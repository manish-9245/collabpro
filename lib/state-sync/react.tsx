"use client";

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";

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
const queryCache = new Map<string, any>();

class StateSyncWSClient {
  private ws: WebSocket | null = null;
  private subscribers = new Map<string, Set<(data: any) => void>>();
  private statusListeners = new Set<(status: 'connecting' | 'connected' | 'disconnected') => void>();
  private cursorListeners = new Set<(cursor: any) => void>();
  private reconnectTimeout: any = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private activeRoom: string | null = null;
  private connectionStatus: 'connecting' | 'connected' | 'disconnected' = 'disconnected';

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
    return `${protocol}//ws-${hostname}`;
  }

  public connect() {
    if (typeof window === 'undefined' || this.ws) return;

    this.setStatus('connecting');
    const url = this.getWsUrl();
    console.log(`[CollabPro WS CLIENT] Connecting to ${url}...`);

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[CollabPro WS CLIENT] Connection established successfully!');
        this.setStatus('connected');
        this.reconnectDelay = 1000;

        if (this.activeRoom) {
          this.ws?.send(JSON.stringify({ type: 'join', fileId: this.activeRoom }));
        }

        this.subscribers.forEach((_, key) => {
          const [path, argsStr] = key.split(/:(.+)/);
          const args = JSON.parse(argsStr || '{}');
          this.ws?.send(JSON.stringify({ type: 'subscribe', path, args }));
        });
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
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[CollabPro WS CLIENT] Socket error:', err);
        this.cleanup();
      };
    } catch (err) {
      console.error('[CollabPro WS CLIENT] Connection initiation failed:', err);
      this.scheduleReconnect();
    }
  }

  private cleanup() {
    this.ws = null;
    this.setStatus('disconnected');
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) return;
    console.log(`[CollabPro WS CLIENT] Scheduling reconnection in ${this.reconnectDelay}ms`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
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
      return new Promise((resolve, reject) => {
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
    }

    const res = await fetch("/api/state-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, args }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Mutation failed: ${errText}`);
    }

    const json = await res.json();
    return json.data;
  }
}

const wsClient = typeof window !== 'undefined' ? new StateSyncWSClient() : null;

function useAdaptiveInterval(defaultInterval = 4000, backoffInterval = 15000, inactivityTimeout = 60000) {
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
        setIntervalTime(backoffInterval);
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
  const intervalTime = useAdaptiveInterval(4000, 15000, 60000);

  const [data, setData] = useState<any>(() => {
    if (!queryPath) return undefined;
    const cacheKey = `${queryPath}:${argsString}`;
    return queryCache.get(cacheKey);
  });

  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>(() => {
    return wsClient ? wsClient.getStatus() : 'disconnected';
  });

  useEffect(() => {
    if (!wsClient) return;
    return wsClient.addStatusListener(setWsStatus);
  }, []);

  useEffect(() => {
    if (!queryPath) return;

    const cacheKey = `${queryPath}:${argsString}`;
    let active = true;
    let timerId: any = null;

    async function fetchData() {
      try {
        const res = await fetch("/api/state-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: queryPath, args }),
        });
        if (res.ok) {
          const json = await res.json();
          if (active) {
            queryCache.set(cacheKey, json.data);
            setData(json.data);
          }
        }
      } catch (err) {
        console.error("Error fetching state-sync query:", err);
      }
    }

    if (wsClient && wsStatus === 'connected') {
      const unsubscribe = wsClient.subscribe(queryPath, args, (updatedData) => {
        if (active) {
          setData(updatedData);
        }
      });

      return () => {
        active = false;
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
        if (timerId) clearTimeout(timerId);
      };
    }
  }, [queryPath, argsString, wsStatus, intervalTime]);

  return data;
}

export function useMutation(mutationReference: any) {
  return async (args?: any) => {
    const mutationPath = getPath(mutationReference);
    if (!mutationPath) throw new Error("Invalid mutation reference passed to useMutation");

    const fileId = args?._id || args?.fileId;

    if (wsClient && wsClient.getStatus() === 'connected') {
      try {
        return await wsClient.mutation(mutationPath, args, fileId);
      } catch (err) {
        console.warn("[CollabPro WS] Mutation via WS failed, falling back to HTTP:", err);
      }
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

