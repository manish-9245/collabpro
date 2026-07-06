"use client"

import React, { useContext, useEffect, useState } from 'react'
import Header from '../_components/Header'
import { ActiveTeamContext } from '@/app/_context/ActiveTeamContext'
import { useSessionAuth } from '@/lib/session-auth/client'
import { api, useSync, useQuery, useMutation } from '@/lib/state-sync/react'
import { toast } from 'sonner'
import { Settings, Users, LogOut, Trash2, Shield, ShieldCheck, Mail, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

function SettingsPage() {
  const { user }: any = useSessionAuth();
  const { activeTeam, setActiveTeam } = useContext(ActiveTeamContext);
  const sync = useSync();

  const [teams, setTeams] = useState<any[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [teamMembersMap, setTeamMembersMap] = useState<{ [teamId: string]: any[] }>({});
  const [loadingMembers, setLoadingMembers] = useState<{ [teamId: string]: boolean }>({});

  const leaveTeam = useMutation(api.teams.leaveTeam);
  const removeMember = useMutation(api.teams.removeMember);

  useEffect(() => {
    if (user?.email) {
      fetchTeams();
    }
  }, [user]);

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
    </div>
  )
}

export default SettingsPage
