"use client"
import React, { useEffect, useState } from 'react'
import WorkspaceHeader from '../_components/WorkspaceHeader'
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { FILE } from '../../dashboard/_components/FileList';
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';

const Editor = dynamic(() => import('../_components/Editor'), { ssr: false });
const Canvas = dynamic(() => import('../_components/Canvas'), { ssr: false });

function Workspace({params}:any) {
   const [triggerSave,setTriggerSave]=useState(false);
   const [viewMode,setViewMode]=useState<'both'|'document'|'canvas'>('both');
   const [savingStatus,setSavingStatus]=useState<'idle'|'saving'|'saved'>('idle');

   // Coordination for Undo/Redo
   const [activePanel, setActivePanel] = useState<'document' | 'canvas'>('document');
   const [undoTrigger, setUndoTrigger] = useState(0);
   const [redoTrigger, setRedoTrigger] = useState(0);
   const [canUndo, setCanUndo] = useState(false);
   const [canRedo, setCanRedo] = useState(false);

   // Subscribe to file updates in real-time (polls behind the scenes in mock client)
   const fileData = useQuery(api.files.getFileById, params?.fileId ? { _id: params.fileId } : 'skip' as any);

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
 
       {/* Workspace Layout  */}
       <div className={`flex-1 grid grid-cols-1 ${viewMode === 'both' ? 'md:grid-cols-2' : 'grid-cols-1'} overflow-hidden`}>
         {/* Document Panel */}
         <div 
           className={`h-full overflow-y-auto ${viewMode === 'canvas' ? 'hidden' : 'block'}`}
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
         {/* Whiteboard/Canvas Panel */}
         <div 
           className={`h-full border-l border-slate-200 dark:border-slate-800 ${viewMode === 'document' ? 'hidden' : 'block'}`}
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
     </div>
   )
}

export default Workspace