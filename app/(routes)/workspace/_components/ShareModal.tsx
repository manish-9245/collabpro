import React, { useState, useEffect } from 'react';
import { X, Lock, Shield, Calendar, Copy, Check, Trash2, Key, Loader2, Link2, Eye, MessageSquare, Edit } from 'lucide-react';
import { toast } from 'sonner';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  fileName: string;
}

export default function ShareModal({ isOpen, onClose, fileId, fileName }: ShareModalProps) {
  const [activeTab, setActiveTab] = useState<'create' | 'active'>('create');
  const [role, setRole] = useState<'viewer' | 'commenter' | 'editor'>('viewer');
  
  // Password protection state
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  
  // Link expiration state
  const [useExpiration, setUseExpiration] = useState(false);
  const [expirationDate, setExpirationDate] = useState('');

  // Generated Link & Lists
  const [isCreating, setIsCreating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeLinks, setActiveLinks] = useState<any[]>([]);
  const [isLoadingLinks, setIsLoadingLinks] = useState(false);

  // Fetch active shared links
  const fetchActiveLinks = async () => {
    setIsLoadingLinks(true);
    try {
      const res = await fetch(`/api/share?fileId=${fileId}`);
      if (res.ok) {
        const json = await res.json();
        setActiveLinks(json.data || []);
      }
    } catch (err) {
      console.error('Failed to load sharing links:', err);
    } finally {
      setIsLoadingLinks(false);
    }
  };

  useEffect(() => {
    if (isOpen && fileId) {
      fetchActiveLinks();
      setGeneratedLink(null);
    }
  }, [isOpen, fileId]);

  if (!isOpen) return null;

  const handleCreateShareLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const payload = {
        fileId,
        role,
        password: usePassword ? password : null,
        expiresAt: useExpiration ? expirationDate : null
      };

      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const json = await res.json();
        const shareUrl = `${window.location.origin}/workspace/share/${json.data.id}`;
        setGeneratedLink(shareUrl);
        toast.success('Secure share link generated successfully!');
        fetchActiveLinks(); // Refresh lists
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to create share link');
      }
    } catch (err: any) {
      toast.error('An error occurred while creating sharing link');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeLink = async (sharedLinkId: string) => {
    try {
      const res = await fetch(`/api/share?sharedLinkId=${sharedLinkId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        toast.success('Sharing link revoked successfully');
        fetchActiveLinks();
      } else {
        toast.error('Failed to revoke link');
      }
    } catch (err) {
      toast.error('Failed to revoke link');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied sharing URL!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-md transition-opacity duration-300 animate-in fade-in"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/25">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/10 rounded-xl text-blue-600 dark:text-blue-400">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-zinc-100">Enterprise Access & Share</h2>
              <p className="text-[11px] text-slate-400 dark:text-zinc-400 font-medium truncate max-w-[280px]">
                Configuring access for <span className="font-semibold text-blue-500">{fileName}</span>
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 dark:text-zinc-400 hover:text-slate-600 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Custom Tabs */}
        <div className="flex border-b border-slate-100 dark:border-slate-800/80 p-1.5 bg-slate-50/30 dark:bg-slate-950/10">
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${activeTab === 'create' ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'}`}
          >
            Generate Shared Link
          </button>
          <button
            onClick={() => {
              setActiveTab('active');
              fetchActiveLinks();
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all relative ${activeTab === 'active' ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'}`}
          >
            Active Shared Links
            {activeLinks.length > 0 && (
              <span className="absolute top-1 right-2.5 px-1.5 py-0.5 bg-blue-600 text-white rounded-full text-[9px] font-extrabold animate-pulse">
                {activeLinks.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeTab === 'create' ? (
            <form onSubmit={handleCreateShareLink} className="space-y-5">
              
              {/* Scope/Role Selection */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-400">Collaborator Role Permission</label>
                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setRole('viewer')}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all text-center ${role === 'viewer' ? 'border-blue-500 bg-blue-50/20 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400' : 'border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-500 dark:text-zinc-400'}`}
                  >
                    <Eye className="h-4.5 w-4.5" />
                    <span className="text-xs font-bold">Viewer</span>
                    <span className="text-[9px] opacity-80 leading-tight font-medium">Read Only</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRole('commenter')}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all text-center ${role === 'commenter' ? 'border-blue-500 bg-blue-50/20 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400' : 'border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-500 dark:text-zinc-400'}`}
                  >
                    <MessageSquare className="h-4.5 w-4.5" />
                    <span className="text-xs font-bold">Commenter</span>
                    <span className="text-[9px] opacity-80 leading-tight font-medium">Leave feedback</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRole('editor')}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all text-center ${role === 'editor' ? 'border-blue-500 bg-blue-50/20 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400' : 'border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-500 dark:text-zinc-400'}`}
                  >
                    <Edit className="h-4.5 w-4.5" />
                    <span className="text-xs font-bold">Editor</span>
                    <span className="text-[9px] opacity-80 leading-tight font-medium">Edit Document</span>
                  </button>
                </div>
              </div>

              {/* Password Protection Toggle */}
              <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-800/50 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-slate-400 dark:text-zinc-400" />
                    <span className="text-xs font-bold text-slate-700 dark:text-zinc-200">Enable Password Access Lock</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={usePassword}
                    onChange={(e) => setUsePassword(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
                  />
                </div>

                {usePassword && (
                  <input
                    type="password"
                    required
                    placeholder="Enter secure link password… (e.g. secret123)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full text-xs font-medium px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-zinc-200"
                  />
                )}
              </div>

              {/* Expiration Date Toggle */}
              <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-800/50 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-slate-400 dark:text-zinc-400" />
                    <span className="text-xs font-bold text-slate-700 dark:text-zinc-200">Set Link Expiration Date</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={useExpiration}
                    onChange={(e) => setUseExpiration(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
                  />
                </div>

                {useExpiration && (
                  <input
                    type="date"
                    required
                    value={expirationDate}
                    onChange={(e) => setExpirationDate(e.target.value)}
                    className="w-full text-xs font-medium px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-zinc-200"
                  />
                )}
              </div>

              {/* Submit Button */}
              {!generatedLink && (
                <button
                  type="submit"
                  disabled={isCreating}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-500/15 active:scale-98 transition-all disabled:opacity-50"
                >
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  Generate Secure Share Link
                </button>
              )}

              {/* Newly Generated Share Link presentation */}
              {generatedLink && (
                <div className="p-4.5 bg-emerald-500/5 dark:bg-emerald-950/10 border border-emerald-500/25 dark:border-emerald-500/10 rounded-2xl space-y-3.5 animate-in slide-in-from-top duration-300">
                  <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-400">
                    <Check className="h-4.5 w-4.5 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[11px] font-bold block uppercase tracking-wider">Your Link Is Live!</span>
                      <span className="text-[10px] opacity-90 block leading-tight">Send this secure link to your collaborators. Access constraints are validated in real-time.</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 bg-white dark:bg-zinc-950/30 p-2.5 rounded-xl border border-emerald-100 dark:border-emerald-500/10 shadow-inner">
                    <code className="text-xs font-mono font-bold select-all break-all text-slate-800 dark:text-zinc-200 flex-1 leading-normal pl-1">
                      {generatedLink}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(generatedLink)}
                      className="p-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-1 transition-all"
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  
                  <button
                    type="button"
                    onClick={() => setGeneratedLink(null)}
                    className="text-[10px] text-slate-500 hover:text-slate-800 dark:text-zinc-400 hover:underline block font-semibold pl-1"
                  >
                    Generate another link
                  </button>
                </div>
              )}

            </form>
          ) : (
            <div className="space-y-3.5">
              {isLoadingLinks ? (
                <div className="flex flex-col items-center justify-center py-10 space-y-2">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                  <p className="text-xs font-semibold text-slate-400">Loading sharing channels…</p>
                </div>
              ) : activeLinks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center space-y-2.5">
                  <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-full text-slate-400">
                    <Link2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-700 dark:text-zinc-300">No Active Sharing Links</h3>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-400 max-w-[200px] leading-normal mx-auto">
                      Generate a sharing link from the first tab to open access for this document.
                    </p>
                  </div>
                </div>
              ) : (
                activeLinks.map((link) => {
                  const shareUrl = `${window.location.origin}/workspace/share/${link.id}`;
                  const isExpired = link.expiresAt && new Date(link.expiresAt) < new Date();
                  
                  return (
                    <div 
                      key={link.id} 
                      className={`p-4 border rounded-2xl flex items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-950/20 ${isExpired ? 'border-red-100 dark:border-red-900/10 opacity-70' : 'border-slate-100 dark:border-slate-800'}`}
                    >
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider ${link.role === 'editor' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/35 dark:text-blue-400' : link.role === 'commenter' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-400' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-zinc-300'}`}>
                            {link.role}
                          </span>
                          
                          {link.passwordHash && (
                            <span className="flex items-center gap-0.5 text-slate-400 dark:text-zinc-500" title="Password Protected">
                              <Lock className="h-3 w-3" />
                            </span>
                          )}

                          {isExpired && (
                            <span className="text-[9px] font-bold text-red-500 uppercase tracking-wide">
                              Expired
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono font-semibold text-slate-600 dark:text-zinc-300 truncate block">
                            .../workspace/share/{link.id.substring(0, 8)}
                          </span>
                        </div>

                        {link.expiresAt && !isExpired && (
                          <span className="text-[9px] text-slate-400 dark:text-zinc-400 font-medium block">
                            📅 Expires: {new Date(link.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => copyToClipboard(shareUrl)}
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-850 rounded-lg text-slate-400 hover:text-slate-600 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
                          title="Copy Link"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleRevokeLink(link.id)}
                          className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg text-slate-400 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400 transition-colors"
                          title="Revoke Sharing Link"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
