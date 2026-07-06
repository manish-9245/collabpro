import { FileListContext } from '@/app/_context/FilesListContext'
import { useSessionAuth } from '@/lib/session-auth/client';
import { Archive, MoreHorizontal, Edit2, FileText, ArrowLeftRight, Trash2, Folder } from 'lucide-react';
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
import { useConvex, useMutation, useQuery } from 'convex/react';
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
  _creationTime: number,
  creatorName?: string,
  creatorImage?: string | null,
  teamName?: string | null
}

function FileList() {
  const { fileList_, setFileList_, activeTab, fileScope, setFileScope, searchQuery } = useContext(FileListContext);
  const { activeTeam } = useContext(ActiveTeamContext);
  const { user }: any = useSessionAuth();
  const router = useRouter();
  const convex = useConvex();

  const archiveFile = useMutation(api.files.archiveFile);
  const updateFileName = useMutation(api.files.updateFileName);
  const localUserList = useQuery(api.user.getUser, user?.email ? { email: user.email } : 'skip' as any);
  const localUser = localUserList && localUserList.length > 0 ? localUserList[0] : null;

  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [fileToRename, setFileForRename] = useState<FILE | null>(null);

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<FILE | null>(null);
  const deleteFile = useMutation(api.files.deleteFile);

  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [moveInput, setMoveInput] = useState('');
  const [fileToMove, setFileToMove] = useState<FILE | null>(null);
  const updateFileFolder = useMutation(api.files.updateFileFolder);

  const handleMoveSubmit = async () => {
    if (!fileToMove) return;
    try {
      await updateFileFolder({
        _id: fileToMove._id as any,
        folder: moveInput.trim() || undefined
      });
      toast.success('File folder updated successfully!');
      setIsMoveDialogOpen(false);
      getFiles(); // Refetch file list
    } catch (error) {
      console.error(error);
      toast.error('Failed to update folder');
    }
  };

  const handleDeleteSubmit = async () => {
    if (!fileToDelete) return;
    try {
      await deleteFile({
        _id: fileToDelete._id as any
      });
      toast.success('File deleted permanently!');
      setIsDeleteDialogOpen(false);
      getFiles(); // Refetch file list
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete file');
    }
  };

  const getFiles = async () => {
    if (activeTeam?._id) {
      const result = await convex.query(api.files.getFiles, { 
        teamId: activeTeam._id as string,
        userEmail: user?.email,
        scope: fileScope
      });
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
    if (searchQuery && !file.fileName.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (activeTab === 'archive') {
      return file.archive === true;
    }
    return file.archive !== true;
  });

  return (
    <div className='mt-10'>
      {/* Scope Filtering Segmented Tabs - Premium Design */}
      <div className="flex justify-between items-center mb-6 gap-4 flex-wrap">
        <div className="flex bg-slate-100/80 dark:bg-zinc-900/60 p-1 rounded-xl border border-slate-200/50 dark:border-zinc-800/80 shadow-inner">
          <button
            onClick={() => setFileScope && setFileScope('team')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center gap-2 ${
              fileScope === 'team' || !fileScope
                ? 'bg-white dark:bg-zinc-950 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/20 dark:border-zinc-800/30'
                : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            <span>Team Files</span>
          </button>
          
          <button
            onClick={() => setFileScope && setFileScope('personal')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center gap-2 ${
              fileScope === 'personal'
                ? 'bg-white dark:bg-zinc-950 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/20 dark:border-zinc-800/30'
                : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            <span>My Files</span>
          </button>

          <button
            onClick={() => setFileScope && setFileScope('org')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center gap-2 ${
              fileScope === 'org'
                ? 'bg-white dark:bg-zinc-950 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/20 dark:border-zinc-800/30'
                : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            <span>Organization Files</span>
          </button>
        </div>
        
        {/* Active tab label */}
        <div className="text-xs font-semibold text-slate-500 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-900/30 px-3 py-1.5 rounded-lg border border-slate-100 dark:border-zinc-800/50">
          Showing: <span className="text-blue-600 dark:text-blue-400 capitalize">{fileScope === 'org' ? 'All Org Teams' : fileScope === 'personal' ? 'My Files' : 'Team Files'}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm">
        <table className="min-w-full divide-y divide-gray-100 dark:divide-zinc-800 bg-white dark:bg-zinc-950 text-sm">
          <thead>
            <tr className="bg-slate-50/50 dark:bg-zinc-900/40">
              <th className="whitespace-nowrap px-6 py-3 text-left font-semibold text-slate-700 dark:text-zinc-300">File Name</th>
              <th className="whitespace-nowrap px-6 py-3 text-left font-semibold text-slate-700 dark:text-zinc-300">Created At</th>
              <th className="whitespace-nowrap px-6 py-3 text-left font-semibold text-slate-700 dark:text-zinc-300">Edited</th>
              {fileScope === 'org' && (
                <th className="whitespace-nowrap px-6 py-3 text-left font-semibold text-slate-700 dark:text-zinc-300">Team</th>
              )}
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
                      <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{file.fileName}</span>
                        {(file as any).folder && (
                          <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-blue-600 dark:text-blue-400 font-bold bg-blue-50/50 dark:bg-blue-950/20 px-2 py-0.5 rounded border border-blue-100/30 w-max truncate max-w-[150px]">
                            <Folder className="h-2.5 w-2.5 shrink-0 text-blue-500 dark:text-blue-400" />
                            {(file as any).folder}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-slate-500 dark:text-zinc-400">
                    {moment(file._creationTime).format('DD MMM YYYY')}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-slate-500 dark:text-zinc-400">
                    {moment(file._creationTime).format('DD MMM YYYY')}
                  </td>
                  {fileScope === 'org' && (
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border border-blue-100 dark:border-blue-900/30">
                        {file.teamName || 'Unknown Team'}
                      </span>
                    </td>
                  )}
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="flex items-center gap-2">
                      <img 
                        src={file.creatorImage || '/logo-1.png'}
                        alt='creator'
                        className='rounded-full border border-slate-100 dark:border-zinc-800 w-6 h-6 object-cover'
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/logo-1.png';
                        }}
                      />
                      <span className="text-xs text-slate-500 dark:text-zinc-400 font-medium">
                        {file.creatorName || 'Author'}
                      </span>
                    </div>
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
                          onClick={() => {
                            setFileToMove(file);
                            setMoveInput((file as any).folder || '');
                            setIsMoveDialogOpen(true);
                          }}
                          className="gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-all text-xs font-medium"
                        >
                          <Folder className="h-3.5 w-3.5 text-slate-500" /> Move / Assign Folder
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
                        <DropdownMenuItem 
                          onClick={() => {
                            setFileToDelete(file);
                            setIsDeleteDialogOpen(true);
                          }}
                          className="gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all text-xs font-medium"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" /> Delete Permanently
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-white max-w-sm rounded-2xl shadow-2xl p-6">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg font-bold text-red-500">
              Delete File
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-xs leading-relaxed">
              Are you sure you want to permanently delete <span className="font-semibold text-white">"{fileToDelete?.fileName}"</span>? This action is irreversible and all document history will be wiped.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6 flex justify-end gap-2">
            <Button 
              variant="ghost" 
              onClick={() => setIsDeleteDialogOpen(false)}
              className="text-zinc-400 hover:text-white hover:bg-zinc-800 text-xs h-9 px-4 rounded-lg border-0"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleDeleteSubmit}
              className="bg-red-600 hover:bg-red-700 text-white border-0 text-xs h-9 px-4 rounded-lg"
            >
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move Folder Dialog */}
      <Dialog open={isMoveDialogOpen} onOpenChange={setIsMoveDialogOpen}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-white max-w-sm rounded-2xl shadow-2xl p-6">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              Organize File Folder
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-xs">
              Enter a folder name to group this file, or clear it to move it to the root level.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <Input 
              value={moveInput} 
              onChange={(e) => setMoveInput(e.target.value)}
              placeholder="Folder name (e.g., Design, Engineering)"
              list="move-existing-folders"
              className="bg-zinc-800/80 border-zinc-700 text-white placeholder-zinc-500 focus:border-blue-500 text-sm h-10 rounded-lg"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleMoveSubmit();
                }
              }}
            />
            <datalist id="move-existing-folders">
              {Array.from(new Set(fileList_?.filter((f: any) => f.folder).map((f: any) => f.folder))).map((f: any) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>
          <DialogFooter className="mt-6 flex justify-end gap-2">
            <Button 
              variant="ghost" 
              onClick={() => setIsMoveDialogOpen(false)}
              className="text-zinc-400 hover:text-white hover:bg-zinc-800 text-xs h-9 px-4 rounded-lg"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleMoveSubmit}
              className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white border-0 text-xs h-9 px-4 rounded-lg"
            >
              Update Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default FileList