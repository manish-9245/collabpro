import OpenAI from 'openai';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/lib/session-auth/server';
import { checkFileAccess } from '@/lib/file-access';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';
import { decryptSecret } from '@/lib/crypto-secrets';
import { extractTextFromDocument } from '@/lib/file-service';
import { AI_CHAT_TOOLS, executeAiChatTool } from '@/lib/ai-chat-tools';

/**
 * Real AI chat send endpoint for the workspace sidebar (AiSidebar.tsx). A
 * standalone route rather than going through app/api/state-sync/route.ts's
 * RPC bus - that bus is plain request/response JSON and has no streaming
 * support anywhere in this app; this is the first streaming response here.
 * Not /api/mcp either - that's API-key-only auth for external agent tools,
 * wrong shape for a same-origin browser chat call.
 *
 * Chat message is short plain text - no document/whiteboard payload is ever
 * sent in the request body (context is loaded server-side from the DB), so
 * this cap can be far smaller than /api/mcp's 5MB.
 */
const MAX_CHAT_BODY_BYTES = 32 * 1024;

// Context budgets - the actual "manages context well" mechanism. Document
// and whiteboard text are each capped independently; history is capped by
// BOTH message count and combined character length, whichever hits first.
// Worst case: ~8-9k (system prompt) + 12k (history) chars, comfortably under
// any modern context window including small local models.
const CONTEXT_CHAR_BUDGET = 4000;
const HISTORY_MAX_MESSAGES = 20;
const HISTORY_MAX_CHARS = 12000;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[...truncated]` : text;
}

function buildSystemPrompt(file: { fileName: string; document: string; whiteboardText: string }): string {
  const docText = truncate(extractTextFromDocument(file.document), CONTEXT_CHAR_BUDGET);
  const boardText = truncate(file.whiteboardText || '', CONTEXT_CHAR_BUDGET);
  return `You are an AI assistant embedded in CollabPro, helping with the file "${file.fileName}".

Document content:
${docText || '(empty)'}

Whiteboard content:
${boardText || '(empty)'}

You are not limited to talking - you have update_document and update_whiteboard tools that actually write to this file. When the user asks you to write, draft, edit, draw, diagram, or sketch something, call the tool and do it, rather than just describing what you would write in chat.

Answer the user's questions about this file. Be concise.`;
}

/** Walks most-recent-first, keeping messages until either budget is hit, then restores chronological order. */
function trimHistory(chronological: { role: string; content: string }[]): { role: 'user' | 'assistant'; content: string }[] {
  const kept: { role: string; content: string }[] = [];
  let totalChars = 0;
  for (let i = chronological.length - 1; i >= 0 && kept.length < HISTORY_MAX_MESSAGES; i--) {
    const msg = chronological[i];
    if (totalChars + msg.content.length > HISTORY_MAX_CHARS) break;
    totalChars += msg.content.length;
    kept.unshift(msg);
  }
  return kept as { role: 'user' | 'assistant'; content: string }[];
}

interface AccumulatedToolCall {
  id?: string;
  name?: string;
  args: string;
}

/**
 * `userId` is a nullable FK (`onDelete: SetNull`) specifically so a chat
 * message survives its author's account being deleted later. It doesn't
 * protect against the write itself: a long-lived session JWT can carry a
 * `user.id` claim from BEFORE an account was deleted and recreated (same
 * email, new row, new id) - the old id then matches no current User row and
 * the insert fails with a foreign-key violation (P2003) even though
 * `userEmail` is perfectly valid. Rather than 500 the whole chat over an
 * unrelated stale-token edge case, retry once with userId omitted - exactly
 * the state a SetNull cleanup would have left it in anyway.
 */
