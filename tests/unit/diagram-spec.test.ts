import { describe, it, expect } from 'vitest';
import { buildElements, defaultSize, layoutDiagram, MAX_EDGE_LABEL, MAX_NODE_LABEL, validateSpec, type DiagramSpec } from '@/lib/mcp/diagram-spec';
import { validateWhiteboardGeometry } from '@/lib/mcp/tools';
import { parseSpecFromModelText } from '@/lib/mcp/ai-spec';

const spec: DiagramSpec = {
  nodes: [
    { id: 'web', label: 'Web App', group: 'frontend' },
    { id: 'api', label: 'API Gateway', group: 'backend' },
    { id: 'auth', label: 'Auth Service', group: 'backend' },
    { id: 'db', label: 'PostgreSQL', group: 'data' },
    { id: 'cache', label: 'Redis', group: 'data' },
  ],
  edges: [
    { from: 'web', to: 'api', label: 'HTTPS' },
    { from: 'api', to: 'auth' },
    { from: 'api', to: 'db' },
    { from: 'api', to: 'cache' },
    { from: 'auth', to: 'db' },
  ],
};

describe('validateSpec', () => {
  it('accepts a good spec', () => expect(validateSpec(spec)).toEqual([]));
  it('flags duplicate ids, unknown endpoints, self loops, empty', () => {
    expect(validateSpec({ nodes: [] })).toHaveLength(1);
    const issues = validateSpec({ nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'A2' }], edges: [{ from: 'a', to: 'zzz' }, { from: 'a', to: 'a' }] });
    expect(issues.join('\n')).toMatch(/Duplicate node id "a"/);
    expect(issues.join('\n')).toMatch(/unknown node "zzz"/);
    expect(issues.join('\n')).toMatch(/self-loop/);
  });
});

describe('layout + elements', () => {
  for (const direction of ['right', 'down'] as const) {
    it(`produces overlap-free, finite, valid elements (${direction})`, () => {
      const s = { ...spec, direction };
      const boxes = layoutDiagram(s, new Map());
      const elements = buildElements(s, boxes);
      expect(validateWhiteboardGeometry(elements)).toEqual([]);
      expect(elements.filter((e) => e.type === 'rectangle')).toHaveLength(5);
      expect(elements.filter((e) => e.type === 'arrow')).toHaveLength(5);
    });
  }

  it('flows left-to-right by dependency depth', () => {
    const boxes = layoutDiagram(spec, new Map());
    expect(boxes.get('web')!.x).toBeLessThan(boxes.get('api')!.x);
    expect(boxes.get('api')!.x).toBeLessThan(boxes.get('auth')!.x);
    expect(boxes.get('auth')!.x).toBeLessThan(boxes.get('db')!.x);
  });

  it('survives cycles', () => {
    const cyc: DiagramSpec = { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }] };
    const elements = buildElements(cyc, layoutDiagram(cyc, new Map()));
    expect(validateWhiteboardGeometry(elements)).toEqual([]);
  });

  it('binds arrows to shapes reciprocally on BOTH ends and gives text a visible color', () => {
    const elements = buildElements(spec, layoutDiagram(spec, new Map()));
    const arrow = elements.find((e) => e.id === 'edge-1') as any;
    const web = elements.find((e) => e.id === 'web') as any;
    const api = elements.find((e) => e.id === 'api') as any;
    expect(arrow.startBinding.elementId).toBe('web');
    expect(arrow.endBinding.elementId).toBe('api');
    expect(web.boundElements.some((b: any) => b.id === arrow.id && b.type === 'arrow')).toBe(true);
    expect(api.boundElements.some((b: any) => b.id === arrow.id && b.type === 'arrow')).toBe(true);
    for (const t of elements.filter((e) => e.type === 'text')) expect((t as any).strokeColor).toBeTruthy();
  });

  it('namespaces every id with the prefix so a second diagram cannot collide on a shared board', () => {
    const layout = layoutDiagram(spec, new Map());
    const first = buildElements(spec, layout, new Map(), 'dA-');
    const second = buildElements(spec, layout, new Map(), 'dB-');
    const ids = (els: any[]) => new Set(els.map((e) => e.id));
    expect([...ids(first)].every((id) => id.startsWith('dA-'))).toBe(true);
    expect([...ids(first)].some((id) => ids(second).has(id))).toBe(false);
    // bindings and bound text follow the prefixed ids
    const arrow = first.find((e: any) => e.id === 'dA-edge-1') as any;
    expect(arrow.startBinding.elementId).toBe('dA-web');
    const label = first.find((e: any) => e.id === 'dA-web-label') as any;
    expect(label.containerId).toBe('dA-web');
  });

  it('is deterministic', () => {
    const a = JSON.stringify(buildElements(spec, layoutDiagram(spec, new Map())));
    const b = JSON.stringify(buildElements(spec, layoutDiagram(spec, new Map())));
    expect(a).toBe(b);
  });

  it('uses supplied icon sizes and BINDS arrows to the icon\'s main shape (largest by area), reciprocally', () => {
    const s: DiagramSpec = { nodes: [{ id: 'i', label: 'Lambda', icon: { librarySource: 'a/b.excalidrawlib', item: '1' } }, { id: 'j', label: 'S3' }], edges: [{ from: 'i', to: 'j' }] };
    const boxes = layoutDiagram(s, new Map([['i', { w: 80, h: 80 }]]));
    expect(boxes.get('i')).toMatchObject({ w: 80, h: 80 });
    const small = { id: 'i-inner', type: 'rectangle', x: 10, y: 10, width: 20, height: 20, groupIds: ['g'], strokeColor: '#000', boundElements: [] };
    const main = { id: 'i-main', type: 'ellipse', x: 0, y: 0, width: 80, height: 80, groupIds: ['g'], strokeColor: '#000', boundElements: [] };
    const els = buildElements(s, boxes, new Map([['i', [small, main]]]));
    const arrow = els.find((e) => e.type === 'arrow') as any;
    expect(arrow.startBinding.elementId).toBe('i-main');
    expect((main.boundElements as any[]).some((b) => b.id === arrow.id)).toBe(true);
    expect((small.boundElements as any[])).toHaveLength(0);
    expect(arrow.endBinding.elementId).toBe('j');
  });

  it('an icon with no backing shape simply leaves that end unbound (never a dangling binding)', () => {
    const s: DiagramSpec = { nodes: [{ id: 'i', label: 'T', icon: { librarySource: 'a/b.excalidrawlib', item: '1' } }, { id: 'j', label: 'U' }], edges: [{ from: 'i', to: 'j' }] };
    const boxes = layoutDiagram(s, new Map([['i', { w: 60, h: 60 }]]));
    const els = buildElements(s, boxes, new Map([['i', [{ id: 'i-t', type: 'text', x: 0, y: 0, width: 60, height: 20, strokeColor: '#000' }]]]));
    expect((els.find((e) => e.type === 'arrow') as any).startBinding).toBeUndefined();
  });
});

