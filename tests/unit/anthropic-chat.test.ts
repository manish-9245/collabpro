import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAnthropicChat } from '@/lib/ai-providers/anthropic-chat';

/** Builds a fetch Response whose body streams the given raw SSE text. */
function sseResponse(events: { event: string; data: unknown }[]): Response {
  const body = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('runAnthropicChat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('streams plain text_delta chunks through emit() with no tool calls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          { event: 'content_block_start', data: { index: 0, content_block: { type: 'text' } } },
          { event: 'content_block_delta', data: { index: 0, delta: { type: 'text_delta', text: 'Hel' } } },
          { event: 'content_block_delta', data: { index: 0, delta: { type: 'text_delta', text: 'lo!' } } },
          { event: 'message_stop', data: {} },
        ])
      )
    );

    const emitted: string[] = [];
    const executeToolCall = vi.fn();

    await runAnthropicChat({
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-test',
      systemPrompt: 'sys',
      history: [{ role: 'user', content: 'hi' }],
      emit: (t) => emitted.push(t),
      executeToolCall,
    });

    expect(emitted.join('')).toBe('Hello!');
    expect(executeToolCall).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('accumulates fragmented input_json_delta, executes the tool, and makes a bounded round-2 request', async () => {
    const round1 = sseResponse([
      { event: 'content_block_start', data: { index: 0, content_block: { type: 'text' } } },
      { event: 'content_block_delta', data: { index: 0, delta: { type: 'text_delta', text: 'Sure, drawing it now.' } } },
      { event: 'content_block_start', data: { index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'update_whiteboard' } } },
      { event: 'content_block_delta', data: { index: 1, delta: { type: 'input_json_delta', partial_json: '{"elements":' } } },
      { event: 'content_block_delta', data: { index: 1, delta: { type: 'input_json_delta', partial_json: '[]}' } } },
      { event: 'message_stop', data: {} },
    ]);
    const round2 = sseResponse([
      { event: 'content_block_delta', data: { index: 0, delta: { type: 'text_delta', text: 'Done!' } } },
      { event: 'message_stop', data: {} },
    ]);

    const fetchMock = vi.fn().mockResolvedValueOnce(round1).mockResolvedValueOnce(round2);
    vi.stubGlobal('fetch', fetchMock);

    const emitted: string[] = [];
    const executeToolCall = vi.fn().mockResolvedValue({ summary: 'Updated the whiteboard with 0 elements.' });

    await runAnthropicChat({
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-test',
      systemPrompt: 'sys',
      history: [{ role: 'user', content: 'draw something' }],
      emit: (t) => emitted.push(t),
      executeToolCall,
    });

    // Tool was called with the fully-reassembled JSON, not a fragment.
    expect(executeToolCall).toHaveBeenCalledWith('update_whiteboard', '{"elements":[]}');

    const fullText = emitted.join('');
    expect(fullText).toContain('Sure, drawing it now.');
    expect(fullText).toContain('Updated the whiteboard with 0 elements.');
    expect(fullText).toContain('Done!');

    // Exactly 2 requests: round 1 (with tools) and round 2 (bounded, no tools).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const round2Body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(round2Body.tools).toBeUndefined();
    expect(round2Body.messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Updated the whiteboard with 0 elements.' }],
    });
  });

  it('surfaces a failed tool call as a warning and an is_error tool_result, without throwing', async () => {
    const round1 = sseResponse([
      { event: 'content_block_start', data: { index: 0, content_block: { type: 'tool_use', id: 'toolu_2', name: 'update_document' } } },
      { event: 'content_block_delta', data: { index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } } },
      { event: 'message_stop', data: {} },
    ]);
    const round2 = sseResponse([{ event: 'message_stop', data: {} }]);
    const fetchMock = vi.fn().mockResolvedValueOnce(round1).mockResolvedValueOnce(round2);
    vi.stubGlobal('fetch', fetchMock);

    const emitted: string[] = [];
    const executeToolCall = vi.fn().mockRejectedValue(new Error('blocks must be a non-empty array'));

    await expect(
      runAnthropicChat({
        apiKey: 'sk-ant-test',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-test',
        systemPrompt: 'sys',
        history: [{ role: 'user', content: 'edit the doc' }],
        emit: (t) => emitted.push(t),
        executeToolCall,
      })
    ).resolves.toBeUndefined();

    expect(emitted.join('')).toContain('blocks must be a non-empty array');
    const round2Body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(round2Body.messages.at(-1).content[0]).toMatchObject({ is_error: true });
  });
});
