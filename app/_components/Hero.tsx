import React from 'react'
import { Layers, FolderGit, Zap, History, Users2, ShieldCheck, Sparkles, ArrowRight, FolderOpen, Folder, FileText } from 'lucide-react'
import { LoginLink, RegisterLink } from '@kinde-oss/kinde-auth-nextjs'

function Hero() {
  const features = [
    {
      icon: Layers,
      title: 'Dual-View Canvas & Editor',
      description: 'Switch flawlessly between a rich real-time Markdown document editor and an infinite collaborative canvas whiteboard.',
      color: 'text-blue-400 border-blue-500/10 hover:border-blue-500/30'
    },
    {
      icon: FolderGit,
      title: 'Collapsible File Trees',
      description: 'Organize project files dynamically into virtual folders. Rename, delete, move, or archive files instantly from the sidebar.',
      color: 'text-indigo-400 border-indigo-500/10 hover:border-indigo-500/30'
    },
    {
      icon: Zap,
      title: 'Real-Time Sync Engine',
      description: 'Co-author blueprints with zero-latency collaborative synchronization. Keep your entire engineering squad aligned.',
      color: 'text-amber-400 border-amber-500/10 hover:border-amber-500/30'
    },
    {
      icon: History,
      title: 'Smart Version History',
      description: 'Autosave snapshots of your designs. Inspect complete revision logs and restore previous workspaces in a single click.',
      color: 'text-emerald-400 border-emerald-500/10 hover:border-emerald-500/30'
    },
    {
      icon: Users2,
      title: 'Team & Org Scoping',
      description: 'Organize files at team levels or view global organization dashboards with full author avatars and team trackers.',
      color: 'text-purple-400 border-purple-500/10 hover:border-purple-500/30'
    },
    {
      icon: ShieldCheck,
      title: 'Enterprise Security Tiers',
      description: 'Complete data sovereignty with unlimited workspace usage. Fully optimized self-hosting with bulletproof reliability.',
      color: 'text-teal-400 border-teal-500/10 hover:border-teal-500/30'
    }
  ];

  return (
    <section className="bg-black min-h-screen relative overflow-hidden pb-24">
      {/* Absolute background decorative radial glows */}
      <div className="absolute top-0 left-1/4 -mt-32 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 -mt-16 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-[400px] h-[400px] bg-purple-600/5 rounded-full blur-3xl pointer-events-none" />

      {/* CSS Keyframe definition for animated mockup cursors */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes cursor-path {
          0% { transform: translate(0, 0); }
          25% { transform: translate(-120px, -70px); }
          50% { transform: translate(-220px, 15px); }
          75% { transform: translate(-80px, -30px); }
          100% { transform: translate(0, 0); }
        }
        .animate-cursor-mock {
          animation: cursor-path 12s infinite ease-in-out;
        }
      `}} />

      {/* Top Floating Badge */}
      <div className='flex items-baseline justify-center pt-24 pb-8 relative z-10'>
        <div className='inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-zinc-800 bg-zinc-950/80 shadow-md shadow-blue-500/5 text-xs text-slate-300'>
          <Sparkles className="h-3.5 w-3.5 text-blue-400 animate-pulse" />
          <span>New Upgrade: </span>
          <span className='text-blue-400 font-semibold'>Collapsible Team Folders & Actions</span>
        </div>
      </div>

      {/* Hero Headline & CTA Section */}
      <div className="mx-auto max-w-screen-xl px-4 text-center relative z-10">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-extrabold sm:text-6xl text-white tracking-tight leading-none">
            Documents & diagrams <br />
            <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
              for modern engineering teams
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-zinc-400 max-w-xl mx-auto leading-relaxed">
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
              className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-zinc-950/80 hover:bg-zinc-900 text-zinc-300 hover:text-white px-8 py-3.5 text-sm font-semibold border border-zinc-800 transition-all shadow-md"
              href="/dashboard"
            >
              Launch Dashboard
            </a>
          </div>
        </div>

        {/* Interactive Workspace Mockup Preview */}
        <div className="mt-16 mx-auto max-w-5xl rounded-2xl border border-zinc-800/80 bg-zinc-950/60 backdrop-blur-xl shadow-2xl overflow-hidden relative group/mockup">
          {/* Header Bar of the Mock Workspace */}
          <div className="h-11 border-b border-zinc-800/80 bg-zinc-950/80 px-4 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-rose-500/80" />
              <span className="w-3 h-3 rounded-full bg-amber-500/80" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
              <span className="text-[10px] font-bold text-zinc-500 tracking-wider uppercase ml-3 hidden sm:inline-block">GrahakAI CollabPro - Simulated Workspace Sandbox</span>
            </div>
            {/* Active Collaborators */}
            <div className="flex items-center gap-1.5">
              <div className="flex -space-x-2">
                <img src="https://api.dicebear.com/7.x/shapes/svg?seed=CyberNeon" alt="user" className="w-5 h-5 rounded-full border border-zinc-800 bg-white" />
                <img src="https://api.dicebear.com/7.x/shapes/svg?seed=AuroraGlow" alt="user" className="w-5 h-5 rounded-full border border-zinc-800 bg-white" />
                <div className="w-5 h-5 rounded-full bg-blue-600 border border-zinc-800 flex items-center justify-center text-[8px] font-bold text-white">+2</div>
              </div>
              <span className="text-[9px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 animate-pulse">Live Collaboration</span>
            </div>
          </div>

          <div className="grid grid-cols-12 h-[380px] bg-zinc-950/30">
            {/* Sidebar Preview */}
            <div className="col-span-3 border-r border-zinc-800/80 p-3 bg-zinc-950/50 hidden md:block select-none text-left">
              <div>
                <h4 className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Team Navigation</h4>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-blue-400 font-semibold bg-blue-500/5 px-2 py-1.5 rounded-lg border border-blue-500/10">
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Engineering Specs</span>
                  </div>
                  <div className="pl-4 space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-zinc-200 py-1 px-1.5 rounded cursor-pointer bg-zinc-900/50">
                      <div className="flex items-center gap-1 min-w-0">
                        <FileText className="h-3 w-3 text-zinc-500 shrink-0" />
                        <span className="truncate font-medium text-zinc-300">system-architecture.md</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 py-1 px-1.5 rounded hover:text-zinc-200">
                      <div className="flex items-center gap-1 min-w-0">
                        <FileText className="h-3 w-3 text-zinc-500 shrink-0" />
                        <span className="truncate">api-endpoints.md</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded cursor-pointer">
                    <Folder className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                    <span className="truncate">Product Designs</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded cursor-pointer">
                    <Folder className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                    <span className="truncate">Marketing Assets</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Document Editor (Left side of split) */}
            <div className="col-span-12 md:col-span-4 p-4 space-y-3 bg-zinc-950/10 border-r border-zinc-800/80 text-left overflow-hidden">
              <div className="flex items-center gap-1.5 border-b border-zinc-900 pb-2">
                <FileText className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span className="text-[11px] font-bold text-zinc-300 truncate">system-architecture.md</span>
              </div>
              <div className="font-mono text-[10px] text-zinc-400 space-y-2 select-none overflow-y-auto max-h-[290px] pr-1 scrollbar-thin">
                <p className="text-zinc-500"># System Design Specs</p>
                <p><span className="text-blue-400">## 1. Authentication</span></p>
                <p className="leading-relaxed text-zinc-500">Using Kinde OSS + Convex data storage. Session persistence is configured statefully with zero timeout limits.</p>
                <p><span className="text-purple-400">## 2. Whiteboard Sync</span></p>
                <p className="leading-relaxed text-zinc-500">Dual-view editor with real-time websocket synchronization between whiteboard canvas and rich Markdown documents.</p>
                <p className="text-emerald-400 font-medium">// Autosaved snapshot v2.1</p>
              </div>
            </div>

            {/* Whiteboard Canvas (Right side of split) */}
            <div className="col-span-12 md:col-span-5 p-4 bg-zinc-950/40 relative overflow-hidden select-none min-h-[200px]">
              {/* Grid Background */}
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f1f23_1px,transparent_1px),linear-gradient(to_bottom,#1f1f23_1px,transparent_1px)] bg-[size:16px_16px] opacity-45" />
              
              <div className="absolute top-2 left-2 border border-zinc-800 bg-zinc-950/80 px-2 py-0.5 rounded text-[9px] text-zinc-400 z-10 font-bold tracking-wider uppercase">
                Canvas Mode
              </div>

              {/* Whiteboard content (Mock Architecture diagram) */}
              <div className="absolute inset-0 flex items-center justify-center gap-6 p-6 z-0 scale-90 sm:scale-100">
                <div className="w-24 h-14 rounded-xl border border-blue-500/30 bg-blue-500/5 flex flex-col items-center justify-center p-2 text-center shadow-lg shadow-blue-500/5">
                  <span className="text-[10px] font-bold text-blue-400">Auth Service</span>
                  <span className="text-[8px] text-zinc-500">Kinde SDK</span>
                </div>
                <div className="w-6 h-px bg-zinc-700 relative flex items-center justify-end shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping absolute" />
                </div>
                <div className="w-24 h-14 rounded-xl border border-purple-500/30 bg-purple-500/5 flex flex-col items-center justify-center p-2 text-center shadow-lg shadow-purple-500/5">
                  <span className="text-[10px] font-bold text-purple-400">Data Engine</span>
                  <span className="text-[8px] text-zinc-500">Convex DB</span>
                </div>
              </div>

              {/* Simulated Moving Collaborator Cursor */}
              <div className="absolute bottom-12 right-12 flex flex-col gap-1 items-start animate-cursor-path pointer-events-none z-10 animate-cursor-mock">
                <svg className="h-4 w-4 fill-indigo-500 text-indigo-500 drop-shadow" viewBox="0 0 24 24">
                  <path d="M4.5 2.1l14.2 14.2-6.5.6-3.8 6.5L4.5 2.1z" />
                </svg>
                <div className="bg-indigo-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                  Alex (Architect)
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Features Grid Header */}
        <div className="mt-28 mb-12 max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Engineered for high-performing squads
          </h2>
          <p className="text-zinc-500 text-xs sm:text-sm mt-2">
            Every feature is architected to give you the speed, clarity, and precision you need to build great systems.
          </p>
        </div>

        {/* Dynamic Responsive Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-screen-xl mx-auto text-left">
          {features.map((feat, idx) => (
            <div 
              key={idx}
              className={`bg-zinc-950/40 backdrop-blur-md border rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-blue-500/5 ${feat.color}`}
            >
              <div className="h-10 w-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
                <feat.icon className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-white mb-2">
                {feat.title}
              </h3>
              <p className="text-zinc-400 text-xs leading-relaxed">
                {feat.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Hero