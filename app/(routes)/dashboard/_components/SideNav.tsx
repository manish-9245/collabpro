import { Archive, ChevronDown, Flag } from 'lucide-react'
import Image from 'next/image'
import React, { useContext, useEffect, useState } from 'react'
import SideNavTopSection, { TEAM } from './SideNavTopSection'
import { useSessionAuth } from '@/lib/session-auth/client'
import SideNavBottomSection from './SideNavBottomSection'
import { api, useSync, useMutation } from '@/lib/state-sync/react'
import { toast } from 'sonner'
import { FileListContext } from '@/app/_context/FilesListContext'
import { ActiveTeamContext } from '@/app/_context/ActiveTeamContext'


function SideNav() {
  const {user}:any=useSessionAuth();
  const createFile=useMutation(api.files.createFile);
  const {activeTeam,setActiveTeam}=useContext(ActiveTeamContext);
  const sync=useSync();
  const [totalFiles,setTotalFiles]=useState<Number>();
  const {fileList_,setFileList_,fileScope}=useContext(FileListContext);
  useEffect(()=>{
    activeTeam&&getFiles();
  },[activeTeam?._id, fileScope])
  const onFileCreate=(fileName:string, folder?: string)=>{
    console.log(fileName, folder)
    createFile({
      fileName:fileName,
      teamId:activeTeam?._id,
      createdBy:user?.email,
      archive:false,
      document:'',
      whiteboard:'',
      folder: folder || undefined
    }).then(resp=>{
      if(resp)
      {
        getFiles();
        toast('File created successfully!')
      }
    },(e)=>{
      toast('Error while creating file')

    })
  }

  const getFiles=async()=>{
    const result=await sync.query(api.files.getFiles,{
      teamId:activeTeam?._id,
      userEmail:user?.email,
      scope:fileScope,
      // Server-clamped max page size (see fileService.ts) - this sidebar
      // count/list doesn't implement load-more yet, so without an explicit
      // `take` a team with 51+ files would silently lose everything past
      // the default page of 50.
      take: 100
    });
    // files:getFiles now returns { items, nextCursor } (Issue 190).
    const items = result?.items ?? [];
    console.log(items);
    setFileList_(items);
    setTotalFiles(items.length)
  }

  return (
    <div
    className=' h-screen 
    fixed w-72 borde-r border-[1px] p-6
    flex flex-col
    '
    >
      <div className='flex-1'>
      <SideNavTopSection user={user} 
      setActiveTeamInfo={(activeTeam:TEAM)=>setActiveTeam(activeTeam)}/>
      </div>
    
     <div>
      <SideNavBottomSection
      totalFiles={totalFiles}
      onFileCreate={onFileCreate}
      />
     </div>
    </div>
  )
}

export default SideNav