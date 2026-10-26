import OpenAI from 'openai';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { decryptSecret } from '@/lib/crypto-secrets';
import { MAX_EDGE_LABEL, MAX_NODE_LABEL, MAX_SPEC_EDGES, MAX_SPEC_NODES, type DiagramSpec } from '@/lib/mcp/diagram-spec';

/**
 * Optional server-side generation for collabpro_create_diagram. Uses the
 * calling team's own provider key (Settings -> AI, AES-256-GCM at rest); if
 * no accessible team has one, no generator exists and the AI tool is simply
 * not registered. The model only ever returns a graph spec - layout and
 * validation stay deterministic and server-side.
 */

const SYSTEM_PROMPT = `You turn a request into a diagram graph. Reply with ONLY one JSON object, no prose, no code fences.
Example of the exact shape (a real, valid reply):
{"direction":"right","nodes":[{"id":"web","label":"Web App","group":"frontend"},{"id":"api","label":"API","group":"backend"}],"edges":[{"from":"web","to":"api","label":"HTTPS"}]}
Rules: "direction" is "right" or "down" and may be omitted; "group" and edge "label" are optional; at most ${MAX_SPEC_NODES} nodes; ids unique; every edge endpoint must be a node id; node labels at most ${MAX_NODE_LABEL} characters; edge labels at most ${MAX_EDGE_LABEL}; use "group" to color related nodes (e.g. "frontend", "data").`;

// Caps what the provider can bill per call: sized for the largest accepted graph.
const MAX_OUTPUT_TOKENS = 4000;

const specSchema = z.object({
  direction: z.enum(['right', 'down']).optional(),
  nodes: z.array(z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(MAX_NODE_LABEL), group: z.string().max(60).optional() })).min(1).max(MAX_SPEC_NODES),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().max(MAX_EDGE_LABEL).optional() })).max(MAX_SPEC_EDGES).optional(),
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
      body: JSON.stringify({ model: settings.model, max_tokens: MAX_OUTPUT_TOKENS, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Provider returned ${res.status}`);
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (json.content ?? []).map((b) => b.text ?? '').join('');
  }
  const client = new OpenAI({ apiKey, baseURL: settings.baseUrl, timeout: 60_000 });
  const res = await client.chat.completions.create({
    model: settings.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }],
  });
  return res.choices[0]?.message?.content ?? '';
}

/** True when any team the user belongs to (creator or member) has a provider configured. Never throws. */
export async function hasAiProvider(prisma: PrismaClient, userEmail: string): Promise<boolean> {
  try {
    const found = await prisma.teamAiSettings.findFirst({
      where: { team: { OR: [{ createdBy: userEmail }, { members: { some: { userEmail } } }] } },
      select: { id: true },
    });
    return !!found;
  } catch {
    return false;
  }
}

/**
 * Generator bound to ONE team's provider. The caller must already have
 * authorized `teamId` for the user; the key used is always that team's own,
 * never another team the user happens to belong to. Undefined when that team
 * has no provider configured.
 */
export async function generatorForTeam(
  prisma: PrismaClient,
  teamId: string,
): Promise<((instruction: string) => Promise<DiagramSpec>) | undefined> {
  const settings: ProviderSettings | null = await prisma.teamAiSettings.findUnique({ where: { teamId } });
  if (!settings) return undefined;
  return async (instruction) => parseSpecFromModelText(await complete(settings, instruction));
}
