"use client"

import React, { useContext, useEffect, useState } from 'react'
import Header from '../_components/Header'
import { ActiveTeamContext } from '@/app/_context/ActiveTeamContext'
import { useSessionAuth } from '@/lib/session-auth/client'
import { api, useSync } from '@/lib/state-sync/react'
import { toast } from 'sonner'
import { 
  Key, Copy, Check, Plus, Trash2, Shield, Calendar, 
  Terminal, Code2, Server, Play, RefreshCw, Layers, Cpu, HelpCircle 
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function DevelopersDashboard() {
  const { user }: any = useSessionAuth();
  const { activeTeam } = useContext(ActiveTeamContext);
  const sync = useSync();

  // API Keys state
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [expiresDays, setExpiresDays] = useState('30');
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<any | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // Playground state
  const [selectedLanguage, setSelectedLanguage] = useState<'curl' | 'js' | 'python' | 'go'>('curl');
  const [selectedMethod, setSelectedMethod] = useState<string>('list_tools');
  const [argumentsJson, setArgumentsJson] = useState<string>('{\n  "scope": "team"\n}');
  const [playgroundApiKey, setPlaygroundApiKey] = useState<string>('');
  const [consoleLogs, setConsoleLogs] = useState<any[]>([]);
  const [executingRequest, setExecutingRequest] = useState(false);

  useEffect(() => {
    if (user?.email) {
      fetchApiKeys();
    }
  }, [user]);

  const fetchApiKeys = async () => {
    setLoadingKeys(true);
    try {
      const res = await fetch('/api/api-keys');
      if (res.ok) {
        const json = await res.json();
        setApiKeys(json.apiKeys || []);
        if (json.apiKeys && json.apiKeys.length > 0 && !playgroundApiKey) {
          // prefill playground key
          setPlaygroundApiKey('collabpro_pat_••••••••');
        }
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load developer keys.");
    } finally {
      setLoadingKeys(false);
    }
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    setGeneratingKey(true);
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName, expiresDays, scope: 'read-write' })
      });
      if (res.ok) {
        const json = await res.json();
        setNewlyCreatedKey(json.apiKey);
        setNewKeyName('');
        fetchApiKeys();
        toast.success("Developer API Key successfully generated!");
      } else {
        const errJson = await res.json();
        toast.error(errJson.error || "Failed to create developer key.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate Developer Key.");
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleRevokeApiKey = async (id: string, name: string) => {
    const confirmed = confirm(`Are you sure you want to revoke API key "${name}"? It will stop working immediately.`);
    if (!confirmed) return;

    try {
      const res = await fetch('/api/api-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        toast.success(`Key "${name}" has been successfully revoked.`);
        fetchApiKeys();
      } else {
        toast.error("Failed to revoke API key.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to revoke API key.");
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKeyId(id);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  // Code Sandbox Snippets
  const getCodeSnippet = () => {
    const keyToUse = newlyCreatedKey?.key || playgroundApiKey || 'YOUR_API_KEY';
    const cleanArgs = argumentsJson.replace(/\n/g, '\n  ');

    if (selectedMethod === 'list_tools') {
      switch (selectedLanguage) {
        case 'curl':
          return `curl -X POST \${window.location.origin || 'http://localhost:3000'}/api/mcp \\
  -H "Authorization: Bearer ${keyToUse}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'`;
        case 'js':
          return `const response = await fetch('/api/mcp', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${keyToUse}',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/list',
    id: 1
  })
});
const result = await response.json();
console.log(result);`;
        case 'python':
          return `import requests

url = "http://localhost:3000/api/mcp"
headers = {
    "Authorization": "Bearer ${keyToUse}",
    "Content-Type": "application/json"
}
payload = {
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
}

res = requests.post(url, json=payload, headers=headers)
print(res.json())`;
        case 'go':
          return `package main

import (
	"bytes"
	"fmt"
	"net/http"
)

func main() {
	url := "http://localhost:3000/api/mcp"
	payload := []byte(\`{"jsonrpc":"2.0","method":"tools/list","id":1}\`)
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(payload))
	req.Header.Set("Authorization", "Bearer ${keyToUse}")
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, _ := client.Do(req)
	fmt.Println("Response Status:", resp.Status)
}`;
      }
    } else {
      // call_tool
      switch (selectedLanguage) {
        case 'curl':
          return `curl -X POST \${window.location.origin || 'http://localhost:3000'}/api/mcp \\
  -H "Authorization: Bearer ${keyToUse}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "${selectedMethod}",
      "arguments": ${cleanArgs}
    },
    "id": 1
  }'`;
        case 'js':
          return `const response = await fetch('/api/mcp', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${keyToUse}',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: '${selectedMethod}',
      arguments: ${cleanArgs}
    },
    id: 1
  })
});
const result = await response.json();
console.log(result);`;
        case 'python':
          return `import requests

url = "http://localhost:3000/api/mcp"
headers = {
    "Authorization": "Bearer ${keyToUse}",
    "Content-Type": "application/json"
}
payload = {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
        "name": "${selectedMethod}",
        "arguments": ${cleanArgs}
    },
    "id": 1
}

res = requests.post(url, json=payload, headers=headers)
print(res.json())`;
        case 'go':
          return `package main

import (
	"bytes"
	"fmt"
	"net/http"
)

func main() {
	url := "http://localhost:3000/api/mcp"
	payload := []byte(\`{"jsonrpc":"2.0","method":"tools/call","params":{"name":"${selectedMethod}","arguments":${cleanArgs.replace(/\n/g, "")}},"id":1}\`)
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(payload))
	req.Header.Set("Authorization", "Bearer ${keyToUse}")
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, _ := client.Do(req)
	fmt.Println("Response Status:", resp.Status)
}`;
      }
    }
  };

  // Run Playground Trigger
  const handleExecuteRequest = async () => {
    const keyToUse = newlyCreatedKey?.key || playgroundApiKey;
    if (!keyToUse || keyToUse.includes('•••')) {
      toast.error("Please enter/select a valid full API key secret to execute live requests.");
      return;
    }

    setExecutingRequest(true);
    const id = Date.now();

    let payload: any = {
      jsonrpc: '2.0',
      id
    };

    if (selectedMethod === 'list_tools') {
      payload.method = 'tools/list';
    } else {
      payload.method = 'tools/call';
      try {
        const parsedArgs = JSON.parse(argumentsJson);
        payload.params = {
          name: selectedMethod,
          arguments: parsedArgs
        };
      } catch (e: any) {
        toast.error("Arguments must be valid JSON object: " + e.message);
        setExecutingRequest(false);
        return;
      }
    }

    // Add request log
    setConsoleLogs(prev => [
      {
        type: 'request',
        timestamp: new Date().toLocaleTimeString(),
        payload
      },
      ...prev
    ]);

    try {
      const response = await fetch('/api/mcp', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${keyToUse}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const responseJson = await response.json();
      setConsoleLogs(prev => [
        {
          type: 'response',
          status: response.status,
          timestamp: new Date().toLocaleTimeString(),
          payload: responseJson
        },
        ...prev
      ]);
      if (response.ok) {
        toast.success("JSON-RPC Request Executed Successfully!");
      } else {
        toast.error(responseJson.error?.message || "Execution returned an error status.");
      }
    } catch (err: any) {
      console.error(err);
      setConsoleLogs(prev => [
        {
          type: 'error',
          timestamp: new Date().toLocaleTimeString(),
          payload: { error: err.message || "Network request failed" }
        },
        ...prev
      ]);
      toast.error("Network error during playground execution.");
    } finally {
      setExecutingRequest(false);
    }
  };

  return (
    <div className='p-4 sm:p-8 min-h-screen bg-slate-950 text-slate-100'>
      <Header />

      <div className="mt-8 space-y-8 max-w-7xl mx-auto">
        {/* Page Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-6 sm:p-8 shadow-2xl">
          <div className="absolute top-0 right-0 -mt-10 -mr-10 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-1/4 -mb-10 w-56 h-56 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-950/40 text-blue-400 text-xs font-semibold border border-blue-900/30">
                <Cpu className="h-3.5 w-3.5 animate-pulse" />
                <span>CollabPro Developer Gateway</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Developer & MCP Integration Hub
              </h1>
              <p className="text-sm text-zinc-400 max-w-2xl leading-relaxed">
                Connect external agents, IDE extensions, or scripts directly into CollabPro. Create secure API tokens, explore standard Model Context Protocol schemas, and test integrations live.
              </p>
            </div>
            
            <div className="flex gap-4 items-center bg-zinc-900/40 border border-zinc-800 p-4 rounded-xl">
              <div className="h-10 w-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">
                <Server className="h-5 w-5" />
              </div>
              <div className="text-left">
                <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Protocol Status</h4>
                <p className="text-sm font-bold text-emerald-400">HTTP & Stdio Online</p>
              </div>
            </div>
          </div>
        </div>

        {/* Core Sections Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* LEFT: API Keys & Sandboxing */}
          <div className="lg:col-span-7 space-y-8">
            
            {/* API Key lifecycle panel */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl space-y-6">
              <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <Key className="h-5 w-5 text-blue-400" />
                  <h2 className="text-lg font-bold text-white">Developer API Keys</h2>
                </div>
                <span className="text-xs text-zinc-500">Secure SHA-256 Tokens</span>
              </div>

              {newlyCreatedKey && (
                <div className="p-4 bg-emerald-950/20 border border-emerald-900/50 rounded-xl space-y-3 animate-in fade-in duration-300">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Key Created - Save this secret!</span>
                    <span className="text-[10px] text-zinc-500">Only shown once</span>
                  </div>
                  <div className="flex gap-2 items-center">
                    <input 
                      type="text" 
                      readOnly 
                      value={newlyCreatedKey.key} 
                      className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-emerald-300 w-full select-all outline-none"
                    />
                    <Button 
                      onClick={() => copyToClipboard(newlyCreatedKey.key, newlyCreatedKey.id)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      size="sm"
                    >
                      {copiedKeyId === newlyCreatedKey.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Use this key in the Authorization header as a Bearer Token: <code className="text-emerald-400">Bearer {newlyCreatedKey.key}</code>
                  </p>
                </div>
              )}

              <form onSubmit={handleCreateApiKey} className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <Input 
                    type="text" 
                    placeholder="e.g. Cursor Assistant Token" 
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 text-sm rounded-lg"
                    required
                  />
                </div>
                <div className="w-32 shrink-0">
                  <select 
                    value={expiresDays} 
                    onChange={(e) => setExpiresDays(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm rounded-lg px-3 py-2 h-9 outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="7">7 Days</option>
                    <option value="30">30 Days</option>
                    <option value="90">90 Days</option>
                    <option value="365">1 Year</option>
                  </select>
                </div>
                <Button 
                  type="submit" 
                  disabled={generatingKey}
                  className="bg-blue-600 hover:bg-blue-700 text-white h-9 px-4 rounded-lg shrink-0 gap-1.5"
                >
                  {generatingKey ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Generate Key
                </Button>
              </form>

              <div className="space-y-3">
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider block">Active Keys</span>
                
                {loadingKeys ? (
                  <div className="flex justify-center items-center py-6 text-zinc-500 gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
                    <span>Loading keys...</span>
                  </div>
                ) : apiKeys.length === 0 ? (
                  <div className="text-center py-8 text-sm text-zinc-600 border border-dashed border-zinc-800 rounded-xl">
                    No active developer keys found. Generate one above to begin.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                    {apiKeys.map((key) => (
                      <div key={key.id} className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/30 border border-zinc-800/60 hover:border-zinc-800 transition-all">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg bg-zinc-900 flex items-center justify-center text-blue-400 border border-zinc-800">
                            <Key className="h-4 w-4" />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-white">{key.name}</h4>
                            <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-1">
                              <span className="font-mono text-zinc-400">{key.maskedKey}</span>
                              <span>•</span>
                              <span className="flex items-center gap-0.5"><Shield className="h-3 w-3" /> {key.scope}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="text-right hidden sm:block">
                            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block">Expires</span>
                            <span className="text-xs text-zinc-400 font-mono">
                              {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : 'Never'}
                            </span>
                          </div>
                          <Button 
                            variant="ghost" 
                            onClick={() => handleRevokeApiKey(key.id, key.name)}
                            className="h-8 w-8 p-0 text-zinc-500 hover:text-red-400 hover:bg-zinc-900 rounded-lg"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Interactive Code Sandbox */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl space-y-6">
              <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <Code2 className="h-5 w-5 text-indigo-400" />
                  <h2 className="text-lg font-bold text-white">Interactive Integration Sandbox</h2>
                </div>
                
                {/* Languages switcher */}
                <div className="flex gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800">
                  {(['curl', 'js', 'python', 'go'] as const).map(lang => (
                    <button
                      key={lang}
                      onClick={() => setSelectedLanguage(lang)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                        selectedLanguage === lang 
                          ? 'bg-zinc-800 text-white shadow' 
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {lang === 'js' ? 'JS' : lang.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex gap-2 items-center text-xs text-zinc-400 bg-zinc-900/30 p-2.5 rounded-lg border border-zinc-800">
                  <Terminal className="h-4 w-4 text-indigo-400 shrink-0" />
                  <span>Choose any method or tool below to automatically compile code execution blocks:</span>
                </div>

                <div className="relative">
                  <pre className="bg-zinc-900 text-zinc-300 p-4 rounded-xl border border-zinc-800 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-[250px] scrollbar-thin">
                    <code>{getCodeSnippet()}</code>
                  </pre>
                  <Button
                    onClick={() => copyToClipboard(getCodeSnippet(), 'snippet_copy')}
                    className="absolute top-2.5 right-2.5 h-7 w-7 p-0 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                  >
                    {copiedKeyId === 'snippet_copy' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT: JSON-RPC Live Playground */}
          <div className="lg:col-span-5 space-y-8">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl flex flex-col h-full space-y-6">
              <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <Play className="h-5 w-5 text-emerald-400" />
                  <h2 className="text-lg font-bold text-white">JSON-RPC Live Console</h2>
                </div>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>

              {/* API Key selector or plain-text input */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider block">Execution Authentication</label>
                <Input 
                  type="password"
                  placeholder="Paste your collabpro_pat_... secret key here"
                  value={playgroundApiKey}
                  onChange={(e) => setPlaygroundApiKey(e.target.value)}
                  className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-600 text-xs font-mono"
                />
              </div>

              {/* Methods selector */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider block">Target MCP / REST Method</label>
                <select
                  value={selectedMethod}
                  onChange={(e) => {
                    setSelectedMethod(e.target.value);
                    if (e.target.value === 'list_tools') {
                      setArgumentsJson('{}');
                    } else if (e.target.value === 'collabpro_list_files') {
                      setArgumentsJson('{\n  "scope": "team"\n}');
                    } else if (e.target.value === 'collabpro_get_file') {
                      setArgumentsJson('{\n  "fileId": "YOUR_FILE_UUID"\n}');
                    } else if (e.target.value === 'collabpro_update_document') {
                      setArgumentsJson('{\n  "fileId": "YOUR_FILE_UUID",\n  "document": "{\\\"blocks\\\":[{\\\"type\\\":\\\"paragraph\\\",\\\"data\\\":{\\\"text\\\":\\\"Updated via CollabPro MCP\\\"}}]}"\n}');
                    } else if (e.target.value === 'collabpro_update_whiteboard') {
                      setArgumentsJson('{\n  "fileId": "YOUR_FILE_UUID",\n  "whiteboard": "[]"\n}');
                    }
                  }}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white text-xs font-semibold rounded-lg px-3 py-2 h-9 outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="list_tools">tools/list (Discover schemas)</option>
                  <option value="collabpro_list_files">collabpro_list_files (Fetch files)</option>
                  <option value="collabpro_get_file">collabpro_get_file (Fetch specific file)</option>
                  <option value="collabpro_update_document">collabpro_update_document (Modify editor content)</option>
                  <option value="collabpro_update_whiteboard">collabpro_update_whiteboard (Modify drawing board)</option>
                </select>
              </div>

              {/* Arguments JSON Textarea */}
              {selectedMethod !== 'list_tools' && (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider block">Arguments (JSON Payload)</label>
                  <textarea
                    rows={4}
                    value={argumentsJson}
                    onChange={(e) => setArgumentsJson(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-[11px] font-mono text-zinc-300 focus:ring-1 focus:ring-blue-500 outline-none resize-none leading-relaxed"
                  />
                </div>
              )}

              <Button
                onClick={handleExecuteRequest}
                disabled={executingRequest}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold h-10 gap-2 rounded-lg"
              >
                {executingRequest ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Execute JSON-RPC Request
              </Button>

              {/* Monospace Neon Console Log View */}
              <div className="flex-1 flex flex-col space-y-1.5 min-h-[300px]">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider block">Live Terminal logs</label>
                  <button 
                    onClick={() => setConsoleLogs([])}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 font-semibold"
                  >
                    Clear Console
                  </button>
                </div>
                
                <div className="flex-1 bg-black border border-zinc-800 rounded-xl p-4 overflow-y-auto max-h-[350px] font-mono text-[10px] text-green-400 space-y-4 shadow-inner scrollbar-thin">
                  {consoleLogs.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-zinc-600 text-center text-[11px] py-12 select-none">
                      Console idle. Execute requests above to stream live communication sequences.
                    </div>
                  ) : (
                    consoleLogs.map((log, index) => (
                      <div key={index} className="border-b border-zinc-900 pb-3 last:border-0">
                        <div className="flex justify-between items-center text-[9px] text-zinc-500 mb-1">
                          <span className={`font-bold uppercase tracking-wider ${
                            log.type === 'request' ? 'text-indigo-400' : log.type === 'error' ? 'text-red-400' : 'text-emerald-400'
                          }`}>
                            {log.type === 'request' ? '→ Request (JSON-RPC)' : log.type === 'error' ? '⚠ Connection Failure' : `← Response (HTTP ${log.status})`}
                          </span>
                          <span>{log.timestamp}</span>
                        </div>
                        <pre className="whitespace-pre-wrap leading-relaxed max-w-full overflow-x-auto text-green-300">
                          {JSON.stringify(log.payload, null, 2)}
                        </pre>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>

        </div>

      </div>
    </div>
  )
}

export default DevelopersDashboard
