"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

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

// Proxy to simulate Convex API references (e.g. api.user.getUser)
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

// Re-export api from our mock
export const api = makePathProxy([]);

export function ConvexProvider({
  client,
  children,
}: {
  client: any;
  children: ReactNode;
}) {
  return <>{children}</>;
}

export class ConvexReactClient {
  constructor(url: string) {}
}

// Global cache to share active query results and prevent infinite re-fetches
const queryCache = new Map<string, any>();

export function useQuery(queryReference: any, args?: any) {
  const queryPath = getPath(queryReference);
  const argsString = JSON.stringify(args || {});

  const [data, setData] = useState<any>(() => {
    if (!queryPath) return undefined;
    const cacheKey = `${queryPath}:${argsString}`;
    return queryCache.get(cacheKey);
  });

  useEffect(() => {
    if (!queryPath) return;

    let active = true;
    const cacheKey = `${queryPath}:${argsString}`;

    async function fetchData() {
      try {
        const res = await fetch("/api/convex", {
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
        console.error("Error fetching mock convex query:", err);
      }
    }

    fetchData();

    // Poll for changes (since we don't have standard websockets for Convex here)
    const interval = setInterval(fetchData, 4000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [queryPath, argsString]);

  return data;
}

export function useMutation(mutationReference: any) {
  return async (args?: any) => {
    const mutationPath = getPath(mutationReference);
    if (!mutationPath) throw new Error("Invalid mutation reference passed to useMutation");

    const res = await fetch("/api/convex", {
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

export function useConvex() {
  return {
    query: async (queryReference: any, args?: any) => {
      const queryPath = getPath(queryReference);
      if (!queryPath) throw new Error("Invalid query reference passed to convex.query");

      const res = await fetch("/api/convex", {
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
