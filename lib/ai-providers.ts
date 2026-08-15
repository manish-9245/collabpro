/**
 * Provider presets for AI Co-Pilot Setup. Shared between the frontend
 * (app/(routes)/dashboard/settings/ai/page.tsx - dropdown + setup guide) and
 * the backend (app/api/ai/models/route.ts - dynamic model listing,
 * app/api/ai/chat/route.ts - which branch to call).
 *
 * OpenAI, Gemini, and NVIDIA NIM are all genuinely OpenAI-compatible chat-
 * completions endpoints (Gemini via Google's own /v1beta/openai/ compat
 * layer), so the existing OpenAI SDK path in chat/route.ts already works for
 * all three unchanged - just a baseUrl swap. Anthropic's Messages API is a
 * different shape entirely (no /chat/completions, no `choices[].delta`), so
 * it gets a real second code path (lib/ai-providers/anthropic-chat.ts).
 */
export type AiProviderId = 'openai' | 'anthropic' | 'gemini' | 'nvidia_nim' | 'custom';

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  /** Whether this provider speaks the OpenAI chat-completions wire format (true) or needs its own code path (false). */
  openAiCompatible: boolean;
  defaultBaseUrl: string;
  /** Where a user gets/manages an API key for this provider - a real, well-known URL, shown in the setup guide. */
  keyManagementUrl: string;
  setupNote: string;
}

export const AI_PROVIDER_PRESETS: Record<AiProviderId, AiProviderPreset> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    openAiCompatible: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyManagementUrl: 'https://platform.openai.com/api-keys',
    setupNote: 'Create a secret key on the OpenAI platform, then pick a model below.',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    openAiCompatible: false,
    defaultBaseUrl: 'https://api.anthropic.com',
    keyManagementUrl: 'https://console.anthropic.com/settings/keys',
    setupNote: 'Create an API key in the Anthropic Console. Uses the native Messages API, not an OpenAI-compatible shim.',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    openAiCompatible: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    keyManagementUrl: 'https://aistudio.google.com/apikey',
    setupNote: "Create a key in Google AI Studio. Routed through Gemini's own OpenAI-compatibility layer.",
  },
  nvidia_nim: {
    id: 'nvidia_nim',
    label: 'NVIDIA NIM',
    openAiCompatible: true,
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    keyManagementUrl: 'https://build.nvidia.com/',
    setupNote: 'Generate an API key on build.nvidia.com for any hosted NIM model.',
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    openAiCompatible: true,
    defaultBaseUrl: '',
    keyManagementUrl: '',
    setupNote: 'Any self-hosted or third-party endpoint that speaks the OpenAI chat-completions API (e.g. Groq, OpenRouter, local Ollama/vLLM).',
  },
};

export function isKnownProvider(value: string): value is AiProviderId {
  return Object.prototype.hasOwnProperty.call(AI_PROVIDER_PRESETS, value);
}

/** Server-side only: fetches the live model list from a provider. Never logs or persists the apiKey. */
export async function fetchProviderModels(provider: AiProviderId, baseUrl: string, apiKey: string): Promise<string[]> {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    if (!res.ok) throw new Error(`Anthropic models request failed (${res.status})`);
    const body = await res.json();
    return (body.data ?? []).map((m: { id: string }) => m.id);
  }

  if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) throw new Error(`Gemini models request failed (${res.status})`);
    const body = await res.json();
    return (body.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: { name: string }) => m.name.replace(/^models\//, ''));
  }

  // openai / nvidia_nim / custom: all OpenAI-compatible GET {baseUrl}/models
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${normalizedBase}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Models request failed (${res.status})`);
  const body = await res.json();
  return (body.data ?? []).map((m: { id: string }) => m.id);
}
