import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import StateSyncProvider from "./StateSyncProvider";
import { Toaster } from "@/components/ui/sonner";
import Script from "next/script";
import CommandPalette from "@/components/CommandPalette";

const inter = Inter({ 
  subsets: ["latin"],
  variable: "--font-sans",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://collabpro.io"),
  title: {
    default: "CollabPro — Real-Time Whiteboard & Document Collaboration Studio",
    template: "%s | CollabPro"
  },
  description: "The ultimate self-hosted developer studio for system design, real-time collaborative flowcharts, software architecture mapping, and deep markdown blueprints. 100% data sovereign, 0% SaaS dependencies.",
  keywords: [
    "real-time collaboration", "system architecture editor", "collaborative whiteboard",
    "markdown blueprints", "Excalidraw Next.js", "self-hosted diagramming", "Prisma Postgres team workspace",
    "collaborative flowchart tool", "open source Miro alternative"
  ],
  authors: [{ name: "CollabPro Core Contributors" }],
  creator: "CollabPro Core Team",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://collabpro.io",
    title: "CollabPro — Real-Time Whiteboard & Document Collaboration Studio",
    description: "The ultimate self-hosted developer studio for system design, real-time collaborative flowcharts, software architecture mapping, and deep markdown blueprints. 100% data sovereign, 0% SaaS dependencies.",
    siteName: "CollabPro",
    images: [{
      url: "/landing_page_clean.png",
      width: 1200,
      height: 630,
      alt: "CollabPro Workspace Blueprint Preview"
    }]
  },
  twitter: {
    card: "summary_large_image",
    title: "CollabPro — Real-Time Whiteboard & Document Collaboration Studio",
    description: "Sovereign dual-view markdown and whiteboard studio for modern engineering teams.",
    images: ["/landing_page_clean.png"],
    creator: "@collabpro"
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1
    }
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${outfit.variable} antialiased`}>
        <Script
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${process.env.NEXT_PUBLIC_GOOGLE_ADS_CLIENT_ID}`}
          strategy="lazyOnload"
          crossOrigin="anonymous"
        />
        <StateSyncProvider>
         {children}
         <Toaster />
         <CommandPalette />
        </StateSyncProvider>
      </body>
    </html>
  );
}
