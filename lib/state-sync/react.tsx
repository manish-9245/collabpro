"use client";

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
// We will lazily import idb to avoid SSR module resolution errors
let dbPromise: Promise<any> | null = null;
if (typeof window !== 'undefined') {
  import('idb').then(({ openDB }) => {
    dbPromise = openDB('collabpro-offline-sync', 1, {
      upgrade(db) {
        db.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
      },
    });
  }).catch(e => console.error("Failed to load idb", e));
}

// Robust helper to extract query path from any reference type (standard or mock)
const getPath = (ref: any): string | undefined => {
  if (!ref) return undefined;
  if (typeof ref === "string") return ref;
  
  try {
    const p1 = ref._path;
    if (typeof p1 === "string") return p1;
  } catch (e) {}

  try {
    const p2 = ref.__path;
    if (typeof p2 === "string") return p2;
  } catch (e) {}

  if (typeof ref === "object") {
    try {
      if ("_path" in ref) {
        const p = ref._path;
        if (typeof p === "string") return p;
      }
    } catch (e) {}
    try {
      if ("__path" in ref) {
        const p = ref.__path;
        if (typeof p === "string") return p;
      }
    } catch (e) {}
  }
  return undefined;
};

// Proxy to simulate API references (e.g. api.user.getUser)
const makePathProxy = (path: string[] = []): any => {
  return new Proxy(() => {}, {
    get(target, prop: string) {
      if (prop === "__path" || prop === "_path") {
        return path.join(":");
      }
      if (prop === "then" || prop === "catch" || typeof prop === "symbol") return undefined;
      return makePathProxy([...path, prop]);
    }
  });
};

// Re-export api from our proxy
export const api = makePathProxy([]);

export function StateSyncProvider({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}

// Global cache to share active query results and prevent infinite re-fetches
const memoryCache = new Map<string, any>();
const queryCache = {
  get(key: string) {
    if (typeof window === 'undefined') return undefined;
    return memoryCache.get(key);
  },
  set(key: string, value: any) {
    memoryCache.set(key, value);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`collabpro:cache:${key}`, JSON.stringify(value));
      } catch (e) {
        console.error("Failed to write to localStorage cache:", e);
      }
    }
  }
};

// Coalesce concurrent redundant query fetches into a single promise
const inflightRequests = new Map<string, Promise<any>>();

export function calculateBackoffWithJitter(attempt: number, baseDelay = 1000, maxDelay = 30000): number {
  const maxBackoff = Math.min(maxDelay, baseDelay * Math.pow(2, attempt));
  return Math.random() * maxBackoff;
}

