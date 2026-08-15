"use client"

import React, { useState } from 'react'
import Link from 'next/link'
import Header from '../_components/Header'
import {
  Sparkles, FileText, RefreshCw, Users, HelpCircle,
  BrainCircuit, Server, ChevronDown, BookOpen, ArrowRight
} from 'lucide-react'

const FEATURES = [
  {
    title: "Dynamic Co-Editor",
    description: "A structured document editor (Editor.js) - headers, lists, checklists, warnings, and images - synced to the server on every change, plus manual version checkpoints.",
    icon: FileText,
    color: "from-blue-500 to-cyan-500"
  },
  {
    title: "Interactive System Canvas",
    description: "An Excalidraw whiteboard with pre-loaded AWS/system icons, 200+ community icon libraries, and PDF import. Opens on demand from the toolbar's Split View or Canvas button.",
    icon: Sparkles,
    color: "from-purple-500 to-indigo-500"
  },
  {
    title: "Version Checkpoint History",
    description: "Create named savepoints of both the document and whiteboard from the workspace header's History panel, and restore any previous checkpoint with one click.",
    icon: RefreshCw,
    color: "from-emerald-500 to-teal-500"
  },
  {
    title: "Teams & Personal Access Tokens",
    description: "Manage team memberships, invite collaborators, and generate scoped Personal Access Tokens for scripts and AI agents - all from Settings.",
    icon: Users,
    color: "from-amber-500 to-orange-500"
  },
  {
    title: "AI Co-Pilot That Actually Edits",
    description: "A per-file AI chat sidebar that can write to your document or draw on your whiteboard directly, not just describe what it would do - once a team owner configures a provider.",
    icon: BrainCircuit,
    color: "from-violet-500 to-purple-600"
  },
  {
    title: "MCP: Connect External AI Clients",
    description: "A real, spec-compliant Model Context Protocol server (/api/mcp) so Claude Desktop, Cursor, VS Code, and Windsurf can read and edit your files directly.",
    icon: Server,
    color: "from-rose-500 to-pink-600"
  }
]

const GUIDES = [
  {
    title: "Set up AI Co-Pilot",
    description: "Configure your team's model provider (OpenAI, Anthropic, Gemini, or NVIDIA NIM) so the in-editor chat sidebar can respond and edit files.",
    href: "/dashboard/settings/ai"
  },
  {
    title: "Connect an MCP client",
    description: "Wire up Claude Desktop, Cursor, VS Code, or Windsurf to this workspace, step by step, with a live diagnostic to confirm it worked.",
    href: "/dashboard/settings/mcp"
  },
  {
    title: "Generate a Personal Access Token",
    description: "Create a scoped API key for scripts, MCP clients, or the Developer Hub sandbox - and revoke it any time.",
    href: "/dashboard/settings"
  },
  {
    title: "Explore the API in the Developer Hub",
    description: "Full parameter reference for all 6 MCP tools, plus a live JSON-RPC console to try requests against your own key.",
    href: "/dashboard/developers"
  }
]

const FAQS = [
  {
    q: "Why isn't the AI chat sidebar responding in my file?",
    a: "AI Co-Pilot is configured per team, not per user. A team owner needs to add a provider (API key + model) under Settings → AI Co-Pilot first - until then, every team member sees an explicit \"no AI provider configured\" message instead of a silent failure."
  },
  {
    q: "Can the AI actually change my document or whiteboard, or just talk?",
    a: "It can write. When you ask it to draft, edit, draw, or diagram something, it calls a tool that writes directly to the file (bounded to one action per message) - you'll see an inline action marker in the chat confirming what it changed."
  },
  {
    q: "What's the difference between a version checkpoint and autosave?",
    a: "Every edit autosaves continuously in the background. Checkpoints (via the History panel in the workspace header) are separate, named snapshots you create deliberately - useful for \"before I try this\" moments you might want to roll back to."
  },
  {
    q: "Is my AI provider API key safe to store here?",
    a: "It's encrypted at rest with AES-256-GCM and only ever decrypted server-side to call your provider - it's never sent back to any browser, not even yours, after you save it. Only a masked preview (e.g. sk-••••1a2b) is shown."
  },
  {
    q: "How do team roles work?",
    a: "Whoever creates a team is its owner and is the only one who can configure AI Co-Pilot, manage organization admin policy, and remove members. Everyone else is a member: they can collaborate on files but not change team-wide settings."
  },
  {
    q: "What can an MCP client (Claude Desktop, Cursor, etc.) actually do once connected?",
    a: "Exactly 7 tools, all listed with full parameters in the Developer Hub: list files, create a new file, fetch/update a document or whiteboard, and search/insert icons from community Excalidraw libraries. A read-only API key can use the read tools but gets a 403 from the write ones."
  }
]

function HelpPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  return (
    <div className='p-8 min-h-screen bg-slate-50/30 dark:bg-zinc-950'>
      <Header />

      {/* Title Header */}
      <div className='mt-8 relative overflow-hidden rounded-2xl border border-slate-100 dark:border-zinc-900 bg-white dark:bg-zinc-950 p-6 sm:p-8 shadow-sm'>
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-56 h-56 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-4 w-44 h-44 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className='relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6'>
          <div className='space-y-2'>
            <div className='inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-xs font-semibold border border-blue-100/50 dark:border-blue-900/30'>
              <HelpCircle className='h-3.5 w-3.5' />
              <span>CollabPro Help Center</span>
            </div>
            <h1 className='text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-none'>
              Master the <span className='text-blue-600 dark:text-blue-400'>CollabPro</span> Suite
            </h1>
            <p className='text-sm text-slate-500 dark:text-zinc-400 max-w-xl leading-relaxed'>
              What each part of the workspace actually does, real setup guides, and answers to the questions people actually ask.
            </p>
          </div>
        </div>
      </div>

      {/* Feature Grid */}
      <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8'>
        {FEATURES.map((feat, index) => (
          <div
            key={index}
            className='bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-2xl p-6 shadow-sm hover:shadow-xl hover:border-slate-200 dark:hover:border-zinc-800 transition-all duration-300 group'
          >
            <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${feat.color} flex items-center justify-center text-white shadow-md shadow-blue-500/10 group-hover:scale-110 transition-transform duration-300`}>
              <feat.icon className='h-6 w-6' />
            </div>
            <h3 className='text-lg font-bold text-slate-800 dark:text-zinc-100 mt-4 mb-2'>
              {feat.title}
            </h3>
            <p className='text-xs text-slate-500 dark:text-zinc-400 leading-relaxed'>
              {feat.description}
            </p>
          </div>
        ))}
      </div>

      {/* Guides */}
      <div className='mt-10'>
        <h2 className='text-sm font-black text-slate-800 dark:text-zinc-100 uppercase tracking-wider flex items-center gap-2 mb-4'>
          <BookOpen className='h-4 w-4 text-blue-600' /> Guides
        </h2>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          {GUIDES.map((guide) => (
            <Link
              key={guide.href}
              href={guide.href}
              className='flex items-center justify-between gap-3 bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-blue-200 dark:hover:border-blue-900/40 transition-all group'
            >
              <div>
                <h4 className='text-sm font-bold text-slate-800 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors'>
                  {guide.title}
                </h4>
                <p className='text-xs text-slate-500 dark:text-zinc-400 mt-1 leading-relaxed'>
                  {guide.description}
                </p>
              </div>
              <ArrowRight className='h-4 w-4 text-slate-300 dark:text-zinc-700 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all shrink-0' />
            </Link>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div className='mt-10 max-w-3xl'>
        <h2 className='text-sm font-black text-slate-800 dark:text-zinc-100 uppercase tracking-wider flex items-center gap-2 mb-4'>
          <HelpCircle className='h-4 w-4 text-blue-600' /> Frequently Asked Questions
        </h2>
        <div className='divide-y divide-slate-100 dark:divide-zinc-900 border border-slate-100 dark:border-zinc-900 rounded-2xl overflow-hidden bg-white dark:bg-zinc-950 shadow-sm'>
          {FAQS.map((faq, index) => {
            const isOpen = openFaq === index
            return (
              <div key={index}>
                <button
                  type='button'
                  onClick={() => setOpenFaq(isOpen ? null : index)}
                  className='w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50/60 dark:hover:bg-zinc-900/40 transition-colors'
                >
                  <span className='text-sm font-semibold text-slate-800 dark:text-zinc-100'>{faq.q}</span>
                  <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className='px-5 pb-4 -mt-1'>
                    <p className='text-xs text-slate-500 dark:text-zinc-400 leading-relaxed'>{faq.a}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Still stuck */}
      <div className='mt-10 rounded-2xl border border-dashed border-slate-200 dark:border-zinc-800 p-6 bg-slate-50/50 dark:bg-zinc-900/10 text-center max-w-3xl mx-auto'>
        <h4 className='text-sm font-bold text-slate-700 dark:text-zinc-300 mb-1'>Still stuck?</h4>
        <p className='text-xs text-slate-500 dark:text-zinc-500 leading-relaxed'>
          The Guides and FAQ above cover every real feature in this workspace. For the full technical reference -
          every MCP tool's parameters, live request testing - head to the{' '}
          <Link href='/dashboard/developers' className='text-blue-600 dark:text-blue-400 font-semibold hover:underline'>
            Developer Hub
          </Link>.
        </p>
      </div>
    </div>
  )
}

export default HelpPage
