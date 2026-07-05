import { FileListContext } from '@/app/_context/FilesListContext'
import { useKindeBrowserClient } from '@kinde-oss/kinde-auth-nextjs';
import { Archive, MoreHorizontal, Edit2, FileText, ArrowLeftRight } from 'lucide-react';
import moment from 'moment';
import Image from 'next/image';
import React, { useContext, useEffect, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useRouter } from 'next/navigation';
import { useConvex, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ActiveTeamContext } from '@/app/_context/ActiveTeamContext';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export interface FILE {
  archive: boolean,
  createdBy: string,
  document: string,
  fileName: string,
  teamId: string,
  whiteboard: string,
  _id: string,
  _creationTime: number
}

function FileList() {
  const { fileList_, setFileList_, activeTab } = useContext(FileListContext);
  const { activeTeam } = useContext(ActiveTeamContext);
  const { user }: any = useKindeBrowserClient();
  const router = useRouter();
  const convex = useConvex();

  const archiveFile = useMutation(api.files.archiveFile);
  const updateFileName = useMutation(api.files.updateFileName);

  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [fileToRename, setFileForRename] = useState<FILE | null>(null);

  const getFiles = async () => {
    if (activeTeam?._id) {
      const result = await convex.query(api.files.getFiles, { teamId: activeTeam._id as string });
      setFileList_(result);
    }
  }

  const handleRenameSubmit = async () => {
    if (!fileToRename) return;
    const trimmed = renameInput.trim();
    if (!trimmed) {
      toast.error('File name cannot be empty');
      return;
    }

    try {
      await updateFileName({
        _id: fileToRename._id as any,
        fileName: trimmed
      });
      toast.success('File renamed successfully!');
      setIsRenameDialogOpen(false);
      getFiles(); // Refetch file list
    } catch (error) {
      console.error(error);
      toast.error('Failed to rename file');
    }
  };

  const handleArchiveToggle = async (file: FILE) => {
    const isArchiving = !file.archive;
    try {
      await archiveFile({
        _id: file._id as any,
        archive: isArchiving
      });
      toast.success(isArchiving ? 'File archived successfully!' : 'File restored successfully!');
      getFiles(); // Refetch file list
    } catch (error) {
      console.error(error);
      toast.error(isArchiving ? 'Failed to archive file' : 'Failed to restore file');
    }
  };

  // Filter files based on whether activeTab is 'archive'
  const filteredFiles = fileList_?.filter((file: FILE) => {
    if (activeTab === 'archive') {
      return file.archive === true;
    }
    return file.archive !== true;
  });

  return (
    <div className='mt-10'>
      <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm">
        <table className="min-w-full divide-y divide-gray-100 dark:divide-zinc-800 bg-white dark:bg-zinc-950 text-sm">
          <thead>
            <tr className="bg-slate-50/50 dark:bg-zinc-900/40">
              <th className="whitespace-nowrap px-6 py-3 text-left font-semibold text-slate-700 dark:text-zinc-300">File Name</th>
              <th className="whitespace-nowrap px-6 py-3 text-left font-semibold text-slate-700 dark:text-zinc-300">Created At</th>
              <th className="whitespace-nowrap px-6 py-3 text-left font-semibold text-slate-700 dark:text-zinc-300">Edited</th>
              <th className="whitespace-nowrap px-6 py-3 text-left font-semibold text-slate-700 dark:text-zinc-300">Author</th>
              <th className="whitespace-nowrap px-6 py-3 text-left font-semibold text-slate-700 dark:text-zinc-300 w-10"></th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
            {filteredFiles && filteredFiles.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-16 px-4">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <div className="p-4 bg-slate-50 dark:bg-zinc-900/40 rounded-full border border-slate-100 dark:border-zinc-800 text-slate-400 dark:text-zinc-500">
                      {activeTab === 'archive' ? (
                        <Archive className="h-8 w-8 text-slate-500" />
                      ) : (
                        <FileText className="h-8 w-8 text-slate-500" />
                      )}
                    </div>
                    <h3 className="text-base font-semibold text-slate-700 dark:text-zinc-300">
                      {activeTab === 'archive' ? 'No archived files' : 'No files found'}
                    </h3>
                    <p className="text-xs text-slate-400 dark:text-zinc-500 max-w-xs leading-relaxed">
                      {activeTab === 'archive' 
                        ? 'Files you archive will appear here. You can restore them anytime from this menu.' 
                        : 'Get started by creating a new file from the sidebar!'}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredFiles && filteredFiles.map((file: FILE, index: number) => (
                <tr 
                  key={index} 
                  className="hover:bg-slate-50/80 dark:hover:bg-zinc-900/30 cursor-pointer transition-all duration-150"
                  onClick={() => router.push('/workspace/' + file._id)}
                >
                  <td className="whitespace-nowrap px-6 py-4 font-semibold text-slate-800 dark:text-zinc-100">
                    <div className="flex items-center gap-2.5">
                      <FileText className="h-4 w-4 text-blue-500" />
                      <span>{file.fileName}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-slate-500 dark:text-zinc-400">
                    {moment(file._creationTime).format('DD MMM YYYY')}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-slate-500 dark:text-zinc-400">
                    {moment(file._creationTime).format('DD MMM YYYY')}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {user && (
                      <div className="flex items-center gap-2">
                        <Image 
                          src={user?.picture}
                          alt='user'
                          width={26}
                          height={26}
                          className='rounded-full border border-slate-100 dark:border-zinc-800'
                        />
                        <span className="text-xs text-slate-500 dark:text-zinc-400 font-medium">
                          {user?.given_name || 'Author'}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-900 text-slate-400 hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-300 transition-all">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 shadow-lg rounded-xl p-1 min-w-[140px]">
                        <DropdownMenuItem 
                          onClick={() => {
                            setFileForRename(file);
                            setRenameInput(file.fileName);
                            setIsRenameDialogOpen(true);
                          }}
                          className="gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-all text-xs font-medium"
                        >
                          <Edit2 className="h-3.5 w-3.5 text-slate-500" /> Rename File
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleArchiveToggle(file)}
                          className={`gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 transition-all text-xs font-medium ${
                            file.archive 
                              ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50/50 dark:text-emerald-400 dark:hover:bg-emerald-950/20' 
                              : 'text-rose-600 hover:text-rose-700 hover:bg-rose-50/50 dark:text-rose-400 dark:hover:bg-rose-950/20'
                          }`}
                        >
                          {file.archive ? (
                            <>
                              <ArrowLeftRight className="h-3.5 w-3.5" /> Restore File
                            </>
                          ) : (
                            <>
                              <Archive className="h-3.5 w-3.5" /> Archive File
                            </>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Rename Dialog */}
      <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-white max-w-sm rounded-2xl shadow-2xl p-6">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              Rename File
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-xs">
              Enter a new name for your file.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <Input 
              value={renameInput} 
              onChange={(e) => setRenameInput(e.target.value)}
              placeholder="File name"
              className="bg-zinc-800/80 border-zinc-700 text-white placeholder-zinc-500 focus:border-blue-500 text-sm h-10 rounded-lg"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameInput.trim().length > 0) {
                  handleRenameSubmit();
                }
              }}
            />
          </div>
          <DialogFooter className="mt-6 flex justify-end gap-2">
            <Button 
              variant="ghost" 
              onClick={() => setIsRenameDialogOpen(false)}
              className="text-zinc-400 hover:text-white hover:bg-zinc-800 text-xs h-9 px-4 rounded-lg"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleRenameSubmit}
              disabled={!renameInput || renameInput.trim().length === 0}
              className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white border-0 text-xs h-9 px-4 rounded-lg"
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default FileList