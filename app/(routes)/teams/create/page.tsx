"use client"

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, useMutation } from '@/lib/state-sync/react';
import { useSessionAuth } from '@/lib/session-auth/client';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Sparkles, Users, Loader2 } from 'lucide-react';
import { BackgroundBeams } from '@/components/ui/background-beams-custom';

export default function CreateTeam() {
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  
  const createTeam = useMutation(api.teams.createTeam);
  const { user }: any = useSessionAuth();
  const router = useRouter();

  const handleCreateNewTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = teamName.trim();
    if (!trimmedName) {
      toast.error('Team name cannot be empty');
      return;
    }

    setLoading(true);
    try {
      const resp = await createTeam({
        teamName: trimmedName,
        createdBy: user?.email
      });
      if (resp) {
        toast.success('Team created successfully!');
        router.push('/dashboard');
      } else {
        toast.error('Failed to create team. Please try again.');
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between relative overflow-hidden font-sans">
      {/* Decorative background gradients */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-blue-200/40 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-indigo-100/30 rounded-full blur-[120px] pointer-events-none" />

      {/* Subtle Premium Background Beams */}
      <BackgroundBeams className="opacity-40" />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col justify-center items-center px-4 py-12 relative z-10">
        
        {/* Back navigation button */}
        <div className="mb-8 w-full max-w-md flex justify-start">
          <button 
            type="button"
            onClick={() => router.push('/dashboard')}
            className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors bg-white/80 backdrop-blur-md px-3.5 py-2 rounded-xl border border-slate-200/80 shadow-sm hover:shadow-md active:scale-95"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Dashboard
          </button>
        </div>

        {/* Create Team Card */}
        <div className="w-full max-w-md p-8 bg-white/70 backdrop-blur-md border border-slate-200 rounded-2xl shadow-xl">
          <div className="flex flex-col items-center mb-8">
            <div className="relative mb-3">
              <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 opacity-20 blur" />
              <img 
                src="/logo-1.png" 
                alt="CollabPro Logo" 
                width={56} 
                height={56} 
                className="relative rounded-full bg-white p-1 border border-slate-200 shadow-lg" 
              />
            </div>
            
            <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-blue-100 bg-blue-50/50 text-blue-700 text-[10px] font-extrabold uppercase tracking-wider mb-2">
              <Sparkles className="h-3 w-3 animate-pulse" />
              <span>Workspace Setup</span>
            </div>

            <h1 className="text-2xl font-black tracking-tight text-center bg-gradient-to-r from-slate-900 via-slate-800 to-slate-600 bg-clip-text text-transparent">
              What should we call your team?
            </h1>
            <p className="text-xs text-slate-500 mt-1 text-center font-medium">
              You can always modify this name later inside team configurations
            </p>
          </div>

          <form onSubmit={handleCreateNewTeam} className="space-y-6">
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-slate-400" />
                Team / Organization Name
              </label>
              <Input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="Team Name"
                className="w-full bg-white/50 border border-slate-200 focus:border-blue-500 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none transition-all shadow-inner focus:ring-4 focus:ring-blue-500/10"
                required
                disabled={loading}
              />
            </div>

            <Button
              type="submit"
              disabled={loading || !teamName.trim()}
              className="w-full py-6 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-semibold rounded-xl text-sm transition-all flex items-center justify-center shadow-md hover:shadow-blue-500/25 disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Creating Team...
                </>
              ) : (
                'Create Team'
              )}
            </Button>
          </form>
        </div>
      </div>

      {/* Simple Footer */}
      <footer className="py-6 text-center text-[10px] text-slate-400 border-t border-slate-100 bg-white/50 relative z-10">
        <p>© {new Date().getFullYear()} CollabPro. All sovereign rights reserved.</p>
      </footer>
    </div>
  );
}