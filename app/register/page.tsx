"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import Header from '../_components/Header';
import Footer from '../_components/Footer';
import { BackgroundBeams } from '@/components/ui/background-beams-custom';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) {
      toast.error('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success('Account created successfully!');
        window.location.href = '/dashboard';
      } else {
        toast.error(data.error || 'Registration failed');
      }
    } catch (err) {
      toast.error('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between relative overflow-hidden">
      <Header />

      <div className="flex-1 flex flex-col justify-center items-center px-4 py-12 relative">
        {/* Dynamic Gradients Background */}
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-blue-200/40 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-indigo-100/30 rounded-full blur-[120px] pointer-events-none" />

        {/* Subtle Premium Background Beams */}
        <BackgroundBeams className="opacity-40" />

        <div className="w-full max-w-md p-8 bg-white/70 backdrop-blur-md border border-slate-200 rounded-2xl shadow-xl relative z-10">
          <div className="flex flex-col items-center mb-8">
            <img src="/logo-1.png" alt="CollabPro Logo" width={56} height={56} className="mb-2 rounded-full bg-white p-1 border border-slate-200 shadow-lg" />
            <h1 className="text-2xl font-black tracking-tight text-center bg-gradient-to-r from-slate-900 via-slate-800 to-slate-600 bg-clip-text text-transparent">
              Get started with CollabPro
            </h1>
            <p className="text-xs text-slate-500 mt-1">Create your self-hosted basic credentials account</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-6">
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">
                Full Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-50/50 border border-slate-200 focus:border-blue-500 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none transition-all shadow-inner focus:ring-4 focus:ring-blue-500/10"
                placeholder="John Doe"
                required
              />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-50/50 border border-slate-200 focus:border-blue-500 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none transition-all shadow-inner focus:ring-4 focus:ring-blue-500/10"
                placeholder="name@company.com"
                required
              />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50/50 border border-slate-200 focus:border-blue-500 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none transition-all shadow-inner focus:ring-4 focus:ring-blue-500/10"
                placeholder="••••••••"
                required
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full py-6 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-semibold rounded-xl text-sm transition-all flex items-center justify-center shadow-md hover:shadow-blue-500/25"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-xs text-slate-500 font-medium">
              Already have an account?{' '}
              <a href="/login" className="text-blue-600 hover:text-blue-500 font-bold transition-all">
                Sign in instead
              </a>
            </p>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
