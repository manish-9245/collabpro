"use client"

import React, { useContext, useEffect, useState } from 'react';
import { ActiveTeamContext } from '@/app/_context/ActiveTeamContext';
import { useSessionAuth } from '@/lib/session-auth/client';
import { api, useSync, useMutation } from '@/lib/state-sync/react';
import {
  BrainCircuit,
  ShieldCheck,
  Sliders,
  RefreshCw,
  Zap,
  Trash2,
  Lock,
  ExternalLink,
  ListChecks,
  AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';
import { AI_PROVIDER_PRESETS, AiProviderId } from '@/lib/ai-providers';

const PROVIDER_ORDER: AiProviderId[] = ['openai', 'anthropic', 'gemini', 'nvidia_nim', 'custom'];

export default function AiSettingsHub() {
  const { user }: any = useSessionAuth();
  const { activeTeam } = useContext(ActiveTeamContext);
  const sync = useSync();

  const saveSettings = useMutation(api.ai.saveSettings);
  const deleteSettings = useMutation(api.ai.deleteSettings);

  const isOwner = activeTeam?.createdBy === user?.email;

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<any>(null);
  const [provider, setProvider] = useState<AiProviderId>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);

  const preset = AI_PROVIDER_PRESETS[provider];

  useEffect(() => {
    if (activeTeam?._id) {
      loadSettings();
    } else {
      setLoading(false);
    }
  }, [activeTeam]);

  const loadSettings = async () => {
    if (!activeTeam?._id) return;
    setLoading(true);
    try {
      const data = await sync.query(api.ai.getSettings, { teamId: activeTeam._id });
      setSettings(data);
      const loadedProvider: AiProviderId = data?.provider && data.provider in AI_PROVIDER_PRESETS ? data.provider : 'openai';
      setProvider(loadedProvider);
      setBaseUrl(data?.baseUrl || AI_PROVIDER_PRESETS[loadedProvider].defaultBaseUrl);
      setModel(data?.model || '');
      setApiKey('');
      setAvailableModels(null);
      setModelFetchError(null);
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to load AI settings.');
    } finally {
      setLoading(false);
    }
  };

  const handleProviderChange = (next: AiProviderId) => {
    setProvider(next);
    setBaseUrl(AI_PROVIDER_PRESETS[next].defaultBaseUrl);
    setModel('');
    setAvailableModels(null);
    setModelFetchError(null);
  };

  const handleFetchModels = async () => {
    if (!activeTeam?._id) return;
    setFetchingModels(true);
    setModelFetchError(null);
    try {
      const res = await fetch('/api/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: activeTeam._id, provider, baseUrl, apiKey: apiKey || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Failed to fetch models');
      setAvailableModels(json.models || []);
      if (json.models?.length && !json.models.includes(model)) {
        setModel(json.models[0]);
      }
    } catch (err: any) {
      setModelFetchError(err.message || 'Failed to fetch models');
      toast.error(err.message || 'Failed to fetch models');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam?._id || !isOwner) return;

    setSaving(true);
    try {
      await saveSettings({
        teamId: activeTeam._id,
        provider,
        baseUrl,
        model,
        apiKey: apiKey || undefined, // blank means "keep the existing key"
      });
      toast.success('AI configuration saved.');
      setApiKey('');
      loadSettings();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to save AI configuration.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!activeTeam?._id || !isOwner) return;
    try {
      await deleteSettings({ teamId: activeTeam._id });
      toast.success('AI provider removed.');
      setSettings(null);
      setModel('');
      setApiKey('');
      setAvailableModels(null);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to remove AI configuration.');
    }
  };

  return (
    <div className="max-w-4xl">
      {/* Hub Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-slate-200/50 dark:border-slate-800/60">
          <div>
            <div className="flex items-center gap-2 text-[#6965db]">
              <BrainCircuit className="h-5 w-5" />
              <span className="text-[10px] font-black uppercase tracking-wider">Workspace Intelligence</span>
            </div>
            <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100 tracking-tight mt-1">
              AI Co-Pilot Setup
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xl leading-relaxed">
              Configure your team's AI provider for {activeTeam?.teamName || 'this team'}. The key is encrypted at rest and used server-side, once per chat message - it is never sent to or stored in any browser.
            </p>
          </div>
        </div>

        {!activeTeam?._id ? (
          <div className="mt-8 p-6 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 rounded-2xl text-center text-xs text-slate-400">
            Select a team to configure its AI provider.
          </div>
        ) : loading ? (
          <div className="mt-8 flex items-center justify-center py-16 text-slate-400">
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-8">
            <div className="md:col-span-3 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 p-6 rounded-3xl shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <Sliders className="h-4 w-4 text-[#6965db]" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">Configure Provider</span>
                </div>
                {!isOwner && (
                  <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    <Lock className="h-3 w-3" /> Read-only (owner only)
                  </div>
                )}
              </div>

              <form onSubmit={handleSave} className="space-y-4 mt-6">
                {/* Provider picker */}
                <div>
                  <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                    Provider
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {PROVIDER_ORDER.map((id) => {
                      const isActive = provider === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          disabled={!isOwner}
                          onClick={() => handleProviderChange(id)}
                          className={`px-2.5 py-2 rounded-xl border text-[10.5px] font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                            isActive
                              ? 'border-[#6965db] bg-[#6965db]/5 text-[#6965db] shadow-sm'
                              : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          {AI_PROVIDER_PRESETS[id].label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 leading-relaxed">
                    {preset.setupNote}
                    {preset.keyManagementUrl && (
                      <>
                        {' '}
                        <a
                          href={preset.keyManagementUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#6965db] font-semibold hover:underline inline-flex items-center gap-0.5"
                        >
                          Get an API key <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </>
                    )}
                  </p>
                </div>

                <div>
                  <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                    Base URL
                  </label>
                  <input
                    type="text"
                    placeholder="https://api.openai.com/v1"
                    value={baseUrl}
                    disabled={!isOwner || provider !== 'custom'}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 outline-none focus:border-[#6965db] text-slate-700 dark:text-slate-300 disabled:opacity-60"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                    API Key {settings?.maskedKey && <span className="normal-case font-mono text-slate-400">(current: {settings.maskedKey})</span>}
                  </label>
                  <input
                    type="password"
                    placeholder={settings?.maskedKey ? 'Leave blank to keep the current key' : 'Paste your provider API key'}
                    value={apiKey}
                    disabled={!isOwner}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 outline-none focus:border-[#6965db] text-slate-700 dark:text-slate-300 disabled:opacity-60"
                  />
                </div>

                {/* Model - dynamically fetched dropdown, falling back to free text */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider">
                      Model
                    </label>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={handleFetchModels}
                        disabled={fetchingModels || (!apiKey && !settings?.maskedKey)}
                        className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[#6965db] hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                        title={!apiKey && !settings?.maskedKey ? 'Enter an API key first' : 'Fetch the live model list from this provider'}
                      >
                        {fetchingModels ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ListChecks className="h-3 w-3" />}
                        Fetch available models
                      </button>
                    )}
                  </div>

                  {availableModels && availableModels.length > 0 ? (
                    <select
                      value={model}
                      disabled={!isOwner}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full text-[10.5px] font-semibold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 outline-none focus:border-[#6965db] text-slate-700 dark:text-slate-300 disabled:opacity-60"
                    >
                      {!availableModels.includes(model) && model && <option value={model}>{model}</option>}
                      {availableModels.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder={provider === 'openai' ? 'gpt-4o-mini' : provider === 'anthropic' ? 'claude-sonnet-4-5' : 'model-id'}
                      value={model}
                      disabled={!isOwner}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full text-[10.5px] font-semibold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 outline-none focus:border-[#6965db] text-slate-700 dark:text-slate-300 disabled:opacity-60"
                      required
                    />
                  )}
                  {modelFetchError && (
                    <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" /> {modelFetchError} - you can still type a model ID above.
                    </p>
                  )}
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800/80 rounded-2xl flex items-start gap-3">
                  <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-relaxed">
                    The key is encrypted at rest (AES-256-GCM) and only ever decrypted server-side to call your provider. It is never re-displayed after saving - only a masked preview is shown.
                  </p>
                </div>

                {isOwner && (
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex-1 h-11 bg-[#6965db] hover:bg-[#5753c9] text-white text-[11px] font-bold uppercase tracking-wider rounded-2xl cursor-pointer shadow-lg shadow-[#6965db]/20 flex items-center justify-center gap-1.5 transition-all active:scale-98 disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" /> Saving...
                        </>
                      ) : (
                        <>
                          <Zap className="h-4 w-4" /> Save AI Configuration
                        </>
                      )}
                    </button>
                    {settings && (
                      <button
                        type="button"
                        onClick={handleDelete}
                        className="h-11 px-4 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/50 text-rose-600 text-[11px] font-bold uppercase tracking-wider rounded-2xl cursor-pointer flex items-center justify-center gap-1.5 transition-all active:scale-98"
                      >
                        <Trash2 className="h-4 w-4" /> Remove
                      </button>
                    )}
                  </div>
                )}
              </form>
            </div>
          </div>
        )}

    </div>
  );
}
