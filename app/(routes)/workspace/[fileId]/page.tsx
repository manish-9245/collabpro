"use client"
import React, { useEffect, useState } from 'react'
import WorkspaceHeader from '../_components/WorkspaceHeader'
import { useConvex } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { FILE } from '../../dashboard/_components/FileList';
import dynamic from 'next/dynamic';

const Editor = dynamic(() => import('../_components/Editor'), { ssr: false });
const Canvas = dynamic(() => import('../_components/Canvas'), { ssr: false });

function Workspace({params}:any) {
   const [triggerSave,setTriggerSave]=useState(false);
   const convex=useConvex();
   const [fileData,setFileData]=useState<FILE|any>();
   const [viewMode,setViewMode]=useState<'both'|'document'|'canvas'>('both');
   const [savingStatus,setSavingStatus]=useState<'idle'|'saving'|'saved'>('idle');

   useEffect(()=>{
    console.log("FILEID",params.fileId)
    params.fileId&&getFileData();
   },[])

   const getFileData=async()=>{
    const result=await convex.query(api.files.getFileById,{_id:params.fileId})
    setFileData(result);
  }
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <WorkspaceHeader 
        fileData={fileData} 
        onSave={()=>setTriggerSave(!triggerSave)} 
        onRename={(newName: string) => setFileData((prev: any) => prev ? { ...prev, fileName: newName } : prev)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        savingStatus={savingStatus}
      />

      {/* Workspace Layout  */}
      <div className={`flex-1 grid grid-cols-1 ${viewMode === 'both' ? 'md:grid-cols-2' : 'grid-cols-1'} overflow-hidden`}>
        {/* Document  */}
          <div className={`h-full overflow-y-auto ${viewMode === 'canvas' ? 'hidden' : 'block'}`}>
            <Editor onSaveTrigger={triggerSave}
            fileId={params.fileId}
            fileData={fileData}
            setSavingStatus={setSavingStatus}
            />
          </div>
        {/* Whiteboard/canvas  */}
        <div className={`h-full border-l border-slate-200 dark:border-slate-800 ${viewMode === 'document' ? 'hidden' : 'block'}`}>
            <Canvas
             onSaveTrigger={triggerSave}
             fileId={params.fileId}
             fileData={fileData}
             setSavingStatus={setSavingStatus}
             />
        </div>
      </div>
    </div>
  )
}

export default Workspace