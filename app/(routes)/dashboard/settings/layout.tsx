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
 *
 * Horizontal tab bar, not a second vertical sidebar: dashboard/layout.tsx
 * already renders the one app-wide SideNav on every /dashboard/* route, and
 * a second vertical nav stacked next to it reads as two sidebars on any
 * normal-width screen - a pattern reserved for the editor (document tree +
 * canvas library panel), not settings.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user }: any = useSessionAuth()
  const { activeTeam } = useContext(ActiveTeamContext)
  const isOwner = activeTeam?.createdBy === user?.email

  return (
    <div className="min-h-screen bg-slate-50/30 dark:bg-zinc-950">
      <div className="p-4 sm:p-8 pb-4">
        <Header />
      </div>
      <div className="px-4 sm:px-8 pb-16 max-w-6xl mx-auto">
        <nav className="flex items-center gap-1.5 mb-6 pb-2 border-b border-slate-200/70 dark:border-zinc-800 overflow-x-auto [mask-image:linear-gradient(to_right,black_94%,transparent_100%)]">
          {NAV_ITEMS.filter((item) => !item.ownerOnly || isOwner).map((item) => {
            const isActive = pathname === item.href
            const Icon = item.icon
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => router.push(item.href)}
                className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-t-lg text-xs font-bold transition-all border-b-2 -mb-[9px] ${
                  isActive
                    ? 'border-[#6965db] text-[#6965db]'
                    : 'border-transparent text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
                }`}
                title={item.description}
              >
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#6965db]' : 'text-slate-400 dark:text-zinc-500'}`} />
                {item.label}
              </button>
            )
          })}
        </nav>
        <main className="min-w-0 w-full">{children}</main>
      </div>
    </div>
  )
}
