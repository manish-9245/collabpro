"use client"
import React, { useState } from 'react'
import { ShieldCheck, AlertTriangle, Bug, Code, Percent, RefreshCw, Settings, Loader2, AlertCircle } from 'lucide-react'
import SonarcloudSettings from './SonarcloudSettings'

interface SonarcloudMetrics {
  qualityGate: string
  bugs: number
  codeSmells: number
  coverage: number
  vulnerabilities: number
}

interface SonarcloudSettingsData {
  userId: string
  organization: string
  projectKey: string
  token: string
}

interface SonarcloudWidgetProps {
  settings?: SonarcloudSettingsData | null
  metrics?: SonarcloudMetrics | null
  loading?: boolean
  error?: string | null
  onConfigure?: (settings: { organization: string; projectKey: string; token: string }) => void
  onRetry?: () => void
}

function getQualityGateColor(gate: string): string {
  switch (gate) {
    case 'OK':
      return 'text-emerald-500 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30'
    case 'WARN':
      return 'text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30'
    default:
      return 'text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30'
  }
}

function getQualityGateIcon(gate: string) {
  switch (gate) {
    case 'OK':
      return <ShieldCheck className="h-4 w-4" />
    case 'WARN':
      return <AlertTriangle className="h-4 w-4" />
    default:
      return <AlertCircle className="h-4 w-4" />
  }
}

function MetricCard({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  color: string
}) {
  return (
    <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200 group">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</span>
        <div className={`p-2 rounded-lg group-hover:scale-110 transition-transform ${color}`}>
          {icon}
        </div>
      </div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="text-2xl font-black text-slate-800 dark:text-white">{value}</span>
      </div>
    </div>
  )
}

export default function SonarcloudWidget({
  settings,
  metrics,
  loading,
  error,
  onConfigure,
  onRetry,
}: SonarcloudWidgetProps) {
  const [showSettings, setShowSettings] = useState(false)

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-center gap-3 py-8">
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          <span className="text-sm text-slate-500 dark:text-zinc-400">Loading SonarCloud metrics...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col items-center justify-center gap-3 py-6">
          <AlertCircle className="h-8 w-8 text-rose-400" />
          <span className="text-sm text-rose-500 text-center">{error}</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!settings?.projectKey) {
    return (
      <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col items-center justify-center gap-3 py-6">
          <ShieldCheck className="h-8 w-8 text-slate-300 dark:text-zinc-600" />
          <div className="text-center">
            <span className="text-sm font-bold text-slate-500 dark:text-zinc-400 block">
              SonarCloud Not Configured
            </span>
            <span className="text-xs text-slate-400 dark:text-zinc-500 mt-1 block">
              Connect your SonarCloud project to see compliance metrics
            </span>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            Configure
          </button>
        </div>
        {showSettings && onConfigure && (
          <SonarcloudSettings
            onSave={onConfigure}
            onCancel={() => setShowSettings(false)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowSettings(!showSettings)}
        className="w-full text-left"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Quality Gate</span>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${getQualityGateColor(metrics?.qualityGate || 'NONE')}`}>
            {getQualityGateIcon(metrics?.qualityGate || 'NONE')}
            {metrics?.qualityGate === 'OK' ? 'Passed' : metrics?.qualityGate === 'WARN' ? 'Warning' : 'Failed'}
          </div>
        </div>
      </button>

      {showSettings && onConfigure && (
        <SonarcloudSettings
          initialSettings={{
            organization: settings.organization,
            projectKey: settings.projectKey,
            token: settings.token,
          }}
          onSave={onConfigure}
          onCancel={() => setShowSettings(false)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Bugs"
          value={metrics?.bugs ?? '-'}
          icon={<Bug className="h-4 w-4" />}
          color="text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30"
        />
        <MetricCard
          label="Code Smells"
          value={metrics?.codeSmells ?? '-'}
          icon={<Code className="h-4 w-4" />}
          color="text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30"
        />
        <MetricCard
          label="Coverage"
          value={metrics?.coverage != null ? `${metrics.coverage}%` : '-'}
          icon={<Percent className="h-4 w-4" />}
          color="text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
        />
        <MetricCard
          label="Vulnerabilities"
          value={metrics?.vulnerabilities ?? '-'}
          icon={<AlertTriangle className="h-4 w-4" />}
          color="text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30"
        />
      </div>

      {onRetry && (
        <div className="flex justify-end">
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
      )}
    </div>
  )
}
