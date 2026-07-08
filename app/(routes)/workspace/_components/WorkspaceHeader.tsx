"use client"

import { Button } from '@/components/ui/button'
import { Link, Save, Edit2, Check, X, Loader2, FileText, Columns, Palette, Download, Share2, History, Plus, Cloud, Undo, Redo } from 'lucide-react'
import Image from 'next/image'
import React, { useState, useEffect, useRef } from 'react'
import { api, useMutation, useQuery } from '@/lib/state-sync/react'
import { toast } from 'sonner'
import { useSessionAuth } from '@/lib/session-auth/client'
import moment from 'moment'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import ShareModal from './ShareModal'

interface WorkspaceHeaderProps {
  fileData: any
  onSave: () => void
  onRename: (newName: string) => void
  viewMode: 'both' | 'document' | 'canvas'
  onViewModeChange: (mode: 'both' | 'document' | 'canvas') => void
  savingStatus?: 'idle' | 'saving' | 'saved'
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
}

function WorkspaceHeader({ 
  fileData, 
  onSave, 
  onRename, 
  viewMode, 
  onViewModeChange, 
  savingStatus = 'idle',
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false
}: WorkspaceHeaderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [fileName, setFileName] = useState('Untitled File')
  const [tempName, setTempName] = useState('Untitled File')
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  
  const updateFileName = useMutation(api.files.updateFileName)
  const createVersion = useMutation(api.files.createVersion)
  const restoreVersion = useMutation(api.files.restoreVersion)
  const updateVersionNote = useMutation(api.files.updateVersionNote)

  const { user } = useSessionAuth()
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [versionNote, setVersionNote] = useState('')
  const [isCreatingVersion, setIsCreatingVersion] = useState(false)
  const [isShareOpen, setIsShareOpen] = useState(false)

  const [editingVersionId, setEditingVersionId] = useState<string | null>(null)
  const [tempVersionNote, setTempVersionNote] = useState('')
  const [isUpdatingNote, setIsUpdatingNote] = useState(false)

  const handleUpdateVersionNote = async (versionId: string) => {
    const trimmed = tempVersionNote.trim()
    if (!trimmed) {
      toast.error('Checkpoint name cannot be empty')
      return
    }
    setIsUpdatingNote(true)
    try {
      await updateVersionNote({ versionId, note: trimmed })
      toast.success('Checkpoint name updated successfully!')
      setEditingVersionId(null)
    } catch (err) {
      toast.error('Failed to update checkpoint name')
    } finally {
      setIsUpdatingNote(false)
    }
  }

  // Fetch previous checkpoints
  const versions = useQuery(api.files.getVersions, fileData?._id ? { fileId: fileData._id } : 'skip' as any) || []
  const activeCollaborators = useQuery(
    api.files.getActiveCollaborators,
    fileData?._id ? { fileId: fileData._id, currentUserEmail: user?.email } : 'skip' as any
  ) || []

  // Sync state with fileData when it loads or changes
  useEffect(() => {
    if (fileData?.fileName) {
      setFileName(fileData.fileName)
      setTempName(fileData.fileName)
    }
  }, [fileData])

  // Focus the input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSave = async () => {
    const trimmed = tempName.trim()
    if (!trimmed) {
      toast.error('File name cannot be empty')
      setTempName(fileName)
      setIsEditing(false)
      return
    }

    if (trimmed === fileName) {
      setIsEditing(false)
      return
    }

    setIsSaving(true)
    try {
      await updateFileName({
        _id: fileData._id,
        fileName: trimmed
      })
      setFileName(trimmed)
      onRename(trimmed)
      toast.success('File renamed successfully!')
      setIsEditing(false)
    } catch (err: any) {
      console.error(err)
      toast.error('Failed to rename file')
      setTempName(fileName)
    } finally {
      setIsSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      setTempName(fileName)
      setIsEditing(false)
    }
  }

  const handleShare = () => {
    setIsShareOpen(true)
  }

  const handleCreateVersion = async () => {
    if (!fileData?._id) return
    setIsCreatingVersion(true)
    try {
      await createVersion({
        fileId: fileData._id,
        createdByName: user?.given_name || "Author",
        createdByImage: user?.picture || "",
        note: versionNote.trim() || "Manual Savepoint"
      })
      setVersionNote('')
      toast.success('Version checkpoint created successfully!')
    } catch (err) {
      console.error(err)
      toast.error('Failed to create version checkpoint')
    } finally {
      setIsCreatingVersion(false)
    }
  }

  const handleRestoreVersion = async (versionId: string) => {
    try {
      await restoreVersion({ versionId })
      toast.success('Version restored successfully! Re-syncing and loading...')
      setTimeout(() => {
        window.location.reload()
      }, 1000)
    } catch (err) {
      console.error(err)
      toast.error('Failed to restore version')
    }
  }

  const exportAsMarkdown = () => {
    if (!fileData?.document) {
      toast.error('No document content to export')
      return
    }
    try {
      const data = JSON.parse(fileData.document)
      let md = `# ${fileName || 'Untitled Document'}\n\n`
      if (data.blocks && Array.isArray(data.blocks)) {
        data.blocks.forEach((block: any) => {
          if (block.type === 'header') {
            const hashes = '#'.repeat(block.data.level || 2)
            md += `${hashes} ${block.data.text}\n\n`
          } else if (block.type === 'paragraph') {
            md += `${block.data.text}\n\n`
          } else if (block.type === 'list') {
            if (block.data.items && Array.isArray(block.data.items)) {
              block.data.items.forEach((item: string) => {
                md += `- ${item}\n`
              })
              md += `\n`
            }
          } else if (block.type === 'checklist') {
            if (block.data.items && Array.isArray(block.data.items)) {
              block.data.items.forEach((item: any) => {
                const checked = item.checked ? '[x]' : '[ ]'
                md += `- ${checked} ${item.text}\n`
              })
              md += `\n`
            }
          } else if (block.type === 'warning') {
            md += `> **Warning:** ${block.data.title || ''}\n`
            md += `> ${block.data.message || ''}\n\n`
          }
        })
      }
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${fileName || 'Untitled'}.md`
      link.click()
      URL.revokeObjectURL(url)
      toast.success('Exported document as Markdown!')
    } catch (e) {
      console.error(e)
      toast.error('Failed to export as Markdown')
    }
  }

  const exportAsHTML = () => {
    if (!fileData?.document) {
      toast.error('No document content to export')
      return
    }
    try {
      const data = JSON.parse(fileData.document)
      let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${fileName || 'Untitled Document'}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; }
    h1, h2, h3 { color: #111; margin-top: 1.5em; }
    blockquote { border-left: 4px solid #ddd; padding-left: 15px; color: #666; margin-left: 0; }
    ul { padding-left: 20px; }
    li { margin-bottom: 5px; }
  </style>
</head>
<body>
  <h1>${fileName || 'Untitled Document'}</h1>\n`
      if (data.blocks && Array.isArray(data.blocks)) {
        data.blocks.forEach((block: any) => {
          if (block.type === 'header') {
            const tag = `h${block.data.level || 2}`
            html += `  <${tag}>${block.data.text}</${tag}>\n`
          } else if (block.type === 'paragraph') {
            html += `  <p>${block.data.text}</p>\n`
          } else if (block.type === 'list') {
            if (block.data.items && Array.isArray(block.data.items)) {
              html += `  <ul>\n`
              block.data.items.forEach((item: string) => {
                html += `    <li>${item}</li>\n`
              })
              html += `  </ul>\n`
            }
          } else if (block.type === 'checklist') {
            if (block.data.items && Array.isArray(block.data.items)) {
              html += `  <ul style="list-style-type: none; padding-left: 0;">\n`
              block.data.items.forEach((item: any) => {
                const checked = item.checked ? 'checked' : ''
                html += `    <li><input type="checkbox" ${checked} disabled> ${item.text}</li>\n`
              })
              html += `  </ul>\n`
            }
          } else if (block.type === 'warning') {
            html += `  <blockquote><strong>Warning:</strong> ${block.data.title || ''}<br>${block.data.message || ''}</blockquote>\n`
          }
        })
      }
      html += `</body>\n</html>`
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${fileName || 'Untitled'}.html`
      link.click()
      URL.revokeObjectURL(url)
      toast.success('Exported document as HTML!')
    } catch (e) {
      console.error(e)
      toast.error('Failed to export as HTML')
    }
  }

  const exportAsJSON = () => {
    if (!fileData?.whiteboard) {
      toast.error('No whiteboard content to export')
      return
    }
    try {
      const data = JSON.parse(fileData.whiteboard)
      const jsonStr = JSON.stringify(data, null, 2)
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${fileName || 'Untitled'}_whiteboard.json`
      link.click()
      URL.revokeObjectURL(url)
      toast.success('Exported whiteboard configuration!')
    } catch (e) {
      console.error(e)
      toast.error('Failed to export whiteboard JSON')
    }
  }

  const getInitials = (name: string, email: string) => {
    const source = (name || email || 'C').trim()
    const parts = source.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    if (parts[0].includes('@')) {
      const emailName = parts[0].split('@')[0]
      return emailName.slice(0, 2).toUpperCase()
    }
    return parts[0].slice(0, 2).toUpperCase()
  }

  const getStatusTone = (status: string) => {
    const lower = status.toLowerCase()
    if (lower.includes('canvas') || lower.includes('design')) return 'bg-violet-500'
    if (lower.includes('document') || lower.includes('edit')) return 'bg-blue-500'
    return 'bg-emerald-500'
  }

  return (
    <div className='p-3 border-b flex justify-between items-center bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm gap-2 h-14 shrink-0'>
      {/* Left section */}
      <div className='flex gap-3 items-center min-w-0 flex-1 mr-2'>
        <img src={'/logo-1.png'}
          alt='logo'
          height={32}
          width={32}
          className='rounded-full bg-white p-0.5 border border-slate-200/60 dark:border-slate-800/80 transition-transform hover:scale-105 duration-200 shrink-0 shadow-sm'
        />
        
        {/* Dynamic / Editable File Name */}
        <div className='flex items-center gap-1.5 min-w-0 max-w-[200px] sm:max-w-md group'>
          {isEditing ? (
            <div className='flex items-center gap-1 min-w-0 w-full'>
              <input
                ref={inputRef}
                type='text'
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                disabled={isSaving}
                className='px-2 py-1 text-sm font-semibold text-slate-800 dark:text-slate-100 border border-blue-500 rounded-lg outline-none ring-2 ring-blue-500/15 bg-slate-50 dark:bg-slate-950 w-full truncate transition-all'
              />
              {isSaving ? (
                <Loader2 className='h-4 w-4 animate-spin text-blue-500 shrink-0' />
              ) : (
                <div className='flex gap-0.5 shrink-0'>
                  <button 
                    onMouseDown={(e) => e.preventDefault()} // prevent blur from triggering before click
                    onClick={handleSave}
                    className='p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-green-600'
                  >
                    <Check className='h-3.5 w-3.5' />
                  </button>
                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setTempName(fileName); setIsEditing(false); }}
                    className='p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-rose-500'
                  >
                    <X className='h-3.5 w-3.5' />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div 
              className='flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all duration-150 min-w-0'
              onClick={() => setIsEditing(true)}
              title="Click to edit name"
            >
              <h2 className='font-bold text-[16px] text-slate-800 dark:text-slate-100 truncate max-w-[120px] sm:max-w-[200px] md:max-w-md select-none'>
                {fileName}
              </h2>
              <Edit2 className='h-3.5 w-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0' />
            </div>
          )}
        </div>
      </div>

      {/* Center: Beautiful Segmented View Switcher Control & Undo/Redo Controls */}
      <div className="flex items-center gap-2">
        {/* Undo/Redo Button Group */}
        <div className='flex items-center gap-1 bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800 shrink-0 shadow-inner mr-1'>
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-1.5 rounded-lg transition-all duration-200 ${
              canUndo
                ? 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 hover:shadow-sm active:scale-90'
                : 'text-slate-300 dark:text-slate-700/40 cursor-not-allowed'
            }`}
            title="Undo (Ctrl+Z / Cmd+Z)"
          >
            <Undo className='h-3.5 w-3.5' />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className={`p-1.5 rounded-lg transition-all duration-200 ${
              canRedo
                ? 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 hover:shadow-sm active:scale-90'
                : 'text-slate-300 dark:text-slate-700/40 cursor-not-allowed'
            }`}
            title="Redo (Ctrl+Y / Cmd+Y)"
          >
            <Redo className='h-3.5 w-3.5' />
          </button>
        </div>

        {/* View Switcher Control */}
        <div className='flex items-center gap-1 bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800 shrink-0 shadow-inner'>
          <button
            onClick={() => onViewModeChange('document')}
            className={`flex items-center gap-1.5 px-2 py-1 md:px-3 md:py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
              viewMode === 'document'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/40 dark:border-slate-800/40'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
            title="Document Editor Only"
          >
            <FileText className='h-3.5 w-3.5' />
            <span className='hidden md:inline'>Document</span>
          </button>
          
          <button
            onClick={() => onViewModeChange('both')}
            className={`flex items-center gap-1.5 px-2 py-1 md:px-3 md:py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
              viewMode === 'both'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/40 dark:border-slate-800/40'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
            title="Split Screen View"
          >
            <Columns className='h-3.5 w-3.5' />
            <span className='hidden md:inline'>Split View</span>
          </button>
          
          <button
            onClick={() => onViewModeChange('canvas')}
            className={`flex items-center gap-1.5 px-2 py-1 md:px-3 md:py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
              viewMode === 'canvas'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/40 dark:border-slate-800/40'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
            title="Whiteboard Canvas Only"
          >
            <Palette className='h-3.5 w-3.5' />
            <span className='hidden md:inline'>Canvas</span>
          </button>
        </div>
      </div>
      
      {/* Right side buttons */}
      <div className='flex items-center gap-2 shrink-0 flex-1 justify-end'>
        {/* Live Collaborator Presence Pile */}
        <div className='flex items-center gap-2 mr-1'>
          {activeCollaborators.length === 0 ? (
            <span className='hidden lg:inline-flex text-[11px] font-medium text-slate-500 dark:text-slate-400 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700'>
              Just you
            </span>
          ) : (
            <div className='flex items-center'>
              <div className='flex items-center transition-all duration-300 ease-out'>
                {activeCollaborators.slice(0, 3).map((collaborator: any, index: number) => (
                  <div
                    key={collaborator._id}
                    className={`group relative h-8 w-8 rounded-full border-2 border-white dark:border-slate-900 shadow-md transition-all duration-300 hover:z-20 hover:scale-110 ${index !== 0 ? '-ml-2.5' : ''}`}
                    style={{ backgroundColor: collaborator.userColor || '#6366f1' }}
                  >
                    {collaborator.userImage ? (
                      <img src={collaborator.userImage} alt={collaborator.userName} className='h-full w-full rounded-full object-cover' />
                    ) : (
                      <div className='h-full w-full rounded-full flex items-center justify-center text-[10px] font-bold text-white uppercase tracking-wide'>
                        {getInitials(collaborator.userName, collaborator.userEmail)}
                      </div>
                    )}
                    <div className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-white dark:border-slate-900 ${getStatusTone(collaborator.workspaceStatus || '')}`} />

                    <div className='pointer-events-none absolute top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-2.5 py-1.5 shadow-xl opacity-0 group-hover:opacity-100 group-hover:translate-y-0 translate-y-1 transition-all duration-200'>
                      <p className='text-[11px] font-semibold text-slate-800 dark:text-slate-100'>{collaborator.userName || collaborator.userEmail}</p>
                      <p className='text-[10px] text-slate-500 dark:text-slate-400'>{collaborator.workspaceStatus || 'Active in workspace'}</p>
                    </div>
                  </div>
                ))}
              </div>
              {activeCollaborators.length > 3 && (
                <div className='ml-1.5 px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all duration-300'>
                  +{activeCollaborators.length - 3}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dynamic Realtime Saving Status Indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-semibold shadow-inner min-w-[125px] justify-center transition-all duration-300">
          {savingStatus === 'saving' ? (
            <div className="flex items-center gap-1.5 text-amber-500 dark:text-amber-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Saving...</span>
            </div>
          ) : savingStatus === 'saved' ? (
            <div className="flex items-center gap-1.5 text-emerald-500 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              <span>Saved</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <Cloud className="h-3.5 w-3.5" />
              <span>Synced</span>
            </div>
          )}
        </div>

        {/* Version History Button */}
        <Button 
          onClick={() => setIsHistoryOpen(true)}
          className='h-8.5 text-[12px] font-medium gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-lg shadow-sm hover:shadow active:scale-95 transition-all border border-slate-200 dark:border-slate-700'
        >
          <History className='h-4 w-4' /> <span className='hidden sm:inline'>History</span>
        </Button>
        
        {/* Export Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className='h-8.5 text-[12px] font-medium gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-lg shadow-sm hover:shadow active:scale-95 transition-all border border-slate-200 dark:border-slate-700'>
              <Download className='h-4 w-4' /> <span className='hidden sm:inline'>Export</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
            <DropdownMenuLabel className="text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider">Export Document</DropdownMenuLabel>
            <DropdownMenuItem onClick={exportAsMarkdown} className="cursor-pointer gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
              <FileText className="h-4 w-4 text-blue-500" /> Export as Markdown (.md)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportAsHTML} className="cursor-pointer gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
              <FileText className="h-4 w-4 text-green-500" /> Export as HTML (.html)
            </DropdownMenuItem>
            
            <DropdownMenuSeparator className="bg-slate-100 dark:bg-slate-800" />
            
            <DropdownMenuLabel className="text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider">Export Whiteboard</DropdownMenuLabel>
            <DropdownMenuItem onClick={exportAsJSON} className="cursor-pointer gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
              <Palette className="h-4 w-4 text-purple-500" /> Export Canvas (.json)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button 
          onClick={handleShare}
          className='h-8.5 text-[12px] font-medium gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm hover:shadow active:scale-95 transition-all'
        >
          <span className='hidden sm:inline'>Share</span> <Share2 className='h-4 w-4' /> 
        </Button>
      </div>

      {/* Slide-out Drawer Panel for Version History */}
      {isHistoryOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop Overlay */}
          <div 
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-300"
            onClick={() => setIsHistoryOpen(false)}
          />
          
          {/* Panel positioning container */}
          <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col h-full transform transition-transform duration-300 ease-in-out">
              
              {/* Drawer Header */}
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-blue-500" />
                  <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Version History</h2>
                </div>
                <button 
                  onClick={() => setIsHistoryOpen(false)}
                  className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              
              {/* Drawer Content - Scrollable */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                
                {/* Create custom Savepoint Form */}
                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-4 rounded-xl space-y-3 shadow-inner">
                  <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Create Custom Savepoint</h3>
                  <div className="flex gap-2">
                    <Input
                      placeholder="E.g., Final draft, Meeting notes..."
                      value={versionNote}
                      onChange={(e) => setVersionNote(e.target.value)}
                      className="h-9 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateVersion()
                      }}
                    />
                    <Button 
                      onClick={handleCreateVersion}
                      disabled={isCreatingVersion}
                      className="h-9 text-xs px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg gap-1 shadow-sm shrink-0"
                    >
                      {isCreatingVersion ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      Create
                    </Button>
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-normal">
                    This will freeze a snapshot of both your document editor and whiteboard canvas as a custom named savepoint.
                  </p>
                </div>
                
                {/* Checkpoints Scroll Container */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Previous Checkpoints</h3>
                  
                  {versions.length === 0 ? (
                    <div className="text-center py-8 px-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                      <History className="h-8 w-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
                      <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">No saved versions found.</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1">Create a savepoint to capture current state.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-slate-950">
                      {versions.map((ver: any) => (
                        <div 
                          key={ver._id} 
                          className="p-4 flex gap-3 items-start hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                        >
                          {/* User Avatar */}
                          <div className="h-8 w-8 rounded-full border border-slate-100 dark:border-slate-800 overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0 shadow-sm relative">
                            {ver.createdByImage ? (
                              <img 
                                src={ver.createdByImage} 
                                alt={ver.createdByName} 
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="h-full w-full flex items-center justify-center text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800">
                                {ver.createdByName.charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>
                          
                          {/* Version Details */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                                Version #{ver.version}
                              </span>
                              <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                                {moment(ver.createdAt).fromNow()}
                              </span>
                            </div>
                            
                            {editingVersionId === ver._id ? (
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <Input
                                  className="h-7 text-xs px-2 py-1 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-lg focus-visible:ring-1 focus-visible:ring-blue-500 w-full"
                                  value={tempVersionNote}
                                  onChange={(e) => setTempVersionNote(e.target.value)}
                                  placeholder="Checkpoint name"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleUpdateVersionNote(ver._id)
                                    if (e.key === 'Escape') setEditingVersionId(null)
                                  }}
                                  disabled={isUpdatingNote}
                                />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30 shrink-0"
                                  onClick={() => handleUpdateVersionNote(ver._id)}
                                  disabled={isUpdatingNote}
                                >
                                  {isUpdatingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-slate-400 hover:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900 shrink-0"
                                  onClick={() => setEditingVersionId(null)}
                                  disabled={isUpdatingNote}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <div className="group relative mt-1 flex items-center justify-between gap-1.5">
                                <p className="text-xs text-slate-600 dark:text-slate-300 font-medium italic break-words leading-tight">
                                  "{ver.note || 'No description'}"
                                </p>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  onClick={() => {
                                    setEditingVersionId(ver._id)
                                    setTempVersionNote(ver.note || '')
                                  }}
                                >
                                  <Edit2 className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                            
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">
                              Created by <span className="font-semibold">{ver.createdByName}</span> • {moment(ver.createdAt).format('lll')}
                            </p>
                            
                            {/* Actions */}
                            <div className="flex gap-2 mt-2">
                              <Button
                                size="sm"
                                onClick={() => handleRestoreVersion(ver._id)}
                                className="h-7 text-[10px] font-medium bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-950/80 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/60 rounded-lg active:scale-95 transition-all px-2.5"
                              >
                                Restore Version
                              </Button>
                              {editingVersionId !== ver._id && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setEditingVersionId(ver._id)
                                    setTempVersionNote(ver.note || '')
                                  }}
                                  className="h-7 text-[10px] font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg active:scale-95 transition-all px-2.5"
                                >
                                  Rename
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Enterprise Share Settings Modal */}
      <ShareModal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        fileId={fileData?._id}
        fileName={fileName}
      />
    </div>
  )
}

export default WorkspaceHeader