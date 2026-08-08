import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { POST as chatPOST } from '@/app/api/ai/chat/route';
import { getServerSession } from '@/lib/session-auth/server';
import { checkFileAccess } from '@/lib/file-access';
import { checkRateLimit } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';
import { decryptSecret } from '@/lib/crypto-secrets';

const mockGetUser = vi.fn();
vi.mock('@/lib/session-auth/server', () => ({
  getServerSession: () => ({ getUser: mockGetUser }),
}));

vi.mock('@/lib/file-access', () => ({
  checkFileAccess: vi.fn(),
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 19, resetAt: Date.now() + 60_000, firstBlock: false }),
  getClientIp: () => '203.0.113.1',
  LIMITS: { AI_CHAT: { windowMs: 60_000, maxAttempts: 20 } },
}));

vi.mock('@/lib/audit', () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock('@/lib/crypto-secrets', () => ({
  decryptSecret: vi.fn().mockReturnValue('sk-real-key'),
}));

const mockFileFindUnique = vi.fn();
const mockTeamAiSettingsFindUnique = vi.fn();
const mockChatMessageCreate = vi.fn();
const mockChatMessageFindMany = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    file: { findUnique: (...args: any[]) => mockFileFindUnique(...args) },
    teamAiSettings: { findUnique: (...args: any[]) => mockTeamAiSettingsFindUnique(...args) },
    chatMessage: {
      create: (...args: any[]) => mockChatMessageCreate(...args),
      findMany: (...args: any[]) => mockChatMessageFindMany(...args),
    },
  },
}));

// Async-iterable fake stream mimicking the OpenAI SDK's chat.completions.create({stream:true}) return.
function fakeLlmStream(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield { choices: [{ delta: { content: c } }] };
    },
  };
}

const mockCreateCompletion = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: (...args: any[]) => mockCreateCompletion(...args) } };
  },
}));

const mockExecuteAiChatTool = vi.fn();
vi.mock('@/lib/ai-chat-tools', () => ({
  AI_CHAT_TOOLS: [{ type: 'function', function: { name: 'update_document' } }, { type: 'function', function: { name: 'update_whiteboard' } }],
  executeAiChatTool: (...args: any[]) => mockExecuteAiChatTool(...args),
}));

// Mimics a real OpenAI streaming response where a tool call's `arguments`
// arrive fragmented across several chunks (as they do in production) and
// must be concatenated by index before parsing.
function fakeToolCallStream(id: string, name: string, argFragments: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] } }] };
      for (const frag of argFragments) {
        yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: frag } }] } }] };
      }
    },
  };
}

function chatRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

