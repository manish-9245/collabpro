"use client"
import { useState } from 'react'
import { ShieldAlert, Shield, AlertTriangle, AlertCircle, Info, ExternalLink, Settings, Loader2 } from 'lucide-react'
import { api, useQuery } from '@/lib/state-sync/react'
import { useSessionAuth } from '@/lib/session-auth/client'
import SnykSettings from './SnykSettings'

function SnykWidget() {
  const { user }: any = useSessionAuth()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const settings = useQuery(
    api.snyk.getSettings,
    user?.email ? { userEmail: user.email } : 'skip' as any
  )

  const metrics = useQuery(
    api.snyk.getMetrics,
    settings ? { userEmail: user.email } : 'skip' as any
  )

  const isUnconfigured = settings === null
  const isLoading = settings === undefined || (settings && metrics === undefined)
  const hasError = !isUnconfigured && !isLoading && !metrics

  if (isUnconfigured) {
    return (
      <div
        onClick={() => setSettingsOpen(true)}
        className='bg-white dark:bg-zinc-950 border border-dashed border-slate-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-zinc-700 transition-all duration-200 group cursor-pointer'
      >
        <div className='flex items-center justify-between'>
          <span className='text-xs font-bold text-slate-400 uppercase tracking-wider'>Snyk Security</span>
          <div className='p-2 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-amber-600 dark:text-amber-400 group-hover:scale-110 transition-transform'>
            <ShieldAlert className='h-4 w-4' />
          </div>
        </div>
        <div className='mt-4'>
          <span className='text-sm font-medium text-amber-600 dark:text-amber-400'>Not configured</span>
          <p className='text-xs text-slate-400 mt-1'>Click to set up Snyk integration</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className='bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-xl p-5 shadow-sm'>
        <div className='flex items-center justify-between'>
          <span className='text-xs font-bold text-slate-400 uppercase tracking-wider'>Snyk Security</span>
          <div className='p-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-blue-600 dark:text-blue-400'>
            <Shield className='h-4 w-4' />
          </div>
        </div>
        <div className='mt-4 flex items-center gap-2'>
          <Loader2 className='h-4 w-4 animate-spin text-slate-400' />
          <span className='text-sm text-slate-400'>Scanning...</span>
        </div>
      </div>
    )
  }

  if (hasError || !metrics) {
    return (
      <div className='bg-white dark:bg-zinc-950 border border-red-100 dark:border-red-950/30 rounded-xl p-5 shadow-sm'>
        <div className='flex items-center justify-between'>
          <span className='text-xs font-bold text-slate-400 uppercase tracking-wider'>Snyk Security</span>
          <div className='p-2 bg-red-50 dark:bg-red-950/30 rounded-lg text-red-600 dark:text-red-400'>
            <AlertCircle className='h-4 w-4' />
          </div>
        </div>
        <div className='mt-4'>
          <span className='text-sm font-medium text-red-600 dark:text-red-400'>Failed to load</span>
          <button
            onClick={() => window.location.reload()}
            className='text-xs text-blue-500 hover:text-blue-600 ml-2 underline'
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        onClick={() => setSettingsOpen(true)}
        className='bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200 group cursor-pointer'
      >
        <div className='flex items-center justify-between'>
          <span className='text-xs font-bold text-slate-400 uppercase tracking-wider group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors'>
            Snyk Security
          </span>
          <div className='p-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform'>
            <Shield className='h-4 w-4' />
          </div>
        </div>
        <div className='mt-2 flex items-baseline gap-1.5'>
          <span className='text-2xl font-black text-slate-800 dark:text-white'>{metrics.projectCount}</span>
          <span className='text-xs text-slate-400'>Projects</span>
        </div>
        <div className='mt-3 space-y-1'>
          <div className='flex items-center gap-1.5'>
            <AlertTriangle className='h-3 w-3 text-red-500' />
            <span className='text-xs font-semibold text-red-600 dark:text-red-400'>{metrics.totalCritical} critical</span>
          </div>
          <div className='flex items-center gap-1.5'>
            <AlertCircle className='h-3 w-3 text-orange-500' />
            <span className='text-xs font-semibold text-orange-600 dark:text-orange-400'>{metrics.totalHigh} high</span>
          </div>
          <div className='flex items-center gap-1.5'>
            <Info className='h-3 w-3 text-yellow-500' />
            <span className='text-xs font-semibold text-yellow-600 dark:text-yellow-400'>{metrics.totalMedium} medium</span>
          </div>
          <div className='flex items-center gap-1.5'>
            <Info className='h-3 w-3 text-slate-400' />
            <span className='text-xs font-semibold text-slate-500'>{metrics.totalLow} low</span>
          </div>
        </div>
        <div className='mt-2 flex items-center gap-1'>
          <Shield className='h-3 w-3 text-emerald-500' />
          <span className='text-xs font-bold text-emerald-600 dark:text-emerald-400'>Rating: {metrics.securityRating}</span>
        </div>
      </div>
      <SnykSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}

export default SnykWidget
