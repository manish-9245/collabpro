"use client"
import { Button } from '@/components/ui/button'
import { api } from '@/convex/_generated/api'
import { useSessionAuth } from '@/lib/session-auth/client'
import { useConvex, useMutation, useQuery } from 'convex/react'
import React, { useEffect, useContext } from 'react'
import Header from './_components/Header'
import FileList from './_components/FileList'
import AdBanner from './../../_components/AdBanner'
import { FileListContext } from '@/app/_context/FilesListContext'
import { ActiveTeamContext } from '@/app/_context/ActiveTeamContext'
import { Sparkles, FileText, Users, Award, ShieldAlert, Layers } from 'lucide-react'

function Dashboard() {
  const convex = useConvex();
  const { user }: any = useSessionAuth();
  const { fileList_ } = useContext(FileListContext);
  const { activeTeam } = useContext(ActiveTeamContext);

  const createUser = useMutation(api.user.createUser);
  const members = useQuery(api.teams.getTeamMembers, activeTeam?._id ? { teamId: activeTeam._id } : 'skip' as any);

  useEffect(() => {
    if (user) {
      checkUser()
    }
  }, [user])

  const checkUser = async () => {
    const result = await convex.query(api.user.getUser, { email: user?.email });
    if (!result?.length) {
      createUser({
        name: user.given_name,
        email: user.email,
        image: user.picture
      }).then((resp) => {
        console.log(resp)
      })
    }
  }

  const totalFilesCount = fileList_?.length || 0;
  const totalMembersCount = members?.length || 1;

  return (
    <div className='p-8 min-h-screen bg-slate-50/30 dark:bg-zinc-950/20'>
      {/* Search and Invite Top Header */}
      <Header />

      {/* Modern SaaS Welcome Banner */}
      <div className='mt-8 relative overflow-hidden rounded-2xl border border-slate-100 dark:border-zinc-900 bg-white dark:bg-zinc-950 p-6 sm:p-8 shadow-sm'>
        {/* Subtle decorative background glow */}
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-56 h-56 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-4 w-44 h-44 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className='relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6'>
          <div className='space-y-2'>
            <div className='inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-xs font-semibold border border-blue-100/50 dark:border-blue-900/30'>
              <Sparkles className='h-3.5 w-3.5 animate-pulse' />
              <span>CollabPro Workspace Active</span>
            </div>
            <h1 className='text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-none'>
              Welcome back, <span className='text-blue-600 dark:text-blue-400'>{user?.given_name || 'Innovator'}</span>!
            </h1>
            <p className='text-sm text-slate-500 dark:text-zinc-400 max-w-xl leading-relaxed'>
              Collaborate in real-time, construct beautiful markdown blueprints, build diagram-as-code models, and capture your team's collective genius.
            </p>
          </div>
          
          <div className='shrink-0 flex items-center gap-3 bg-slate-50/50 dark:bg-zinc-900/30 border border-slate-100 dark:border-zinc-800/80 p-3 rounded-xl shadow-sm'>
            <div className='h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-inner'>
              <Layers className='h-5 w-5' />
            </div>
            <div className='text-left'>
              <h4 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider'>Selected Team</h4>
              <p className='text-sm font-bold text-slate-800 dark:text-slate-200 max-w-[150px] truncate'>
                {activeTeam?.teamName || 'Loading Team...'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Cards Grid */}
      <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6'>
        {/* Metric 1 */}
        <div className='bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200 group'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-bold text-slate-400 uppercase tracking-wider group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors'>Total Documents</span>
            <div className='p-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform'>
              <FileText className='h-4 w-4' />
            </div>
          </div>
          <div className='mt-4 flex items-baseline gap-1.5'>
            <span className='text-2xl font-black text-slate-800 dark:text-white'>{totalFilesCount}</span>
            <span className='text-xs text-slate-400'>Files</span>
          </div>
        </div>

        {/* Metric 2 */}
        <div className='bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200 group'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-bold text-slate-400 uppercase tracking-wider group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors'>Collaborators</span>
            <div className='p-2 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform'>
              <Users className='h-4 w-4' />
            </div>
          </div>
          <div className='mt-4 flex items-baseline gap-1.5'>
            <span className='text-2xl font-black text-slate-800 dark:text-white'>{totalMembersCount}</span>
            <span className='text-xs text-slate-400'>Members</span>
          </div>
        </div>

        {/* Metric 3 */}
        <div className='bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200 group'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-bold text-slate-400 uppercase tracking-wider group-hover:text-emerald-500 dark:group-hover:text-emerald-400 transition-colors'>Active Tier</span>
            <div className='p-2 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform'>
              <Award className='h-4 w-4' />
            </div>
          </div>
          <div className='mt-4 flex items-baseline gap-1.5'>
            <span className='text-lg font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-tight'>Self-Hosted</span>
            <span className='text-xs text-slate-400'>Enterprise</span>
          </div>
        </div>

        {/* Metric 4 */}
        <div className='bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200 group'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-bold text-slate-400 uppercase tracking-wider group-hover:text-purple-500 dark:group-hover:text-purple-400 transition-colors'>Storage Usage</span>
            <div className='p-2 bg-purple-50 dark:bg-purple-950/30 rounded-lg text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform'>
              <ShieldAlert className='h-4 w-4' />
            </div>
          </div>
          <div className='mt-4 flex items-baseline gap-1.5'>
            <span className='text-2xl font-black text-slate-800 dark:text-white'>Unlimited</span>
            <span className='text-xs text-emerald-500 font-semibold'>100% Free</span>
          </div>
        </div>
      </div>

      {/* Files List Panel */}
      <FileList />

      {/* Non-intrusive Ad Banner styled for high-end SaaS feel */}
      <div className="mt-8 overflow-hidden rounded-xl border border-dashed border-slate-200 dark:border-zinc-800 p-2 opacity-80 hover:opacity-100 transition-opacity">
        <AdBanner
          data-ad-slot="4796371341"
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      </div>
    </div>
  )
}

export default Dashboard