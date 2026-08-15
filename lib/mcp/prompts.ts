import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * MCP prompts - reusable instruction templates a client is meant to fetch
 * and inject into its own context BEFORE it starts generating, as opposed
 * to a tool `description` (only read at call time, easy for a model to
 * skim past) or server-side validation in lib/mcp/tools.ts (only catches
 * problems AFTER generation, as a reject-and-retry). This is the "ask the
 * caller AI to follow guidelines while it drafts the diagram" channel the
 * protocol actually provides for that - see
 * https://modelcontextprotocol.io/specification/2025-06-18/server/prompts.
 *
 * The whiteboard guidelines below are condensed from
 * https://github.com/Agents365-ai/excalidraw-skill (MIT) - a design system
 * built specifically for hand-authored Excalidraw JSON (semantic color
 * palette, spacing table, font hierarchy, edge-to-edge arrow binding) that
 * matches this app's own whiteboard format (`@excalidraw/excalidraw`,
 * package.json) more closely than anything worth reinventing here.
 *
 * Registered separately from registerCollabProTools (lib/mcp/tools.ts)
 * because prompts and tools are distinct MCP primitives with their own
 * list/get methods - this file has no auth/DB context of its own to take.
 */
export function registerCollabProPrompts(server: McpServer) {
  server.registerPrompt(
    'collabpro_diagram_guidelines',
    {
      title: 'Whiteboard Diagram Guidelines',
      description: 'Layout, color, and typography rules to follow BEFORE drafting elements for collabpro_update_whiteboard. Fetch this first when asked to generate a diagram - it saves a reject-and-retry round trip, since the server enforces the overlap/number rules on every write, and produces a noticeably cleaner result than ad-hoc coordinates.',
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Follow these rules when composing elements for collabpro_update_whiteboard.',
              '(Condensed from https://github.com/Agents365-ai/excalidraw-skill, MIT.)',
              '',
              '## Hard rules (server rejects the write otherwise)',
              '1. Every shape (rectangle/ellipse/diamond) needs finite numeric x, y, width, height.',
              '2. No two shapes may overlap - the server rejects the whole write and names the offending pair.',
              '3. Every text element needs an explicit, non-empty strokeColor - see Typography below for the 3 approved values. Omitted strokeColor is rejected outright, not just discouraged: it is the single most common way a generated diagram ships with invisible text.',
              '4. Every arrow/line needs a "points" array with 2+ [dx, dy] pairs, and width/height must not both be 0 when those points span a real distance - a 0x0 arrow renders as nothing.',
              '',
              '## Layout',
              '- Prefer typography over boxes: use a standalone text element unless the thing is a real component an arrow connects to. Boxing every label makes it look like a wireframe.',
              '- Compute arrow endpoints edge-to-edge (the shape\'s border facing the target), never center-to-center - a center-to-center line draws straight through both shapes. This math is required regardless of bindings (next bullet) - every renderer, including the export/embed SVG, draws from these literal x/y/points, never re-derived from a binding.',
              '- Genuinely CONNECT an arrow to the shapes it touches, don\'t just position it nearby: set `startBinding: {elementId, focus: 0, gap: 4-6}` and `endBinding: {elementId, focus: 0, gap: 4-6}` referencing the actual shape ids (for a fetched icon, its main background rectangle/ellipse element). Also add `{id: arrowId, type: "arrow"}` to that shape\'s own `boundElements` array so the link is reciprocal. An arrow that only LOOKS adjacent (no binding) will drift out of alignment the moment either shape moves in the live editor - a bound one won\'t.',
              '- Keep arrows short and axis-aligned; route around zones instead of long diagonals crossing unrelated boxes ("spaghetti arrows").',
              '- Spacing reference: 150-200px gap between shapes joined by a labeled arrow, 100-120px if unlabeled, minimum 40px between ANY two elements.',
              '- Element width from label length so text never truncates: max(160, charCount * 9) for Latin, doubled for CJK.',
              '',
              '## Section headers (for a diagram with multiple horizontal rows/zones)',
              'A section header describes the row BELOW it - it must sit ABOVE that row, in the gap between the previous row\'s bottom and this row\'s top, not in the gap after it. Placing "Compute / Auth" in the gap AFTER the compute row (i.e. right before the NEXT row starts) reads backwards: a viewer scanning top-to-bottom meets the label right as they\'re leaving the row it describes and entering the next one. Concretely: header.y should be close to (next_row_top - header.height - ~15), not close to (this_row_bottom + ~15). Keep every section header at the same x (left-aligned with the diagram title) for a consistent scan line - do not center or right-align individual headers to whichever element happens to sit at that row\'s x-position that day.',
              '',
              '## Color (semantic palette - do not invent new colors)',
              '| Category | Fill | Stroke | Use for |',
              '|---|---|---|---|',
              '| Primary/Input | #dbeafe | #1e40af | Entry points, APIs, user-facing |',
              '| Success/Data | #dcfce7 | #166534 | Data stores, success states |',
              '| Warning/Decision | #fef9c3 | #854d0e | Decision points, conditions |',
              '| Error/Critical | #fee2e2 | #991b1b | Errors, alerts, critical paths |',
              '| External/Storage | #f3e8ff | #6b21a8 | External services, databases, AI/ML |',
              '| Process/Default | #e0f2fe | #0369a1 | Standard process steps |',
              '| Trigger/Start | #fed7aa | #c2410c | Start nodes, triggers, events |',
              '| Neutral/Container | #f1f5f9 | #475569 | Groups, swimlanes, backgrounds |',
              '',
              '## Typography',
              '- Font size hierarchy: 28px title, 24px section header, 20px primary label, 16px description, 14px annotation.',
              '- ALWAYS set an explicit dark `strokeColor` on text elements (#1e293b title / #334155 label / #64748b description) - the server rejects a text element with no strokeColor (hard rule 3 above).',
              '',
              '## Icons (real AWS/Azure/GCP/network/UML icons, not plain colored boxes)',
              'Use collabpro_search_icon_libraries (keyword) to find a library, collabpro_list_library_items (librarySource) to see every real icon it contains by name, then collabpro_get_library_icon (librarySource, item, x, y) to fetch and place one. That last call does NOT return the icon\'s element geometry - it returns a short-lived "ref". Pass that ref straight into collabpro_update_whiteboard\'s "iconRefs" array; do not try to hand-draw a colored rectangle as a stand-in "icon" instead of calling these tools - a plain box is never a substitute and is the most common way a diagram ends up looking generic instead of like the real architecture it claims to represent.',
              'An icon is composed of several primitives sharing one `groupIds` entry - that\'s how the server\'s overlap check knows they\'re one visual unit, not colliding diagram nodes. This is handled for you automatically when placing via a ref.',
              'Use sparingly: an icon is a labeled node, not a replacement for the diagram\'s own spacing and arrow rules above.',
              '',
              '## Building a diagram across multiple calls',
              'collabpro_update_whiteboard MERGES by default - each call\'s "whiteboard"/"iconRefs" add to or update whatever is already on the board, nothing else is touched. This is what makes "one call per node" safe: call it once per icon/shape/arrow as you go, and earlier calls\' work is never discarded. Use "deleted" (element ids) to remove something specific. Only pass "replaceAll":true for a deliberate full-board regenerate - it discards anything not included in that one call\'s "whiteboard", which is very rarely what you want mid-build.',
              '',
              '## Worked example - two boxes, correctly spaced, with a labeled connecting arrow',
              '```json',
              JSON.stringify([
                { id: 'client', type: 'rectangle', x: 40, y: 40, width: 180, height: 80, strokeColor: '#1e40af', backgroundColor: '#dbeafe', fillStyle: 'solid', strokeWidth: 2, roughness: 0, opacity: 100, boundElements: [{ id: 'arr-1', type: 'arrow' }] },
                { id: 'client-lbl', type: 'text', x: 60, y: 70, width: 140, height: 20, text: 'Client', fontSize: 16, fontFamily: 2, strokeColor: '#1e293b', backgroundColor: 'transparent' },
                { id: 'server', type: 'rectangle', x: 320, y: 40, width: 180, height: 80, strokeColor: '#0369a1', backgroundColor: '#e0f2fe', fillStyle: 'solid', strokeWidth: 2, roughness: 0, opacity: 100, boundElements: [{ id: 'arr-1', type: 'arrow' }] },
                { id: 'server-lbl', type: 'text', x: 340, y: 70, width: 140, height: 20, text: 'Server', fontSize: 16, fontFamily: 2, strokeColor: '#1e293b', backgroundColor: 'transparent' },
                { id: 'arr-1', type: 'arrow', x: 220, y: 80, width: 100, height: 0, points: [[0, 0], [100, 0]], strokeColor: '#1e293b', backgroundColor: 'transparent', startBinding: { elementId: 'client', focus: 0, gap: 4 }, endBinding: { elementId: 'server', focus: 0, gap: 4 } },
                { id: 'arr-1-lbl', type: 'text', x: 230, y: 50, width: 90, height: 16, text: '1. request', fontSize: 11, fontFamily: 2, strokeColor: '#64748b', backgroundColor: 'transparent' },
              ], null, 2),
              '```',
            ].join('\n'),
          },
        },
      ],
    })
  );
}
