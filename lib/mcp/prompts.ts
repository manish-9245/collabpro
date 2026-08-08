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
              '',
              '## Layout',
              '- Prefer typography over boxes: use a standalone text element unless the thing is a real component an arrow connects to. Boxing every label makes it look like a wireframe.',
              '- Compute arrow endpoints edge-to-edge (the shape\'s border facing the target), never center-to-center - a center-to-center line draws straight through both shapes.',
              '- Keep arrows short and axis-aligned; route around zones instead of long diagonals crossing unrelated boxes ("spaghetti arrows").',
              '- Spacing reference: 150-200px gap between shapes joined by a labeled arrow, 100-120px if unlabeled, minimum 40px between ANY two elements.',
              '- Element width from label length so text never truncates: max(160, charCount * 9) for Latin, doubled for CJK.',
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
              '- ALWAYS set an explicit dark `strokeColor` on text elements (#1e293b title / #334155 label / #64748b description) - omitted strokeColor can make text invisible against the shape background.',
              '',
              '## Icons (real AWS/Azure/GCP/network/UML icons, not plain boxes)',
              'Use collabpro_search_icon_libraries (keyword) to find a library, then collabpro_get_library_icon (librarySource, item, x, y) to fetch one icon - it returns ready-to-use elements already translated to (x, y) and ID-namespaced, no manual coordinate math needed. Splice the returned elements array into your collabpro_update_whiteboard call alongside your other elements.',
              'Keep the returned `groupIds` as-is. An icon\'s primitives are drawn deliberately overlapping (e.g. nested rectangles inside an ellipse) to compose the image - the server\'s overlap check exempts any two shapes that share a `groupIds` entry for exactly this reason. If you compose a multi-primitive icon yourself instead of fetching one, give all of its parts one shared groupIds entry so they aren\'t rejected as colliding diagram nodes.',
              'Use sparingly: an icon is a labeled node, not a replacement for the diagram\'s own spacing and arrow rules above.',
              '',
              '## Worked example - two boxes, correctly spaced, with a labeled connecting arrow',
              '```json',
              JSON.stringify([
                { id: 'client', type: 'rectangle', x: 40, y: 40, width: 180, height: 80, strokeColor: '#1e40af', backgroundColor: '#dbeafe', fillStyle: 'solid', strokeWidth: 2, roughness: 0, opacity: 100 },
                { id: 'client-lbl', type: 'text', x: 60, y: 70, width: 140, height: 20, text: 'Client', fontSize: 16, fontFamily: 2, strokeColor: '#1e293b', backgroundColor: 'transparent' },
                { id: 'server', type: 'rectangle', x: 320, y: 40, width: 180, height: 80, strokeColor: '#0369a1', backgroundColor: '#e0f2fe', fillStyle: 'solid', strokeWidth: 2, roughness: 0, opacity: 100 },
                { id: 'server-lbl', type: 'text', x: 340, y: 70, width: 140, height: 20, text: 'Server', fontSize: 16, fontFamily: 2, strokeColor: '#1e293b', backgroundColor: 'transparent' },
                { id: 'arr-1', type: 'arrow', x: 220, y: 80, width: 100, height: 0, points: [[0, 0], [100, 0]], strokeColor: '#1e293b', backgroundColor: 'transparent' },
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
