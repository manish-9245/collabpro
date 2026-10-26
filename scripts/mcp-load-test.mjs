#!/usr/bin/env node
// Minimal load/soak probe for /api/mcp and the OAuth discovery/token paths.
//   BASE_URL=https://app.example.com COLLABPRO_API_KEY=collabpro_pat_... \
//   node scripts/mcp-load-test.mjs [--seconds 30] [--concurrency 10]
// Reports p50/p95/p99 latency and error rate per endpoint. The OAuth discovery
// and token endpoints must stay far below Claude's 10s timeout (30s for refresh).
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : def; };
const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const key = process.env.COLLABPRO_API_KEY;
const seconds = flag('seconds', 30);
const concurrency = flag('concurrency', 10);

const targets = [
  { name: 'well-known/oauth-protected-resource', run: () => fetch(`${base}/.well-known/oauth-protected-resource`) },
  { name: 'well-known/oauth-authorization-server', run: () => fetch(`${base}/.well-known/oauth-authorization-server`) },
  { name: 'mcp 401 (unauthenticated)', run: () => fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' }), expect: 401 },
];
if (key) {
  targets.push({
    name: 'mcp tools/list (authed)',
    run: () => fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
  });
}

const stats = new Map(targets.map((t) => [t.name, { lat: [], errors: 0 }]));
const end = Date.now() + seconds * 1000;
async function worker(n) {
  for (let i = n; Date.now() < end; i++) {
    const t = targets[i % targets.length];
    const s = stats.get(t.name);
    const t0 = performance.now();
    try {
      const res = await t.run();
      await res.arrayBuffer();
      if (res.status !== (t.expect ?? 200)) s.errors++;
    } catch { s.errors++; }
    s.lat.push(performance.now() - t0);
  }
}
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
const pct = (a, p) => (a.length ? a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);
let failed = false;
for (const [name, s] of stats) {
  const p95 = pct(s.lat, 95);
  const errRate = s.errors / Math.max(1, s.lat.length);
  if (p95 > 2000 || errRate > 0.01) failed = true;
  console.log(`${name.padEnd(42)} n=${s.lat.length} p50=${pct(s.lat, 50).toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${pct(s.lat, 99).toFixed(0)}ms err=${(errRate * 100).toFixed(2)}%`);
}
if (failed) { console.error('FAIL: p95 > 2000ms or error rate > 1%'); process.exit(1); }