export class StateSyncWSClient {
  private ws: WebSocket | null = null;
  private subscribers = new Map<string, Set<(data: any) => void>>();
  private statusListeners = new Set<(status: 'connecting' | 'connected' | 'disconnected') => void>();
  private cursorListeners = new Set<(cursor: any) => void>();
  private reconnectTimeout: any = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private activeRoom: string | null = null;
  private connectionStatus: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
  private isConnecting = false;
  private consecutiveFailures = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      const match = window.location.pathname.match(/\/workspace\/([^/]+)/);
      if (match && match[1]) {
        this.activeRoom = match[1];
        this.connect();
      }
    }
  }

  public getStatus() {
    return this.connectionStatus;
  }

  public addStatusListener(listener: (status: any) => void) {
    this.statusListeners.add(listener);
    listener(this.connectionStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public addCursorListener(listener: (cursor: any) => void) {
    this.cursorListeners.add(listener);
    return () => {
      this.cursorListeners.delete(listener);
    };
  }

  public sendCursor(x: number, y: number, name: string, color: string, isCanvas: boolean) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.activeRoom) {
      this.ws.send(JSON.stringify({
        type: 'cursor',
        fileId: this.activeRoom,
        x,
        y,
        name,
        color,
        isCanvas
      }));
    }
  }

  private setStatus(status: 'connecting' | 'connected' | 'disconnected') {
    if (this.connectionStatus === status) return;
    this.connectionStatus = status;
    this.statusListeners.forEach(l => l(status));
  }

  private getWsUrl() {
    if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
    if (typeof window === 'undefined') return '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `${protocol}//localhost:3001`;
    }
    // For the production host collabpro.buildwithmanish.com, connect directly without a separate ws- prefix
    if (hostname === 'collabpro.buildwithmanish.com' || hostname.includes('collabpro.buildwithmanish.com')) {
      return `${protocol}//${hostname}`;
    }
    return `${protocol}//ws-${hostname}`;
  }

  public async connect() {
    if (typeof window === 'undefined' || this.ws || this.isConnecting) return;

    this.isConnecting = true;
    this.setStatus('connecting');
    
    let tokenParam = '';
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          tokenParam = encodeURIComponent(JSON.stringify({
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            image: data.user.image,
          }));
        }
      }
    } catch (err) {
      console.error('[CollabPro WS CLIENT] Failed to fetch session token for handshake:', err);
    }

    // Guard if we were cleaned up or connected during the async fetch
    if (!this.isConnecting) return;

    const baseUrl = this.getWsUrl();
    const url = tokenParam ? `${baseUrl}?token=${tokenParam}` : baseUrl;
    console.log(`[CollabPro WS CLIENT] Connecting to ${url}...`);

    try {
      this.ws = new WebSocket(url);
      this.isConnecting = false; // reset lock once instantiated

      this.ws.onopen = () => {
        console.log('[CollabPro WS CLIENT] Connection established successfully!');
        this.consecutiveFailures = 0;
        this.reconnectDelay = 1000;
        this.setStatus('connected');

        if (this.activeRoom) {
          this.ws?.send(JSON.stringify({ type: 'join', fileId: this.activeRoom }));
        }

        this.subscribers.forEach((_, key) => {
          const [path, argsStr] = key.split(/:(.+)/);
          const args = JSON.parse(argsStr || '{}');
          this.ws?.send(JSON.stringify({ type: 'subscribe', path, args }));
        });

        // Flush durable offline queue from IndexedDB
        if (dbPromise) {
          dbPromise.then(async (db) => {
            try {
              const tx = db.transaction('mutations', 'readwrite');
              const store = tx.objectStore('mutations');
              const allMutations = await store.getAll();
              for (const item of allMutations) {
                try {
                  // Use HTTP fallback to guarantee flush of queued offline operations
                  await fetch("/api/state-sync", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: item.path, args: item.args }),
                  });
                  await store.delete(item.id);
                } catch(e) {
                  console.error('[CollabPro WS CLIENT] Failed to flush offline mutation', e);
                }
              }
            } catch(err) {
               console.error('[CollabPro WS CLIENT] Error accessing idb for flush:', err);
            }
          });
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'query-update') {
            const cacheKey = `${msg.path}:${JSON.stringify(msg.args || {})}`;
            queryCache.set(cacheKey, msg.data);
            const listeners = this.subscribers.get(cacheKey);
            if (listeners) {
              listeners.forEach(cb => cb(msg.data));
            }
          } else if (msg.type === 'cursor-update') {
            this.cursorListeners.forEach(cb => cb(msg));
          }
        } catch (err) {
          console.error('[CollabPro WS CLIENT] Failed to parse socket message:', err);
        }
      };

      this.ws.onclose = () => {
        console.warn('[CollabPro WS CLIENT] Connection closed.');
        this.cleanup();
        this.consecutiveFailures++;
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[CollabPro WS CLIENT] Socket error:', err);
        this.cleanup();
      };
    } catch (err) {
      console.error('[CollabPro WS CLIENT] Connection initiation failed:', err);
      this.isConnecting = false;
      this.consecutiveFailures++;
      this.scheduleReconnect();
    }
  }

  private cleanup() {
    this.isConnecting = false;
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch (e) {}
    }
    this.ws = null;
    this.setStatus('disconnected');
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) return;
    
    // Calculate backoff using full-jitter exponential backoff to prevent "thundering herd"
    const delay = calculateBackoffWithJitter(
      this.consecutiveFailures,
      1000,
      this.maxReconnectDelay
    );

    console.log(`[CollabPro WS CLIENT] Scheduling reconnection in ${delay.toFixed(0)}ms (attempt ${this.consecutiveFailures})`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  public subscribe(path: string, args: any, callback: (data: any) => void) {
    const cacheKey = `${path}:${JSON.stringify(args || {})}`;
    if (!this.subscribers.has(cacheKey)) {
      this.subscribers.set(cacheKey, new Set());
    }
    this.subscribers.get(cacheKey)!.add(callback);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', path, args }));
    }

    return () => {
      const listeners = this.subscribers.get(cacheKey);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.subscribers.delete(cacheKey);
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'unsubscribe', path, args }));
          }
        }
      }
    };
  }

  public async mutation(path: string, args: any, fileId?: string): Promise<any> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        return await new Promise((resolve, reject) => {
          const handler = (event: MessageEvent) => {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'mutation-result' && msg.path === path) {
                this.ws?.removeEventListener('message', handler);
                if (msg.success) {
                  resolve(msg.data);
                } else {
                  reject(new Error(msg.error || 'Mutation failed over WebSocket'));
                }
              }
            } catch {}
          };
          this.ws!.addEventListener('message', handler);
          this.ws!.send(JSON.stringify({ type: 'mutation', path, args, fileId }));

          setTimeout(() => {
            this.ws?.removeEventListener('message', handler);
            reject(new Error('Mutation request timed out over WebSocket'));
          }, 10000);
        });
      } catch (wsErr) {
        console.warn("[CollabPro WS] Mutation via WS failed, falling back to HTTP:", wsErr);
      }
    }

    try {
      console.log(`[CollabPro WS CLIENT] Attempting HTTP fallback for ${path}...`);
      const res = await fetch("/api/state-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, args }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[CollabPro WS CLIENT] HTTP Mutation Failed for ${path}: ${res.status} ${errText}`);
        throw new Error(`Mutation failed: ${errText}`);
      }

      const json = await res.json();
      console.log(`[CollabPro WS CLIENT] HTTP Mutation Success for ${path}`);
      return json.data;
    } catch (httpErr) {
      console.error("[CollabPro WS CLIENT] HTTP Mutation Threw Exception:", httpErr);
      // Compensate for lag on poor connections by queuing operations locally in IndexedDB
      console.log('[CollabPro WS] Queuing mutation offline for latency compensation...');
      if (typeof window !== 'undefined' && dbPromise) {
        dbPromise.then(async db => {
          try {
            const tx = db.transaction('mutations', 'readwrite');
            const store = tx.objectStore('mutations');
            // Optimal batching: deduplicate pending mutations
            const allMutations = await store.getAll();
            const existing = allMutations.find((m: any) => m.path === path && m.fileId === fileId);
            if (existing) {
               existing.args = args;
               await store.put(existing);
            } else {
               await store.add({ path: path, args, fileId });
            }
          } catch(err) {
            console.error('[CollabPro WS CLIENT] Error accessing idb for queuing:', err);
          }
        });
      }
      return Promise.resolve(args); // Optimistically resolve
    }
  }
}

