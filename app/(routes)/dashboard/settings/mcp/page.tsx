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
  HelpCircle, 
  Activity, 
  CheckCircle, 
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
  const [activeTab, setActiveTab] = useState<'remote' | 'claude' | 'cursor' | 'windsurf' | 'custom'>('remote');
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

  const cursorCommand = `npx tsx ${mcpServerScriptPath}`;
  const cursorEnv = `COLLABPRO_API_KEY=${selectedKey}\nCOLLABPRO_BASE_URL=${baseAppUrl}`;

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
      <div className="max-w-6xl mx-auto px-6 pt-8">
        
        {/* Hub Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-slate-200/50 dark:border-slate-800/60">
          <div>
            <div className="flex items-center gap-2 text-[#6965db]">
              <Cpu className="h-5 w-5 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-wider">Model Context Protocol</span>
            </div>
            <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100 tracking-tight mt-1">
              MCP Client Integration Hub
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Connect external agentic AI engines directly to your self-hosted whiteboard canvas elements. /api/mcp is a spec-compliant remote MCP server — clients that support remote servers need just a URL and API key, zero local install. Claude, Cursor, or Windsurf can view and write system diagrams on your behalf!
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <a 
              href="https://modelcontextprotocol.io" 
              target="_blank" 
              rel="noopener noreferrer"
              className="px-3.5 py-1.5 border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 rounded-lg text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-1.5 transition-all"
            >
              Protocol Spec <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* Configuration Setup Blocks */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
          
          {/* Settings Left Controls Column */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* Step 1: Credentials selector */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 p-5 rounded-2xl shadow-sm">
              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <Key className="h-4 w-4 text-[#6965db]" />
                <span className="text-[11px] font-bold uppercase tracking-wider">1. Select API Key</span>
              </div>
              <p className="text-[9.5px] text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed">
                Configurations are dynamically updated on selection. Keys can be managed in settings.
              </p>
              
              <div className="mt-4">
                {loadingKeys ? (
                  <div className="text-center py-2 text-[10px] text-slate-400">Loading secure keys...</div>
                ) : apiKeys.length === 0 ? (
                  <div className="p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/40 dark:border-amber-900/40 rounded-xl">
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold leading-normal">
                      No active API keys found!
                    </p>
                    <p className="text-[8.5px] text-amber-600 dark:text-amber-500 mt-0.5 leading-normal">
                      Please go to your Profile settings tab and generate a new key first.
                    </p>
                  </div>
                ) : (
                  <select
                    value={selectedKey}
                    onChange={(e) => setSelectedKey(e.target.value)}
                    className="w-full text-[10px] font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 outline-none focus:border-[#6965db] text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    {apiKeys.map((key) => (
                      <option key={key.id} value={key.key}>
                        {key.name} (***{key.key.substring(key.key.length - 8)})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Step 1b: Workspace absolute path */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 p-5 rounded-2xl shadow-sm">
              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <Code className="h-4 w-4 text-[#6965db]" />
                <span className="text-[11px] font-bold uppercase tracking-wider">1b. Local Workspace Path</span>
              </div>
              <p className="text-[9.5px] text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed">
                Provide the absolute path to your local CollabPro repository. This dynamically updates client script paths below!
              </p>
              
              <div className="mt-4">
                <input
                  type="text"
                  value={workspacePath}
                  onChange={(e) => setWorkspacePath(e.target.value)}
                  placeholder="/Users/username/collabpro"
                  className="w-full text-[10px] font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 outline-none focus:border-[#6965db] text-slate-700 dark:text-slate-300"
                />
              </div>
            </div>

            {/* Step 2: Live Diagnostic Handshake Visualizer */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 p-5 rounded-2xl shadow-sm flex flex-col">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <Activity className="h-4 w-4 text-[#6965db]" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">2. Diagnostics</span>
                </div>
                {diagnosticState === 'success' && (
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                )}
              </div>
              <p className="text-[9.5px] text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed">
                Test the client handshake stdio connection parameters instantly.
              </p>

              {/* Handshake Console logs screen */}
              <div className="flex-1 min-h-[140px] max-h-[140px] bg-slate-950 rounded-xl p-3.5 font-mono text-[8px] mt-4 overflow-y-auto space-y-1 select-none border border-slate-800 text-slate-400">
                {handshakeLogs.length === 0 ? (
                  <div className="text-slate-600 italic text-center pt-8">Console idle. Hit "Run Diagnostics" below.</div>
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
                className="mt-4 w-full h-9 bg-[#6965db] hover:bg-[#5753c9] text-white text-[10px] font-bold uppercase tracking-wider rounded-xl cursor-pointer shadow-md shadow-[#6965db]/20 flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
              >
                {diagnosticState === 'testing' ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Handshaking...
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5" /> Run Handshake Diagnostics
                  </>
                )}
              </button>
            </div>

          </div>

          {/* Setup Tabs Central Panels Column */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Guide category selector tabs */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 p-5 rounded-2xl shadow-sm">
              <div className="flex border-b border-slate-100 dark:border-slate-800 pb-3 gap-2">
                <button
                  onClick={() => setActiveTab('remote')}
                  className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                    activeTab === 'remote'
                      ? 'bg-[#6965db]/10 text-[#6965db] dark:text-[#8572e3] font-black'
                      : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                  }`}
                >
                  Remote (No Install)
                </button>
                <button
                  onClick={() => setActiveTab('claude')}
                  className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                    activeTab === 'claude' 
                      ? 'bg-[#6965db]/10 text-[#6965db] dark:text-[#8572e3] font-black' 
                      : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                  }`}
                >
                  Claude Desktop
                </button>
                <button
                  onClick={() => setActiveTab('cursor')}
                  className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                    activeTab === 'cursor' 
                      ? 'bg-[#6965db]/10 text-[#6965db] dark:text-[#8572e3] font-black' 
                      : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                  }`}
                >
                  Cursor IDE
                </button>
                <button
                  onClick={() => setActiveTab('windsurf')}
                  className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                    activeTab === 'windsurf' 
                      ? 'bg-[#6965db]/10 text-[#6965db] dark:text-[#8572e3] font-black' 
                      : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                  }`}
                >
                  Windsurf
                </button>
                <button
                  onClick={() => setActiveTab('custom')}
                  className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                    activeTab === 'custom' 
                      ? 'bg-[#6965db]/10 text-[#6965db] dark:text-[#8572e3] font-black' 
                      : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                  }`}
                >
                  Custom Stdio
                </button>
              </div>

              {/* TAB 0: REMOTE (NO INSTALL) - direct Streamable HTTP, no local process */}
              {activeTab === 'remote' && (
                <div className="mt-5 space-y-4 animate-in fade-in duration-200">
                  <div className="space-y-1">
                    <h3 className="text-xs font-black text-slate-800 dark:text-slate-200">Remote MCP Server (Recommended)</h3>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      /api/mcp is a real, spec-compliant Streamable HTTP MCP server. Any client that supports remote servers connects with just a URL and a Bearer token — no local process, no runtime to install.
                    </p>
                  </div>

                  <div className="text-[9.5px] text-slate-500 dark:text-slate-400 space-y-1 bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                    <p className="font-bold text-slate-700 dark:text-slate-300">How to load:</p>
                    <p>1. In your client's remote MCP server settings, add a new server of type <strong>Streamable HTTP</strong>.</p>
                    <p>2. Paste the Server URL below.</p>
                    <p>3. Set the Authorization header to <span className="font-mono text-[#6965db]">Bearer &lt;your API key&gt;</span> using the key selected on the left.</p>
                  </div>

                  <div className="space-y-3.5">
                    <div>
                      <div className="text-[8.5px] font-black uppercase text-slate-400 tracking-wider mb-1">Server URL:</div>
                      <div className="relative">
                        <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 font-mono text-[8.5px] text-slate-300 overflow-x-auto select-all">
                          {remoteMcpUrl}
                        </pre>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(remoteMcpUrl, setCopiedCmd)}
                          className="absolute top-2.5 right-3 p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
                        >
                          {copiedCmd ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="text-[8.5px] font-black uppercase text-slate-400 tracking-wider mb-1">Authorization Header:</div>
                      <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 font-mono text-[8.5px] text-emerald-400 overflow-x-auto select-all">
                        {`Bearer ${selectedKey}`}
                      </pre>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800/80 rounded-xl flex items-start gap-3">
                    <Info className="h-4 w-4 text-[#6965db] shrink-0 mt-0.5" />
                    <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-relaxed">
                      Client doesn't support remote servers yet? Use the Claude Desktop, Cursor IDE, or Windsurf tabs — they all launch a local stdio bridge that forwards to this same URL.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 1: CLAUDE DESKTOP APP CONFIG */}
              {activeTab === 'claude' && (
                <div className="mt-5 space-y-4 animate-in fade-in duration-200">
                  <div className="space-y-1">
                    <h3 className="text-xs font-black text-slate-800 dark:text-slate-200">Claude Desktop Config Integrator</h3>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Inject our custom tools definition straight into Anthropic's Claude Desktop config registry.
                    </p>
                  </div>

                  {/* Step instructions */}
                  <div className="text-[9.5px] text-slate-500 dark:text-slate-400 space-y-1 bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                    <p className="font-bold text-slate-700 dark:text-slate-300">How to load:</p>
                    <p>1. Open your Claude Desktop settings configurations file:</p>
                    <p className="font-mono text-[8px] pl-3 text-[#6965db]">~/Library/Application Support/Claude/claude_desktop_config.json</p>
                    <p>2. Copy the precompiled JSON block below and merge it under the root object.</p>
                    <p>3. Relaunch your Claude Desktop Client app to establish connection handshake.</p>
                  </div>

                  {/* Preloaded code block editor */}
                  <div className="relative">
                    <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-[8.5px] text-slate-300 overflow-x-auto select-all max-h-[180px]">
                      {claudeConfig}
                    </pre>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(claudeConfig, setCopiedText)}
                      className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
                      title="Copy Configuration Payload"
                    >
                      {copiedText ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 2: CURSOR CUSTOM COMMAND */}
              {activeTab === 'cursor' && (
                <div className="mt-5 space-y-4 animate-in fade-in duration-200">
                  <div className="space-y-1">
                    <h3 className="text-xs font-black text-slate-800 dark:text-slate-200">Cursor IDE Custom Command Builder</h3>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Connect Cursor's AI Composer and Chat Agent to read and edit your diagrams in real-time.
                    </p>
                  </div>

                  <div className="text-[9.5px] text-slate-500 dark:text-slate-400 space-y-1 bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                    <p className="font-bold text-slate-700 dark:text-slate-300">How to load:</p>
                    <p>1. Open **Cursor Settings &gt; Features &gt; MCP**.</p>
                    <p>2. Add a new MCP Server choosing type **stdio**.</p>
                    <p>3. Configure the command path and environment variable mappings shown below.</p>
                  </div>

                  <div className="space-y-3.5">
                    {/* Command setting item */}
                    <div>
                      <div className="text-[8.5px] font-black uppercase text-slate-400 tracking-wider mb-1">Executable Command:</div>
                      <div className="relative">
                        <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 font-mono text-[8.5px] text-slate-300 overflow-x-auto select-all">
                          {cursorCommand}
                        </pre>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(cursorCommand, setCopiedCmd)}
                          className="absolute top-2.5 right-3 p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
                        >
                          {copiedCmd ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Environment Settings items */}
                    <div>
                      <div className="text-[8.5px] font-black uppercase text-slate-400 tracking-wider mb-1">Required Environment Values:</div>
                      <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 font-mono text-[8.5px] text-emerald-400 overflow-x-auto select-all">
                        {cursorEnv}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: WINDSURF */}
              {activeTab === 'windsurf' && (
                <div className="mt-5 space-y-4 animate-in fade-in duration-200">
                  <div className="space-y-1">
                    <h3 className="text-xs font-black text-slate-800 dark:text-slate-200">Windsurf IDE Client Connector</h3>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Seamlessly link Windsurf's premium coding agents directly with whiteboard coordinates.
                    </p>
                  </div>

                  <div className="text-[9.5px] text-slate-500 dark:text-slate-400 space-y-1 bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                    <p className="font-bold text-slate-700 dark:text-slate-300">How to load:</p>
                    <p>1. Open **Windsurf settings panel &gt; Model Context Protocol**.</p>
                    <p>2. Copy and paste the standard Stdio command template and key mappings similar to the Cursor configuration settings.</p>
                    <p>3. Restart the workspace window thread to initialize client node handshakes.</p>
                  </div>
                  
                  <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800/80 rounded-xl flex items-start gap-3">
                    <Info className="h-4 w-4 text-[#6965db] shrink-0 mt-0.5" />
                    <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-relaxed">
                      Tip: Windsurf uses the standard model-context-protocol specifications. If typescript packages are cached, you can launch the exporter runtime using direct npx nodes dynamically!
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 4: CUSTOM STDIO CLIENTS */}
              {activeTab === 'custom' && (
                <div className="mt-5 space-y-4 animate-in fade-in duration-200">
                  <div className="space-y-1">
                    <h3 className="text-xs font-black text-slate-800 dark:text-slate-200">Generic Stdio Node.js Client Setup</h3>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Implement handshakes in custom Python, Node, or Go tooling engines.
                    </p>
                  </div>

                  <div className="text-[9.5px] text-slate-500 dark:text-slate-400 space-y-2 bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-100 dark:border-slate-800 leading-relaxed">
                    <p className="font-bold text-slate-700 dark:text-slate-300">Specifications:</p>
                    <p>• Transmits JSON-RPC payload events through standard system pipelines (`stdin` / `stdout`).</p>
                    <p>• Communicates natively using the Model Context Protocol v1 specifications.</p>
                    <p>• API Authentication uses an `Authorization: Bearer &lt;key&gt;` HTTP header on the remote MCP endpoint (`COLLABPRO_API_KEY` is only the local bridge script's env var name for that same key).</p>
                  </div>
                </div>
              )}

            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
