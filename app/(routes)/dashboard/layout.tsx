"use client"
import { api, useSync } from '@/lib/state-sync/react';
import { useSessionAuth } from '@/lib/session-auth/client';
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
    const sync=useSync();
    const {user}:any=useSessionAuth();
    const [fileList_,setFileList_]=useState();
    const [activeTeam,setActiveTeam]=useState<any>();
    const [activeTab,setActiveTab]=useState<string>('all');
    const [fileScope,setFileScope]=useState<string>('team');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const router=useRouter();
    useEffect(()=>{
        user?.email&&checkTeam();
    },[user?.email])

    const checkTeam=async()=>{
        const result=await sync.query(api.teams.getTeam,
            {email:user?.email});

        if(!result?.length)
        {
            router.push('/teams/create')
        }
    }

  return (
    <div>
      <ActiveTeamContext.Provider value={{activeTeam,setActiveTeam}}>
      <FileListContext.Provider value={{fileList_,setFileList_,activeTab,setActiveTab,fileScope,setFileScope,searchQuery,setSearchQuery}}>
      <div className='min-h-screen flex flex-col md:block'>
          {/* Mobile Top Navbar */}
          <div className='md:hidden flex items-center justify-between bg-white border-b px-6 py-4 sticky top-0 z-40 shadow-sm'>
              <div className='flex items-center gap-2'>
                  <span className='font-black text-xl text-blue-600 tracking-tight'>Collab<span className='text-gray-900'>Pro</span></span>
              </div>
              <button 
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  className='p-2 rounded-md hover:bg-gray-100 border text-lg font-bold'
                  aria-label='Toggle Sidebar'
              >
                  {isSidebarOpen ? '✕' : '☰'}
              </button>
          </div>

          {/* Sidebar container with drawer layout */}
          <div className={`
              bg-white h-screen w-72 fixed top-0 bottom-0 left-0 z-50 border-r transition-transform duration-300 ease-in-out
              md:translate-x-0
              ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}>
              <SideNav />
          </div>

          {/* Mobile Backdrop */}
          {isSidebarOpen && (
              <div 
                  onClick={() => setIsSidebarOpen(false)}
                  className='md:hidden fixed inset-0 bg-black/30 backdrop-blur-xs z-40 transition-opacity'
              />
          )}

          {/* Main Content Area */}
          <div className='flex-1 md:ml-72 min-h-screen bg-gray-50/50'>
              {children}
          </div>
      </div>
      </FileListContext.Provider>
      </ActiveTeamContext.Provider>
     
      </div>
  )
}

export default DashboardLayout