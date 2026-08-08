"use client"

import React, { useContext, useEffect, useState } from 'react';
import Header from '../../_components/Header';
import { useSessionAuth } from '@/lib/session-auth/client';
import { 
  Server, 
  Code, 
  Cpu, 
  Copy, 
  Check, 
  Terminal, 
  Compass,
  Activity,
  ExternalLink,
  Key, 
  Sparkles,
  RefreshCw,
  Zap,
  Info
} from 'lucide-react';
import { toast } from 'sonner';

export default function McpSettingsHub() {
  const { user }: any = useSessionAuth();
  const [activeTab, setActiveTab] = useState<'remote' | 'vscode' | 'claude' | 'cursor' | 'windsurf' | 'custom'>('remote');
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('YOUR_API_KEY_HERE');
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  
  // Diagnostics
  const [diagnosticState, setDiagnostics] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [handshakeLogs, setHandshakeLogs] = useState<string[]>([]);

  useEffect(() => {
    if (user?.email) {
      fetchApiKeys();
    }
  }, [user?.email]);

  const fetchApiKeys = async () => {
    setLoadingKeys(true);
    try {
      const res = await fetch('/api/api-keys');
      if (res.ok) {
        const json = await res.json();
        const active = json.apiKeys || [];
        setApiKeys(active);
        if (active.length > 0) {
          setSelectedKey(active[0].key);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingKeys(false);
    }
  };

  const copyToClipboard = (text: string, stateSetter: (b: boolean) => void) => {
    navigator.clipboard.writeText(text);
    stateSetter(true);
    toast.success("Configuration copied to clipboard!");
    setTimeout(() => stateSetter(false), 2000);
  };

  const [workspacePath, setWorkspacePath] = useState<string>('/Users/your-username/collabpro');

  // Node runtime environment setup paths
  const baseAppUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const mcpServerScriptPath = workspacePath ? `${workspacePath.replace(/\/$/, '')}/scripts/mcp-server.ts` : './scripts/mcp-server.ts';
  const remoteMcpUrl = `${baseAppUrl}/api/mcp`;

  // tsx (not ts-node) is what this repo actually has installed
  // (package.json devDependencies) and is what scripts/mcp-server.ts is
  // launched with elsewhere (see ws-server's "ws:start" script) - using it
  // here means `npx tsx` resolves locally instead of fetching an
  // uninstalled package from the registry on first run.
  const claudeConfig = JSON.stringify({
    "mcpServers": {
      "collabpro-mcp": {
        "command": "npx",
        "args": ["tsx", mcpServerScriptPath],
        "env": {
          "COLLABPRO_API_KEY": selectedKey,
          "COLLABPRO_BASE_URL": baseAppUrl
        }
      }
    }
  }, null, 2);

  // VS Code's native MCP client (Copilot Chat agent mode) reads this file
  // straight from the workspace root and speaks Streamable HTTP directly -
  // same transport as the "Remote" tab, just as a file instead of manual entry.
  const vscodeConfig = JSON.stringify({
    "inputs": [
      {
        "id": "collabproApiKey",
        "type": "promptString",
        "description": "CollabPro API key",
        "password": true
      }
    ],
    "servers": {
      "collabpro": {
        "type": "http",
        "url": remoteMcpUrl,
        "headers": { "Authorization": "Bearer ${input:collabproApiKey}" }
      }
    }
  }, null, 2);

  const cursorCommand = `npx tsx ${mcpServerScriptPath}`;
  const cursorEnv = `COLLABPRO_API_KEY=${selectedKey}\nCOLLABPRO_BASE_URL=${baseAppUrl}`;

  const CLIENTS: { id: typeof activeTab; label: string; icon: typeof Server; subtitle: string }[] = [
    { id: 'remote', label: 'Remote', icon: Server, subtitle: 'No install needed' },
    { id: 'vscode', label: 'VS Code', icon: Code, subtitle: "Copilot Chat's agent mode" },
    { id: 'claude', label: 'Claude Desktop', icon: Sparkles, subtitle: "Anthropic's desktop app" },
    { id: 'cursor', label: 'Cursor IDE', icon: Cpu, subtitle: 'AI Composer & Chat Agent' },
    { id: 'windsurf', label: 'Windsurf', icon: Compass, subtitle: 'Cascade agent' },
    { id: 'custom', label: 'Custom Stdio', icon: Terminal, subtitle: 'Any JSON-RPC client' },
  ];
  const activeClient = CLIENTS.find((c) => c.id === activeTab)!;

  // Real diagnostic against the HTTP MCP endpoint (/api/mcp), using the
  // selected key exactly as a real client would present it. This can't
  // verify the *stdio* server the configs above launch (a browser can't
  // spawn a local subprocess), but it's a genuine round trip that confirms
  // the key is valid/correctly scoped and the MCP protocol layer responds -
  // the previous version of this button never made a network call at all
  // and always reported a hard-coded success with tool names that don't
  // exist in the real implementation.
  const runDiagnostics = async () => {
    if (selectedKey === 'YOUR_API_KEY_HERE') {
      toast.warning("Please select or generate a valid CollabPro API key first.");
      return;
    }

    setDiagnostics('testing');
    setHandshakeLogs(["🔑 Testing API key against the MCP HTTP endpoint (/api/mcp)..."]);

    try {
      // The Streamable HTTP transport requires Accept to declare both media
      // types per spec - without it the SDK responds 406 regardless of a
      // valid key, which would make every diagnostic run report a false
      // failure.
      const mcpHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        Authorization: `Bearer ${selectedKey}`,
      };

      const initRes = await fetch('/api/mcp', {
        method: 'POST',
        headers: mcpHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      const initBody = await initRes.json();
      if (!initRes.ok) {
        throw new Error(initBody?.error?.message || `HTTP ${initRes.status}`);
      }
      setHandshakeLogs(prev => [...prev, `✅ initialize succeeded (protocol ${initBody.result?.protocolVersion ?? 'unknown'})`]);

      const listRes = await fetch('/api/mcp', {
        method: 'POST',
        headers: mcpHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
      });
      const listBody = await listRes.json();
      if (!listRes.ok) {
        throw new Error(listBody?.error?.message || `HTTP ${listRes.status}`);
      }
      const toolNames: string[] = (listBody.result?.tools ?? []).map((t: { name: string }) => t.name);
      setHandshakeLogs(prev => [
        ...prev,
        `✅ tools/list returned ${toolNames.length} tool(s):`,
        ...toolNames.map((name) => `   👉 ${name}`),
        "ℹ️ This confirms the API key and HTTP endpoint work. It does not launch or test the local stdio process your client config runs - relaunch your client after saving its config to verify that separately.",
      ]);
      setDiagnostics('success');
      toast.success("MCP API key verified against /api/mcp.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setHandshakeLogs(prev => [...prev, `❌ Failed: ${message}`]);
      setDiagnostics('failed');
      toast.error("MCP diagnostic failed - see console log below.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 font-sans pb-16">
      <Header />
      <div className="max-w-4xl mx-auto px-6 pt-8">

        {/* Hub Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6">
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
              MCP
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xl leading-relaxed">
              Choose your client, then follow the steps to connect it to CollabPro. /api/mcp is a real, spec-compliant remote MCP server.
            </p>
          </div>
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 px-3.5 py-1.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-1.5 transition-all w-fit"
          >
            Protocol Spec <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Prerequisites strip - API key + workspace path, needed before any
            client config below can actually work, kept compact so the client
            picker stays the visual centerpiece of the page */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-6 border-b border-slate-200/70 dark:border-slate-800/60">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              <Key className="h-3 w-3" /> API Key
            </div>
            {loadingKeys ? (
              <div className="text-[10px] text-slate-400 py-2">Loading...</div>
            ) : apiKeys.length === 0 ? (
              <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/40 rounded-lg text-[10px] text-amber-700 dark:text-amber-400 font-semibold">
                No API keys yet — generate one in Profile settings first.
              </div>
            ) : (
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="w-full text-[10px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-2 outline-none focus:border-[#6965db] text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                {apiKeys.map((key) => (
                  <option key={key.id} value={key.key}>
                    {key.name} (***{key.key.substring(key.key.length - 8)})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              <Code className="h-3 w-3" /> Local Workspace Path
            </div>
            <input
              type="text"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              placeholder="/Users/username/collabpro"
              className="w-full text-[10px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-2 outline-none focus:border-[#6965db] text-slate-700 dark:text-slate-300"
            />
          </div>
        </div>

        {/* Client picker - a row of selectable cards, the primary interaction */}
        <div className="pt-6">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {CLIENTS.map((client) => {
              const isActive = activeTab === client.id;
              const Icon = client.icon;
              return (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => setActiveTab(client.id)}
                  className={`relative flex flex-col items-center justify-center gap-2 aspect-square rounded-2xl border-2 p-3 transition-all ${
                    isActive
                      ? 'border-[#6965db] bg-[#6965db]/5'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  {isActive && (
                    <span className="absolute top-2 right-2 h-4 w-4 rounded-full bg-[#6965db] text-white flex items-center justify-center">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                  )}
                  <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${isActive ? 'bg-[#6965db]/15 text-[#6965db]' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <span className="text-[10.5px] font-bold text-slate-700 dark:text-slate-300 text-center leading-tight">{client.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Set up {client} panel */}
        <div className="mt-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 pb-5 border-b border-slate-100 dark:border-slate-800">
            <div className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0">
              <activeClient.icon className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-slate-100">Set up {activeClient.label}</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{activeClient.subtitle}</p>
            </div>
          </div>

          {/* TAB 0: REMOTE (NO INSTALL) - direct Streamable HTTP, no local process */}
          {activeTab === 'remote' && (
            <div className="mt-5 space-y-4 animate-in fade-in duration-200">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                /api/mcp is a real, spec-compliant Streamable HTTP MCP server. Any client that supports remote servers connects with just a URL and a Bearer token — no local process, no runtime to install. In your client's remote MCP server settings, add a new <strong>Streamable HTTP</strong> server with the URL and header below.
              </p>

              <div className="space-y-3">
                <div>
                  <div className="text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1.5">Server URL</div>
                  <div className="flex items-center justify-between gap-3 bg-slate-900 rounded-xl px-4 py-3">
                    <code className="font-mono text-[11px] text-slate-100 truncate select-all">{remoteMcpUrl}</code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(remoteMcpUrl, setCopiedCmd)}
                      className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-bold cursor-pointer transition-colors"
                    >
                      {copiedCmd ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      {copiedCmd ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1.5">Authorization Header</div>
                  <div className="flex items-center justify-between gap-3 bg-slate-900 rounded-xl px-4 py-3">
                    <code className="font-mono text-[11px] text-emerald-400 truncate select-all">{`Bearer ${selectedKey}`}</code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`Bearer ${selectedKey}`, setCopiedText)}
                      className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-bold cursor-pointer transition-colors"
                    >
                      {copiedText ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      {copiedText ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>

              <p className="text-[10.5px] text-slate-400 dark:text-slate-500 leading-relaxed flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-[#6965db] shrink-0 mt-0.5" />
                Client doesn't support remote servers yet? Use the Claude Desktop, Cursor IDE, or Windsurf cards above — they all launch a local stdio bridge that forwards to this same URL.
              </p>
            </div>
          )}

          {/* TAB 0b: VS CODE - native Streamable HTTP client via .vscode/mcp.json */}
          {activeTab === 'vscode' && (
            <div className="mt-5 space-y-4 animate-in fade-in duration-200">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                VS Code has a native MCP client that speaks Streamable HTTP directly — no bridge process. This repo already ships a <code className="font-mono text-[10px]">.vscode/mcp.json</code> with this exact config. Open this repo as a workspace, then run <strong>MCP: List Servers</strong> and start the <code className="font-mono text-[10px]">collabpro</code> entry — VS Code will prompt once for the API key selected above.
              </p>

              <div className="relative">
                <pre className="bg-slate-900 rounded-xl p-4 font-mono text-[10.5px] text-slate-100 overflow-x-auto select-all max-h-[220px]">
                  {vscodeConfig}
                </pre>
                <button
                  type="button"
                  onClick={() => copyToClipboard(vscodeConfig, setCopiedCmd)}
                  className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-bold cursor-pointer transition-colors"
                  title="Copy .vscode/mcp.json"
                >
                  {copiedCmd ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copiedCmd ? 'Copied' : 'Copy'}
                </button>
              </div>

              <p className="text-[10.5px] text-slate-400 dark:text-slate-500 leading-relaxed flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-[#6965db] shrink-0 mt-0.5" />
                Tool calls made from VS Code's agent run on VS Code's own model/tokens — this server has no model provider key of its own and can't spend one.
              </p>
            </div>
          )}

          {/* TAB 1: CLAUDE DESKTOP APP CONFIG */}
          {activeTab === 'claude' && (
            <div className="mt-5 space-y-4 animate-in fade-in duration-200">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Open your Claude Desktop config file at <code className="font-mono text-[10px] text-[#6965db]">~/Library/Application Support/Claude/claude_desktop_config.json</code>, merge the JSON below under the root object, then relaunch Claude Desktop.
              </p>

              <div className="relative">
                <pre className="bg-slate-900 rounded-xl p-4 font-mono text-[10.5px] text-slate-100 overflow-x-auto select-all max-h-[180px]">
                  {claudeConfig}
                </pre>
                <button
                  type="button"
                  onClick={() => copyToClipboard(claudeConfig, setCopiedText)}
                  className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-bold cursor-pointer transition-colors"
                  title="Copy configuration"
                >
                  {copiedText ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copiedText ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: CURSOR CUSTOM COMMAND */}
          {activeTab === 'cursor' && (
            <div className="mt-5 space-y-4 animate-in fade-in duration-200">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Open <strong>Cursor Settings &gt; Features &gt; MCP</strong>, add a new server of type <strong>stdio</strong>, then set the command and environment variables below.
              </p>

              <div className="space-y-3">
                <div>
                  <div className="text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1.5">Command</div>
                  <div className="flex items-center justify-between gap-3 bg-slate-900 rounded-xl px-4 py-3">
                    <code className="font-mono text-[11px] text-slate-100 truncate select-all">{cursorCommand}</code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(cursorCommand, setCopiedCmd)}
                      className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-bold cursor-pointer transition-colors"
                    >
                      {copiedCmd ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      {copiedCmd ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1.5">Environment Variables</div>
                  <pre className="bg-slate-900 rounded-xl p-4 font-mono text-[10.5px] text-emerald-400 overflow-x-auto select-all">
                    {cursorEnv}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: WINDSURF */}
          {activeTab === 'windsurf' && (
            <div className="mt-5 space-y-4 animate-in fade-in duration-200">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Open <strong>Windsurf settings &gt; Model Context Protocol</strong> and add a new stdio server using the same command and environment variables as the Cursor card, then restart the workspace window.
              </p>

              <p className="text-[10.5px] text-slate-400 dark:text-slate-500 leading-relaxed flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-[#6965db] shrink-0 mt-0.5" />
                Windsurf follows the standard Model Context Protocol spec — the Cursor card's command and env values work here unchanged.
              </p>
            </div>
          )}

          {/* TAB 4: CUSTOM STDIO CLIENTS */}
          {activeTab === 'custom' && (
            <div className="mt-5 space-y-2 animate-in fade-in duration-200 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              <p>• Transmits JSON-RPC payloads over standard <code className="font-mono text-[10px]">stdin</code> / <code className="font-mono text-[10px]">stdout</code> pipes.</p>
              <p>• Speaks the Model Context Protocol v1 spec natively.</p>
              <p>• Authenticates with an <code className="font-mono text-[10px]">Authorization: Bearer &lt;key&gt;</code> header on the remote endpoint (<code className="font-mono text-[10px]">COLLABPRO_API_KEY</code> is only the local bridge script's env var name for that same key).</p>
            </div>
          )}
        </div>

        {/* Diagnostics - live handshake test against the real MCP endpoint */}
        <div className="mt-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <Activity className="h-4 w-4 text-[#6965db]" />
              <span className="text-xs font-black">Diagnostics</span>
            </div>
            {diagnosticState === 'success' && (
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
            )}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Test the selected API key against the live MCP endpoint.
          </p>

          <div className="mt-4 min-h-[110px] max-h-[140px] bg-slate-900 rounded-xl p-3.5 font-mono text-[10px] overflow-y-auto space-y-1 select-none">
            {handshakeLogs.length === 0 ? (
              <div className="text-slate-500 italic text-center pt-8">Console idle. Run diagnostics below.</div>
            ) : (
              handshakeLogs.map((log, i) => (
                <div key={i} className={log.startsWith('✅') ? 'text-emerald-400 font-bold' : log.startsWith('❌') ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                  {log}
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={runDiagnostics}
            disabled={diagnosticState === 'testing'}
            className="mt-4 w-full sm:w-auto px-5 h-9 bg-[#6965db] hover:bg-[#5753c9] text-white text-[11px] font-bold rounded-xl cursor-pointer shadow-md shadow-[#6965db]/20 flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
          >
            {diagnosticState === 'testing' ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Handshaking...
              </>
            ) : (
              <>
                <Zap className="h-3.5 w-3.5" /> Run Diagnostics
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