export const wsClient = typeof window !== 'undefined' ? new StateSyncWSClient() : null;

function useAdaptiveInterval(defaultInterval = 4000, backoffInterval = 60000, inactivityTimeout = 60000) {
  const [intervalTime, setIntervalTime] = useState(defaultInterval);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let inactivityTimer: any = null;

    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      // If we were backed off, restore immediately
      setIntervalTime((prev) => {
        if (prev !== defaultInterval && document.visibilityState === "visible") {
          return defaultInterval;
        }
        return prev;
      });

      // Reset inactivity check timer
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(checkInactivity, inactivityTimeout);
    };

    const checkInactivity = () => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= inactivityTimeout) {
        setIntervalTime(backoffInterval);
      } else {
        // Schedule next check for remaining time
        const remaining = inactivityTimeout - elapsed;
        inactivityTimer = setTimeout(checkInactivity, remaining);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        setIntervalTime(300000); // 5 minutes (practically paused) when tab is hidden
      } else {
        // Check if they are active before resetting to default
        const elapsed = Date.now() - lastActivityRef.current;
        if (elapsed < inactivityTimeout) {
          setIntervalTime(defaultInterval);
        } else {
          setIntervalTime(backoffInterval);
        }
      }
    };

    // Listen to standard activity events
    const activityEvents = ["mousemove", "keydown", "mousedown", "scroll", "click", "touchstart"];
    activityEvents.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Initial inactivity scheduling
    inactivityTimer = setTimeout(checkInactivity, inactivityTimeout);

    return () => {
      activityEvents.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (inactivityTimer) clearTimeout(inactivityTimer);
    };
  }, [defaultInterval, backoffInterval, inactivityTimeout]);

  return intervalTime;
}

