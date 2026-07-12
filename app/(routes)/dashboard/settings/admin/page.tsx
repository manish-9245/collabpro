"use client"

import React, { useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Header from '../../_components/Header'
import { ActiveTeamContext } from '@/app/_context/ActiveTeamContext'
import { useSessionAuth } from '@/lib/session-auth/client'
import { api, useSync, useMutation } from '@/lib/state-sync/react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { 
  Settings, Users, Shield, ShieldCheck, Mail, Loader2, Key, Check, Plus, 
  AlertTriangle, ArrowLeft, Globe, Lock, Info, Server, Sparkles, UserPlus, 
  Trash2, UserCheck, Download, Search, Filter, Clock, ShieldAlert
} from 'lucide-react'

export default function AdminSettingsPage() {
  const router = useRouter();
  const { user }: any = useSessionAuth();
  const { activeTeam } = useContext(ActiveTeamContext);
  const sync = useSync();

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<any>(null);
  const [seatCount, setSeatCount] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<'policy' | 'audit'>('policy');

  // Compliance Audit Logs states
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  // Form states
  const [allowedDomains, setAllowedDomains] = useState('');
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoProvider, setSsoProvider] = useState('saml');
  const [ssoMetadataUrl, setSsoMetadataUrl] = useState('');
  const [seatLimit, setSeatLimit] = useState(50);
  const [savingSettings, setSavingSettings] = useState(false);

  // Invite states
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  const inviteMember = useMutation(api.teams.inviteMember);
  const removeMember = useMutation(api.teams.removeMember);
  const updateSettings = useMutation(api.orgSettings.updateSettings);

  const isOwner = activeTeam?.createdBy === user?.email;

  useEffect(() => {
    if (user?.email && activeTeam?._id) {
      loadAdminData();
    } else if (user?.email && !activeTeam?._id) {
      setLoading(false);
    }
  }, [user, activeTeam]);

  const loadAdminData = async () => {
    if (!activeTeam?._id) return;
    setLoading(true);
    try {
      // 1. Load settings
      const settingsData = await sync.query(api.orgSettings.getSettings, { teamId: activeTeam._id });
      setSettings(settingsData);
      setAllowedDomains(settingsData?.allowedDomains || '');
      setSsoEnabled(settingsData?.ssoEnabled || false);
      setSsoProvider(settingsData?.ssoProvider || 'saml');
      setSsoMetadataUrl(settingsData?.ssoMetadataUrl || '');
      setSeatLimit(settingsData?.seatLimit || 50);

      // 2. Load seat count
      const seats = await sync.query(api.orgSettings.getSeatCount, { teamId: activeTeam._id });
      setSeatCount(seats);

      // 3. Load active members
      setLoadingMembers(true);
      const membersList = await sync.query(api.teams.getTeamMembers, { teamId: activeTeam._id });
      setMembers(membersList || []);

      // 4. Load compliance audit logs
      try {
        const logs = await sync.query(api.securityAudit.getLogs, { teamId: activeTeam._id });
        setAuditLogs(logs || []);
      } catch (logErr) {
        console.error("Failed to load audit logs:", logErr);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load organization settings.");
    } finally {
      setLoading(false);
      setLoadingMembers(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam?._id) return;

    setSavingSettings(true);
    try {
      await updateSettings({
        teamId: activeTeam._id,
        allowedDomains,
        ssoEnabled,
        ssoProvider,
        ssoMetadataUrl,
        seatLimit,
      });
      toast.success("Organization policies saved successfully!");
      // Reload seat count & settings
      loadAdminData();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to update organization policies.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam?._id || !inviteEmail.trim()) return;

    setInviting(true);
    try {
      await inviteMember({
        teamId: activeTeam._id,
        userEmail: inviteEmail.trim().toLowerCase(),
      });
      toast.success(`Invitation successfully sent to ${inviteEmail}!`);
      setInviteEmail('');
      loadAdminData();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to invite member.");
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (memberEmail: string) => {
    if (!activeTeam?._id) return;
    if (memberEmail === activeTeam.createdBy) {
      toast.error("The organization creator/owner cannot be removed.");
      return;
    }

    try {
      await removeMember({
        teamId: activeTeam._id,
        userEmail: memberEmail,
        ownerEmail: user.email
      });
      toast.success(`${memberEmail} has been successfully removed.`);
      loadAdminData();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to remove member.");
    }
  };

  const handleExportCSV = () => {
    if (auditLogs.length === 0) {
      toast.info("No audit logs available to export.");
      return;
    }

    const headers = ['Timestamp', 'Actor Email', 'IP Address', 'Action', 'Context Details'];
    const rows = auditLogs.map(log => [
      new Date(log.createdAt).toISOString(),
      log.userEmail,
      log.ipAddress || '127.0.0.1',
      log.action,
      log.context.replace(/"/g, '""')
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(val => `"${val}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `collabpro-audit-logs-${activeTeam?.teamName || 'team'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Audit logs exported to CSV successfully!");
  };

  // Compute Seat gauge percentage
  const activeSeats = seatCount?.activeSeats || 1;
  const limit = seatCount?.seatLimit || 50;
  const seatPercent = Math.min(100, Math.round((activeSeats / limit) * 100));

  // Filter audit logs based on user search and dropdown selection
  const filteredLogs = auditLogs.filter(log => {
    const matchesSearch = log.userEmail.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          log.context.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesAction = actionFilter === '' || log.action === actionFilter;
    return matchesSearch && matchesAction;
  });

  if (!activeTeam) {
    return (
      <div className="p-8 min-h-screen bg-slate-50/30 dark:bg-zinc-950/20">
        <Header />
        <div className="mt-12 text-center py-20 bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-2xl shadow-sm">
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-slate-800 dark:text-zinc-100">No Active Organization Selected</h2>
          <p className="text-sm text-slate-400 mt-2 max-w-sm mx-auto">
            Please select or create an active organization/team from the sidebar before accessing admin controls.
          </p>
        </div>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="p-8 min-h-screen bg-slate-50/30 dark:bg-zinc-950/20">
        <Header />
        <div className="mt-12 text-center py-20 bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-2xl shadow-sm">
          <Shield className="h-10 w-10 text-rose-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-slate-800 dark:text-zinc-100">Access Denied</h2>
          <p className="text-sm text-slate-400 mt-2 max-w-sm mx-auto">
            Administrative controls are restricted to the organization owner ({activeTeam.createdBy}).
          </p>
          <Button onClick={() => router.push('/dashboard/settings')} className="mt-6 gap-2" variant="outline">
            <ArrowLeft className="h-4 w-4" /> Back to My Organizations
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='p-8 min-h-screen bg-slate-50/30 dark:bg-zinc-950/20'>
      <Header />

      {/* Back button and title */}
      <div className="mt-8 flex items-center gap-3">
        <Button 
          onClick={() => router.push('/dashboard/settings')}
          variant="ghost" 
          className="p-2 h-9 w-9 rounded-lg border border-slate-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-slate-100 dark:hover:bg-zinc-900 shadow-sm"
        >
          <ArrowLeft className="h-4 w-4 text-slate-600 dark:text-zinc-300" />
        </Button>
        <span className="text-xs font-semibold text-slate-400 dark:text-zinc-500">Settings / Admin Control Center</span>
      </div>

      {/* Organization Header */}
      <div className='mt-4 relative overflow-hidden rounded-2xl border border-slate-100 dark:border-zinc-900 bg-white dark:bg-zinc-950 p-6 sm:p-8 shadow-sm'>
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-56 h-56 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-4 w-44 h-44 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className='relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6'>
          <div className='space-y-2'>
            <div className='inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 text-xs font-semibold border border-indigo-100/50 dark:border-indigo-900/30'>
              <ShieldCheck className='h-3.5 w-3.5' />
              <span>Admin configurations for {activeTeam.teamName}</span>
            </div>
            <h1 className='text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-none'>
              Organization Control Center
            </h1>
            <p className='text-sm text-slate-500 dark:text-zinc-400 max-w-xl leading-relaxed'>
              Configure allowed domain rules, active seat restrictions, SAML single sign-on, and audit compliance logging records.
            </p>
          </div>
        </div>
      </div>

      {/* Interactive Tabs */}
      <div className="mt-8 flex gap-2 border-b border-slate-100 dark:border-zinc-900 pb-px">
        <Button
          onClick={() => setActiveTab('policy')}
          variant="ghost"
          className={`h-10 px-6 rounded-t-xl rounded-b-none text-xs font-bold gap-2 transition-all border-b-2 -mb-px ${
            activeTab === 'policy' 
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/20 dark:bg-indigo-950/20' 
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-zinc-300'
          }`}
        >
          <Globe className="h-4 w-4" /> Access & Identity Policies
        </Button>
        <Button
          onClick={() => setActiveTab('audit')}
          variant="ghost"
          className={`h-10 px-6 rounded-t-xl rounded-b-none text-xs font-bold gap-2 transition-all border-b-2 -mb-px ${
            activeTab === 'audit' 
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/20 dark:bg-indigo-950/20' 
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-zinc-300'
          }`}
        >
          <Server className="h-4 w-4" /> Compliance Audit Logs
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col justify-center items-center py-32 text-slate-400 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          <span className="text-sm font-medium">Loading organization configurations...</span>
        </div>
      ) : activeTab === 'policy' ? (
        /* TAB 1: Access & Identity Policies (Two Column Grid) */
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* LEFT COL: Settings Form & SSO */}
          <div className="lg:col-span-2 space-y-8">
            <form onSubmit={handleSaveSettings} className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
              <h3 className="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2 border-b border-slate-50 dark:border-zinc-900 pb-4">
                <Globe className="h-5 w-5 text-indigo-600" />
                Access & Identity Policies
              </h3>

              {/* Allowed Domains */}
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-zinc-300 flex items-center gap-2">
                  Allowed Signup Domains
                  <span className="px-2 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-zinc-900 text-slate-500">Security Rule</span>
                </label>
                <input 
                  type="text"
                  placeholder="e.g. enterprise.com, google.com (Leave empty to allow all)"
                  value={allowedDomains}
                  onChange={(e) => setAllowedDomains(e.target.value)}
                  className="w-full h-10 px-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:text-zinc-100"
                />
                <p className="text-xs text-slate-400 dark:text-zinc-500">
                  Comma-separated list of domains. Signups and invitations mismatching these rules will be rejected.
                </p>
              </div>

              {/* SSO Toggle */}
              <div className="space-y-4 pt-4 border-t border-slate-50 dark:border-zinc-900">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
                      <Lock className="h-4 w-4 text-emerald-500" />
                      Single Sign-On (SSO) Integration
                    </h4>
                    <p className="text-xs text-slate-400">Delegate workspace authentication to an external enterprise provider.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={ssoEnabled} 
                      onChange={(e) => setSsoEnabled(e.target.checked)}
                      className="sr-only peer" 
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-zinc-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:after:bg-zinc-950 dark:peer-checked:bg-indigo-600 peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                {ssoEnabled && (
                  <div className="p-5 rounded-xl border border-slate-100 dark:border-zinc-900 bg-slate-50/50 dark:bg-zinc-900/10 space-y-4 animate-fadeIn">
                    
                    {/* SSO Provider Selector */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-600 dark:text-zinc-400">SSO Provider Protocol</label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700 dark:text-zinc-300">
                          <input 
                            type="radio" 
                            name="ssoProvider" 
                            value="saml"
                            checked={ssoProvider === 'saml'}
                            onChange={() => setSsoProvider('saml')}
                            className="text-indigo-600 focus:ring-indigo-500"
                          />
                          SAML 2.0
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700 dark:text-zinc-300">
                          <input 
                            type="radio" 
                            name="ssoProvider" 
                            value="oidc"
                            checked={ssoProvider === 'oidc'}
                            onChange={() => setSsoProvider('oidc')}
                            className="text-indigo-600 focus:ring-indigo-500"
                          />
                          OIDC (OpenID Connect)
                        </label>
                      </div>
                    </div>

                    {/* Metadata URL */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-600 dark:text-zinc-400 flex items-center gap-1">
                        <Server className="h-3.5 w-3.5 text-slate-400" />
                        Identity Provider Metadata URL
                      </label>
                      <input 
                        type="url"
                        placeholder="https://identity-provider.com/saml/metadata"
                        value={ssoMetadataUrl}
                        onChange={(e) => setSsoMetadataUrl(e.target.value)}
                        required={ssoEnabled}
                        className="w-full h-10 px-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:text-zinc-100"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Submit triggers */}
              <div className="pt-4 border-t border-slate-50 dark:border-zinc-900 flex justify-end">
                <Button 
                  type="submit" 
                  disabled={savingSettings}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold h-10 px-6 rounded-xl text-xs uppercase tracking-wide gap-2 transition-all shadow hover:shadow-indigo-500/15"
                >
                  {savingSettings && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save Policy Configs
                </Button>
              </div>
            </form>

            {/* Teammates List Panel */}
            <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-2xl p-6 sm:p-8 shadow-sm">
              <h3 className="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2 border-b border-slate-50 dark:border-zinc-900 pb-4 mb-6">
                <Users className="h-5 w-5 text-indigo-600" />
                Active Teammates ({members.length})
              </h3>

              <div className="space-y-4">
                {/* Active Owner Row */}
                <div className="flex items-center justify-between p-4 border border-indigo-100/50 dark:border-indigo-950 bg-indigo-50/10 dark:bg-indigo-950/10 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shadow-sm">
                      {activeTeam.createdBy.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-indigo-950 dark:text-indigo-400">{activeTeam.createdBy}</h4>
                      <span className="inline-flex items-center gap-1 text-[10px] bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 font-extrabold px-2.5 py-0.5 rounded-full mt-0.5 border border-indigo-200/30">
                        <Shield className="h-3 w-3" /> Creator & Owner
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400 font-semibold italic">Unremovable</span>
                </div>

                {/* Other members list */}
                <div className="space-y-3.5 max-h-[350px] overflow-y-auto pr-1">
                  {loadingMembers ? (
                    <div className="flex justify-center items-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
                    </div>
                  ) : members.filter(m => m.email !== activeTeam.createdBy).length === 0 ? (
                    <div className="text-center py-12 text-slate-400 border border-dashed border-slate-100 dark:border-zinc-900 rounded-xl">
                      <Users className="h-8 w-8 text-slate-200 dark:text-zinc-800 mx-auto mb-2" />
                      <p className="text-xs font-medium">No additional teammates added yet.</p>
                    </div>
                  ) : (
                    members.filter(m => m.email !== activeTeam.createdBy).map((member: any) => (
                      <div key={member.userEmail} className="flex items-center justify-between p-4 border border-slate-50 dark:border-zinc-900 bg-white dark:bg-zinc-950 hover:bg-slate-50/30 dark:hover:bg-zinc-900/10 rounded-xl transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 flex items-center justify-center text-xs font-bold font-mono">
                            {member.userEmail.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-100">{member.userEmail}</h4>
                            <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 dark:bg-zinc-900 text-slate-500 font-semibold px-2 py-0.5 rounded-full mt-0.5">
                              <UserCheck className="h-3 w-3" /> Member
                            </span>
                          </div>
                        </div>
                        <Button 
                          onClick={() => handleRemoveMember(member.userEmail)}
                          variant="ghost" 
                          className="h-8 w-8 p-0 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT COL: Seat gauge & Invite Panel */}
          <div className="space-y-8">
            
            {/* Seat Capacity Gauge card */}
            <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-2xl p-6 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 -mt-2 -mr-2 w-32 h-32 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
              
              <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2 mb-6">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                Active Subscription Limit
              </h3>

              <div className="space-y-4">
                {/* Visual Premium Gauge */}
                <div className="relative pt-1">
                  <div className="flex mb-2 items-center justify-between">
                    <div>
                      <span className="text-xs font-bold inline-block py-1 px-2.5 uppercase rounded-full text-indigo-600 bg-indigo-50 dark:bg-indigo-950 dark:text-indigo-400">
                        {activeSeats} / {limit} Seats Filled
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-extrabold text-indigo-600 dark:text-indigo-400">
                        {seatPercent}%
                      </span>
                    </div>
                  </div>
                  
                  {/* Gauge Bar */}
                  <div className="overflow-hidden h-3 text-xs flex rounded-full bg-slate-100 dark:bg-zinc-900">
                    <div 
                      style={{ width: `${seatPercent}%` }} 
                      className={`shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center transition-all duration-500 ${
                        seatPercent >= 90 ? 'bg-gradient-to-r from-rose-500 to-red-600' : 'bg-gradient-to-r from-indigo-500 to-purple-600'
                      }`}
                    />
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-slate-50 dark:border-zinc-900 bg-slate-50/30 dark:bg-zinc-900/10 space-y-2">
                  <div className="flex items-start gap-2.5 text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
                    <Info className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      Your current organization package provides a maximum capacity of <span className="font-bold text-slate-700 dark:text-zinc-200">{limit} seats</span>. 
                      Need more concurrent seats for your large scale enterprise rollout? Contact sales to upgrade your license metrics instantly.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Invitation Panel */}
            <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-2xl p-6 shadow-sm">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2 mb-4">
                <UserPlus className="h-4 w-4 text-indigo-500" />
                Invite New Collaborator
              </h3>

              <form onSubmit={handleInviteMember} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 dark:text-zinc-400">Email Address</label>
                  <input 
                    type="email"
                    placeholder="e.g. colleague@enterprise.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    className="w-full h-10 px-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:text-zinc-100"
                  />
                </div>

                <Button 
                  type="submit" 
                  disabled={inviting}
                  className="w-full h-10 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl gap-2 font-semibold text-xs tracking-wide uppercase transition-all shadow hover:shadow-indigo-500/10 active:scale-[0.98]"
                >
                  {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  Send Pending Invite
                </Button>
              </form>
            </div>

          </div>

        </div>
      ) : (
        /* TAB 2: Compliance Audit Logs (One-Column Rich List View) */
        <div className="mt-8 space-y-6">
          <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
            
            {/* Tab header and actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-50 dark:border-zinc-900 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <Server className="h-5 w-5 text-indigo-600" />
                  Compliance Audit Logs Tracking
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Immutable tracking of administrative settings updates, file deletions, and collaborative invitations.
                </p>
              </div>

              <Button 
                onClick={handleExportCSV}
                className="h-9 px-4 rounded-xl border border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-900 text-slate-700 dark:text-zinc-300 gap-1.5 text-xs font-bold shadow-sm transition-all"
                variant="outline"
              >
                <Download className="h-4 w-4" /> Export logs to CSV
              </Button>
            </div>

            {/* Filter controls */}
            <div className="flex flex-col sm:flex-row gap-4">
              
              {/* Search text box */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <input 
                  type="text"
                  placeholder="Search logs by actor email, context details, or event..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 pl-9 pr-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:text-zinc-100"
                />
              </div>

              {/* Action dropdown selector */}
              <div className="relative w-full sm:w-60">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="w-full h-10 pl-9 pr-8 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:text-zinc-100 appearance-none cursor-pointer"
                >
                  <option value="">All Security Events</option>
                  <option value="file:delete">File Deletion (file:delete)</option>
                  <option value="member:invite">Teammate Invite (member:invite)</option>
                  <option value="member:remove">Teammate Removal (member:remove)</option>
                  <option value="settings:update">SSO & Policies Update (settings:update)</option>
                </select>
              </div>

            </div>

            {/* Log Table view */}
            <div className="overflow-x-auto border border-slate-100 dark:border-zinc-900 rounded-xl">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-zinc-900/50 text-slate-500 dark:text-zinc-400 font-extrabold border-b border-slate-100 dark:border-zinc-900">
                    <th className="p-4 text-xs tracking-wider uppercase font-bold w-48">Timestamp</th>
                    <th className="p-4 text-xs tracking-wider uppercase font-bold w-64">Actor Email</th>
                    <th className="p-4 text-xs tracking-wider uppercase font-bold w-36">IP Address</th>
                    <th className="p-4 text-xs tracking-wider uppercase font-bold w-44">Security Event</th>
                    <th className="p-4 text-xs tracking-wider uppercase font-bold">Metadata Context</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-zinc-900">
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-12 text-center text-slate-400">
                        <ShieldAlert className="h-8 w-8 text-slate-200 dark:text-zinc-800 mx-auto mb-2" />
                        <p className="text-xs font-semibold">No matching compliance audit events found.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/20 dark:hover:bg-zinc-900/10 transition-colors">
                        <td className="p-4 font-mono text-xs text-slate-400 flex items-center gap-1.5 whitespace-nowrap">
                          <Clock className="h-3.5 w-3.5" />
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="p-4 font-bold text-slate-700 dark:text-zinc-300 max-w-[240px] truncate">
                          {log.userEmail}
                        </td>
                        <td className="p-4 font-mono text-xs text-slate-500">
                          {log.ipAddress || '127.0.0.1'}
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${
                            log.action === 'file:delete' 
                              ? 'bg-rose-50 border-rose-200 text-rose-600 dark:bg-rose-950/20 dark:border-rose-900/40 dark:text-rose-400' 
                              : log.action === 'member:remove' 
                              ? 'bg-amber-50 border-amber-200 text-amber-600 dark:bg-amber-950/20 dark:border-amber-900/40 dark:text-amber-400' 
                              : log.action === 'member:invite' 
                              ? 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-950/20 dark:border-blue-900/40 dark:text-blue-400' 
                              : 'bg-emerald-50 border-emerald-200 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-900/40 dark:text-emerald-400'
                          }`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="p-4 text-xs font-mono text-slate-500 dark:text-zinc-400 max-w-sm truncate">
                          {log.context}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
