/**
 * Graph -> Excalidraw elements, so a calling model describes WHAT the diagram
 * contains (nodes, edges, groups) and the server decides WHERE things go.
 * Layered left-to-right (or top-to-bottom) layout: longest-path layering with
 * cycle back-edges ignored for ranking, which keeps every shape on a grid
 * with guaranteed clear space - the overlap rule in validateWhiteboardGeometry
 * cannot trip on its own output.
 */

export interface SpecNode {
  id: string;
  label: string;
  /** Nodes with the same group share a color. */
  group?: string;
  /** Optional library icon rendered in place of the box (see collabpro_place_icon). */
  icon?: { librarySource: string; item: string };
}
export interface SpecEdge {
  from: string;
  to: string;
  label?: string;
}
export interface DiagramSpec {
  nodes: SpecNode[];
  edges?: SpecEdge[];
  direction?: 'right' | 'down';
}
export interface Box { x: number; y: number; w: number; h: number }
export type SpecElement = Record<string, unknown>;

export const MAX_SPEC_NODES = 60;
export const MAX_SPEC_EDGES = 120;
const GAP_MAIN = 100; // between layers (arrow room)
const GAP_CROSS = 40; // between siblings in a layer
const NODE_H = 64;

const PALETTE = [
  { stroke: '#1e40af', bg: '#dbeafe' },
  { stroke: '#047857', bg: '#d1fae5' },
  { stroke: '#b45309', bg: '#fef3c7' },
  { stroke: '#6d28d9', bg: '#ede9fe' },
  { stroke: '#be123c', bg: '#ffe4e6' },
  { stroke: '#0f766e', bg: '#ccfbf1' },
];

export function validateSpec(spec: DiagramSpec): string[] {
  const issues: string[] = [];
  if (spec.nodes.length === 0) issues.push('At least one node is required.');
  if (spec.nodes.length > MAX_SPEC_NODES) issues.push(`Too many nodes (${spec.nodes.length}); max ${MAX_SPEC_NODES}.`);
  if ((spec.edges?.length ?? 0) > MAX_SPEC_EDGES) issues.push(`Too many edges; max ${MAX_SPEC_EDGES}.`);
  const ids = new Set<string>();
  for (const n of spec.nodes) {
    if (ids.has(n.id)) issues.push(`Duplicate node id "${n.id}".`);
    ids.add(n.id);
  }
  for (const e of spec.edges ?? []) {
    if (!ids.has(e.from)) issues.push(`Edge references unknown node "${e.from}".`);
    if (!ids.has(e.to)) issues.push(`Edge references unknown node "${e.to}".`);
    if (e.from === e.to) issues.push(`Edge "${e.from}" -> "${e.to}" is a self-loop; not supported.`);
  }
  return issues;
}

/** Default box size from the label; icon nodes pass their own measured size. */
export function defaultSize(label: string): { w: number; h: number } {
  return { w: Math.min(280, Math.max(140, label.length * 9 + 32)), h: NODE_H };
}

function assignLayers(spec: DiagramSpec): Map<string, number> {
  const adj = new Map<string, string[]>(spec.nodes.map((n) => [n.id, []]));
  for (const e of spec.edges ?? []) adj.get(e.from)?.push(e.to);

  // DFS to find back edges (cycles); those are ignored for ranking.
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of adj.get(id) ?? []) {
      const s = state.get(to) ?? 0;
      if (s === 1) back.add(`${id}>${to}`);
      else if (s === 0) visit(to);
    }
    state.set(id, 2);
  };
  for (const n of spec.nodes) if (!state.get(n.id)) visit(n.id);

  const preds = new Map<string, string[]>(spec.nodes.map((n) => [n.id, []]));
  for (const e of spec.edges ?? []) if (!back.has(`${e.from}>${e.to}`)) preds.get(e.to)?.push(e.from);

  const layer = new Map<string, number>();
  const rank = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    const r = Math.max(-1, ...(preds.get(id) ?? []).map(rank)) + 1;
    layer.set(id, r);
    return r;
  };
  for (const n of spec.nodes) rank(n.id);
  return layer;
}

export function layoutDiagram(spec: DiagramSpec, sizes: Map<string, { w: number; h: number }>): Map<string, Box> {
  const down = spec.direction === 'down';
  const layers = assignLayers(spec);
  const columns = new Map<number, SpecNode[]>();
  for (const n of spec.nodes) {
    const l = layers.get(n.id) ?? 0;
    columns.set(l, [...(columns.get(l) ?? []), n]);
  }
  const size = (n: SpecNode) => sizes.get(n.id) ?? defaultSize(n.label);

  // Main axis = layer direction; cross axis = position within the layer.
  const mainExtent = (n: SpecNode) => (down ? size(n).h : size(n).w);
  const crossExtent = (n: SpecNode) => (down ? size(n).w : size(n).h);
  const layerCross = new Map<number, number>();
  for (const [l, nodes] of columns) {
    layerCross.set(l, nodes.reduce((sum, n) => sum + crossExtent(n), 0) + GAP_CROSS * (nodes.length - 1));
  }
  const maxCross = Math.max(...layerCross.values());

  const out = new Map<string, Box>();
  let mainPos = 0;
  for (const l of [...columns.keys()].sort((a, b) => a - b)) {
    const nodes = columns.get(l)!;
    let crossPos = (maxCross - (layerCross.get(l) ?? 0)) / 2;
    for (const n of nodes) {
      const { w, h } = size(n);
      out.set(n.id, down ? { x: crossPos, y: mainPos, w, h } : { x: mainPos, y: crossPos, w, h });
      crossPos += crossExtent(n) + GAP_CROSS;
    }
    mainPos += Math.max(...nodes.map(mainExtent)) + GAP_MAIN;
  }
  return out;
}

