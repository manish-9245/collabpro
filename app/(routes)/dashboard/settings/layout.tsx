"use client"

import React, { useContext } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Header from '../_components/Header'
import { ActiveTeamContext } from '@/app/_context/ActiveTeamContext'
import { useSessionAuth } from '@/lib/session-auth/client'
import { Users, BrainCircuit, Server, ShieldCheck } from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dashboard/settings', label: 'General', description: 'Teams & API keys', icon: Users, ownerOnly: false },
  { href: '/dashboard/settings/ai', label: 'AI Co-Pilot', description: 'Model provider setup', icon: BrainCircuit, ownerOnly: false },
  { href: '/dashboard/settings/mcp', label: 'MCP', description: 'Connect AI clients', icon: Server, ownerOnly: false },
  { href: '/dashboard/settings/admin', label: 'Admin', description: 'Org policy & audit log', icon: ShieldCheck, ownerOnly: true },
]

/**
 * Shared shell for every /dashboard/settings/* route. Before this, General,
 * AI, MCP and Admin were four unlinked URLs - nothing on any of them pointed
 * at the others, so most users only ever found whichever one they'd been
 * given a direct link to.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user }: any = useSessionAuth()
  const { activeTeam } = useContext(ActiveTeamContext)
  const isOwner = activeTeam?.createdBy === user?.email

  return (
    <div className="min-h-screen bg-slate-50/30 dark:bg-zinc-950/20">
      <div className="p-4 sm:p-8 pb-4">
        <Header />
      </div>
      <div className="px-4 sm:px-8 pb-16 max-w-6xl mx-auto flex flex-col lg:flex-row gap-8 items-start">
        <nav className="w-full lg:w-56 shrink-0 lg:sticky lg:top-8 flex flex-row lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible">
          <h2 className="hidden lg:block px-3 text-[11px] font-black uppercase tracking-widest text-slate-400 dark:text-zinc-500 mb-1">
            Settings
          </h2>
          {NAV_ITEMS.filter((item) => !item.ownerOnly || isOwner).map((item) => {
            const isActive = pathname === item.href
            const Icon = item.icon
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => router.push(item.href)}
                className={`shrink-0 flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all border ${
                  isActive
                    ? 'bg-white dark:bg-zinc-950 shadow-sm border-slate-200/70 dark:border-zinc-800 text-[#6965db]'
                    : 'border-transparent text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-white/60 dark:hover:bg-zinc-900/40'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#6965db]' : 'text-slate-400 dark:text-zinc-500'}`} />
                <span className="min-w-0">
                  <span className="block text-xs font-bold whitespace-nowrap">{item.label}</span>
                  <span className="hidden lg:block text-[10px] text-slate-400 dark:text-zinc-500 truncate">
                    {item.description}
                  </span>
                </span>
              </button>
            )
          })}
        </nav>
        <main className="flex-1 min-w-0 w-full">{children}</main>
      </div>
    </div>
  )
}
