"use client"

import { LoginLink, RegisterLink, useSessionAuth } from '@/lib/session-auth/client'
import Image from 'next/image'
import React from 'react'

function Header() {
  const { user, isLoading } = useSessionAuth();

  return (
    <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-slate-100/80">
      <div className="mx-auto flex h-16 max-w-screen-xl items-center gap-8 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <img src='/logo-1.png' alt='CollabPro'
            width={36}
            height={36}
            className="rounded-full bg-white p-0.5 shadow-md shadow-blue-500/10 border border-slate-200/50"
          />
          <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">CollabPro</span>
        </div>

        <div className="flex flex-1 items-center justify-end md:justify-between">
          <nav aria-label="Global" className="hidden md:block">
            <ul className="flex items-center gap-6 text-sm">
              <li>
                <a className="text-slate-600 hover:text-slate-900 transition font-medium" href="#"> About </a>
              </li>

              <li>
                <a className="text-slate-600 hover:text-slate-900 transition font-medium" href="#"> Careers </a>
              </li>

              <li>
                <a className="text-slate-600 hover:text-slate-900 transition font-medium" href="#"> History </a>
              </li>

              <li>
                <a className="text-slate-600 hover:text-slate-900 transition font-medium" href="#"> Services </a>
              </li>

              <li>
                <a className="text-slate-600 hover:text-slate-900 transition font-medium" href="#"> Projects </a>
              </li>
            </ul>
          </nav>

          <div className="flex items-center gap-4">
            {!isLoading && (
              user ? (
                <a 
                  href="/dashboard" 
                  className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 text-sm font-semibold transition shadow-sm hover:shadow"
                >
                  Go to Dashboard
                </a>
              ) : (
                <div className="sm:flex sm:gap-4">
                  <div className="block rounded-md px-5 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-950 transition cursor-pointer">
                    <LoginLink postLoginRedirectURL="/dashboard"> Login</LoginLink>
                  </div>

                  <div className="hidden rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 text-sm font-medium transition shadow-sm hover:shadow md:block">
                    <RegisterLink>Register</RegisterLink>  
                  </div>
                </div>
              )
            )}

            {isLoading && (
              <div className="h-10 w-28 bg-slate-100 animate-pulse rounded-xl" />
            )}

            <button
              className="block rounded bg-slate-100 p-2.5 text-slate-600 transition hover:text-slate-900 md:hidden"
            >
              <span className="sr-only">Toggle menu</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header