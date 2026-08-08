"use client"

import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  X,
  Send,
  Settings as SettingsIcon,
  Trash2,
  Zap,
  AlertTriangle
} from 'lucide-react';
import Link from 'next/link';
import { api, useQuery, useMutation } from '@/lib/state-sync/react';

interface AiSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  fileData: any;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

const MAX_TEXTAREA_HEIGHT = 120;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

/**
 * Tool-call action markers (⚡ succeeded / ⚠️ failed) are streamed inline as
 * plain "\n\n"-separated blocks by app/api/ai/chat/route.ts's `emit()` -
 * the raw emoji prefix is only ever a parsing signal (and what's actually
 * persisted in already-existing history rows); the rendered pill below uses
 * real lucide icons instead of displaying the emoji character itself.
 * Rendered as a distinct pill instead of plain text so an action taken on
 * the file is visually distinguishable from the model's prose at a glance -
 * the actual point of "the AI can take actions, not just chat".
 */
function renderMessageContent(content: string) {
  return content
    .split(/\n\n+/)
    .filter((block) => block.trim())
    .map((block, i) => {
      const trimmed = block.trim();
      const isWarning = trimmed.startsWith('⚠️');
      const isAction = isWarning || trimmed.startsWith('⚡');
      if (isAction) {
        const text = trimmed.replace(/^(⚡|⚠️)\s*/, '');
        const Icon = isWarning ? AlertTriangle : Zap;
        return (
          <div
            key={i}
            className={`${i > 0 ? 'mt-2' : ''} inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-semibold leading-relaxed ${
              isWarning
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                : 'bg-[#6965db]/10 text-[#6965db] dark:text-[#8572e3]'
            }`}
          >
            <Icon className="h-3 w-3 shrink-0" strokeWidth={2.5} />
            <span>{text}</span>
          </div>
        );
      }
      return (
        <p key={i} className={`whitespace-pre-line ${i > 0 ? 'mt-2' : ''}`}>
          {block}
        </p>
      );
    });
}

/**
 * Real AI chat sidebar, backed by app/api/ai/chat/route.ts (streaming) and
 * the chat:getMessages/ai:getSettings state-sync RPCs (persisted history,
 * per-file-per-user - each collaborator gets their own conversation about
 * this file). No fallback to canned responses when no team AI key is
 * configured - the disabled state below is explicit about why, not silent.
 */
