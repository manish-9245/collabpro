"use client"

import React from 'react'
import Header from '../_components/Header'
import { Sparkles, FileText, Move, Play, RefreshCw, Users, ShieldAlert, Award, HelpCircle } from 'lucide-react'

function HelpPage() {
  const features = [
    {
      title: "Dynamic Co-Editor",
      description: "Craft rich, structured system specifications, markdown blueprints, and checklists side-by-side with your design whiteboard. Powered by an advanced document engine with real-time continuous synchronization.",
      icon: FileText,
      color: "from-blue-500 to-cyan-500"
    },
    {
      title: "Interactive System Canvas",
      description: "Design enterprise-grade network architectures, database blueprints, and cloud diagrams directly inside a robust Excalidraw integration, featuring specialized pre-loaded AWS and general systems icons.",
      icon: Sparkles,
      color: "from-purple-500 to-indigo-500"
    },
    {
      title: "Fluid Draggable Splitter",
      description: "Seamlessly switch between documents-first or whiteboard-first views. Drag the sliding divider bar dynamically in real-time to tailor your workspace layout to your screen sizing preferences.",
      icon: Move,
      color: "from-pink-500 to-rose-500"
    },
    {
      title: "Version Checkpoint History",
      description: "Never lose a breakthrough. Commit version snapshots of your documents and diagrams with customizable checkpoint labels. Review, rename, and roll back to previous revisions with one click.",
      icon: RefreshCw,
      color: "from-emerald-500 to-teal-500"
    },
    {
      title: "GitHub-style Teams & Org Settings",
      description: "Manage global memberships across teams and organizations. Send secure, trackable invitations, receive instant inbox alerts, and accept or decline incoming org membership invites.",
      icon: Users,
      color: "from-amber-500 to-orange-500"
    },
    {
      title: "Premium Anime Avatars & Profiles",
      description: "Stand out from the crowd. Personalize your workspace profile with customizable bios, social/portfolio links (GitHub, LinkedIn, Twitter), and stunning, animated anime characters as avatars.",
      icon: Award,
      color: "from-red-500 to-pink-600"
    }
  ]

  return (
    <div className='p-8 min-h-screen bg-slate-50/30 dark:bg-zinc-950/20'>
      <Header />

      {/* Title Header */}
      <div className='mt-8 relative overflow-hidden rounded-2xl border border-slate-100 dark:border-zinc-900 bg-white dark:bg-zinc-950 p-6 sm:p-8 shadow-sm'>
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-56 h-56 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-4 w-44 h-44 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className='relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6'>
          <div className='space-y-2'>
            <div className='inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-xs font-semibold border border-blue-100/50 dark:border-blue-900/30'>
              <HelpCircle className='h-3.5 w-3.5 animate-pulse' />
              <span>CollabPro Help Center</span>
            </div>
            <h1 className='text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-none'>
              Master the <span className='text-blue-600 dark:text-blue-400'>GrahakAI CollabPro</span> Suite
            </h1>
            <p className='text-sm text-slate-500 dark:text-zinc-400 max-w-xl leading-relaxed'>
              Everything you need to know about navigating your premium design environment. Learn how to draft, model, and collaborate efficiently.
            </p>
          </div>
        </div>
      </div>

      {/* Feature Walkthrough Grid */}
      <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8'>
        {features.map((feat, index) => (
          <div 
            key={index}
            className='bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-2xl p-6 shadow-sm hover:shadow-xl hover:border-slate-200 dark:hover:border-zinc-800 transition-all duration-300 flex flex-col justify-between group'
          >
            <div>
              {/* Feature Icon container with Gradient */}
              <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${feat.color} flex items-center justify-center text-white shadow-md shadow-blue-500/10 group-hover:scale-110 transition-transform duration-300`}>
                <feat.icon className='h-6 w-6' />
              </div>

              <h3 className='text-lg font-bold text-slate-800 dark:text-zinc-100 mt-4 mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors'>
                {feat.title}
              </h3>
              
              <p className='text-xs text-slate-500 dark:text-zinc-400 leading-relaxed'>
                {feat.description}
              </p>
            </div>

            <div className='mt-6 pt-4 border-t border-slate-50 dark:border-zinc-900 flex items-center gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider cursor-pointer group-hover:gap-2 transition-all'>
              <span>Explore Tutorial</span>
              <Play className='h-3 w-3 fill-current' />
            </div>
          </div>
        ))}
      </div>

      {/* System Architecture Section */}
      <div className='mt-8 rounded-2xl border border-dashed border-slate-200 dark:border-zinc-800 p-6 bg-slate-50/50 dark:bg-zinc-900/10 text-center max-w-3xl mx-auto'>
        <h4 className='text-sm font-bold text-slate-700 dark:text-zinc-300 mb-1'>Need Additional Assistance?</h4>
        <p className='text-xs text-slate-500 dark:text-zinc-500 leading-relaxed mb-4'>
          Our localized enterprise customer success crew is always on standby to ensure your blueprints are flawless. Submit tickets or review offline codebases directly.
        </p>
        <button className='bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs py-2 px-5 rounded-lg shadow-sm transition-all duration-200 hover:scale-105 active:scale-95'>
          Contact Enterprise Support
        </button>
      </div>
    </div>
  )
}

export default HelpPage