function base(id: string, type: string, x: number, y: number, w: number, h: number, i: number): SpecElement {
  return {
    id, type, x, y, width: w, height: h, angle: 0,
    strokeColor: '#1e293b', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
    roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1000 + i, version: 1,
    versionNonce: 2000 + i, isDeleted: false, boundElements: [], updated: 1, link: null, locked: false,
  };
}

function textEl(id: string, text: string, x: number, y: number, w: number, h: number, i: number, containerId: string | null): SpecElement {
  return {
    ...base(id, 'text', x, y, w, h, i),
    text, originalText: text, fontSize: 16, fontFamily: 2, textAlign: 'center', verticalAlign: containerId ? 'middle' : 'top',
    containerId, autoResize: true, lineHeight: 1.25,
  };
}

/** Pick the facing sides of two boxes and return the arrow's start point and delta. */
function connect(a: Box, b: Box): { sx: number; sy: number; dx: number; dy: number } {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  const horizontal = Math.abs(bcx - acx) / (a.w / 2 + b.w / 2) >= Math.abs(bcy - acy) / (a.h / 2 + b.h / 2);
  if (horizontal) {
    const right = bcx >= acx;
    const sx = right ? a.x + a.w : a.x, ex = right ? b.x : b.x + b.w;
    return { sx, sy: acy, dx: ex - sx, dy: bcy - acy };
  }
  const below = bcy >= acy;
  const sy = below ? a.y + a.h : a.y, ey = below ? b.y : b.y + b.h;
  return { sx: acx, sy, dx: bcx - acx, dy: ey - sy };
}

/**
 * @param iconElements already-positioned library elements for icon nodes (keyed by node id).
 */
export function buildElements(spec: DiagramSpec, boxes: Map<string, Box>, iconElements: Map<string, SpecElement[]> = new Map()): SpecElement[] {
  const out: SpecElement[] = [];
  const groups = [...new Set(spec.nodes.map((n) => n.group ?? ''))];
  let i = 0;

  const shapeIds = new Map<string, string>();
  spec.nodes.forEach((n) => {
    const box = boxes.get(n.id)!;
    const icon = iconElements.get(n.id);
    if (icon) {
      out.push(...icon);
      out.push(textEl(`${n.id}-label`, n.label, box.x, box.y + box.h + 6, box.w, 20, i++, null));
      return;
    }
    const color = PALETTE[groups.indexOf(n.group ?? '') % PALETTE.length];
    const rect = base(n.id, 'rectangle', box.x, box.y, box.w, box.h, i++);
    rect.strokeColor = color.stroke;
    rect.backgroundColor = color.bg;
    rect.roundness = { type: 3 };
    rect.boundElements = [{ id: `${n.id}-label`, type: 'text' }];
    out.push(rect, textEl(`${n.id}-label`, n.label, box.x + 8, box.y + box.h / 2 - 10, box.w - 16, 20, i++, n.id));
    shapeIds.set(n.id, n.id);
  });

  (spec.edges ?? []).forEach((e, idx) => {
    const a = boxes.get(e.from)!, b = boxes.get(e.to)!;
    const { sx, sy, dx, dy } = connect(a, b);
    const id = `edge-${idx + 1}`;
    const arrow = base(id, 'arrow', sx, sy, Math.abs(dx), Math.abs(dy), i++);
    arrow.points = [[0, 0], [dx, dy]];
    arrow.endArrowhead = 'arrow';
    arrow.startArrowhead = null;
    if (shapeIds.has(e.from)) {
      arrow.startBinding = { elementId: e.from, focus: 0, gap: 4 };
      (out.find((el) => el.id === e.from)!.boundElements as unknown[]).push({ id, type: 'arrow' });
    }
    if (shapeIds.has(e.to)) {
      arrow.endBinding = { elementId: e.to, focus: 0, gap: 4 };
      (out.find((el) => el.id === e.to)!.boundElements as unknown[]).push({ id, type: 'arrow' });
    }
    out.push(arrow);
    if (e.label) {
      const w = Math.max(40, e.label.length * 8);
      out.push(textEl(`${id}-label`, e.label, sx + dx / 2 - w / 2, sy + dy / 2 - 24, w, 18, i++, null));
    }
  });
  return out;
}
