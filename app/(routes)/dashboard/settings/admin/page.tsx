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
  Trash2, UserCheck
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
      loadAdminData(); // Refresh seat counts & active members list
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to send invitation.");
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (memberEmail: string) => {
    if (!activeTeam?._id) return;
    const confirmed = confirm(`Are you sure you want to remove ${memberEmail} from this organization?`);
    if (!confirmed) return;

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

  // Compute Seat gauge percentage
  const activeSeats = seatCount?.activeSeats || 1;
  const limit = seatCount?.seatLimit || 50;
  const seatPercent = Math.min(100, Math.round((activeSeats / limit) * 100));

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
              Configure allowed domain rules, active seat restrictions, and SAML single sign-on mechanisms for your enterprise workspace.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col justify-center items-center py-32 text-slate-400 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          <span className="text-sm font-medium">Loading organization configurations...</span>
        </div>
      ) : (
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

              {/* Seat Capacity Monitor Trigger */}
              <div className="space-y-2 pt-4 border-t border-slate-50 dark:border-zinc-900">
                <label className="text-sm font-bold text-slate-700 dark:text-zinc-300 flex items-center gap-2">
                  Allocated Organization Seat Limit
                </label>
                <input 
                  type="number"
                  min={1}
                  max={500}
                  value={seatLimit}
                  onChange={(e) => setSeatLimit(Number(e.target.value))}
                  className="w-full h-10 px-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:text-zinc-100"
                />
                <p className="text-xs text-slate-400 dark:text-zinc-500">
                  Maximum active members allowed inside this organization concurrently (Max 500 seats).
                </p>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 flex justify-end">
                <Button 
                  type="submit" 
                  disabled={savingSettings}
                  className="h-10 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-6 gap-2"
                >
                  {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save Organization Policies
                </Button>
              </div>
            </form>

            {/* Collaborators Grid */}
            <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-2xl p-6 sm:p-8 shadow-sm">
              <h3 className="text-base font-bold text-slate-800 dark:text-white mb-6 flex items-center gap-2">
                <Users className="h-5 w-5 text-indigo-600" />
                Collaborator Roster ({members.length + 1})
              </h3>

              <div className="border border-slate-100 dark:border-zinc-900 rounded-xl overflow-hidden shadow-sm">
                <div className="divide-y divide-slate-100 dark:divide-zinc-900">
                  
                  {/* Owner (You) */}
                  <div className="px-5 py-4 flex items-center justify-between bg-slate-50/50 dark:bg-zinc-900/10">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-xs font-bold font-mono">
                        {activeTeam.createdBy.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-100">{activeTeam.createdBy}</h4>
                        <span className="inline-flex items-center gap-1 text-[10px] bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-semibold px-2 py-0.5 rounded-full mt-0.5">
                          <ShieldCheck className="h-3 w-3" /> Owner
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Members list */}
                  {loadingMembers ? (
                    <div className="p-8 text-center text-slate-400 gap-2 flex justify-center items-center">
                      <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                      <span className="text-sm">Retrieving team roster...</span>
                    </div>
                  ) : members.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-sm">
                      No external team members added yet. Use the sidebar to invite people.
                    </div>
                  ) : (
                    members.map((member: any, idx: number) => (
                      <div key={idx} className="px-5 py-4 flex items-center justify-between hover:bg-slate-50/20 dark:hover:bg-zinc-900/10 transition-colors">
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
      )}
    </div>
  )
}
