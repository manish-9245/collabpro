"use client"
import React, { useEffect, useState } from 'react'
import WorkspaceHeader from '../_components/WorkspaceHeader'
import { api, useMutation, useQuery, useCursors } from '@/lib/state-sync/react';
import { FILE } from '../../dashboard/_components/FileList';
import { Loader2, Sparkles } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useSessionAuth } from '@/lib/session-auth/client';
import AiSidebar from '../_components/AiSidebar';

const Editor = dynamic(() => import('../_components/Editor'), { ssr: false });
const Canvas = dynamic(() => import('../_components/Canvas'), { ssr: false });

function Workspace({params}:any) {
   const [triggerSave,setTriggerSave]=useState(false);
   const [viewMode,setViewMode]=useState<'both'|'document'|'canvas'>('both');
   const [savingStatus,setSavingStatus]=useState<'idle'|'saving'|'saved'>('idle');
   const [isAiOpen, setIsAiOpen] = useState(false);

   // Coordination for Undo/Redo
   const [splitPct, setSplitPct] = useState(50);
   const [activePanel, setActivePanel] = useState<'document' | 'canvas'>('document');
   const [canUndo, setCanUndo] = useState(false);
   const [canRedo, setCanRedo] = useState(false);
   const [undoTrigger, setUndoTrigger] = useState(0);
   const [redoTrigger, setRedoTrigger] = useState(0);
   const { user } = useSessionAuth();
   const { cursors, broadcastCursor } = useCursors();

   // Fallback split view to single panel on mobile/tablet viewports
   useEffect(() => {
     const handleResize = () => {
       if (typeof window !== 'undefined' && window.innerWidth < 768 && viewMode === 'both') {
         setViewMode('document');
       }
     };
     handleResize();
     window.addEventListener('resize', handleResize);
     return () => window.removeEventListener('resize', handleResize);
   }, [viewMode]);
   
   const upsertPresence = useMutation(api.files.upsertPresence);
   const clearPresence = useMutation(api.files.clearPresence);

   // Subscribe to file updates in real-time (polls behind the scenes in mock client)
   const fileData = useQuery(api.files.getFileById, params?.fileId ? { _id: params.fileId } : 'skip' as any);

   const getPresenceStatus = (): string => {
    if (viewMode === 'document') return 'Editing document';
    if (viewMode === 'canvas') return 'Designing canvas';
    return activePanel === 'canvas' ? 'Collaborating on canvas' : 'Collaborating on document';
   };

   const getPresenceColor = (email: string): string => {
    const palette = ['#2563eb', '#7c3aed', '#0ea5e9', '#14b8a6', '#f97316', '#ec4899', '#10b981', '#f59e0b'];
    const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return palette[hash % palette.length];
   };

   const handlePointerMove = (e: React.PointerEvent) => {
     if (!user?.email) return;
     const rect = e.currentTarget.getBoundingClientRect();
     const x = ((e.clientX - rect.left) / rect.width) * 100;
     const y = ((e.clientY - rect.top) / rect.height) * 100;
     broadcastCursor(
       x,
       y,
       user.given_name || user.email.split('@')[0] || 'Collaborator',
       getPresenceColor(user.email),
       activePanel === 'canvas'
     );
   };

   useEffect(() => {
    if (!params?.fileId || !user?.email) return;

    const heartbeat = async () => {
      try {
        await upsertPresence({
          fileId: params.fileId,
          userEmail: user.email,
          userName: user.given_name || user.email.split('@')[0] || 'Collaborator',
          userImage: user.picture || '',
          userColor: getPresenceColor(user.email),
          workspaceStatus: getPresenceStatus(),
        });
      } catch (error) {
        console.error('Failed to update presence heartbeat:', error);
      }
    };

    heartbeat();
    const interval = setInterval(heartbeat, 5000);

    return () => {
      clearInterval(interval);
    };
   }, [params?.fileId, user?.email, user?.given_name, user?.picture, viewMode, activePanel]);

   useEffect(() => {
    if (!params?.fileId || !user?.email) return;

    const clearOnExit = () => {
      clearPresence({ fileId: params.fileId, userEmail: user.email }).catch(() => {});
    };

    window.addEventListener('beforeunload', clearOnExit);

    return () => {
      window.removeEventListener('beforeunload', clearOnExit);
      clearOnExit();
    };
   }, [params?.fileId, user?.email]);

   useEffect(() => {
     if (activePanel === 'canvas') {
       // Canvas (Excalidraw) always has history actions available internally
       setCanUndo(true);
       setCanRedo(true);
     }
   }, [activePanel]);

   const handleEditorHistoryChange = (undoable: boolean, redoable: boolean) => {
     if (activePanel === 'document') {
       setCanUndo(undoable);
       setCanRedo(redoable);
     }
   };

   // Render loading state while fileData is fetching/resolving
   if (fileData === undefined) {
     return (
       <div className="h-screen w-screen flex flex-col items-center justify-center bg-white dark:bg-slate-950">
         <div className="flex flex-col items-center gap-4">
           <Loader2 className="h-10 w-10 animate-spin text-blue-600 dark:text-blue-400" />
           <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Loading your CollabPro workspace...</p>
         </div>
       </div>
     );
   }

   return (
     <div className="h-screen flex flex-col overflow-hidden">
       <WorkspaceHeader 
         fileData={fileData} 
         onSave={()=>setTriggerSave(!triggerSave)} 
         onRename={(newName: string) => {}} // Name updates dynamically via useQuery
         viewMode={viewMode}
         onViewModeChange={setViewMode}
         savingStatus={savingStatus}
         onUndo={() => setUndoTrigger(prev => prev + 1)}
         onRedo={() => setRedoTrigger(prev => prev + 1)}
         canUndo={canUndo}
         canRedo={canRedo}
       />

        {/* Workspace Layout */}
        <div 
          className="flex-1 flex overflow-hidden w-full relative"
          onPointerMove={handlePointerMove}
        >
          {/* Multiplayer Cursor Layers */}
          {Object.values(cursors).map((cursor) => {
            if (cursor.email === user?.email) return null; // Don't render own cursor
            return (
              <div
                key={cursor.email}
                style={{
                  left: `${cursor.x}%`,
                  top: `${cursor.y}%`,
                  transition: 'all 0.08s cubic-bezier(0.25, 1, 0.5, 1)', // Smooth animation easing
                }}
                className="absolute pointer-events-none z-[9999] flex flex-col items-start gap-1"
              >
                {/* Sleek SVG Mouse Cursor Arrow */}
                <svg
                  className="w-5 h-5 drop-shadow-md"
                  viewBox="0 0 24 24"
                  fill={cursor.color}
                  stroke="white"
                  strokeWidth="2"
                >
                  <path d="M5.653 2.5a.75.75 0 00-.73 1.05l7.5 18a.75.75 0 001.378-.057l3.076-7.382 7.042-2.113a.75.75 0 00-.02-1.428l-17.5-8a.75.75 0 00-.746-.07z" />
                </svg>
                {/* Sleek Cursor Name Tag */}
                <div
                  style={{ backgroundColor: cursor.color }}
                  className="px-2 py-0.5 rounded-full text-[10px] text-white font-semibold shadow-md whitespace-nowrap animate-in zoom-in-50 duration-200"
                >
                  {cursor.name} {cursor.isCanvas ? '🎨' : '📝'}
                </div>
              </div>
            );
          })}

          {/* Document Panel */}
          <div 
            style={{ 
              width: viewMode === 'both' ? `${splitPct}%` : viewMode === 'document' ? '100%' : '0%',
              display: viewMode === 'canvas' ? 'none' : 'block'
            }}
            className="h-full overflow-y-auto"
            onMouseDownCapture={() => setActivePanel('document')}
          >
            <Editor 
              onSaveTrigger={triggerSave}
              fileId={params.fileId}
              fileData={fileData}
              setSavingStatus={setSavingStatus}
              undoTrigger={undoTrigger}
              redoTrigger={redoTrigger}
              onHistoryChange={handleEditorHistoryChange}
              activePanel={activePanel}
            />
          </div>

          {/* Draggable Divider (Only in "both" view mode) */}
          {viewMode === 'both' && (
            <div
              className="w-1.5 h-full bg-slate-200 hover:bg-blue-500 cursor-col-resize transition-all duration-150 flex-shrink-0 relative z-50 flex items-center justify-center dark:bg-zinc-800 dark:hover:bg-blue-600"
              onMouseDown={(e) => {
                e.preventDefault();
                const handleMouseMove = (moveEvent: MouseEvent) => {
                  const newPct = (moveEvent.clientX / window.innerWidth) * 100;
                  if (newPct > 15 && newPct < 85) {
                    setSplitPct(newPct);
                  }
                };
                const handleMouseUp = () => {
                  window.removeEventListener('mousemove', handleMouseMove);
                  window.removeEventListener('mouseup', handleMouseUp);
                };
                window.addEventListener('mousemove', handleMouseMove);
                window.addEventListener('mouseup', handleMouseUp);
              }}
            >
              <div className="w-[2px] h-8 rounded-full bg-slate-400 dark:bg-zinc-500" />
            </div>
          )}

          {/* Whiteboard/Canvas Panel */}
          <div 
            style={{ 
              width: viewMode === 'both' ? `${100 - splitPct}%` : viewMode === 'canvas' ? '100%' : '0%',
              display: viewMode === 'document' ? 'none' : 'block'
            }}
            className="h-full border-l border-slate-200 dark:border-slate-800"
            onMouseDownCapture={() => setActivePanel('canvas')}
          >
            <Canvas
              onSaveTrigger={triggerSave}
              fileId={params.fileId}
              fileData={fileData}
              setSavingStatus={setSavingStatus}
              undoTrigger={undoTrigger}
              redoTrigger={redoTrigger}
              activePanel={activePanel}
            />
          </div>
        </div>

        {/* Floating AI Companion Trigger Button */}
        <button 
          type="button"
          onClick={() => setIsAiOpen(prev => !prev)}
          className="fixed bottom-20 right-6 z-50 h-10 w-10 bg-gradient-to-tr from-[#6965db] to-[#8572e3] text-white shadow-xl rounded-full flex items-center justify-center hover:scale-105 active:scale-95 cursor-pointer transition-all border border-[#6965db]/40 group"
          title="Toggle AI Co-Pilot Sidebar"
        >
          <Sparkles className="h-4.5 w-4.5 group-hover:rotate-12 transition-transform" />
        </button>

        <AiSidebar 
          isOpen={isAiOpen} 
          onClose={() => setIsAiOpen(false)} 
          fileId={params.fileId} 
          fileData={fileData} 
        />
     </div>
   )
}

export default Workspace