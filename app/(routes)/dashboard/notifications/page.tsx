"use client"

import React, { useContext, useEffect, useState } from 'react'
import Header from '../_components/Header'
import { ActiveTeamContext } from '@/app/_context/ActiveTeamContext'
import { useSessionAuth } from '@/lib/session-auth/client'
import { useQuery, useMutation, useConvex } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { toast } from 'sonner'
import { Bell, Check, X, ShieldAlert, CheckCircle2, Inbox, Calendar, Mail, Loader2, Sparkles } from 'lucide-react'
import moment from 'moment'

function NotificationsPage() {
  const { user }: any = useSessionAuth();
  const { setActiveTeam } = useContext(ActiveTeamContext);
  const convex = useConvex();

  const [invitations, setInvitations] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const respondToInvitation = useMutation(api.notifications.respondToInvitation);
  const markRead = useMutation(api.notifications.markRead);

  useEffect(() => {
    if (user?.email) {
      fetchNotificationsData();
    }
  }, [user]);

  const fetchNotificationsData = async () => {
    setLoading(true);
    try {
      const invites = await convex.query(api.notifications.getInvitations, { userEmail: user.email });
      const notifs = await convex.query(api.notifications.getNotifications, { userEmail: user.email });
      setInvitations(invites || []);
      setNotifications(notifs || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleResponse = async (invitationId: string, response: 'accept' | 'decline', teamName: string) => {
    try {
      const result = await respondToInvitation({ invitationId, response });
      if (result?.success) {
        toast.success(
          response === 'accept' 
            ? `Successfully joined team "${teamName}"!` 
            : `Declined invitation to join "${teamName}".`
        );
        
        // If accepted, let's force list reload
        fetchNotificationsData();
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to process invitation.");
    }
  };

  const handleMarkAllRead = async () => {
    if (!user?.email) return;
    setMarkingAll(true);
    try {
      await markRead({ userEmail: user.email });
      toast.success("All notifications marked as read.");
      fetchNotificationsData();
    } catch (err) {
      console.error(err);
      toast.error("Failed to update notifications.");
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className='p-8 min-h-screen bg-slate-50/30 dark:bg-zinc-950/20'>
      <Header />

      {/* Main Header */}
      <div className='mt-8 relative overflow-hidden rounded-2xl border border-slate-100 dark:border-zinc-900 bg-white dark:bg-zinc-950 p-6 sm:p-8 shadow-sm'>
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-56 h-56 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-4 w-44 h-44 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className='relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6'>
          <div className='space-y-2'>
            <div className='inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-xs font-semibold border border-blue-100/50 dark:border-blue-900/30'>
              <Bell className='h-3.5 w-3.5' />
              <span>GitHub-like Notifications Inbox</span>
            </div>
            <h1 className='text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-none'>
              Invitations & Activity Alerts
            </h1>
            <p className='text-sm text-slate-500 dark:text-zinc-400 max-w-xl leading-relaxed'>
              Manage pending team requests, accept collaborative invitations, and stay informed on teammate actions and system events.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
        
        {/* Pending Invitations Column */}
        <div className="lg:col-span-1 space-y-4">
          <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2 mb-2">
            <Mail className="h-4.5 w-4.5 text-blue-500" />
            Pending Invitations ({invitations.length})
          </h3>

          {loading ? (
            <div className="flex justify-center items-center py-12 text-slate-400 gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-xs">Loading requests...</span>
            </div>
          ) : invitations.length === 0 ? (
            <div className="bg-slate-50 dark:bg-zinc-900/10 border border-dashed border-slate-200 dark:border-zinc-800 p-8 rounded-xl text-center">
              <Inbox className="h-8 w-8 mx-auto text-slate-400 dark:text-zinc-500 mb-3" />
              <h4 className="text-xs font-semibold text-slate-700 dark:text-zinc-300">All caught up!</h4>
              <p className="text-[10px] text-slate-400 dark:text-zinc-500 max-w-[180px] mx-auto mt-1 leading-normal">
                No pending team invites found. Check again later.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {invitations.map((invite: any, index: number) => (
                <div 
                  key={index}
                  className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 p-4 rounded-xl shadow-sm space-y-3 relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500" />
                  
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-zinc-200">
                      Join Team <span className="text-blue-600 dark:text-blue-400 font-black">"{invite.teamName}"</span>
                    </h4>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-1 leading-normal">
                      Invited by: <span className="font-semibold text-slate-600 dark:text-zinc-300">{invite.inviterEmail}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => handleResponse(invite._id, 'accept', invite.teamName)}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] uppercase py-1.5 px-3 rounded-md flex items-center justify-center gap-1 transition-all"
                    >
                      <Check className="h-3 w-3" />
                      Accept
                    </button>
                    <button
                      onClick={() => handleResponse(invite._id, 'decline', invite.teamName)}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:text-zinc-300 font-bold text-[10px] uppercase py-1.5 px-3 rounded-md flex items-center justify-center gap-1 transition-all"
                    >
                      <X className="h-3 w-3" />
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Historical Notifications Feed Column */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <Bell className="h-4.5 w-4.5 text-blue-500" />
              Notification Alerts Log ({notifications.length})
            </h3>
            
            {notifications.some(n => !n.read) && (
              <button
                onClick={handleMarkAllRead}
                disabled={markingAll}
                className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 disabled:opacity-50"
              >
                {markingAll ? "Updating..." : "Mark all as read"}
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-20 text-slate-400 gap-2 bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-xl">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-xs">Loading activity feed...</span>
            </div>
          ) : notifications.length === 0 ? (
            <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 p-16 rounded-xl text-center shadow-sm">
              <Inbox className="h-10 w-10 mx-auto text-slate-300 dark:text-zinc-600 mb-4" />
              <h4 className="text-sm font-bold text-slate-600 dark:text-zinc-400">Activity inbox is empty</h4>
              <p className="text-xs text-slate-400 dark:text-zinc-500 max-w-xs mx-auto mt-2 leading-relaxed">
                When you accept invites, or invite collaborators who accept, notifications and activity logging logs will pop up here.
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 rounded-xl shadow-sm divide-y divide-slate-100 dark:divide-zinc-900 overflow-hidden">
              {notifications.map((notif: any, index: number) => {
                const isUnread = !notif.read;
                return (
                  <div 
                    key={index}
                    className={`p-4 sm:p-5 flex items-start gap-4 transition-colors ${
                      isUnread ? 'bg-blue-50/25 dark:bg-blue-950/10' : 'bg-transparent'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {notif.type === 'invite' ? (
                        <div className="h-8 w-8 rounded-full bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-500">
                          <Mail className="h-4 w-4" />
                        </div>
                      ) : notif.type === 'response' ? (
                        <div className="h-8 w-8 rounded-full bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-500">
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-slate-50 dark:bg-zinc-900/50 flex items-center justify-center text-slate-500">
                          <ShieldAlert className="h-4 w-4" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 space-y-1">
                      <div className="flex justify-between items-center gap-3">
                        <span className="text-xs font-bold text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                          {notif.title}
                          {isUnread && (
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                          )}
                        </span>
                        <span className="text-[9px] text-slate-400 dark:text-zinc-500 flex items-center gap-1 whitespace-nowrap">
                          <Calendar className="h-3 w-3" />
                          {moment(notif.createdAt).fromNow()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
                        {notif.message}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default NotificationsPage
