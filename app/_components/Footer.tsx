import React from 'react';

export default function Footer() {
  return (
    <footer className="bg-white border-t border-slate-100 py-8 text-center text-xs text-slate-400 mt-auto w-full">
      <div className="max-w-screen-xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p>© {new Date().getFullYear()} CollabPro. All sovereign rights reserved.</p>
        <div className="flex gap-6">
          <a href="/releases" className="hover:text-slate-600 transition">Changelog</a>
          <a href="/#blueprint" className="hover:text-slate-600 transition">Features</a>
        </div>
      </div>
    </footer>
  );
}