export default function AiSidebar({ isOpen, onClose, fileId, fileData }: AiSidebarProps) {
  const teamId = fileData?.teamId;
  const history = useQuery(api.chat.getMessages, fileId ? { fileId } : 'skip' as any);
  const aiSettings = useQuery(api.ai.getSettings, teamId ? { teamId } : 'skip' as any);
  const clearHistoryMutation = useMutation(api.chat.clearHistory);

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Locks out server->local syncing once the user has actually sent a
  // message in THIS session, so a later poll/WS refresh of `history`
  // doesn't clobber an in-flight optimistic send. Keyed by whether the user
  // has sent, not by whether `history` has ever been an array - `history`
  // legitimately IS an array (possibly empty) before the real server data
  // arrives (e.g. mid-WS-subscribe), and locking on that first, still-
  // catching-up value permanently ignored the real data that landed a
  // moment later.
  const hasSentLocally = useRef(false);

  useEffect(() => {
    hasSentLocally.current = false;
  }, [fileId]);

  useEffect(() => {
    if (!hasSentLocally.current && Array.isArray(history)) {
      setMessages(history.map((m: any) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })));
    }
  }, [history]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [input]);

  const noAiConfigured = aiSettings !== undefined && aiSettings === null;

  const handleSend = async (textToSend: string) => {
    if (!textToSend.trim() || isSending || noAiConfigured) return;

    hasSentLocally.current = true;

    const userMsg: Message = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: textToSend,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setErrorText(null);
    setIsSending(true);
    setStreamingText('');

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, message: textToSend }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setErrorText(body?.message || `AI request failed (${res.status})`);
        setStreamingText(null);
        setIsSending(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setStreamingText(full);
      }

      setMessages((prev) => [...prev, { id: `local-${Date.now()}-ai`, role: 'assistant', content: full, createdAt: new Date().toISOString() }]);
      setStreamingText(null);
    } catch {
      setErrorText('Lost connection to the AI service. Please try again.');
      setStreamingText(null);
    } finally {
      setIsSending(false);
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm('Clear this conversation? This can\'t be undone.')) return;
    try {
      await clearHistoryMutation({ fileId });
      setMessages([]);
      hasSentLocally.current = false;
    } catch {
      setErrorText('Failed to clear the conversation. Please try again.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="w-80 h-full bg-white dark:bg-slate-950 border-l border-slate-200/60 dark:border-slate-800/80 flex flex-col shrink-0 relative z-[100] font-sans">

      {/* Sidebar Header */}
      <div className="px-4 py-3.5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#6965db] animate-pulse" />
          <div>
            <div className="text-[10px] font-bold text-slate-800 dark:text-slate-100">Co-Pilot Workspace</div>
            {aiSettings?.model && (
              <div className="text-[8px] text-[#6965db] font-black uppercase tracking-wider mt-0.5 flex items-center gap-1">
                Active: {aiSettings.model} <span className="h-1 w-1 bg-emerald-500 rounded-full animate-ping" />
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {messages.length > 0 && (
            <button
              onClick={handleClearHistory}
              title="Clear conversation"
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-400 dark:text-slate-500 hover:text-rose-500 cursor-pointer transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            title="Close"
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-400 dark:text-slate-500 hover:text-slate-600 cursor-pointer transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {noAiConfigured ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#6965db]/15 to-[#8572e3]/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-[#6965db]" />
          </div>
          <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Co-Pilot isn't set up yet</div>
          <p className="text-[9.5px] text-slate-400 dark:text-slate-500 leading-relaxed max-w-[220px]">
            Ask a team owner to add an AI provider in Settings → AI to start using it here.
          </p>
          <Link
            href="/dashboard/settings/ai"
            className="mt-1 px-3 py-1.5 bg-[#6965db]/10 hover:bg-[#6965db] hover:text-white text-[#6965db] dark:text-[#8572e3] text-[9px] font-black uppercase tracking-wider rounded-lg flex items-center gap-1.5 transition-all"
          >
            <SettingsIcon className="h-3 w-3" /> Go to Settings → AI
          </Link>
        </div>
      ) : (
        <>
          {/* Messages Scroll Panel */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 bg-slate-50/20">
            {messages.length === 0 && streamingText === null && (
              <div className="text-[9.5px] text-slate-400 dark:text-slate-500 text-center pt-8 leading-relaxed">
                Ask about this file's document or whiteboard content.
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col animate-in fade-in slide-in-from-bottom-1 duration-200 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div className={`max-w-[85%] rounded-2xl p-3 text-[10px] leading-relaxed shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-[#6965db] text-white rounded-br-none font-medium'
                    : 'bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-bl-none'
                }`}>
                  <div className="font-sans">
                    {renderMessageContent(msg.content)}
                  </div>
                </div>
                <span className="text-[8px] text-slate-400 dark:text-slate-500 mt-1 px-1">{formatTimestamp(msg.createdAt)}</span>
              </div>
            ))}

            {streamingText !== null && (
              <div className="flex flex-col items-start animate-in fade-in slide-in-from-bottom-1 duration-200">
                <div className="max-w-[85%] rounded-2xl rounded-bl-none p-3 text-[10px] leading-relaxed shadow-sm bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                  <div className="font-sans">
                    {streamingText && renderMessageContent(streamingText)}
                    {isSending && (
                      <span className={`inline-flex items-center gap-1 ${streamingText ? 'mt-1.5' : ''}`}>
                        <span className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                        <span className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-pulse" style={{ animationDelay: '200ms' }} />
                        <span className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-pulse" style={{ animationDelay: '400ms' }} />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {errorText && (
              <div className="text-[9px] text-rose-500 bg-rose-50 dark:bg-rose-950/30 border border-rose-200/50 dark:border-rose-900/40 rounded-lg p-2.5">
                {errorText}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input controls footer */}
          <div className="p-3.5 border-t border-slate-100 dark:border-slate-800/80 shrink-0 bg-slate-50/30">
            <div className="flex items-end gap-2 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 rounded-xl px-3 py-2 shadow-xs focus-within:border-[#6965db]/80">
              <textarea
                ref={textareaRef}
                rows={1}
                placeholder="Ask your AI companion... (Shift+Enter for a new line)"
                value={input}
                disabled={isSending}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(input);
                  }
                }}
                className="flex-1 resize-none bg-transparent border-0 focus:outline-none focus:ring-0 text-[10px] leading-relaxed text-slate-700 dark:text-slate-200 placeholder-slate-400 disabled:opacity-50"
                style={{ maxHeight: MAX_TEXTAREA_HEIGHT }}
              />
              <button
                type="button"
                onClick={() => handleSend(input)}
                disabled={isSending || !input.trim()}
                className="shrink-0 p-1.5 rounded-lg bg-[#6965db] hover:bg-[#5753c9] text-white cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