describe('POST /api/ai/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 19, resetAt: Date.now() + 60_000, firstBlock: false });
    mockFileFindUnique.mockResolvedValue({ id: 'file-1', teamId: 'team-1', fileName: 'Doc', document: '', whiteboard: '', whiteboardText: '' });
    mockTeamAiSettingsFindUnique.mockResolvedValue({ teamId: 'team-1', baseUrl: 'https://api.openai.com/v1', encryptedKey: 'enc', model: 'gpt-4o-mini' });
    mockChatMessageFindMany.mockResolvedValue([]);
    mockChatMessageCreate.mockResolvedValue({});
    mockCreateCompletion.mockResolvedValue(fakeLlmStream(['Hel', 'lo!']));
  });

  it('401s when unauthenticated', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await chatPOST(chatRequest({ fileId: 'file-1', message: 'hi' }));
    expect(res.status).toBe(401);
  });

  it('429s and sets Retry-After when rate limited', async () => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'dev@collabpro.com' });
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 5000, firstBlock: true });
    const res = await chatPOST(chatRequest({ fileId: 'file-1', message: 'hi' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('413s over the body size cap', async () => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'dev@collabpro.com' });
    const res = await chatPOST(chatRequest({ fileId: 'file-1', message: 'x'.repeat(40 * 1024) }));
    expect(res.status).toBe(413);
  });

  it('400s on missing fileId/message', async () => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'dev@collabpro.com' });
    const res = await chatPOST(chatRequest({ fileId: 'file-1', message: '   ' }));
    expect(res.status).toBe(400);
  });

  it('403s when the user lacks file access', async () => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'dev@collabpro.com' });
    vi.mocked(checkFileAccess).mockResolvedValue(false);
    const res = await chatPOST(chatRequest({ fileId: 'file-1', message: 'hi' }));
    expect(res.status).toBe(403);
  });

  it('409s with a clear error when the team has no AI provider configured', async () => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'dev@collabpro.com' });
    vi.mocked(checkFileAccess).mockResolvedValue(true);
    mockTeamAiSettingsFindUnique.mockResolvedValue(null);
    const res = await chatPOST(chatRequest({ fileId: 'file-1', message: 'hi' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('no_ai_configured');
    expect(mockChatMessageCreate).not.toHaveBeenCalled(); // never even persists the user message
  });

  it('persists the user message before calling the LLM, streams the reply, and persists the assistant reply after', async () => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'dev@collabpro.com' });
    vi.mocked(checkFileAccess).mockResolvedValue(true);

    const res = await chatPOST(chatRequest({ fileId: 'file-1', message: 'What does this file do?' }));
    expect(res.status).toBe(200);

    // User message persisted first (before the LLM call resolves in real usage;
    // here, before we even read the stream).
    expect(mockChatMessageCreate).toHaveBeenCalledWith({
      data: { fileId: 'file-1', userEmail: 'dev@collabpro.com', userId: 'u1', role: 'user', content: 'What does this file do?' },
    });

    const text = await readAll(res);
    expect(text).toBe('Hello!');

    // Assistant reply persisted after the stream completes.
    expect(mockChatMessageCreate).toHaveBeenCalledWith({
      data: { fileId: 'file-1', userEmail: 'dev@collabpro.com', userId: 'u1', role: 'assistant', content: 'Hello!' },
    });
    expect(logAuditEvent).toHaveBeenCalledWith('team-1', 'dev@collabpro.com', 'ai_chat:message', { fileId: 'file-1' }, '203.0.113.1');
  });

  it('decrypts the team key and calls the LLM with the trimmed history + system prompt including file context', async () => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'dev@collabpro.com' });
    vi.mocked(checkFileAccess).mockResolvedValue(true);
    mockFileFindUnique.mockResolvedValue({ id: 'file-1', teamId: 'team-1', fileName: 'Login Diagram', document: '', whiteboard: '', whiteboardText: 'Browser Login API' });
    // Route queries `orderBy: { createdAt: 'desc' }` then reverses to
    // chronological order - so the mock must return newest-first, matching
    // what real Prisma would hand back.
    mockChatMessageFindMany.mockResolvedValue([
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'earlier question' },
    ]);

    await chatPOST(chatRequest({ fileId: 'file-1', message: 'follow up' }));

    expect(decryptSecret).toHaveBeenCalledWith('enc');
    const callArgs = mockCreateCompletion.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4o-mini');
    expect(callArgs.stream).toBe(true);
    expect(callArgs.messages[0].role).toBe('system');
    expect(callArgs.messages[0].content).toContain('Login Diagram');
    expect(callArgs.messages[0].content).toContain('Browser Login API');
    expect(callArgs.messages.slice(1)).toEqual([
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ]);
  });

  it('persists a partial assistant reply if the client disconnects mid-stream', async () => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'dev@collabpro.com' });
    vi.mocked(checkFileAccess).mockResolvedValue(true);

    const res = await chatPOST(chatRequest({ fileId: 'file-1', message: 'hi' }));
    const reader = res.body!.getReader();
    await reader.read(); // read one chunk
    await reader.cancel(); // simulate the client disconnecting

    // give the fire-and-forget persistence a tick
    await new Promise((r) => setTimeout(r, 0));

    const assistantCalls = mockChatMessageCreate.mock.calls.filter((c) => c[0].data.role === 'assistant');
    expect(assistantCalls.length).toBe(1);
    expect(assistantCalls[0][0].data.content.length).toBeGreaterThan(0);
  });

  it('actually takes actions: executes a tool call, streams an action marker, and does a second round-trip for the final reply', async () => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'dev@collabpro.com' });
    vi.mocked(checkFileAccess).mockResolvedValue(true);
    mockExecuteAiChatTool.mockResolvedValue({ summary: 'Added 3 elements to the whiteboard.' });

    mockCreateCompletion
      .mockResolvedValueOnce(fakeToolCallStream('call_1', 'update_whiteboard', ['{"elements":[{"id"', ':"a"}]}']))
      .mockResolvedValueOnce(fakeLlmStream(['Done, ', 'drew it!']));

    const res = await chatPOST(chatRequest({ fileId: 'file-1', message: 'draw a login flow' }));
    const text = await readAll(res);

    // Tool executed with the fully-concatenated (fragmented across chunks) arguments.
    expect(mockExecuteAiChatTool).toHaveBeenCalledWith(
      'update_whiteboard',
      '{"elements":[{"id":"a"}]}',
      { prisma: expect.anything(), fileId: 'file-1' }
    );

    // Action marker streamed inline, followed by the model's final natural-language reply.
    expect(text).toBe('⚡ Added 3 elements to the whiteboard.\n\nDone, drew it!');

    // Round 2 call has no `tools` (bounded to one tool round trip) and includes
    // the assistant's tool_calls turn + the tool result as real conversation history.
    expect(mockCreateCompletion).toHaveBeenCalledTimes(2);
    const round2Args = mockCreateCompletion.mock.calls[1][0];
    expect(round2Args.tools).toBeUndefined();
    const msgs = round2Args.messages;
    expect(msgs[msgs.length - 2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'update_whiteboard', arguments: '{"elements":[{"id":"a"}]}' } }],
    });
    expect(msgs[msgs.length - 1]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'Added 3 elements to the whiteboard.' });

    // Both the action marker and the final reply are persisted together as one message.
    expect(mockChatMessageCreate).toHaveBeenCalledWith({
      data: { fileId: 'file-1', userEmail: 'dev@collabpro.com', userId: 'u1', role: 'assistant', content: '⚡ Added 3 elements to the whiteboard.\n\nDone, drew it!' },
    });
    expect(logAuditEvent).toHaveBeenCalledWith('team-1', 'dev@collabpro.com', 'ai_chat:action', { fileId: 'file-1', tool: 'update_whiteboard' }, '203.0.113.1');
  });

  it('reports a failed tool execution inline instead of silently dropping it, and still completes with a final reply', async () => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'dev@collabpro.com' });
    vi.mocked(checkFileAccess).mockResolvedValue(true);
    mockExecuteAiChatTool.mockRejectedValue(new Error('Whiteboard rejected - shapes overlap'));

    mockCreateCompletion
      .mockResolvedValueOnce(fakeToolCallStream('call_1', 'update_whiteboard', ['{"elements":[]}']))
      .mockResolvedValueOnce(fakeLlmStream(['Sorry, that failed.']));

    const res = await chatPOST(chatRequest({ fileId: 'file-1', message: 'draw something' }));
    const text = await readAll(res);

    expect(text).toContain('⚠️ update_whiteboard failed: Whiteboard rejected - shapes overlap');
    expect(text).toContain('Sorry, that failed.');

    const round2Args = mockCreateCompletion.mock.calls[1][0];
    const toolResultMsg = round2Args.messages[round2Args.messages.length - 1];
    expect(toolResultMsg).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'Error: Whiteboard rejected - shapes overlap' });
  });

  it('self-heals a stale session userId (foreign key violation) by retrying without userId, instead of 500ing the whole chat', async () => {
    // Regression: found live - a long-lived session JWT can carry a
    // `user.id` claim from before the account was deleted and recreated
    // (same email, new row/id). ChatMessage.userId is a real FK, so the
    // insert throws P2003 even though userEmail is perfectly valid.
    mockGetUser.mockResolvedValue({ id: 'stale-id-from-old-account', email: 'dev@collabpro.com' });
    vi.mocked(checkFileAccess).mockResolvedValue(true);

    const fkError = new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated', { code: 'P2003', clientVersion: '7.9.0' });
    mockChatMessageCreate
      .mockRejectedValueOnce(fkError) // user message, first attempt (stale userId)
      .mockResolvedValueOnce({}) // user message, retry with userId: null
      .mockRejectedValueOnce(fkError) // assistant message, first attempt
      .mockResolvedValueOnce({}); // assistant message, retry with userId: null

    const res = await chatPOST(chatRequest({ fileId: 'file-1', message: 'hi' }));
    expect(res.status).toBe(200);
    await readAll(res);

    expect(mockChatMessageCreate).toHaveBeenCalledWith({
      data: { fileId: 'file-1', userEmail: 'dev@collabpro.com', userId: null, role: 'user', content: 'hi' },
    });
    expect(mockChatMessageCreate).toHaveBeenCalledWith({
      data: { fileId: 'file-1', userEmail: 'dev@collabpro.com', userId: null, role: 'assistant', content: 'Hello!' },
    });
  });
});
