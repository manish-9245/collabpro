"use client"
import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, useMutation, useQuery } from '@/lib/state-sync/react'
import { useSessionAuth } from '@/lib/session-auth/client'
import { ShieldAlert, Loader2, CheckCircle } from 'lucide-react'

interface SnykSettingsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function SnykSettingsDialog({ open, onOpenChange }: SnykSettingsProps) {
  const { user }: any = useSessionAuth()
  const [token, setToken] = useState('')
  const [orgId, setOrgId] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const existingSettings = useQuery(
    api.snyk.getSettings,
    user?.email ? { userEmail: user.email } : 'skip' as any
  )

  useEffect(() => {
    if (existingSettings) {
      setToken(existingSettings.token || '')
      setOrgId(existingSettings.orgId || '')
    }
  }, [existingSettings])

  const saveSettings = useMutation(api.snyk.saveSettings)
  const deleteSettings = useMutation(api.snyk.deleteSettings)

  const handleSave = async () => {
    if (!token.trim() || !orgId.trim()) {
      setError('Token and Org ID are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      await saveSettings({
        userId: user.email,
        token: token.trim(),
        orgId: orgId.trim(),
      })
      setSaved(true)
      setTimeout(() => {
        setSaved(false)
        onOpenChange(false)
      }, 1200)
    } catch (err: any) {
      setError(err?.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setSaving(true)
    setError('')
    try {
      await deleteSettings({ userEmail: user.email })
      onOpenChange(false)
    } catch (err: any) {
      setError(err?.message || 'Failed to delete settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <ShieldAlert className='h-5 w-5 text-blue-600 dark:text-blue-400' />
            Snyk Security Settings
          </DialogTitle>
          <DialogDescription>
            Configure your Snyk API credentials to display vulnerability metrics on the dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <label className='text-xs font-bold text-slate-500 uppercase tracking-wider'>Snyk API Token</label>
            <Input
              type='password'
              placeholder='snyk-api-token-...'
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>

          <div className='space-y-2'>
            <label className='text-xs font-bold text-slate-500 uppercase tracking-wider'>Organization ID</label>
            <Input
              type='text'
              placeholder='org-abc-123'
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
            />
          </div>

          {error && (
            <p className='text-xs text-red-500'>{error}</p>
          )}

          <div className='flex items-center justify-between pt-2'>
            <div>
              {existingSettings && (
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={handleDelete}
                  disabled={saving}
                  className='text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20'
                >
                  Remove
                </Button>
              )}
            </div>
            <div className='flex items-center gap-2'>
              <Button variant='outline' size='sm' onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size='sm' onClick={handleSave} disabled={saving}>
                {saving ? (
                  <span className='flex items-center gap-1'>
                    <Loader2 className='h-3 w-3 animate-spin' />
                    Saving...
                  </span>
                ) : saved ? (
                  <span className='flex items-center gap-1'>
                    <CheckCircle className='h-3 w-3' />
                    Saved
                  </span>
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SnykSettingsDialog