describe('label limits keep text inside its box and clear of arrows', () => {
  it('rejects labels longer than the box can hold', () => {
    const issues = validateSpec({ nodes: [{ id: 'a', label: 'x'.repeat(41) }, { id: 'b', label: 'ok' }], edges: [{ from: 'a', to: 'b', label: 'y'.repeat(25) }] });
    expect(issues.join('\n')).toMatch(/label is 41 characters; max 40/);
    expect(issues.join('\n')).toMatch(/longer than 24 characters/);
  });
  it('the widest permitted label still fits its (capped) box', () => {
    const size = defaultSize('x'.repeat(MAX_NODE_LABEL));
    // node text is inset 8px each side inside the box, so that is the width it really has
    expect(size.w - 16).toBeGreaterThanOrEqual(MAX_NODE_LABEL * 9);
  });
  it('left-to-right layers leave room for the longest edge label between boxes', () => {
    const s: DiagramSpec = { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b', label: 'x'.repeat(MAX_EDGE_LABEL) }] };
    const boxes = layoutDiagram(s, new Map());
    const gap = boxes.get('b')!.x - (boxes.get('a')!.x + boxes.get('a')!.w);
    expect(gap).toBeGreaterThanOrEqual(MAX_EDGE_LABEL * 8);
    const els = buildElements(s, boxes);
    expect(validateWhiteboardGeometry(els)).toEqual([]);
  });
});

describe('parseSpecFromModelText', () => {
  it('extracts JSON from chatty or fenced output', () => {
    const out = parseSpecFromModelText('Sure!\n```json\n{"nodes":[{"id":"a","label":"A"}],"edges":[]}\n```');
    expect(out.nodes).toHaveLength(1);
  });
  it('rejects non-JSON and schema violations', () => {
    expect(() => parseSpecFromModelText('no json here')).toThrow();
    expect(() => parseSpecFromModelText('{"nodes":[]}')).toThrow();
    expect(() => parseSpecFromModelText('{"nodes":[{"id":"","label":"x"}]}')).toThrow();
  });
});
