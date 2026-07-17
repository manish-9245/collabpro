import * as Y from 'yjs';

// Since Buffer is not available in standard browser Web Workers, we implement robust cross-platform base64 translation
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encodeState(state: any): string {
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
    const base64 = uint8ArrayToBase64(update);
    
    return JSON.stringify({
      yjs: true,
      data: base64
    });
  } catch (err: any) {
    console.error("[CRDT Worker] Encoding failed:", err);
    return JSON.stringify(state);
  }
}

function decodeState(storedStr: string | null | undefined, fallbackDefault: any): any {
  if (!storedStr) return fallbackDefault;
  
  try {
    const parsed = JSON.parse(storedStr);
    
    if (parsed && parsed.yjs && parsed.data) {
      const update = base64ToUint8Array(parsed.data);
      const doc = new Y.Doc();
      Y.applyUpdate(doc, update);
      
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
    
    return parsed;
  } catch (e: any) {
    return fallbackDefault;
  }
}

self.onmessage = (e: MessageEvent) => {
  const { id, action, payload, fallbackDefault } = e.data;
  
  try {
    if (action === 'encode') {
      const result = encodeState(payload);
      self.postMessage({ id, result });
    } else if (action === 'decode') {
      const result = decodeState(payload, fallbackDefault);
      self.postMessage({ id, result });
    } else {
      self.postMessage({ id, error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
