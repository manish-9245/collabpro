import OpenAI from 'openai';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { decryptSecret } from '@/lib/crypto-secrets';
import { MAX_SPEC_EDGES, MAX_SPEC_NODES, type DiagramSpec } from '@/lib/mcp/diagram-spec';

/**
 * Optional server-side generation for collabpro_create_diagram. Uses the
 * calling team's own provider key (Settings -> AI, AES-256-GCM at rest); if
 * no accessible team has one, no generator exists and the AI tool is simply
 * not registered. The model only ever returns a graph spec - layout and
 * validation stay deterministic and server-side.
 */

const SYSTEM_PROMPT = `You turn a request into a diagram graph. Reply with ONLY a JSON object, no prose, no code fences:
{"direction":"right"|"down","nodes":[{"id":"short-kebab-id","label":"Short label","group":"optional group name"}],"edges":[{"from":"id","to":"id","label":"optional"}]}
Rules: at most ${MAX_SPEC_NODES} nodes; ids unique; every edge endpoint must be a node id; labels under 40 characters; use "group" to color related nodes (e.g. "frontend", "data").`;

const specSchema = z.object({
  direction: z.enum(['right', 'down']).optional(),
  nodes: z.array(z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(120), group: z.string().max(60).optional() })).min(1).max(MAX_SPEC_NODES),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().max(80).optional() })).max(MAX_SPEC_EDGES).optional(),
});

export function parseSpecFromModelText(text: string): DiagramSpec {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model did not return JSON');
  return specSchema.parse(JSON.parse(text.slice(start, end + 1)));
}

interface ProviderSettings {
  provider: string;
  baseUrl: string;
  encryptedKey: string;
  model: string;
}

async function complete(settings: ProviderSettings, user: string): Promise<string> {
  const apiKey = decryptSecret(settings.encryptedKey);
  if (settings.provider === 'anthropic') {
    const res = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: settings.model, max_tokens: 2000, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Provider returned ${res.status}`);
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (json.content ?? []).map((b) => b.text ?? '').join('');
  }
  const client = new OpenAI({ apiKey, baseURL: settings.baseUrl, timeout: 60_000 });
  const res = await client.chat.completions.create({
    model: settings.model,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }],
  });
  return res.choices[0]?.message?.content ?? '';
}

/**
 * Returns a generator when a team the user belongs to (creator or member) has
 * a provider configured, else undefined. Never throws: a lookup failure just
 * means the optional AI tool is not offered.
 */
export async function resolveSpecGenerator(
  prisma: PrismaClient,
  userEmail: string,
): Promise<((instruction: string, existing?: string) => Promise<DiagramSpec>) | undefined> {
  let settings: ProviderSettings | null = null;
  try {
    settings = await prisma.teamAiSettings.findFirst({
      where: { team: { OR: [{ createdBy: userEmail }, { members: { some: { userEmail } } }] } },
    });
  } catch {
    return undefined;
  }
  if (!settings) return undefined;
  const resolved = settings;
  return async (instruction, existing) => {
    const prompt = existing ? `Existing diagram labels: ${existing}\n\nRequest: ${instruction}` : instruction;
    return parseSpecFromModelText(await complete(resolved, prompt));
  };
}
