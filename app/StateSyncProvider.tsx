"use client";

import { ReactNode, useEffect } from "react";
import { StateSyncProvider } from "@/lib/state-sync/react";
import { AuthProvider } from "@/lib/session-auth/client";

export default function StateSyncProviderWrapper({
  children,
}: {
  children: ReactNode;
}) {
  useEffect(() => {
    const adsClientId = process.env.NEXT_PUBLIC_GOOGLE_ADS_CLIENT_ID;
    if (adsClientId && adsClientId !== "undefined" && adsClientId !== "null" && adsClientId.trim() !== "") {
      const exists = document.querySelector(`script[src*="adsbygoogle.js"]`);
      if (!exists) {
        const script = document.createElement("script");
        script.async = true;
        script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClientId}`;
        script.crossOrigin = "anonymous";
        document.head.appendChild(script);
      }
    }
  }, []);

  return (
    <StateSyncProvider>
      <AuthProvider>
        {children}
      </AuthProvider>
    </StateSyncProvider>
  );
}