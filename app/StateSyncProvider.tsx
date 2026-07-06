"use client";

import { ReactNode } from "react";
import { StateSyncProvider } from "@/lib/state-sync/react";
import { AuthProvider } from "@/lib/session-auth/client";

export default function StateSyncProviderWrapper({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <StateSyncProvider>
      <AuthProvider>
        {children}
      </AuthProvider>
    </StateSyncProvider>
  );
}