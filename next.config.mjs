import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    output: 'standalone',
    // Pin the trace root to this project explicitly. Without this, Next's
    // "outermost lockfile wins" heuristic can walk past this project's own
    // package-lock.json into an ancestor directory that happens to contain
    // another one (e.g. a parent checkout or monorepo root), which nests
    // .next/standalone/server.js under that ancestor's relative path instead
    // of writing it at the expected .next/standalone/server.js.
    outputFileTracingRoot: __dirname,
    async headers() {
        // The consent page must never be framed (clickjacking the Allow button).
        return [
            {
                source: '/oauth/:path*',
                headers: [
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
                    { key: 'Cache-Control', value: 'no-store' },
                    // The URL carries state/PKCE challenge; never leak it via Referer.
                    { key: 'Referrer-Policy', value: 'no-referrer' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                ],
            },
            {
                source: '/api/oauth/:path*',
                headers: [
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'Referrer-Policy', value: 'no-referrer' },
                ],
            },
        ];
    },
    images: {
        remotePatterns: [
            { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
            { protocol: 'https', hostname: 'api.dicebear.com', pathname: '/7.x/**' },
            { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
            { protocol: 'https', hostname: 'images.unsplash.com' },
        ],
    }
};

export default nextConfig;
