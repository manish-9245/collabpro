"use client"

import React, { useContext, useEffect, useState } from 'react';
import Header from '../../_components/Header';
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
  Lock
} from 'lucide-react';
import { toast } from 'sonner';

export default function AiSettingsHub() {
  const { user }: any = useSessionAuth();
  const { activeTeam } = useContext(ActiveTeamContext);
  const sync = useSync();

  const saveSettings = useMutation(api.ai.saveSettings);
  const deleteSettings = useMutation(api.ai.deleteSettings);

  const isOwner = activeTeam?.createdBy === user?.email;

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<any>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

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
      setBaseUrl(data?.baseUrl || '');
      setModel(data?.model || '');
      setApiKey('');
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to load AI settings.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam?._id || !isOwner) return;

    setSaving(true);
    try {
      await saveSettings({
        teamId: activeTeam._id,
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
      setBaseUrl('');
      setModel('');
      setApiKey('');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to remove AI configuration.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 font-sans pb-16">
      <Header />
      <div className="max-w-4xl mx-auto px-6 pt-8">

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
              Configure your team's AI provider for {activeTeam?.teamName || 'this team'}. Any OpenAI-compatible endpoint works (OpenAI, Azure OpenAI, Groq, OpenRouter, local Ollama, etc). The key is encrypted at rest and used server-side, once per chat message - it is never sent to or stored in any browser.
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
                <div>
                  <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                    Base URL
                  </label>
                  <input
                    type="text"
                    placeholder="https://api.openai.com/v1"
                    value={baseUrl}
                    disabled={!isOwner}
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

                <div>
                  <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                    Model
                  </label>
                  <input
                    type="text"
                    placeholder="gpt-4o-mini"
                    value={model}
                    disabled={!isOwner}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full text-[10.5px] font-semibold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 outline-none focus:border-[#6965db] text-slate-700 dark:text-slate-300 disabled:opacity-60"
                    required
                  />
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
    </div>
  );
}
