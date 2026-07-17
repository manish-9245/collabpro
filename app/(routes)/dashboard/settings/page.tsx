"use client"

import React, { useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Header from '../_components/Header'
import { ActiveTeamContext } from '@/app/_context/ActiveTeamContext'
import { useSessionAuth } from '@/lib/session-auth/client'
import { api, useSync, useQuery, useMutation } from '@/lib/state-sync/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Settings, Users, LogOut, Trash2, Shield, ShieldCheck, Mail, ChevronDown, ChevronUp, Loader2, Key, Copy, Check, Plus, AlertTriangle, Calendar } from 'lucide-react'


function SettingsPage() {
  const router = useRouter();
  const { user }: any = useSessionAuth();
  const { activeTeam, setActiveTeam } = useContext(ActiveTeamContext);
  const sync = useSync();

  const [teams, setTeams] = useState<any[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [teamMembersMap, setTeamMembersMap] = useState<{ [teamId: string]: any[] }>({});
  const [loadingMembers, setLoadingMembers] = useState<{ [teamId: string]: boolean }>({});

  // API Keys state
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [expiresDays, setExpiresDays] = useState('30');
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);

  const leaveTeam = useMutation(api.teams.leaveTeam);
  const removeMember = useMutation(api.teams.removeMember);

  useEffect(() => {
    if (user?.email) {
      fetchTeams();
      fetchApiKeys();
    }
  }, [user?.email]);

  const fetchApiKeys = async () => {
    setLoadingKeys(true);
    try {
      const res = await fetch('/api/api-keys');
      if (res.ok) {
        const json = await res.json();
        setApiKeys(json.apiKeys || []);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load API keys.");
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
        body: JSON.stringify({ name: newKeyName, expiresDays })
      });
      if (res.ok) {
        const json = await res.json();
        setNewlyCreatedKey(json.apiKey);
        setNewKeyName('');
        fetchApiKeys();
        toast.success("API Key successfully generated!");
      } else {
        const errJson = await res.json();
        toast.error(errJson.error || "Failed to create API key.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate API Key.");
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleRevokeApiKey = async (id: string, name: string) => {
    const confirmed = confirm(`Are you sure you want to revoke API key "${name}"? It will immediately stop working.`);
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("API Key copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const fetchTeams = async () => {
    setLoadingTeams(true);
    try {
      const data = await sync.query(api.teams.getTeam, { email: user.email });
      setTeams(data || []);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load teams list.");
    } finally {
      setLoadingTeams(false);
    }
  };

  const fetchMembers = async (teamId: string) => {
    setLoadingMembers(prev => ({ ...prev, [teamId]: true }));
    try {
      const membersList = await sync.query(api.teams.getTeamMembers, { teamId });
      setTeamMembersMap(prev => ({ ...prev, [teamId]: membersList || [] }));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMembers(prev => ({ ...prev, [teamId]: false }));
    }
  };

  const handleToggleExpand = (teamId: string) => {
    if (expandedTeamId === teamId) {
      setExpandedTeamId(null);
    } else {
      setExpandedTeamId(teamId);
      if (!teamMembersMap[teamId]) {
        fetchMembers(teamId);
      }
    }
  };

  const handleLeaveTeam = async (teamId: string, teamName: string) => {
    const confirmed = confirm(`Are you sure you want to leave team "${teamName}"?`);
    if (!confirmed) return;

    try {
      await leaveTeam({ teamId, userEmail: user.email });
      toast.success(`You successfully left "${teamName}"!`);
      
      // If we left our currently active team, reset activeTeam to another team if available
      if (activeTeam?._id === teamId) {
        setActiveTeam(null);
      }
      
      fetchTeams();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to leave the team.");
    }
  };

  const handleRemoveMember = async (teamId: string, memberEmail: string) => {
    const confirmed = confirm(`Are you sure you want to remove ${memberEmail} from this team?`);
    if (!confirmed) return;

    try {
      await removeMember({
        teamId,
        userEmail: memberEmail,
        ownerEmail: user.email
      });
      toast.success(`${memberEmail} has been removed successfully.`);
      fetchMembers(teamId); // Reload members list
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to remove member.");
    }
  };

  return (
    <div className='p-8 min-h-screen bg-slate-50/30 dark:bg-zinc-950/20'>
      <Header />

      {/* Main Settings Header */}
      <div className='mt-8 relative overflow-hidden rounded-2xl border border-slate-100 dark:border-zinc-900 bg-white dark:bg-zinc-950 p-6 sm:p-8 shadow-sm'>
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-56 h-56 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-4 w-44 h-44 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className='relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6'>
          <div className='space-y-2'>
            <div className='inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-xs font-semibold border border-blue-100/50 dark:border-blue-900/30'>
              <Settings className='h-3.5 w-3.5' />
              <span>Workspace Configurations</span>
            </div>
            <h1 className='text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-none'>
              My Organizations & Teams
            </h1>
            <p className='text-sm text-slate-500 dark:text-zinc-400 max-w-xl leading-relaxed'>
              Manage your memberships, review current collaborators, leave external organizations, and manage access to your active workspaces.
            </p>
          </div>

          {activeTeam && activeTeam.createdBy === user?.email && (
            <Button 
              onClick={() => router.push('/dashboard/settings/admin')}
              className="h-10 bg-indigo-600 hover:bg-indigo-700 text-white gap-2 rounded-xl text-xs font-bold shadow-sm transition-all"
            >
              <ShieldCheck className="h-4 w-4" /> Organization Admin Settings
            </Button>
          )}
        </div>
      </div>


      {/* Teams Settings Panel */}
      <div className="mt-8 bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-2xl p-6 sm:p-8 shadow-sm max-w-3xl">
        <h3 className="text-base font-bold text-slate-800 dark:text-white mb-6 flex items-center gap-2">
          <Users className="h-5 w-5 text-blue-600" />
          Active Memberships ({teams.length})
        </h3>

        {loadingTeams ? (
          <div className="flex justify-center items-center py-16 text-slate-400 gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            <span>Loading active memberships...</span>
          </div>
        ) : teams.length === 0 ? (
          <div className="text-center py-16 text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl">
            You are not currently part of any team. Please create a team to start collaborating.
          </div>
        ) : (
          <div className="space-y-4">
            {teams.map((team: any, index: number) => {
              const isOwner = team.createdBy === user?.email;
              const isExpanded = expandedTeamId === team._id;
              const members = teamMembersMap[team._id] || [];
              const isLoadingMem = loadingMembers[team._id] || false;

              return (
                <div 
                  key={index}
                  className="border border-slate-100 dark:border-zinc-900 rounded-xl overflow-hidden shadow-sm"
                >
                  <div className="bg-slate-50/50 dark:bg-zinc-900/20 px-5 py-4 flex justify-between items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold uppercase shadow-inner">
                        {team.teamName.charAt(0)}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-100">{team.teamName}</h4>
                        <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium">Created by {team.createdBy}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {isOwner ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full uppercase tracking-wider dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20">
                          <ShieldCheck className="h-3 w-3" />
                          Owner
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full uppercase tracking-wider dark:text-slate-400 dark:bg-slate-500/10 dark:border-slate-500/20">
                          <Shield className="h-3 w-3" />
                          Member
                        </span>
                      )}

                      {/* Action buttons */}
                      {isOwner ? (
                        <button
                          onClick={() => handleToggleExpand(team._id)}
                          className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-500 dark:bg-zinc-900 dark:border-zinc-800 dark:hover:bg-zinc-800 dark:text-zinc-400 text-xs font-semibold flex items-center gap-1 transition-all"
                        >
                          <span>Manage Members</span>
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleLeaveTeam(team._id, team.teamName)}
                          className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 bg-red-50/50 hover:bg-red-50 hover:text-red-700 font-semibold text-xs flex items-center gap-1.5 transition-all"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          Leave Team
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Collaborators Section */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 dark:border-zinc-900 bg-white dark:bg-zinc-950 p-5 space-y-3">
                      <div className="text-xs font-black text-slate-400 dark:text-zinc-500 uppercase tracking-widest pb-1 border-b border-slate-50 dark:border-zinc-900">
                        Teammates List
                      </div>
                      
                      {isLoadingMem ? (
                        <div className="flex justify-center items-center py-6 text-slate-400 gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                          <span className="text-xs">Fetching members...</span>
                        </div>
                      ) : members.length <= 1 ? (
                        <div className="text-center py-4 text-xs text-slate-400 italic">
                          No other collaborators have joined this team yet. Invite them using 'Invite & Manage' in the header.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                          {members.map((member: any, mIdx: number) => {
                            if (member.role === 'owner') return null; // Skip self owner in member list
                            return (
                              <div 
                                key={mIdx}
                                className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50/60 border border-slate-100 hover:bg-slate-50 dark:bg-zinc-900/10 dark:border-zinc-900 flex-wrap gap-2 transition-all"
                              >
                                <div className="flex items-center gap-2.5">
                                  <div className="h-7 w-7 rounded-full bg-slate-200 dark:bg-zinc-800 flex items-center justify-center text-slate-600 dark:text-zinc-400 text-xs font-bold uppercase">
                                    {member.email.charAt(0)}
                                  </div>
                                  <span className="text-xs text-slate-700 dark:text-zinc-300 font-medium">{member.email}</span>
                                </div>

                                <button
                                  onClick={() => handleRemoveMember(team._id, member.email)}
                                  className="p-1 px-2.5 rounded-md text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 text-xs font-bold flex items-center gap-1 transition-colors"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Remove
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* --- PREMIUM API KEYS & PAT MANAGEMENT SECTION (MCP INTEGRATIONS) --- */}
      <div className="mt-8 bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-2xl p-6 sm:p-8 shadow-sm max-w-3xl space-y-6">
        <div>
          <h3 className="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Key className="h-5 w-5 text-blue-600" />
            Personal Access Tokens (MCP API Keys)
          </h3>
          <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1 max-w-xl">
            Generate secure access keys to integrate CollabPro with Model Context Protocol (MCP) clients, autonomous AI agents (such as Claude Desktop, Gemini Code Assist, or cursor-agents), and programmatic webhooks.
          </p>
        </div>

        {/* Newly Created Key Alert (Only shown once!) */}
        {newlyCreatedKey && (
          <div className="p-5 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 rounded-xl space-y-3 relative overflow-hidden animate-in fade-in slide-in-from-top duration-300">
            <div className="absolute top-0 right-0 -mt-2 -mr-2 w-16 h-16 bg-blue-500/10 rounded-full blur-xl pointer-events-none" />
            <div className="flex gap-2 text-blue-800 dark:text-blue-400">
              <AlertTriangle className="h-5 w-5 text-blue-600 shrink-0" />
              <div>
                <span className="text-xs font-bold block">Important: Copy your Personal Access Token now!</span>
                <span className="text-[11px] opacity-90 block">For security reasons, this token will not be displayed again once you reload or navigate away from this page.</span>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-white dark:bg-zinc-900/50 p-3 rounded-lg border border-blue-200/50 dark:border-blue-900/20 shadow-inner">
              <code className="text-xs font-mono font-bold select-all break-all text-slate-800 dark:text-zinc-200 flex-1">
                {newlyCreatedKey.key}
              </code>
              <button
                type="button"
                onClick={() => copyToClipboard(newlyCreatedKey.key)}
                className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-1 transition-all"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="text-xs font-semibold">{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Premium Dynamic Claude/Cursor Integration Snippet */}
            <div className="mt-4 p-4 bg-slate-900 text-zinc-100 rounded-xl border border-slate-800 space-y-3 font-medium">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-400">Claude Desktop Integration Setup</span>
                <span className="text-[10px] text-zinc-500">Append this config block to your local claude_desktop_config.json</span>
              </div>
              <pre className="text-[10px] font-mono overflow-x-auto p-3 bg-black/40 rounded-lg text-emerald-400 select-all border border-slate-800/60 leading-relaxed">
{JSON.stringify({
  mcpServers: {
    collabpro: {
      command: "npx",
      args: ["-y", "collabpro-mcp"],
      env: {
        COLLABPRO_API_KEY: newlyCreatedKey.key,
        COLLABPRO_BASE_URL: typeof window !== 'undefined' ? window.location.origin : "https://collabpro.buildwithmanish.com"
      }
    }
  }
}, null, 2)}
              </pre>
              <p className="text-[9px] text-zinc-400 leading-normal">
                💡 **Pro Tip**: Use this configuration to empower Claude Desktop with the native ability to read, sync, edit, and orchestrate CollabPro team-shared documents and Excalidraw whiteboards programmatically!
              </p>
            </div>
            
            <button
              type="button"
              onClick={() => setNewlyCreatedKey(null)}
              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-bold"
            >
              Done, I have saved it securely
            </button>
          </div>
        )}

        {/* Create Key Form */}
        <form onSubmit={handleCreateApiKey} className="p-4 bg-slate-50/50 dark:bg-zinc-900/20 rounded-xl border border-slate-100 dark:border-zinc-900 grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div className="sm:col-span-1 space-y-1.5">
            <label className="text-xs font-bold text-slate-500 dark:text-zinc-400 block">Token Description</label>
            <input
              type="text"
              placeholder="e.g. Gemini Code Assist, Claude Desktop"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 dark:text-zinc-400 block">Expiration</label>
            <select
              value={expiresDays}
              onChange={(e) => setExpiresDays(e.target.value)}
              className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
            >
              <option value="7">7 Days</option>
              <option value="30">30 Days</option>
              <option value="90">90 Days</option>
              <option value="never">No Expiration (Never)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={generatingKey || !newKeyName.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white text-xs font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-all"
          >
            {generatingKey ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span>Generate Token</span>
          </button>
        </form>

        {/* Existing Keys Table */}
        <div className="space-y-3">
          <h4 className="text-xs font-black text-slate-400 dark:text-zinc-500 uppercase tracking-widest pb-1 border-b border-slate-50 dark:border-zinc-900">
            Active Tokens ({apiKeys.length})
          </h4>

          {loadingKeys ? (
            <div className="flex justify-center items-center py-10 text-slate-400 gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-xs">Loading personal tokens...</span>
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-400 border border-dashed border-slate-100 rounded-xl bg-white dark:bg-zinc-950">
              No personal access tokens generated yet. Add one to integrate with MCP AI agents.
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {apiKeys.map((key: any, idx: number) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg bg-white border border-slate-100 hover:bg-slate-50/50 dark:bg-zinc-900/10 dark:border-zinc-900 flex-wrap gap-3 transition-all"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-700 dark:text-zinc-300">{key.name}</span>
                      <code className="text-[10px] font-mono font-medium text-slate-400 dark:text-zinc-500 px-1.5 py-0.5 bg-slate-50 dark:bg-zinc-900 rounded border border-slate-100 dark:border-zinc-800">
                        {key.key}
                      </code>
                    </div>

                    <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-zinc-500 font-semibold">
                      <span className="flex items-center gap-0.5">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" />
                        Created: {new Date(key.createdAt).toLocaleDateString()}
                      </span>
                      <span>•</span>
                      <span>
                        Expires: {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : 'Never'}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleRevokeApiKey(key.id, key.name)}
                    className="p-1 px-2.5 rounded-md text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 text-xs font-bold flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
