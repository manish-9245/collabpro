import { validateAndSanitizeWhiteboardElements } from '@/lib/canvas-validation';

export type ConflictStrategy = 'reject' | 'merge' | 'overwrite';

export function mapConvexIds(obj: any): any {
  if (!obj) return obj;
  if (Array.isArray(obj)) {
    return obj.map(mapConvexIds);
  }
  if (typeof obj === 'object') {
    if (obj instanceof Date) return obj.toISOString();
    
    const newObj: any = {};
    for (const key of Object.getOwnPropertyNames(obj)) {
      newObj[key] = mapConvexIds(obj[key]);
    }
    for (const key in obj) {
      if (!(key in newObj)) {
        newObj[key] = mapConvexIds(obj[key]);
      }
    }
    if (obj.id !== undefined && obj._id === undefined) {
      newObj._id = obj.id;
    }
    return newObj;
  }
  return obj;
}

export function asJsonString(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJsonIfString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function asEditorDocument(value: unknown): Record<string, any> {
  const parsed = parseJsonIfString(value);
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).blocks)) {
    return parsed as Record<string, any>;
  }

  if (typeof parsed === 'string') {
    const text = parsed.trim();
    return {
      time: Date.now(),
      version: "2.8.1",
      blocks: text ? [
        {
          id: crypto.randomUUID(),
          type: 'paragraph',
          data: { text }
        }
      ] : []
    };
  }

  throw new Error("Invalid document payload. Expected Editor.js JSON or string content.");
}

export function asWhiteboardElements(value: unknown): any[] {
  const parsed = parseJsonIfString(value);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).elements)) {
    return (parsed as any).elements;
  }
  throw new Error("Invalid whiteboard payload. Expected Excalidraw elements array or { elements }.");
}

export function mergeDocumentBlocks(currentDoc: Record<string, any>, incomingDoc: Record<string, any>): Record<string, any> {
  const currentBlocks = Array.isArray(currentDoc.blocks) ? currentDoc.blocks : [];
  const incomingBlocks = Array.isArray(incomingDoc.blocks) ? incomingDoc.blocks : [];
  return {
    ...currentDoc,
    ...incomingDoc,
    time: Date.now(),
    version: incomingDoc.version || currentDoc.version || "2.8.1",
    blocks: [
      ...currentBlocks,
      ...incomingBlocks.map((block: any) =>
        block && typeof block === 'object' && block.id ? block : { ...block, id: crypto.randomUUID() }
      )
    ]
  };
}

export function mergeWhiteboardById(currentElements: any[], incomingElements: any[]): any[] {
  const merged = new Map<string, any>();
  const ordered: any[] = [];

  for (const element of currentElements) {
    if (!element || typeof element !== 'object') continue;
    const key = typeof element.id === 'string' && element.id.length > 0 ? element.id : crypto.randomUUID();
    if (!merged.has(key)) ordered.push(key);
    merged.set(key, element);
  }

  for (const element of incomingElements) {
    if (!element || typeof element !== 'object') continue;
    const key = typeof element.id === 'string' && element.id.length > 0 ? element.id : crypto.randomUUID();
    if (!merged.has(key)) ordered.push(key);
    merged.set(key, element);
  }

  return ordered.map((key) => merged.get(key)).filter(Boolean);
}
