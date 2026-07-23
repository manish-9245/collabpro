"use client"
import React, { useState } from 'react'
import { X, Key, Building2, Folder, Save } from 'lucide-react'

interface SonarcloudSettingsProps {
  initialSettings?: {
    organization: string
    projectKey: string
    token: string
  }
  onSave: (settings: { organization: string; projectKey: string; token: string }) => void
  onCancel: () => void
}

export default function SonarcloudSettings({
  initialSettings,
  onSave,
  onCancel,
}: SonarcloudSettingsProps) {
  const [org, setOrg] = useState(initialSettings?.organization || '')
  const [projectKey, setProjectKey] = useState(initialSettings?.projectKey || '')
  const [token, setToken] = useState(initialSettings?.token || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setError('')
    if (!org.trim()) {
      setError('Organization is required')
      return
    }
    if (!projectKey.trim()) {
      setError('Project key is required')
      return
    }
    if (!token.trim()) {
      setError('Token is required')
      return
    }
    setSaving(true)
    try {
      await onSave({ organization: org.trim(), projectKey: projectKey.trim(), token: token.trim() })
    } catch {
      setError('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 shadow-md">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">SonarCloud Settings</span>
        <button
          onClick={onCancel}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            <Building2 className="h-3 w-3" />
            Organization
          </label>
          <input
            type="text"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="your-sonarcloud-org"
            className="w-full text-xs bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg p-2.5 outline-none focus:border-blue-400 text-slate-700 dark:text-zinc-300"
          />
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            <Folder className="h-3 w-3" />
            Project Key
          </label>
          <input
            type="text"
            value={projectKey}
            onChange={(e) => setProjectKey(e.target.value)}
            placeholder="my-project-key"
            className="w-full text-xs bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg p-2.5 outline-none focus:border-blue-400 text-slate-700 dark:text-zinc-300"
          />
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            <Key className="h-3 w-3" />
            Token
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="SonarCloud access token"
            className="w-full text-xs font-mono bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg p-2.5 outline-none focus:border-blue-400 text-slate-700 dark:text-zinc-300"
          />
        </div>

        {error && (
          <div className="text-[11px] text-rose-500 font-medium">{error}</div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={onCancel}
            className="px-4 h-9 text-xs font-bold text-slate-500 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
