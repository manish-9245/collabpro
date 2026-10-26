import { describe, it, expect } from 'vitest';
import { buildElements, layoutDiagram, validateSpec, type DiagramSpec } from '@/lib/mcp/diagram-spec';
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

  it('binds arrows to shapes reciprocally and gives text a visible color', () => {
    const elements = buildElements(spec, layoutDiagram(spec, new Map()));
    const arrow = elements.find((e) => e.id === 'edge-1') as any;
    expect(arrow.startBinding.elementId).toBe('web');
    const web = elements.find((e) => e.id === 'web') as any;
    expect(web.boundElements.some((b: any) => b.id === arrow.id)).toBe(true);
    for (const t of elements.filter((e) => e.type === 'text')) expect((t as any).strokeColor).toBeTruthy();
  });

  it('is deterministic', () => {
    const a = JSON.stringify(buildElements(spec, layoutDiagram(spec, new Map())));
    const b = JSON.stringify(buildElements(spec, layoutDiagram(spec, new Map())));
    expect(a).toBe(b);
  });

  it('uses supplied icon sizes and emits no shape binding for icon nodes', () => {
    const s: DiagramSpec = { nodes: [{ id: 'i', label: 'Lambda', icon: { librarySource: 'a/b.excalidrawlib', item: '1' } }, { id: 'j', label: 'S3' }], edges: [{ from: 'i', to: 'j' }] };
    const boxes = layoutDiagram(s, new Map([['i', { w: 80, h: 80 }]]));
    expect(boxes.get('i')).toMatchObject({ w: 80, h: 80 });
    const iconEl = { id: 'i-0', type: 'rectangle', x: 0, y: 0, width: 80, height: 80, groupIds: ['g'], strokeColor: '#000' };
    const els = buildElements(s, boxes, new Map([['i', [iconEl]]]));
    const arrow = els.find((e) => e.type === 'arrow') as any;
    expect(arrow.startBinding).toBeUndefined();
    expect(arrow.endBinding.elementId).toBe('j');
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
