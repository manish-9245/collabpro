/**
 * Procedurally generated "premium animated avatar" set. Originally this was
 * a curated list of hotlinked Giphy GIFs - several had already gone dead
 * (404) by the time this was revisited, and there was no reliable way to
 * source/verify a better curated set (no working public Giphy/Tenor test
 * key, and general web search can't confirm what an image actually looks
 * like). A self-contained animated SVG sidesteps both problems: it's a data:
 * URI, so it can never 404, and it's plain markup I can read back, not a
 * black-box hotlink.
 *
 * Renders as a slow-drifting aurora/blob gradient inside a circle. SVG-
 * internal SMIL <animate> keeps animating even though the whole thing is
 * embedded via a normal <img src="data:image/svg+xml,..."> tag - so it drops
 * into every existing avatar render site in the app (profile card, workspace
 * collaborator pile, version history) with zero changes there: the `image`
 * field is still just a string URL, only now one that's always valid.
 */

export interface AvatarPreset {
  id: string;
  name: string;
  colors: [string, string, string];
  /** Relative animation speed multiplier - varies the loop slightly per preset so the grid doesn't pulse in unison. */
  speed: number;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'indigo-aurora', name: 'Indigo Aurora', colors: ['#6965db', '#38bdf8', '#a855f7'], speed: 1 },
  { id: 'emerald-drift', name: 'Emerald Drift', colors: ['#10b981', '#0ea5e9', '#14b8a6'], speed: 1.15 },
  { id: 'sunset-ember', name: 'Sunset Ember', colors: ['#f97316', '#ec4899', '#f59e0b'], speed: 0.9 },
  { id: 'violet-nebula', name: 'Violet Nebula', colors: ['#8b5cf6', '#6366f1', '#d946ef'], speed: 1.1 },
  { id: 'ocean-depth', name: 'Ocean Depth', colors: ['#0ea5e9', '#6965db', '#0891b2'], speed: 1.05 },
  { id: 'rose-quartz', name: 'Rose Quartz', colors: ['#f43f5e', '#f97316', '#ec4899'], speed: 0.95 },
  { id: 'slate-chrome', name: 'Slate Chrome', colors: ['#64748b', '#0ea5e9', '#94a3b8'], speed: 1.2 },
  { id: 'golden-hour', name: 'Golden Hour', colors: ['#f59e0b', '#ef4444', '#f97316'], speed: 0.85 },
];

export function buildAvatarDataUri(preset: AvatarPreset): string {
  const [c1, c2, c3] = preset.colors;
  const d1 = (6 / preset.speed).toFixed(2);
  const d2 = (8 / preset.speed).toFixed(2);
  const d3 = (7 / preset.speed).toFixed(2);
  const d4 = (9 / preset.speed).toFixed(2);
  const d5 = (10 / preset.speed).toFixed(2);

  const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
<defs>
<clipPath id="clip"><circle cx="50" cy="50" r="50"/></clipPath>
<filter id="blur"><feGaussianBlur stdDeviation="13"/></filter>
</defs>
<g clip-path="url(#clip)">
<rect width="100" height="100" fill="#0f172a"/>
<circle r="38" fill="${c1}" filter="url(#blur)">
<animate attributeName="cx" values="30;70;30" dur="${d1}s" repeatCount="indefinite"/>
<animate attributeName="cy" values="30;70;30" dur="${d2}s" repeatCount="indefinite"/>
</circle>
<circle r="34" fill="${c2}" filter="url(#blur)" opacity="0.85">
<animate attributeName="cx" values="70;25;70" dur="${d3}s" repeatCount="indefinite"/>
<animate attributeName="cy" values="65;20;65" dur="${d4}s" repeatCount="indefinite"/>
</circle>
<circle r="28" fill="${c3}" filter="url(#blur)" opacity="0.8">
<animate attributeName="cx" values="50;55;50" dur="${d5}s" repeatCount="indefinite"/>
<animate attributeName="cy" values="20;80;20" dur="${d5}s" repeatCount="indefinite"/>
</circle>
</g>
</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
