"use client";

import React, { useState, Suspense } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success('Successfully logged in!');
        const redirectUrl = searchParams.get('post_login_redirect_url') || '/dashboard';
        
        // Use full page reload to ensure the client-side context updates its active user state
        window.location.href = redirectUrl;
      } else {
        toast.error(data.error || 'Invalid credentials');
      }
    } catch (err) {
      toast.error('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-zinc-950/60 backdrop-blur-md border border-zinc-800 rounded-2xl shadow-2xl relative z-10">
      <div className="flex flex-col items-center mb-8">
        <img src="/logo-1.png" alt="CollabPro Logo" width={56} height={56} className="mb-2 rounded-full bg-white p-1 border border-zinc-800 shadow-xl" />
        <h1 className="text-2xl font-bold tracking-tight text-center bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
          Welcome back to CollabPro
        </h1>
        <p className="text-sm text-zinc-400 mt-1">Log in using your secure basic account</p>
      </div>

      <form onSubmit={handleLogin} className="space-y-6">
        <div>
          <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-zinc-900/80 border border-zinc-800 focus:border-blue-500 rounded-lg px-4 py-3 text-sm text-white focus:outline-none transition-all"
            placeholder="name@company.com"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-zinc-900/80 border border-zinc-800 focus:border-blue-500 rounded-lg px-4 py-3 text-sm text-white focus:outline-none transition-all"
            placeholder="••••••••"
            required
          />
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="w-full py-6 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-medium rounded-lg text-sm transition-all flex items-center justify-center shadow-lg hover:shadow-blue-500/20"
        >
          {loading ? 'Authenticating...' : 'Sign In'}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-xs text-zinc-400">
          Don't have an account?{' '}
          <a href="/register" className="text-blue-400 hover:text-blue-300 font-medium transition-all">
            Create an account
          </a>
        </p>
      </div>
    </div>
  );
}

import { BackgroundBeams } from '@/components/ui/background-beams-custom';

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col justify-center items-center px-4 relative overflow-hidden">
      {/* Dynamic Gradients Background */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-blue-900/30 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-purple-900/20 rounded-full blur-[120px] pointer-events-none" />

      {/* Subtle Premium Background Beams */}
      <BackgroundBeams className="opacity-20" />

      <Suspense fallback={
        <div className="text-sm text-zinc-400 animate-pulse">Loading auth screen...</div>
      }>
        <LoginForm />
      </Suspense>
    </div>
  );
}
