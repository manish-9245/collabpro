import { Button } from '@/components/ui/button'
import { Archive, Flag, Github } from 'lucide-react'
import React, { useState } from 'react'
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
function SideNavBottomSection({onFileCreate,totalFiles}:any) {
  const menuList=[
    {
      id:1,
      name:'Getting Started',
      icon:Flag,
      path:''
    },
    {
      id:2,
      name:'Github',
      icon:Github,
      path:''
    },
    {
      id:3,
      name:'Archive',
      icon:Archive,
      path:''
    }
  ]
  const [fileInput,setFileInput]=useState('');
  return (
    <div>
      {menuList.map((menu,index)=>(
        <h2 key={index} className='flex gap-2 p-1 px-2 text-[14px] 
        hover:bg-gray-100 rounded-md cursor-pointer'>
          <menu.icon className='h-5 w-5'/>
          {menu.name}</h2>
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
          <Input placeholder='Enter File Name' 
          className='mt-3 bg-zinc-900/80 border-zinc-800 text-white placeholder-zinc-500 focus:border-blue-500'
          onChange={(e)=>setFileInput(e.target.value)}
          />
      </DialogDescription>
    </DialogHeader>
    <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button type="button" 
            className='bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white border-0'
            disabled={!(fileInput && fileInput.trim().length > 0)}
            onClick={()=>onFileCreate(fileInput)}
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