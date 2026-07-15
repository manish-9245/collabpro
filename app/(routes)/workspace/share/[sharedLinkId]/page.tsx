"use client";

import React, { useState, useEffect } from 'react';
import { Shield, Key, Eye, EyeOff, Loader2, ArrowRight, Lock, Check, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function SharedLinkPage({ params }: { params: Promise<{ sharedLinkId: string }> }) {
  const unwrappedParams = React.use(params);
  const sharedLinkId = unwrappedParams.sharedLinkId;
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkMeta, setLinkMeta] = useState<any>(null);
  
  // Verification states
  const [password, setPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Fetch link info on mount
  useEffect(() => {
    async function checkLink() {
      try {
        const res = await fetch(`/api/share?sharedLinkId=${sharedLinkId}`);
        if (!res.ok) {
          const err = await res.json();
          setError(err.error || 'Failed to retrieve shared workspace info');
          setLoading(false);
          return;
        }

        const json = await res.json();
        const data = json.data;
        setLinkMeta(data);

        // If no password is required, redirect immediately
        if (!data.requiresPassword) {
          router.push(`/workspace/${data.fileId}?sharedLinkId=${sharedLinkId}&role=${data.role}`);
        } else {
          setLoading(false);
        }
      } catch (err: any) {
        setError('An unexpected error occurred while verifying the shared link.');
        setLoading(false);
      }
    }

    if (sharedLinkId) {
      checkLink();
    }
  }, [sharedLinkId, router]);

  const handleSubmitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);
    setError(null);

    try {
      const res = await fetch('/api/share/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sharedLinkId,
          password
        })
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Incorrect password.');
        setIsVerifying(false);
        return;
      }

      const json = await res.json();
      const data = json.data;

      // Direct user to workspace with valid credentials
      router.push(`/workspace/${data.fileId}?sharedLinkId=${sharedLinkId}&role=${data.role}`);
    } catch (err) {
      setError('An error occurred during password authentication.');
      setIsVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-slate-50 flex flex-col items-center justify-center relative overflow-hidden">
        {/* Decorative dynamic ambient glows */}
        <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-blue-600/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-indigo-600/5 rounded-full blur-3xl" />
        
        <div className="flex flex-col items-center gap-4 relative z-10">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
          <p className="text-xs font-black uppercase tracking-widest text-slate-500">Securing your workspace gateway...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 flex flex-col items-center justify-center p-4 relative overflow-hidden text-slate-900">
      {/* Decorative dynamic ambient glows */}
      <div className="absolute top-1/4 left-1/4 w-[450px] h-[400px] bg-blue-600/5 rounded-full blur-3xl animate-pulse duration-[6000ms]" />
      <div className="absolute bottom-1/4 right-1/4 w-[450px] h-[400px] bg-purple-600/5 rounded-full blur-3xl animate-pulse duration-[8000ms]" />

      <div className="w-full max-w-md relative z-10">
        
        {/* Logo and title */}
        <div className="text-center mb-8">
          <div className="inline-flex p-3.5 bg-blue-50 text-blue-600 rounded-2xl border border-blue-100 mb-4 shadow-lg shadow-blue-500/5">
            <Shield className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">CollabPro Private Gateway</h1>
          <p className="text-xs text-slate-500 font-medium mt-1">This workspace requires authorization credentials</p>
        </div>

        {/* Card */}
        <div className="bg-white/80 backdrop-blur-md border border-slate-200 rounded-3xl p-7 shadow-xl relative overflow-hidden">
          {error && (
            <div className="mb-6 p-4 bg-red-50/5 border border-red-200 rounded-2xl flex items-start gap-2.5 text-red-600 animate-in slide-in-from-top duration-300">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-bold block uppercase tracking-wider">Access Blocked</span>
                <span className="text-[11px] leading-tight opacity-95 block">{error}</span>
              </div>
            </div>
          )}

          {linkMeta && linkMeta.requiresPassword && (
            <form onSubmit={handleSubmitPassword} className="space-y-5">
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">Workspace Security Key</label>
                <p className="text-[10px] text-slate-400 leading-normal">Enter the lock password created by the workspace owner to decrypt real-time whiteboards and documents.</p>
              </div>

              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  disabled={isVerifying}
                  placeholder="Enter access password..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full text-xs font-medium pl-10 pr-10 py-3 bg-slate-50/50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 placeholder-slate-400 transition-all"
                />
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Key className="h-4 w-4" />
                </div>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <button
                type="submit"
                disabled={isVerifying}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-500/15 active:scale-98 transition-all disabled:opacity-50"
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Decrypting Workspace...
                  </>
                ) : (
                  <>
                    Unlock Workspace
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {!linkMeta && error && (
            <div className="text-center space-y-4 py-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                If you believe this is an error, please request a new sharing invite link from the project workspace administrator.
              </p>
              <button
                onClick={() => router.push('/')}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all"
              >
                Return Home
              </button>
            </div>
          )}
        </div>

        {/* Footer info */}
        <p className="text-center text-[10px] text-slate-400 font-medium mt-6">
          Protected by CollabPro Enterprise Link Guard &copy; {new Date().getFullYear()}
        </p>

      </div>
    </div>
  );
}