export function useQuery(queryReference: any, args?: any) {
  const queryPath = getPath(queryReference);
  const argsString = JSON.stringify(args || {});
  const intervalTime = useAdaptiveInterval(4000, 60000, 60000);

  const [data, setData] = useState<any>(() => {
    if (!queryPath) return undefined;
    const cacheKey = `${queryPath}:${argsString}`;
    const cached = queryCache.get(cacheKey);
    if (cached !== undefined) return cached;
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(`collabpro:cache:${cacheKey}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          memoryCache.set(cacheKey, parsed);
          return parsed;
        }
      } catch (e) {}
    }
    return undefined;
  });

  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>(() => {
    return wsClient ? wsClient.getStatus() : 'disconnected';
  });

  useEffect(() => {
    if (!wsClient) return;
    return wsClient.addStatusListener(setWsStatus);
  }, []);

  // Safely hydrate from localStorage cache after mount to prevent SSR hydration errors
  useEffect(() => {
    if (!queryPath) return;
    const cacheKey = `${queryPath}:${argsString}`;
    if (data === undefined && typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(`collabpro:cache:${cacheKey}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          memoryCache.set(cacheKey, parsed);
          setData(parsed);
        }
      } catch (e) {
        console.error("Failed to read from localStorage cache:", e);
      }
    }
  }, [queryPath, argsString, data]);

  const isConnected = wsStatus === 'connected';

  useEffect(() => {
    if (!queryPath || queryPath === 'skip') return;

    const cacheKey = `${queryPath}:${argsString}`;
    let active = true;
    let timerId: any = null;

    async function fetchData() {
      const cacheKey = `${queryPath}:${argsString}`;
      let promise = inflightRequests.get(cacheKey);
      if (!promise) {
        promise = (async () => {
          try {
            const res = await fetch("/api/state-sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: queryPath, args }),
            });
            if (res.ok) {
              const json = await res.json();
              queryCache.set(cacheKey, json.data);
              return json.data;
            }
          } catch (err) {
            console.error("Error fetching state-sync query:", err);
          } finally {
            inflightRequests.delete(cacheKey);
          }
          return undefined;
        })();
        inflightRequests.set(cacheKey, promise);
      }

      try {
        const fetchedData = await promise;
        if (active && fetchedData !== undefined) {
          setData(fetchedData);
        }
      } catch (err) {
        console.error("Error waiting for state-sync promise:", err);
      }
    }

    const handleRefetchEvent = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { path, fileId, optimisticData } = customEvent.detail || {};
      if (path === queryPath) {
        if (!fileId || (args && (args._id === fileId || args.fileId === fileId))) {
          if (optimisticData) {
            queryCache.set(cacheKey, optimisticData);
            setData(optimisticData);
          } else {
            fetchData();
          }
        }
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener('state-sync:refetch', handleRefetchEvent);
    }

    if (wsClient && isConnected) {
      const unsubscribe = wsClient.subscribe(queryPath, args, (updatedData) => {
        if (active) {
          setData(updatedData);
        }
      });

      return () => {
        active = false;
        if (typeof window !== "undefined") {
          window.removeEventListener('state-sync:refetch', handleRefetchEvent);
        }
        unsubscribe();
      };
    } else {
      // Setup dynamic interval polling via self-scheduling setTimeout loops
      const poll = async () => {
        if (!active) return;
        await fetchData();
        timerId = setTimeout(poll, intervalTime);
      };

      fetchData();
      timerId = setTimeout(poll, intervalTime);

      return () => {
        active = false;
        if (typeof window !== "undefined") {
          window.removeEventListener('state-sync:refetch', handleRefetchEvent);
        }
        if (timerId) clearTimeout(timerId);
      };
    }
  }, [queryPath, argsString, isConnected, intervalTime]);

  return data;
}

