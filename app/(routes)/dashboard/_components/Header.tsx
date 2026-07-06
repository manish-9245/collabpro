"use client"

import React, { useContext, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useSessionAuth } from '@/lib/session-auth/client'
import { Search, Send, Users, Shield, ShieldCheck, Mail, Loader2, UserPlus, CheckCircle2 } from 'lucide-react'
import Image from 'next/image'
import { ActiveTeamContext } from '@/app/_context/ActiveTeamContext'
import { FileListContext } from '@/app/_context/FilesListContext'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogDescription,
} from "@/components/ui/dialog"
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

function Header() {
  const { user }: any = useSessionAuth()
  const { activeTeam } = useContext(ActiveTeamContext)
  const { searchQuery, setSearchQuery } = useContext(FileListContext) || {}
  const [inviteEmail, setInviteEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  // Fetch team members if activeTeam is set
  const members = useQuery(api.teams.getTeamMembers, activeTeam?._id ? { teamId: activeTeam._id } : 'skip' as any)
  const inviteMember = useMutation(api.teams.inviteMember)
  const localUserList = useQuery(api.user.getUser, user?.email ? { email: user.email } : 'skip' as any);
  const localUser = localUserList && localUserList.length > 0 ? localUserList[0] : null;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeTeam?._id) {
      toast.error('Please select or create a team first.')
      return
    }
    if (!inviteEmail || !inviteEmail.includes('@')) {
      toast.error('Please enter a valid email address.')
      return
    }

    setIsSubmitting(true)
    try {
      await inviteMember({
        teamId: activeTeam._id,
        userEmail: inviteEmail.trim().toLowerCase(),
        role: 'member'
      })
      toast.success(`${inviteEmail} has been invited successfully!`)
      setInviteEmail('')
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || 'Failed to invite user.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className='flex justify-end w-full gap-4 items-center p-2 bg-slate-50/50 backdrop-blur-md rounded-xl border border-slate-100 dark:bg-slate-900/50 dark:border-slate-800 shadow-sm'>
      <div className='flex gap-2 items-center border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-950 w-64 shadow-inner transition-all focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500'>
        <Search className='h-4 w-4 text-slate-400' />
        <input 
          type='text' 
          placeholder='Search files...' 
          value={searchQuery || ''}
          onChange={(e) => setSearchQuery && setSearchQuery(e.target.value)}
          className='outline-none text-sm bg-transparent w-full text-slate-700 dark:text-slate-200 placeholder-slate-400'
        />
      </div>

      {user && (
        <div className='flex items-center gap-2 border-r border-slate-200 dark:border-slate-800 pr-4'>
          <img 
            src={localUser?.image || user?.picture || '/logo-1.png'} 
            alt='user'
            className='rounded-full border border-slate-200 dark:border-slate-800 shadow-sm w-8 h-8 object-cover'
          />
          <span className='text-xs font-semibold text-slate-600 dark:text-slate-300 hidden md:inline-block'>
            {user?.given_name || 'User'}
          </span>
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button className='gap-2 flex text-sm font-medium h-9 hover:bg-blue-700 bg-blue-600 text-white rounded-lg shadow-md hover:shadow-lg hover:shadow-blue-500/20 active:scale-95 transition-all duration-200'>
            <Send className='h-4 w-4' /> 
            Invite & Manage
          </Button>
        </DialogTrigger>
        <DialogContent className='bg-white border border-slate-200 text-slate-800 max-w-md rounded-2xl shadow-xl p-6 overflow-hidden'>
          <DialogHeader className='space-y-2'>
            <DialogTitle className='text-xl font-bold flex items-center gap-2 text-slate-950'>
              <Users className='h-5 w-5 text-blue-600' />
              Team Management
            </DialogTitle>
            <DialogDescription className='text-slate-500 text-sm'>
              Manage collaborators and invite new members to <span className='text-blue-600 font-semibold'>{activeTeam?.teamName || 'your active team'}</span>.
            </DialogDescription>
          </DialogHeader>

          {/* Invitation Form */}
          <form onSubmit={handleInvite} className='mt-4 space-y-3'>
            <div className='flex flex-col gap-1.5'>
              <label className='text-xs font-semibold text-slate-500 uppercase tracking-wider'>Invite New Collaborator</label>
              <div className='flex gap-2'>
                <div className='relative flex-1'>
                  <Mail className='absolute left-3 top-2.5 h-4 w-4 text-slate-400' />
                  <Input
                    type='email'
                    placeholder='colleague@company.com'
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className='pl-9 bg-slate-50 border-slate-200 text-slate-900 rounded-lg placeholder-slate-400 focus:ring-blue-500/20 focus:border-blue-500'
                    disabled={isSubmitting}
                  />
                </div>
                <Button 
                  type='submit' 
                  disabled={isSubmitting} 
                  className='bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 rounded-lg flex gap-1.5 items-center justify-center transition-all duration-200 shrink-0 min-w-[90px]'
                >
                  {isSubmitting ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    <>
                      <UserPlus className='h-4 w-4' />
                      Invite
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>

          {/* Active Members List */}
          <div className='mt-6 space-y-3'>
            <div className='flex justify-between items-center border-b border-slate-100 pb-2'>
              <span className='text-xs font-bold text-slate-500 uppercase tracking-wider'>Current Members</span>
              <span className='text-xs text-slate-600 bg-slate-50 border border-slate-200/60 px-2 py-0.5 rounded-full font-medium'>
                {members ? `${members.length} total` : 'Loading...'}
              </span>
            </div>

            <div className='max-h-[220px] overflow-y-auto pr-1 space-y-2 scrollbar-thin scrollbar-thumb-slate-200'>
              {!members ? (
                <div className='flex justify-center items-center py-8 text-slate-400 gap-2'>
                  <Loader2 className='h-4 w-4 animate-spin text-blue-500' />
                  <span className='text-sm'>Loading teammates...</span>
                </div>
              ) : members.length === 0 ? (
                <div className='text-center py-6 text-sm text-slate-400'>
                  No members found.
                </div>
              ) : (
                members.map((member: any, index: number) => (
                  <div 
                    key={index} 
                    className='flex items-center justify-between p-2.5 rounded-xl bg-slate-50/50 border border-slate-100 hover:border-slate-200/80 hover:bg-slate-50 transition-all duration-150'
                  >
                    <div className='flex items-center gap-2.5 min-w-0'>
                      <div className='h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold uppercase shadow-inner'>
                        {member.email.charAt(0)}
                      </div>
                      <div className='flex flex-col min-w-0'>
                        <span className='text-sm font-medium text-slate-700 truncate pr-2'>{member.email}</span>
                      </div>
                    </div>

                    <div>
                      {member.role === 'owner' ? (
                        <span className='inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full uppercase tracking-wider'>
                          <ShieldCheck className='h-3 w-3' />
                          Owner
                        </span>
                      ) : (
                        <span className='inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full uppercase tracking-wider'>
                          <Shield className='h-3 w-3' />
                          Member
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Header