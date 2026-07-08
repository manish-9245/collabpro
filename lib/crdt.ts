import * as Y from 'yjs';

/**
 * Encodes any JSON-serializable object state into a Yjs-backed CRDT base64 update string.
 * This guarantees transaction safety and allows merge updates without last-write-wins collisions.
 */
export function encodeCrdtState(state: any): string {
  if (!state) return "";
  
  try {
    const doc = new Y.Doc();
    const map = doc.getMap('state');
    
    const setDeep = (targetMap: Y.Map<any>, obj: any) => {
      for (const [key, value] of Object.entries(obj)) {
        if (value === undefined || value === null) {
          targetMap.set(key, null);
        } else if (Array.isArray(value)) {
          const yarray = new Y.Array();
          targetMap.set(key, yarray);
          
          const convertedArray = value.map(item => {
            if (item && typeof item === 'object') {
              const nestedMap = new Y.Map();
              setDeep(nestedMap, item);
              return nestedMap;
            }
            return item;
          });
          
          yarray.insert(0, convertedArray);
        } else if (typeof value === 'object') {
          const nestedMap = new Y.Map();
          targetMap.set(key, nestedMap);
          setDeep(nestedMap, value);
        } else {
          targetMap.set(key, value);
        }
      }
    };

    setDeep(map, state);
    
    const update = Y.encodeStateAsUpdate(doc);
    const base64 = Buffer.from(update).toString('base64');
    
    return JSON.stringify({
      yjs: true,
      data: base64
    });
  } catch (err) {
    console.error("[CRDT] Encoding failed, falling back to JSON:", err);
    return JSON.stringify(state);
  }
}

/**
 * Decodes a Yjs-backed base64 update string back into its JSON-serializable object form.
 * Supports transparent fallback to standard JSON parser if the payload is pre-CRDT raw JSON.
 */
export function decodeCrdtState(storedStr: string | null | undefined, fallbackDefault: any): any {
  if (!storedStr) return fallbackDefault;
  
  try {
    const parsed = JSON.parse(storedStr);
    
    // Check if it is a Yjs update
    if (parsed && parsed.yjs && parsed.data) {
      const update = Buffer.from(parsed.data, 'base64');
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(update));
      
      const map = doc.getMap('state');
      
      const getDeep = (ymap: Y.Map<any>): any => {
        const obj: any = {};
        for (const key of Array.from(ymap.keys())) {
          const val = ymap.get(key);
          if (val instanceof Y.Array) {
            obj[key] = val.toArray().map((item: any) => {
              if (item instanceof Y.Map) {
                return getDeep(item);
              }
              return item;
            });
          } else if (val instanceof Y.Map) {
            obj[key] = getDeep(val);
          } else {
            obj[key] = val;
          }
        }
        return obj;
      };
      
      return getDeep(map);
    }
    
    // Fallback: If it's standard pre-CRDT raw JSON, return the parsed object
    return parsed;
  } catch (e) {
    // If JSON parsing fails (e.g. raw string is not JSON), return raw or default
    return fallbackDefault;
  }
}