export function useMutation(mutationReference: any) {
  return async (args?: any) => {
    const mutationPath = getPath(mutationReference);
    if (!mutationPath) throw new Error("Invalid mutation reference passed to useMutation");

    const fileId = args?._id || args?.fileId;

    // OPTIMISTIC UI: Apply edits instantly on the local client
    if (mutationPath === 'files:updateDocument' && fileId && args?.document) {
      const cacheKey = `files:getFileById:{"_id":"${fileId}"}`;
      const cached = queryCache.get(cacheKey);
      if (cached) {
        const optimisticData = { ...cached, document: args.document };
        queryCache.set(cacheKey, optimisticData);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('state-sync:refetch', {
            detail: { path: 'files:getFileById', fileId, optimisticData }
          }));
        }
      }
    } else if (mutationPath === 'files:updateWhiteboard' && fileId && args?.whiteboard) {
      const cacheKey = `files:getFileById:{"_id":"${fileId}"}`;
      const cached = queryCache.get(cacheKey);
      if (cached) {
        const optimisticData = { ...cached, whiteboard: args.whiteboard };
        queryCache.set(cacheKey, optimisticData);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('state-sync:refetch', {
            detail: { path: 'files:getFileById', fileId, optimisticData }
          }));
        }
      }
    }

    if (wsClient && wsClient.getStatus() === 'connected') {
      try {
        return await wsClient.mutation(mutationPath, args, fileId);
      } catch (err) {
        console.warn("[CollabPro WS] Mutation via WS failed, falling back to HTTP:", err);
      }
    } else if (wsClient) {
      // Add to offline queue directly if WS is initialized but not connected
      return await wsClient.mutation(mutationPath, args, fileId);
    }

    const res = await fetch("/api/state-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: mutationPath, args }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Mutation failed: ${errText}`);
    }

    const json = await res.json();
    return json.data;
  };
}

export function useSync() {
  return {
    query: async (queryReference: any, args?: any) => {
      const queryPath = getPath(queryReference);
      if (!queryPath) throw new Error("Invalid query reference passed to sync.query");

      const res = await fetch("/api/state-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: queryPath, args }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Query failed: ${errText}`);
      }

      const json = await res.json();
      return json.data;
    }
  };
}

export function useCursors() {
  const [cursors, setCursors] = useState<Record<string, { email: string; name: string; color: string; x: number; y: number; isCanvas: boolean; updatedAt: number }>>({});

  useEffect(() => {
    if (!wsClient) return;

    const cleanup = wsClient.addCursorListener((update) => {
      setCursors((prev) => ({
        ...prev,
        [update.email]: update
      }));
    });

    // Cleanup stale cursors every 2 seconds
    const interval = setInterval(() => {
      const now = Date.now();
      setCursors((prev) => {
        const next = { ...prev };
        let changed = false;
        Object.keys(next).forEach((email) => {
          if (now - next[email].updatedAt > 5000) { // 5-second timeout for inactivity
            delete next[email];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 2000);

    return () => {
      cleanup();
      clearInterval(interval);
    };
  }, []);

  const broadcastCursor = (x: number, y: number, name: string, color: string, isCanvas: boolean) => {
    if (wsClient) {
      wsClient.sendCursor(x, y, name, color, isCanvas);
    }
  };

  return { cursors, broadcastCursor };
}

export function triggerQueryRefetch(path: string, fileId?: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('state-sync:refetch', {
      detail: { path, fileId }
    }));
  }
}

