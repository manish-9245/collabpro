"use client"

import { Button } from '@/components/ui/button'
import { Link, Save, Edit2, Check, X, Loader2, FileText, Columns, Palette, Download, Share2 } from 'lucide-react'
import Image from 'next/image'
import React, { useState, useEffect, useRef } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface WorkspaceHeaderProps {
  fileData: any
  onSave: () => void
  onRename: (newName: string) => void
  viewMode: 'both' | 'document' | 'canvas'
  onViewModeChange: (mode: 'both' | 'document' | 'canvas') => void
}

function WorkspaceHeader({ fileData, onSave, onRename, viewMode, onViewModeChange }: WorkspaceHeaderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [fileName, setFileName] = useState('Untitled File')
  const [tempName, setTempName] = useState('Untitled File')
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  
  const updateFileName = useMutation(api.files.updateFileName)

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
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href)
      toast.success('Workspace link copied to clipboard!')
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

  return (
    <div className='p-3 border-b flex justify-between items-center bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm gap-2 h-14 shrink-0'>
      {/* Left section */}
      <div className='flex gap-3 items-center min-w-0 flex-1 mr-2'>
        <Image src={'/logo-1.png'}
          alt='logo'
          height={36}
          width={36}
          className='transition-transform hover:scale-105 duration-200 shrink-0'
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

      {/* Center: Beautiful Segmented View Switcher Control */}
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
      
      {/* Right side buttons */}
      <div className='flex items-center gap-2 shrink-0 flex-1 justify-end'>
        <Button className='h-8.5 text-[12px] font-medium
        gap-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg shadow-sm hover:shadow active:scale-95 transition-all'
        onClick={() => onSave()}
        > 
          <Save className='h-4 w-4' /> <span className='hidden sm:inline'>Save</span> 
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
    </div>
  )
}

export default WorkspaceHeader