async function createChatMessage(data: { fileId: string; userEmail: string; userId?: string | null; role: string; content: string }) {
  try {
    return await prisma.chatMessage.create({ data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return prisma.chatMessage.create({ data: { ...data, userId: null } });
    }
    throw err;
  }
}

export async function POST(request: Request): Promise<Response> {
  const user = await getServerSession().getUser();
  if (!user?.email) {
    return Response.json({ error: 'unauthorized', message: 'Unauthorized' }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(`ai_chat:${user.email}`, LIMITS.AI_CHAT);
  if (!rateLimit.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
    return Response.json(
      { error: 'rate_limited', message: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
    );
  }

  const bodyBuffer = await request.arrayBuffer();
  if (bodyBuffer.byteLength > MAX_CHAT_BODY_BYTES) {
    return Response.json({ error: 'body_too_large', message: `Request body exceeds ${MAX_CHAT_BODY_BYTES}-byte limit` }, { status: 413 });
  }

  let fileId: unknown;
  let message: unknown;
  try {
    ({ fileId, message } = JSON.parse(new TextDecoder().decode(bodyBuffer)));
  } catch {
    return Response.json({ error: 'invalid_json', message: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof fileId !== 'string' || !fileId || typeof message !== 'string' || !message.trim()) {
    return Response.json({ error: 'bad_request', message: 'fileId and a non-empty message are required' }, { status: 400 });
  }

  const hasAccess = await checkFileAccess(fileId, user.email);
  if (!hasAccess) {
    return Response.json({ error: 'forbidden', message: 'You do not have access to this file' }, { status: 403 });
  }

  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file) {
    return Response.json({ error: 'not_found', message: 'File not found' }, { status: 404 });
  }

  const settings = await prisma.teamAiSettings.findUnique({ where: { teamId: file.teamId } });
  if (!settings) {
    return Response.json(
      { error: 'no_ai_configured', message: 'No AI provider configured for this team. Ask a team owner to set one up in Settings → AI.' },
      { status: 409 }
    );
  }

  // Persisted BEFORE calling the LLM, so the user's message is never lost
  // even if the call itself fails.
  await createChatMessage({ fileId, userEmail: user.email, userId: user.id, role: 'user', content: message });

  const systemPrompt = buildSystemPrompt({ fileName: file.fileName, document: file.document, whiteboardText: file.whiteboardText });
  const recent = await prisma.chatMessage.findMany({
    where: { fileId, userEmail: user.email },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_MAX_MESSAGES,
  });
  const trimmed = trimHistory(recent.reverse());
  const baseMessages: any[] = [{ role: 'system', content: systemPrompt }, ...trimmed];

  let client: OpenAI;
  let round1Stream: AsyncIterable<any>;
  try {
    client = new OpenAI({ apiKey: decryptSecret(settings.encryptedKey), baseURL: settings.baseUrl });
    round1Stream = await client.chat.completions.create({
      model: settings.model,
      stream: true,
      messages: baseMessages,
      tools: AI_CHAT_TOOLS,
    });
  } catch (err) {
    return Response.json(
      { error: 'llm_request_failed', message: err instanceof Error ? err.message : 'Failed to reach the configured AI provider' },
      { status: 502 }
    );
  }

  let full = '';
  const persistAssistantReply = () => {
    if (!full.trim()) return;
    // Fire-and-forget: this can run from ReadableStream's `cancel()` (client
    // disconnected), where nothing awaits it - a rejected promise here must
    // not become an unhandled rejection.
    createChatMessage({ fileId: fileId as string, userEmail: user.email as string, userId: user.id, role: 'assistant', content: full }).catch(() => {});
  };

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (text: string) => {
        full += text;
        controller.enqueue(encoder.encode(text));
      };

      try {
        const toolCalls = new Map<number, AccumulatedToolCall>();
        let round1Content = '';

        for await (const chunk of round1Stream) {
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            round1Content += delta.content;
            emit(delta.content);
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const entry = toolCalls.get(idx) || { args: '' };
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name = tc.function.name;
              if (tc.function?.arguments) entry.args += tc.function.arguments;
              toolCalls.set(idx, entry);
            }
          }
        }

        const resolvedToolCalls = Array.from(toolCalls.values()).filter(
          (tc): tc is Required<AccumulatedToolCall> => !!tc.id && !!tc.name
        );

        // Bounded to exactly one tool round trip - round 2 is called without
        // `tools`, so the model can't chain further calls indefinitely.
        if (resolvedToolCalls.length > 0) {
          const assistantToolCalls = resolvedToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.args },
          }));

          const toolResultMessages: { role: 'tool'; tool_call_id: string; content: string }[] = [];
          for (const tc of assistantToolCalls) {
            try {
              const result = await executeAiChatTool(tc.function.name, tc.function.arguments, { prisma, fileId: fileId as string });
              emit(`⚡ ${result.summary}\n\n`);
              toolResultMessages.push({ role: 'tool', tool_call_id: tc.id, content: result.summary });
              void logAuditEvent(file.teamId, user.email as string, 'ai_chat:action', { fileId, tool: tc.function.name }, getClientIp(request));
            } catch (err) {
              const errMessage = err instanceof Error ? err.message : String(err);
              emit(`⚠️ ${tc.function.name} failed: ${errMessage}\n\n`);
              toolResultMessages.push({ role: 'tool', tool_call_id: tc.id, content: `Error: ${errMessage}` });
            }
          }

          const round2Messages = [
            ...baseMessages,
            { role: 'assistant', content: round1Content || null, tool_calls: assistantToolCalls },
            ...toolResultMessages,
          ];
          const round2Stream = await client.chat.completions.create({
            model: settings.model,
            stream: true,
            messages: round2Messages,
          });
          for await (const chunk of round2Stream) {
            const delta = chunk.choices?.[0]?.delta?.content || '';
            if (delta) emit(delta);
          }
        }
      } catch {
        // Provider stream errored mid-flight - fall through to persist
        // whatever partial text was already generated, same as a clean
        // disconnect.
      } finally {
        controller.close();
        persistAssistantReply();
        void logAuditEvent(file.teamId, user.email as string, 'ai_chat:message', { fileId }, getClientIp(request));
      }
    },
    // Client disconnected mid-stream (e.g. closed the tab) - the provider
    // already generated (and was paid for) whatever tokens arrived so far,
    // so persist the partial reply rather than silently losing it.
    cancel() {
      persistAssistantReply();
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
