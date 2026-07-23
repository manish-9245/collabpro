import { Button } from '@/components/ui/button'
import { Archive, Flag, User, Settings, Bell, HelpCircle, Sparkles, Cpu, Server } from 'lucide-react'
import React, { useState, useContext } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { api, useQuery } from '@/lib/state-sync/react'
import { useSessionAuth } from '@/lib/session-auth/client'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from '@/components/ui/input'
import Constant from '@/app/_constant/Constant'
import PricingDialog from './PricingDialog'
import { FileListContext } from '@/app/_context/FilesListContext'

function SideNavBottomSection({onFileCreate,totalFiles}:any) {
  const { activeTab, setActiveTab, fileList_ } = useContext(FileListContext);
  const router = useRouter();
  const pathname = usePathname();
  const { user }: any = useSessionAuth();

  // Fetch pending invitations for this user
  const invitations = useQuery(api.notifications.getInvitations, user?.email ? { userEmail: user.email } : 'skip' as any);
  const pendingCount = invitations?.length || 0;

  const menuList = [
    {
      id: 1,
      name: 'Files',
      icon: Flag,
      path: '/dashboard',
      action: () => {
        setActiveTab && setActiveTab('all');
        router.push('/dashboard');
      },
      isActive: pathname === '/dashboard' && activeTab !== 'archive'
    },
    {
      id: 2,
      name: 'Profile',
      icon: User,
      path: '/dashboard/profile',
      action: () => {
        router.push('/dashboard/profile');
      },
      isActive: pathname === '/dashboard/profile'
    },
    {
      id: 3,
      name: 'Settings',
      icon: Settings,
      path: '/dashboard/settings',
      action: () => {
        router.push('/dashboard/settings');
      },
      isActive: pathname === '/dashboard/settings'
    },
    {
      id: 4,
      name: 'Notifications',
      icon: Bell,
      path: '/dashboard/notifications',
      action: () => {
        router.push('/dashboard/notifications');
      },
      isActive: pathname === '/dashboard/notifications',
      badge: pendingCount > 0 ? pendingCount : null
    },
    {
      id: 5,
      name: 'Help Center',
      icon: HelpCircle,
      path: '/dashboard/help',
      action: () => {
        router.push('/dashboard/help');
      },
      isActive: pathname === '/dashboard/help'
    },
    {
      id: 6,
      name: 'Archive',
      icon: Archive,
      path: '/dashboard',
      action: () => {
        setActiveTab && setActiveTab('archive');
        router.push('/dashboard');
      },
      isActive: pathname === '/dashboard' && activeTab === 'archive'
    },
    {
      id: 7,
      name: 'Developer Hub',
      icon: Cpu,
      path: '/dashboard/developers',
      action: () => {
        router.push('/dashboard/developers');
      },
      isActive: pathname === '/dashboard/developers'
    },
    {
      id: 8,
      name: 'MCP Settings',
      icon: Server,
      path: '/dashboard/settings/mcp',
      action: () => {
        router.push('/dashboard/settings/mcp');
      },
      isActive: pathname === '/dashboard/settings/mcp'
    },
    {
      id: 9,
      name: 'AI Setup',
      icon: Sparkles,
      path: '/dashboard/settings/ai',
      action: () => {
        router.push('/dashboard/settings/ai');
      },
      isActive: pathname === '/dashboard/settings/ai'
    }
  ]

  const [fileInput,setFileInput]=useState('');
  const [folderInput,setFolderInput]=useState('');

  const folders = Array.from(new Set(fileList_?.filter((f: any) => f.folder).map((f: any) => f.folder))) as string[];

  return (
    <div>
      {menuList.map((menu,index)=>(
        <div 
          key={index} 
          onClick={menu.action}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); menu.action(); } }}
          className={`flex gap-2 p-2 px-3 text-[14px] rounded-lg cursor-pointer transition-all duration-150 items-center justify-between mb-1 ${
            menu.isActive
              ? 'bg-blue-50 text-blue-600 font-semibold dark:bg-blue-950/40 dark:text-blue-400'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900'
          }`}
        >
          <div className="flex items-center gap-2">
            <menu.icon className={`h-5 w-5 ${
              menu.isActive
                ? 'text-blue-500'
                : 'text-zinc-500'
            }`}/>
            {menu.name}
          </div>
          {menu.badge !== undefined && menu.badge !== null && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm animate-pulse">
              {menu.badge}
            </span>
          )}
        </div>
      ))}

      {/* Add New File Button  */}
      <Dialog>
  <DialogTrigger className='w-full' asChild>
  <Button className='w-full bg-blue-600 
      hover:bg-blue-700 justify-start mt-3'>New File</Button>
  </DialogTrigger>
  <DialogContent className="bg-zinc-950 border border-zinc-800 text-white">
    <DialogHeader>
      <DialogTitle className="text-xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">Create New File</DialogTitle>
      <DialogDescription className="text-zinc-400">
          <Input 
            name="filename"
            autoComplete="off"
            placeholder="Enter file name… (e.g. Q3 Roadmap)" 
            className='mt-3 bg-zinc-900/80 border-zinc-800 text-white placeholder-zinc-500 focus:border-blue-500'
            onChange={(e)=>setFileInput(e.target.value)}
          />
          
          <Input 
            name="foldername"
            autoComplete="off"
            placeholder="Enter folder name… (e.g. Design)" 
            list='existing-folders'
            className='mt-3 bg-zinc-900/80 border-zinc-800 text-white placeholder-zinc-500 focus:border-blue-500'
            onChange={(e)=>setFolderInput(e.target.value)}
            value={folderInput}
          />
          <datalist id='existing-folders'>
            {folders.map(folder => (
              <option key={folder} value={folder} />
            ))}
          </datalist>
      </DialogDescription>
    </DialogHeader>
    <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button type="button" 
            className='bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white border-0'
            disabled={!(fileInput && fileInput.trim().length > 0)}
            onClick={() => {
              onFileCreate(fileInput, folderInput.trim() || undefined);
              setFileInput('');
              setFolderInput('');
            }}
            >
              Create File
            </Button>
          </DialogClose>
        </DialogFooter>
  </DialogContent>
</Dialog>

     
      
      {/* Progress Bar - Redesigned for Premium Unlimited */}
      <div className='h-2 w-full bg-zinc-900 rounded-full mt-6 border border-zinc-800 relative overflow-hidden'>
          <div className='h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 rounded-full w-full' />
      </div>

      <h2 className='text-[12px] mt-3 text-zinc-400'>
        <strong>{totalFiles}</strong> documents created</h2>
      <h2 className='text-[12px] mt-1 text-emerald-400 font-medium flex items-center gap-1.5'>
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        Self-Hosted Premium — Unlimited Access
      </h2>  

     </div>
  )
}

export default SideNavBottomSection