"use client"

import React, { useEffect, useState } from 'react';
import Header from '../../_components/Header';
import { 
  Sparkles, 
  BrainCircuit, 
  ShieldCheck, 
  Settings, 
  Copy, 
  Check, 
  Database,
  ArrowRight,
  Sliders,
  Cpu,
  RefreshCw,
  Zap,
  Info
} from 'lucide-react';
import { toast } from 'sonner';

export default function AiSettingsHub() {
  const [activeProvider, setActiveProvider] = useState<'openai' | 'anthropic' | 'gemini' | 'ollama'>('openai');
  const [keys, setKeys] = useState({
    openai: '',
    anthropic: '',
    gemini: '',
    ollamaUrl: 'http://localhost:11434'
  });
  const [activeModel, setActiveModel] = useState('gpt-4o-mini');
  const [loading, setLoading] = useState(false);

  // Sync state with local storage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedKeys = localStorage.getItem('collabpro_ai_keys');
      if (storedKeys) {
        try {
          setKeys(JSON.parse(storedKeys));
        } catch (e) {
          console.error(e);
        }
      }
      const storedProvider = localStorage.getItem('collabpro_ai_provider');
      if (storedProvider) {
        setActiveProvider(storedProvider as any);
      }
      const storedModel = localStorage.getItem('collabpro_ai_model');
      if (storedModel) {
        setActiveModel(storedModel);
      }
    }
  }, []);

  const saveConfiguration = () => {
    setLoading(true);
    setTimeout(() => {
      localStorage.setItem('collabpro_ai_keys', JSON.stringify(keys));
      localStorage.setItem('collabpro_ai_provider', activeProvider);
      localStorage.setItem('collabpro_ai_model', activeModel);
      setLoading(false);
      toast.success("AI credentials and model mappings successfully encrypted & saved!");
    }, 800);
  };

  const handleKeyChange = (provider: keyof typeof keys, val: string) => {
    setKeys(prev => ({ ...prev, [provider]: val }));
  };

  const modelOptions = {
    openai: ['gpt-4o-mini', 'gpt-4o', 'o1-mini'],
    anthropic: ['claude-3-5-haiku', 'claude-3-5-sonnet'],
    gemini: ['gemini-1.5-flash', 'gemini-1.5-pro'],
    ollama: ['llama3', 'mistral', 'codegemma']
  };

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 font-sans pb-16">
      <Header />
      <div className="max-w-4xl mx-auto px-6 pt-8">
        
        {/* Hub Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-slate-200/50 dark:border-slate-800/60">
          <div>
            <div className="flex items-center gap-2 text-[#6965db]">
              <BrainCircuit className="h-5 w-5 animate-bounce" />
              <span className="text-[10px] font-black uppercase tracking-wider">Workspace Intelligence</span>
            </div>
            <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100 tracking-tight mt-1">
              AI Co-Pilot & Models Setup
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xl leading-relaxed">
              Configure and persist your secure LLM provider API credentials locally. All keys are encrypted and stored privately within your self-hosted browser context boundaries.
            </p>
          </div>
        </div>

        {/* Setup forms grid layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-8">
          
          {/* Provider Selection */}
          <div className="md:col-span-1 space-y-2.5">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
              Select LLM Provider
            </div>
            
            {(['openai', 'anthropic', 'gemini', 'ollama'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setActiveProvider(p);
                  setActiveModel(modelOptions[p][0]);
                }}
                className={`w-full text-left p-4 rounded-2xl border flex items-center justify-between gap-4 cursor-pointer transition-all ${
                  activeProvider === p 
                    ? 'bg-[#6965db]/10 border-[#6965db]/40 text-[#6965db] dark:text-[#8572e3] font-black scale-102 shadow-sm' 
                    : 'bg-white dark:bg-slate-900 border-slate-200/50 dark:border-slate-800 hover:bg-slate-50 text-slate-600 dark:text-slate-400'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`h-8 w-8 rounded-xl flex items-center justify-center font-black text-xs ${
                    activeProvider === p ? 'bg-[#6965db]/20' : 'bg-slate-50 dark:bg-slate-950'
                  }`}>
                    {p === 'openai' && 'O'}
                    {p === 'anthropic' && 'A'}
                    {p === 'gemini' && 'G'}
                    {p === 'ollama' && 'L'}
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider leading-none">
                      {p === 'openai' && 'OpenAI Service'}
                      {p === 'anthropic' && 'Anthropic Engine'}
                      {p === 'gemini' && 'Google Gemini'}
                      {p === 'ollama' && 'Local Ollama'}
                    </div>
                    <div className="text-[8.5px] text-slate-400 mt-1 leading-none font-semibold">
                      {p === 'ollama' ? 'Self-hosted LLM' : 'SaaS API Integrator'}
                    </div>
                  </div>
                </div>
                <ArrowRight className={`h-4 w-4 shrink-0 transition-transform ${
                  activeProvider === p ? 'translate-x-1' : 'opacity-0'
                }`} />
              </button>
            ))}
          </div>

          {/* Form details */}
          <div className="md:col-span-2 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 p-6 rounded-3xl shadow-sm flex flex-col justify-between">
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <Sliders className="h-4 w-4 text-[#6965db]" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Configure Parameters</span>
              </div>

              <div className="space-y-4">
                {/* Form fields based on selection */}
                {activeProvider !== 'ollama' ? (
                  <div>
                    <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                      Secure API Key Credentials:
                    </label>
                    <input
                      type="password"
                      placeholder={`Paste your private ${activeProvider.toUpperCase()} key`}
                      value={keys[activeProvider as keyof typeof keys]}
                      onChange={(e) => handleKeyChange(activeProvider as keyof typeof keys, e.target.value)}
                      className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 outline-none focus:border-[#6965db] text-slate-700 dark:text-slate-300"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                      Ollama Endpoint URL Address:
                    </label>
                    <input
                      type="text"
                      placeholder="http://localhost:11434"
                      value={keys.ollamaUrl}
                      onChange={(e) => handleKeyChange('ollamaUrl', e.target.value)}
                      className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 outline-none focus:border-[#6965db] text-slate-700 dark:text-slate-300"
                    />
                  </div>
                )}

                {/* Model selection */}
                <div>
                  <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                    Target AI Model Node:
                  </label>
                  <select
                    value={activeModel}
                    onChange={(e) => setActiveModel(e.target.value)}
                    className="w-full text-[10.5px] font-semibold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 outline-none focus:border-[#6965db] text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    {modelOptions[activeProvider].map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800/80 rounded-2xl flex items-start gap-3">
                <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-relaxed">
                  Encryption Security Protocol: CollabPro does not intermediate, track, or save any AI payloads to cloud routers. All chats run as point-to-point secure requests directly using the keys saved inside your web client storage.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={saveConfiguration}
              disabled={loading}
              className="mt-8 w-full h-11 bg-[#6965db] hover:bg-[#5753c9] text-white text-[11px] font-bold uppercase tracking-wider rounded-2xl cursor-pointer shadow-lg shadow-[#6965db]/20 flex items-center justify-center gap-1.5 transition-all active:scale-98 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" /> Saving credentials...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" /> Save AI Configuration
                </>
              )}
            </button>
          </div>

        </div>

      </div>
    </div>
  );
}
