import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import ConvexClientProvider from "./ConvexClientProvider";
import { Toaster } from "@/components/ui/sonner";
import Head from "next/head";
import Script from "next/script";

const inter = Inter({ 
  subsets: ["latin"],
  variable: "--font-sans",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "CollabPro — Real-Time Whiteboard & Document Collaboration",
  description: "CollabPro is a premium, secure, real-time collaboration platform combining rich document editing with high-performance sketching and whiteboarding.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
       <Head>
        <Script
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${process.env.NEXT_PUBLIC_GOOGLE_ADS_CLIENT_ID}`}
          strategy="lazyOnload"
          crossOrigin="anonymous"
        />
      </Head>
      <body className={`${inter.variable} ${outfit.variable} antialiased`}>
        <ConvexClientProvider>
         {children}
         <Toaster />
        </ConvexClientProvider>
        </body>
    </html>
  );
}
