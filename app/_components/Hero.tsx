"use client"

import React from 'react'
import { Layers, Zap, History, Users2, BrainCircuit, Server, Sparkles, ArrowRight } from 'lucide-react'
import { CHANGELOG } from '@/lib/changelog'
import { BackgroundBeams } from '@/components/ui/background-beams-custom'
import { HoverEffect } from '@/components/ui/card-hover-effect'

function Hero() {
  // Programmatic UI layout upgrade based on latest major release settings
  const latestMajorRelease = CHANGELOG.find(r => r.type === 'major' && r.uiThemeUpgrade);
  const theme = latestMajorRelease?.uiThemeUpgrade || {
    primaryColor: 'from-blue-600 via-indigo-600 to-purple-600',
    bannerGlow: 'bg-blue-500/10',
    badgeText: 'Upgrade Active',
    neonBorder: 'border-blue-500/30 shadow-blue-500/10'
  };

  const features = [
    {
      icon: Layers,
      title: 'Dual-View Canvas & Editor',
      description: 'Switch flawlessly between a rich real-time Markdown document editor and an infinite collaborative canvas whiteboard.',
      color: 'text-blue-600'
    },
    {
      icon: BrainCircuit,
      title: 'AI Co-Pilot That Actually Edits',
      description: 'A per-file chat sidebar backed by OpenAI, Anthropic, Gemini, or NVIDIA NIM that writes to your document or draws on your whiteboard directly - not just describes what it would do.',
      color: 'text-violet-600'
    },
    {
      icon: Server,
      title: 'MCP for Any AI Agent',
      description: 'A real, spec-compliant Model Context Protocol server so Claude Desktop, Cursor, VS Code, and Windsurf can read and edit your files directly.',
      color: 'text-rose-600'
    },
    {
      icon: Zap,
      title: 'Real-Time Sync Engine',
      description: 'Co-author blueprints with zero-latency collaborative synchronization. Keep your entire engineering squad aligned.',
      color: 'text-amber-600'
    },
    {
      icon: History,
      title: 'Smart Version History',
      description: 'Autosave snapshots of your designs. Inspect complete revision logs and restore previous workspaces in a single click.',
      color: 'text-emerald-600'
    },
    {
      icon: Users2,
      title: 'Team & Org Scoping',
      description: 'Organize files at team levels or view global organization dashboards with full author avatars and team trackers.',
      color: 'text-purple-600'
    }
  ];

  return (
    <section className="bg-slate-50/50 min-h-screen relative overflow-hidden pb-24">
      {/* Absolute background decorative radial glows - upgraded programmatically */}
      <div className={`absolute top-0 left-1/4 -mt-32 w-[600px] h-[600px] ${theme.bannerGlow} rounded-full blur-3xl pointer-events-none`} />
      <div className="absolute top-1/3 right-1/4 -mt-16 w-[500px] h-[500px] bg-indigo-100/30 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-[400px] h-[400px] bg-purple-100/10 rounded-full blur-3xl pointer-events-none" />
      
      {/* Subtle Premium Background Beams */}
      <BackgroundBeams className="opacity-30 mix-blend-multiply" />

      {/* Top Floating Dynamic Release Badge */}
      <div className='flex items-baseline justify-center pt-24 pb-8 relative z-10'>
        <div className='inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-slate-200 bg-white shadow-sm shadow-blue-500/5 text-xs text-slate-600'>
          <Sparkles className="h-3.5 w-3.5 text-blue-500 animate-pulse" />
          <span>Active Release: </span>
          <span className='text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-md text-[10px] uppercase tracking-wider'>{theme.badgeText}</span>
        </div>
      </div>

      {/* Hero Headline & CTA Section */}
      <div className="mx-auto max-w-screen-xl px-4 text-center relative z-10">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-extrabold sm:text-6xl text-slate-900 tracking-tight leading-none">
            Documents & diagrams <br />
            <span className={`bg-gradient-to-r ${theme.primaryColor} bg-clip-text text-transparent`}>
              for modern engineering teams
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-slate-600 max-w-xl mx-auto leading-relaxed">
            All-in-one markdown blueprints, collaborative infinite whiteboard canvas, virtual file organizing folders, and real-time syncing.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row justify-center items-center gap-4">
            <a
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-8 py-3.5 text-sm font-semibold shadow-xl shadow-blue-500/10 transition-all group border border-blue-500/30"
              href="/dashboard"
            >
              Get Started for Free
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </a>
            
            <a
              className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-white hover:bg-slate-50 text-slate-700 px-8 py-3.5 text-sm font-semibold border border-slate-200 transition-all shadow-sm"
              href="/dashboard"
            >
              Launch Dashboard
            </a>
          </div>
        </div>

        {/* Product teaser - real captured footage, not a simulated mockup */}
        <div className={`mt-16 mx-auto max-w-5xl rounded-2xl border ${theme.neonBorder} bg-black shadow-2xl overflow-hidden relative`}>
          <video
            className="w-full h-auto block"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            aria-label="CollabPro product teaser"
          >
            <source src="/videos/collabpro-teaser.mp4" type="video/mp4" />
          </video>
        </div>

        {/* Section Anchor for navigation smooth scrolling */}
        <div id="blueprint" className="scroll-mt-24 pt-20" />

        <div className="mt-12">
          {/* Features Header */}
          <div className="max-w-2xl mx-auto mb-10 text-center">
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              Engineered for high-performing squads
            </h2>
            <p className="text-slate-500 text-xs sm:text-sm mt-2 leading-relaxed max-w-lg mx-auto">
              Every component is meticulously designed to provide sovereign, self-contained speed, clarity, and precision.
            </p>
          </div>

          {/* Premium Animated Features Grid */}
          <HoverEffect items={features} />
        </div>
      </div>
    </section>
  )
}

export default Hero