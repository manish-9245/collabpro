"use client"
import { api } from '@/convex/_generated/api';
import { useSessionAuth } from '@/lib/session-auth/client';
import { useConvex } from 'convex/react';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react'
import SideNav from './_components/SideNav';
import { FileListContext } from '@/app/_context/FilesListContext';

import { ActiveTeamContext } from '@/app/_context/ActiveTeamContext';

function DashboardLayout(
    {
        children,
      }: Readonly<{
        children: React.ReactNode;
      }>
) {
    const convex=useConvex();
    const {user}:any=useSessionAuth();
    const [fileList_,setFileList_]=useState();
    const [activeTeam,setActiveTeam]=useState<any>();
    const [activeTab,setActiveTab]=useState<string>('all');
    const [fileScope,setFileScope]=useState<string>('team');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const router=useRouter();
    useEffect(()=>{
        user&&checkTeam();
    },[user])

    const checkTeam=async()=>{
        const result=await convex.query(api.teams.getTeam,
            {email:user?.email});

        if(!result?.length)
        {
            router.push('teams/create')
        }
    }

  return (
    <div>
      <ActiveTeamContext.Provider value={{activeTeam,setActiveTeam}}>
      <FileListContext.Provider value={{fileList_,setFileList_,activeTab,setActiveTab,fileScope,setFileScope,searchQuery,setSearchQuery}}>
      <div className='grid grid-cols-4'>
          <div className='bg-white h-screen w-72 fixed'>
          <SideNav/>
          </div>
          <div className='col-span-4 ml-72'>
          {children}
          </div>
      </div>
      </FileListContext.Provider>
      </ActiveTeamContext.Provider>
     
      </div>
  )
}

export default DashboardLayout