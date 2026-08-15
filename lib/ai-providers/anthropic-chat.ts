import { AI_CHAT_TOOLS } from '@/lib/ai-chat-tools';

/**
 * Native Anthropic Messages API chat path for app/api/ai/chat/route.ts.
 * Anthropic doesn't speak the OpenAI chat-completions wire format (no
 * /chat/completions, no `choices[].delta`, tool calls are content blocks
 * not a separate `tool_calls` array) - unlike OpenAI/Gemini/NVIDIA NIM,
 * which all share that format and reuse route.ts's existing OpenAI-SDK
 * code unchanged. Implemented with plain `fetch` + manual SSE parsing
 * rather than a new SDK dependency, matching how the rest of this route
 * already streams (no framework, no library, just a ReadableStream).
 *
 * Mirrors the OpenAI path's contract exactly: emits plain text chunks via
 * `emit()`, executes at most one bounded round of tool calls, and returns
 * once done - route.ts doesn't need to know which provider it just talked to.
 */

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 4096;

interface AnthropicToolUse {
  id: string;
  name: string;
  inputJson: string;
}

function safeParseJson(jsonStr: string): unknown {
  try {
    return jsonStr ? JSON.parse(jsonStr) : {};
  } catch {
    return {};
  }
}

/** Parses a Server-Sent Events stream, calling onEvent(eventType, parsedData) per event. */
async function streamSSE(response: Response, onEvent: (eventType: string, data: any) => void): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let eventType = 'message';
      const dataLines: string[] = [];
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;

      try {
        onEvent(eventType, JSON.parse(dataLines.join('\n')));
      } catch {
        // Malformed/partial chunk - skip rather than abort the whole stream.
      }
    }
  }
}

/** One Anthropic Messages API turn (streamed). Returns the accumulated text and any tool_use blocks. */
async function runAnthropicTurn(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  messages: unknown[];
  tools?: unknown[];
  emit: (text: string) => void;
}): Promise<{ text: string; toolUses: AnthropicToolUse[] }> {
  const res = await fetch(`${opts.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      system: opts.system,
      messages: opts.messages,
      max_tokens: MAX_TOKENS,
      stream: true,
      ...(opts.tools ? { tools: opts.tools } : {}),
    }),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic request failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  let text = '';
  const blocksByIndex = new Map<number, { type: string; id?: string; name?: string; json: string }>();

  await streamSSE(res, (eventType, data) => {
    if (eventType === 'content_block_start') {
      const block = data.content_block;
      blocksByIndex.set(data.index, { type: block?.type, id: block?.id, name: block?.name, json: '' });
    } else if (eventType === 'content_block_delta') {
      const delta = data.delta;
      if (delta?.type === 'text_delta' && delta.text) {
        text += delta.text;
        opts.emit(delta.text);
      } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const entry = blocksByIndex.get(data.index);
        if (entry) entry.json += delta.partial_json;
      }
    }
  });

  const toolUses: AnthropicToolUse[] = [];
  for (const block of blocksByIndex.values()) {
    if (block.type === 'tool_use' && block.id && block.name) {
      toolUses.push({ id: block.id, name: block.name, inputJson: block.json || '{}' });
    }
  }

  return { text, toolUses };
}

export async function runAnthropicChat(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  emit: (text: string) => void;
  /** Executes one tool call and returns its summary - throws on failure. Caller is responsible for any audit logging on success. */
  executeToolCall: (name: string, argsJson: string) => Promise<{ summary: string }>;
}): Promise<void> {
  const tools = AI_CHAT_TOOLS.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  const round1 = await runAnthropicTurn({
    apiKey: params.apiKey,
    baseUrl: params.baseUrl,
    model: params.model,
    system: params.systemPrompt,
    messages: params.history,
    tools,
    emit: params.emit,
  });

  if (round1.toolUses.length === 0) return;

  const assistantContent: any[] = [];
  if (round1.text) assistantContent.push({ type: 'text', text: round1.text });

  const toolResultBlocks: any[] = [];
  for (const tu of round1.toolUses) {
    assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: safeParseJson(tu.inputJson) });
    try {
      const result = await params.executeToolCall(tu.name, tu.inputJson);
      params.emit(`⚡ ${result.summary}\n\n`);
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: result.summary });
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      params.emit(`⚠️ ${tu.name} failed: ${errMessage}\n\n`);
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${errMessage}`, is_error: true });
    }
  }

  const round2Messages = [
    ...params.history,
    { role: 'assistant', content: assistantContent },
    { role: 'user', content: toolResultBlocks },
  ];

  // Bounded to exactly one tool round trip, same as the OpenAI path - no
  // `tools` passed this time, so the model can't chain further calls.
  await runAnthropicTurn({
    apiKey: params.apiKey,
    baseUrl: params.baseUrl,
    model: params.model,
    system: params.systemPrompt,
    messages: round2Messages,
    emit: params.emit,
  });
}
