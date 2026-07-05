import React from 'react'
import { Layers, FolderGit, Zap, History, Users2, ShieldCheck, Sparkles, ArrowRight } from 'lucide-react'
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