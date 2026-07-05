import { 
    ChevronDown, LayoutGrid, LogOut, Settings, Users, Loader2, Check, Sparkles, Globe, User,
    ChevronRight, Folder, FolderOpen, FileText, MoreHorizontal, Edit2, Trash2, Archive
} from 'lucide-react'
import Image from 'next/image'
import React, { useEffect, useState, useContext } from 'react'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { LogoutLink } from '@kinde-oss/kinde-auth-nextjs'
import { Separator } from '@/components/ui/separator'
import { useConvex, useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FileListContext } from '@/app/_context/FilesListContext'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface TEAM {
    createdBy: String,
    teamName: String,
    _id: String
}

const curatedAvatars = [
    { id: 'neon', name: 'Cyber Neon', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=CyberNeon' },
    { id: 'aurora', name: 'Aura Glow', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=AuroraGlow' },
    { id: 'nebula', name: 'Nebula', url: 'https://api.dicebear.com/7.x/identicon/svg?seed=Nebula' },
    { id: 'space', name: 'Cosmos Space', url: 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=Cosmos' },
    { id: 'stealth', name: 'Stealth Shield', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Stealth' },
    { id: 'quantum', name: 'Quantum Pulse', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Quantum' },
    { id: 'phoenix', name: 'Phoenix', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Phoenix' },
    { id: 'adventurer', name: 'Adventurer', url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Adventurer' },
    { id: 'retro', name: 'Retro Pixel', url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=Retro' },
    { id: 'lorelei', name: 'Lorelei Glow', url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Lorelei' },
    { id: 'initials-1', name: 'CollabPro Blue', url: 'https://api.dicebear.com/7.x/initials/svg?seed=CollabPro' },
    { id: 'initials-2', name: 'CollabPro Gold', url: 'https://api.dicebear.com/7.x/initials/svg?seed=Gold' }
];

function SideNavTopSection({ user, setActiveTeamInfo }: any) {
    const router = useRouter();
    const convex = useConvex();
    const context = useContext(FileListContext) || {};
    const { activeTab, setActiveTab, fileList_, setFileList_, fileScope } = context;
    
    // Core React States
    const [activeTeam, setActiveTeam] = useState<TEAM>();
    const [teamList, setTeamList] = useState<TEAM[]>();
    
    // Fetch user and avatar state from Convex
    const localUserList = useQuery(api.user.getUser, user?.email ? { email: user?.email } : 'skip' as any);
    const localUser = localUserList && localUserList.length > 0 ? localUserList[0] : null;
    const updateUserImage = useMutation(api.user.updateUserImage);

    // Avatar state
    const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
    const [selectedAvatar, setSelectedAvatar] = useState('');
    const [customUrl, setCustomUrl] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Sidebar state & handlers for folder/file tree
    const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
    
    const [isSidebarRenameOpen, setIsSidebarRenameOpen] = useState(false);
    const [sidebarRenameInput, setSidebarRenameInput] = useState('');
    const [sidebarFileToRename, setSidebarFileToRename] = useState<any>(null);

    const [isSidebarDeleteOpen, setIsSidebarDeleteOpen] = useState(false);
    const [sidebarFileToDelete, setSidebarFileToDelete] = useState<any>(null);

    // Sidebar local file list to always show all team files regardless of fileScope filter
    const [sidebarFiles, setSidebarFiles] = useState<any[]>([]);

    const updateFileName = useMutation(api.files.updateFileName);
    const deleteFile = useMutation(api.files.deleteFile);
    const archiveFile = useMutation(api.files.archiveFile);

    const getSidebarFiles = async () => {
        if (activeTeam?._id) {
            try {
                const result = await convex.query(api.files.getFiles, {
                    teamId: activeTeam._id as string
                });
                setSidebarFiles(result || []);
            } catch (err) {
                console.error("Error fetching sidebar team files:", err);
            }
        } else {
            setSidebarFiles([]);
        }
    };

    // Re-fetch all team files whenever the active team changes or the global fileList_ in context changes
    useEffect(() => {
        getSidebarFiles();
    }, [activeTeam, fileList_]);

    const toggleFolder = (folderName: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setCollapsedFolders(prev => ({
            ...prev,
            [folderName]: !prev[folderName]
        }));
    };

    const handleSidebarRenameSubmit = async () => {
        if (!sidebarFileToRename) return;
        const trimmed = sidebarRenameInput.trim();
        if (!trimmed) {
            toast.error('File name cannot be empty');
            return;
        }

        try {
            await updateFileName({
                _id: sidebarFileToRename._id as any,
                fileName: trimmed
            });
            toast.success('File renamed successfully!');
            setIsSidebarRenameOpen(false);
            await getSidebarFiles();
            refreshFiles();
        } catch (error) {
            console.error(error);
            toast.error('Failed to rename file');
        }
    };

    const handleSidebarDeleteSubmit = async () => {
        if (!sidebarFileToDelete) return;
        try {
            await deleteFile({
                _id: sidebarFileToDelete._id as any
            });
            toast.success('File deleted permanently!');
            setIsSidebarDeleteOpen(false);
            await getSidebarFiles();
            refreshFiles();
        } catch (error) {
            console.error(error);
            toast.error('Failed to delete file');
        }
    };

    const handleSidebarArchive = async (file: any) => {
        const isArchiving = !file.archive;
        try {
            await archiveFile({
                _id: file._id as any,
                archive: isArchiving
            });
            toast.success(isArchiving ? 'File archived successfully!' : 'File restored successfully!');
            await getSidebarFiles();
            refreshFiles();
        } catch (error) {
            console.error(error);
            toast.error(isArchiving ? 'Failed to archive file' : 'Failed to restore file');
        }
    };

    const refreshFiles = async () => {
        if (activeTeam?._id && setFileList_) {
            const result = await convex.query(api.files.getFiles, {
                teamId: activeTeam._id as string,
                userEmail: user?.email,
                scope: fileScope
            });
            setFileList_(result);
        }
    };

    // Filter active (non-archived) files
    const nonArchivedFiles = sidebarFiles?.filter((f: any) => !f.archive) || [];

    interface FolderNode {
        name: string;
        path: string;
        folders: Record<string, FolderNode>;
        files: any[];
    }

    const buildHierarchy = (files: any[]) => {
        const root: FolderNode = { name: '', path: '', folders: {}, files: [] };
        files.forEach((file) => {
            if (file.folder && file.folder.trim() !== '') {
                const segments = file.folder
                    .replace(/\\/g, '/')
                    .split('/')
                    .map((s: string) => s.trim())
                    .filter(Boolean);

                let current = root;
                let currentPath = '';
                segments.forEach((seg: string) => {
                    currentPath = currentPath ? `${currentPath}/${seg}` : seg;
                    if (!current.folders[seg]) {
                        current.folders[seg] = {
                            name: seg,
                            path: currentPath,
                            folders: {},
                            files: []
                        };
                    }
                    current = current.folders[seg];
                });
                current.files.push(file);
            } else {
                root.files.push(file);
            }
        });
        return root;
    };

    const hierarchyTree = buildHierarchy(nonArchivedFiles);
    const menu = [
        {
            id: 1,
            name: 'Create Team',
            path: '/teams/create',
            icon: Users
        },
        {
            id: 2,
            name: 'Settings (Avatar)',
            path: '',
            icon: Settings
        }
    ];


    useEffect(() => {
        user && getTeamList();
    }, [user])

    useEffect(() => {
        activeTeam ? setActiveTeamInfo(activeTeam) : null
    }, [activeTeam])

    const getTeamList = async () => {
        const result = await convex.query(api.teams.getTeam, { email: user?.email })
        console.log("TeamList", result);
        setTeamList(result);
        setActiveTeam(result[0]);
    }

    const onMenuClick = (item: any) => {
        if (item.path) {
            router.push(item.path);
        } else if (item.id === 2) {
            setIsAvatarModalOpen(true);
            const currentImg = localUser?.image || user?.picture || '';
            setSelectedAvatar(currentImg);
            const isCurated = curatedAvatars.some(a => a.url === currentImg);
            if (!isCurated && currentImg && !currentImg.startsWith('http://kinde.com')) {
                setCustomUrl(currentImg);
            } else {
                setCustomUrl('');
            }
        }
    }

    const handleSaveAvatar = async () => {
        if (!localUser?._id) {
            toast.error('User profile not fully synchronized. Please try again.');
            return;
        }

        const avatarToSave = customUrl.trim() !== '' ? customUrl.trim() : selectedAvatar;
        if (!avatarToSave) {
            toast.error('Please select an avatar or enter a custom URL.');
            return;
        }

        setIsSaving(true);
        try {
            await updateUserImage({
                _id: localUser._id,
                image: avatarToSave
            });
            toast.success('Your avatar has been updated successfully!');
            setIsAvatarModalOpen(false);
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || 'Failed to update avatar.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div>
            <Popover>
                <PopoverTrigger>
                    <div className='flex items-center gap-3 hover:bg-slate-200 dark:hover:bg-slate-800 p-3 rounded-lg cursor-pointer transition-all'>
                        <Image src='/logo-1.png' alt='logo'
                            width={32}
                            height={32}
                            className="rounded-full bg-white p-0.5 border border-slate-200 dark:border-slate-800 shadow-sm" />
                        <h2 className='flex gap-2 items-center font-bold text-[17px]'>
                            {activeTeam?.teamName}
                            <ChevronDown />
                        </h2>
                    </div>
                </PopoverTrigger>
                <PopoverContent className='ml-7 p-4 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl w-64'>
                    {/* Team Section  */}
                    <div className='max-h-[160px] overflow-y-auto space-y-1 mb-2 pr-1 scrollbar-thin'>
                        {teamList?.map((team, index) => (
                            <h2 key={index}
                                className={`p-2.5 rounded-lg text-sm font-semibold cursor-pointer transition-all flex items-center justify-between ${
                                    activeTeam?._id == team._id 
                                        ? 'bg-blue-600 text-white shadow-md shadow-blue-500/10' 
                                        : 'hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300'
                                }`}
                                onClick={() => setActiveTeam(team)}
                            >
                                <span className='truncate'>{team.teamName}</span>
                                {activeTeam?._id == team._id && <Check className='h-4 w-4 shrink-0 ml-1' />}
                            </h2>
                        ))}
                    </div>
                    <Separator className='my-2 bg-slate-100 dark:bg-slate-800' />
                    {/* Option Section  */}
                    <div className='space-y-1'>
                        {menu.map((item, index) => (
                            <h2 key={index} className='flex gap-2 items-center p-2.5 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-lg cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300 transition-all'
                                onClick={() => onMenuClick(item)}>
                                <item.icon className='h-4 w-4 text-slate-500' />
                                {item.name}</h2>
                        ))}
                        <LogoutLink>
                            <h2 className='flex gap-2 items-center p-2.5 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 transition-all'>
                                <LogOut className='h-4 w-4 text-slate-500 hover:text-red-500' />
                                Logout</h2>
                        </LogoutLink>
                    </div>
                    <Separator className='my-2 bg-slate-100 dark:bg-slate-800' />
                    {/* User Info Section  */}
                    {user && <div className='mt-2 flex gap-2.5 items-center p-1'>
                        <img src={localUser?.image || user?.picture || '/logo-1.png'} alt='user'
                            width={32}
                            height={32}
                            className='rounded-full border border-slate-200 dark:border-slate-800 shadow-sm object-cover shrink-0'
                        />
                        <div className='min-w-0 flex-1'>
                            <h2 className='text-[13px] font-bold text-slate-800 dark:text-slate-100 truncate'>{user?.given_name} {user?.family_name}</h2>
                            <h2 className='text-[11px] text-slate-500 dark:text-slate-400 truncate'>{user?.email}</h2>
                        </div>
                    </div>}
                </PopoverContent>
            </Popover>

            {/* Avatar Selector Dialog */}
            <Dialog open={isAvatarModalOpen} onOpenChange={setIsAvatarModalOpen}>
                <DialogContent className='bg-white border border-slate-200 text-slate-900 max-w-lg rounded-2xl shadow-2xl p-6'>
                    <DialogHeader className='space-y-1.5'>
                        <DialogTitle className='text-xl font-bold flex items-center gap-2 text-slate-900'>
                            <Sparkles className='h-5 w-5 text-amber-500 animate-pulse' />
                            Personalize Your Avatar
                        </DialogTitle>
                        <DialogDescription className='text-slate-500 text-xs'>
                            Choose a customized modern style or specify an image URL to style your CollabPro profile.
                        </DialogDescription>
                    </DialogHeader>
 
                    {/* Current Preview Panel */}
                    <div className='flex items-center gap-4 bg-slate-50 border border-slate-100 rounded-xl p-4 mt-3 shadow-sm'>
                        <div className='relative shrink-0'>
                            <img 
                                src={customUrl.trim() !== '' ? customUrl.trim() : selectedAvatar || '/logo-1.png'} 
                                alt='Preview Avatar' 
                                className='w-14 h-14 rounded-full border border-blue-500/40 bg-white shadow-sm object-cover'
                                onError={(e) => {
                                    (e.target as HTMLImageElement).src = '/logo-1.png';
                                }}
                            />
                            <div className='absolute -bottom-1 -right-1 bg-blue-600 rounded-full p-0.5 border border-white shadow-sm'>
                                <Check className='h-3 w-3 text-white' />
                            </div>
                        </div>
                        <div className='min-w-0 flex-1'>
                            <span className='inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-100 uppercase tracking-wider mb-1'>
                                Avatar Preview
                            </span>
                            <h3 className='text-sm font-semibold text-slate-800 truncate'>{user?.given_name} {user?.family_name}</h3>
                            <p className='text-xs text-slate-500 truncate'>{user?.email}</p>
                        </div>
                    </div>
 
                    {/* Curated Grid */}
                    <div className='mt-4'>
                        <h4 className='text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5'>
                            <User className='h-3.5 w-3.5 text-slate-500' />
                            Select Premium Avatar
                        </h4>
                        <div className='grid grid-cols-4 gap-3 max-h-[160px] overflow-y-auto pr-1 scrollbar-thin'>
                            {curatedAvatars.map((avatar) => {
                                const isSel = selectedAvatar === avatar.url && customUrl.trim() === '';
                                return (
                                    <div 
                                        key={avatar.id}
                                        onClick={() => {
                                            setSelectedAvatar(avatar.url);
                                            setCustomUrl('');
                                        }}
                                        className={`group relative rounded-xl p-1 cursor-pointer transition-all duration-200 border-2 ${
                                            isSel 
                                                ? 'border-blue-500 bg-blue-50/50 shadow-sm shadow-blue-500/10' 
                                                : 'border-slate-100 bg-slate-50/40 hover:border-slate-200 hover:bg-slate-100/50'
                                        }`}
                                    >
                                        <img 
                                            src={avatar.url} 
                                            alt={avatar.name} 
                                            className='w-full h-11 object-contain rounded-lg transition-transform group-hover:scale-105'
                                        />
                                        <div className='mt-1 text-[9px] text-slate-500 group-hover:text-slate-800 text-center truncate px-0.5 font-medium'>
                                            {avatar.name}
                                        </div>
                                        {isSel && (
                                            <div className='absolute top-1 right-1 bg-blue-600 rounded-full p-0.5 border border-white shadow-sm'>
                                                <Check className='h-2.5 w-2.5 text-white' />
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
 
                    {/* Custom URL Input */}
                    <div className='mt-4 space-y-1.5'>
                        <h4 className='text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5'>
                            <Globe className='h-3.5 w-3.5 text-slate-500' />
                            Or Provide Custom Image URL
                        </h4>
                        <Input
                            type='url'
                            placeholder='https://images.unsplash.com/photo-...'
                            value={customUrl}
                            onChange={(e) => setCustomUrl(e.target.value)}
                            className='bg-white border-slate-200 text-slate-900 rounded-lg text-xs placeholder-slate-400 focus:ring-blue-500/20 focus:border-blue-500 h-9'
                        />
                        <p className='text-[10px] text-slate-400'>
                            Paste any public link (JPEG, PNG, SVG). Curated selection is deactivated when custom URL is specified.
                        </p>
                    </div>
 
                    {/* Actions */}
                    <div className='mt-6 flex justify-end gap-2.5 border-t border-slate-100 pt-4'>
                        <Button 
                            variant='ghost' 
                            onClick={() => setIsAvatarModalOpen(false)}
                            className='hover:bg-slate-100 text-slate-600 text-xs border-0 h-9'
                            disabled={isSaving}
                        >
                            Cancel
                        </Button>
                        <Button 
                            onClick={handleSaveAvatar}
                            className='bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 rounded-lg flex items-center gap-1.5 h-9 border-0'
                            disabled={isSaving}
                        >
                            {isSaving ? (
                                <>
                                    <Loader2 className='h-3.5 w-3.5 animate-spin' />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    Save Changes
                                </>
                            )}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* All File Button  */}
            <Button
                variant='outline'
                onClick={() => setActiveTab && setActiveTab('all')}
                className={`w-full justify-start gap-2 font-bold mt-8 transition-all ${
                    activeTab === 'all'
                        ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/50 hover:bg-blue-50 hover:text-blue-600'
                        : 'bg-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-900'
                }`}
            >
                <LayoutGrid className='h-5 w-5' />
                All Files
            </Button>

            {/* Folder and File Hierarchy Tree */}
            <div className="mt-4 border-t border-slate-100 dark:border-zinc-900 pt-4 flex-1 overflow-hidden flex flex-col">
                <h3 className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2 px-2 flex items-center justify-between">
                    <span>Navigation Tree</span>
                    <span className="text-[9px] bg-slate-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded text-slate-500 font-semibold uppercase">{fileScope || 'team'}</span>
                </h3>

                <div className="flex-1 overflow-y-auto max-h-[calc(100vh-340px)] pr-1 space-y-1.5 scrollbar-thin">
                    {/* Recursive render function */}
                    {(() => {
                        const renderFolderNode = (node: FolderNode, depth: number = 0) => {
                            const sortedFolderKeys = Object.keys(node.folders).sort();

                            return (
                                <div className="space-y-1">
                                    {sortedFolderKeys.map((key) => {
                                        const childNode = node.folders[key];
                                        const isCollapsed = !!collapsedFolders[childNode.path];

                                        const countAllFiles = (n: FolderNode): number => {
                                            let count = n.files.length;
                                            Object.values(n.folders).forEach((child) => {
                                                count += countAllFiles(child);
                                            });
                                            return count;
                                        };
                                        const totalFiles = countAllFiles(childNode);

                                        return (
                                            <div key={childNode.path} className="space-y-1">
                                                {/* Folder Header */}
                                                <div
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setCollapsedFolders((prev) => ({
                                                            ...prev,
                                                            [childNode.path]: !prev[childNode.path],
                                                        }));
                                                    }}
                                                    className="flex items-center justify-between group py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-zinc-900/40 cursor-pointer transition-colors"
                                                    style={{ paddingLeft: `${Math.max(8, depth * 12)}px` }}
                                                >
                                                    <div className="flex items-center gap-1.5 min-w-0">
                                                        {isCollapsed ? (
                                                            <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                                        ) : (
                                                            <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                                        )}
                                                        {isCollapsed ? (
                                                            <Folder className="h-4 w-4 text-blue-500 dark:text-blue-400 shrink-0" />
                                                        ) : (
                                                            <FolderOpen className="h-4 w-4 text-blue-500 dark:text-blue-400 shrink-0" />
                                                        )}
                                                        <span className="text-xs font-semibold text-slate-700 dark:text-zinc-300 truncate">
                                                            {childNode.name}
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-bold">
                                                        {totalFiles}
                                                    </span>
                                                </div>

                                                {/* Folder Contents */}
                                                {!isCollapsed && (
                                                    <div className="space-y-1">
                                                        {/* Recursive Subfolders */}
                                                        {renderFolderNode(childNode, depth + 1)}

                                                        {/* Files directly under this folder */}
                                                        {childNode.files.map((file) => (
                                                            <div
                                                                key={file._id}
                                                                onClick={() => router.push('/workspace/' + file._id)}
                                                                className="flex items-center justify-between group py-1.5 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-900/60 cursor-pointer transition-colors text-xs text-slate-600 dark:text-zinc-400"
                                                                style={{ paddingLeft: `${(depth + 1) * 12 + 16}px` }}
                                                            >
                                                                <div className="flex items-center gap-1.5 min-w-0">
                                                                    <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0 group-hover:text-blue-500 transition-colors" />
                                                                    <span className="truncate group-hover:text-slate-900 dark:group-hover:text-white transition-colors font-medium">
                                                                        {file.fileName}
                                                                    </span>
                                                                </div>

                                                                {/* File Quick Actions */}
                                                                <div className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                                                                    <DropdownMenu>
                                                                        <DropdownMenuTrigger asChild>
                                                                            <button className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-zinc-800 text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300">
                                                                                <MoreHorizontal className="h-3 w-3" />
                                                                            </button>
                                                                        </DropdownMenuTrigger>
                                                                        <DropdownMenuContent className="bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 shadow-lg rounded-xl p-1 min-w-[130px]">
                                                                            <DropdownMenuItem
                                                                                onClick={() => {
                                                                                    setSidebarFileToRename(file);
                                                                                    setSidebarRenameInput(file.fileName);
                                                                                    setIsSidebarRenameOpen(true);
                                                                                }}
                                                                                className="gap-2 cursor-pointer rounded-lg px-2 py-1.5 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-all text-xs font-medium"
                                                                            >
                                                                                <Edit2 className="h-3.5 w-3.5 text-slate-500" /> Rename
                                                                            </DropdownMenuItem>
                                                                            <DropdownMenuItem
                                                                                onClick={() => handleSidebarArchive(file)}
                                                                                className="gap-2 cursor-pointer rounded-lg px-2 py-1.5 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-all text-xs font-medium"
                                                                            >
                                                                                <Archive className="h-3 w-3 text-slate-500" /> {file.archive ? 'Restore' : 'Archive'}
                                                                            </DropdownMenuItem>
                                                                            <DropdownMenuItem
                                                                                onClick={() => {
                                                                                    setSidebarFileToDelete(file);
                                                                                    setIsSidebarDeleteOpen(true);
                                                                                }}
                                                                                className="gap-2 cursor-pointer rounded-lg px-2 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all text-xs font-medium"
                                                                            >
                                                                                <Trash2 className="h-3.5 w-3.5 text-red-500" /> Delete
                                                                            </DropdownMenuItem>
                                                                        </DropdownMenuContent>
                                                                    </DropdownMenu>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        };

                        return (
                            <div className="space-y-1">
                                {/* First, render hierarchical nested folders and files */}
                                {renderFolderNode(hierarchyTree)}

                                {/* Then, render Root-level files if any */}
                                {hierarchyTree.files.length > 0 && (
                                    <div className="space-y-0.5">
                                        {hierarchyTree.files.map((file) => (
                                            <div
                                                key={file._id}
                                                onClick={() => router.push('/workspace/' + file._id)}
                                                className="flex items-center justify-between group py-1.5 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-900/60 cursor-pointer transition-colors text-xs text-slate-600 dark:text-zinc-400"
                                                style={{ paddingLeft: '8px' }}
                                            >
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0 group-hover:text-blue-500 transition-colors" />
                                                    <span className="truncate group-hover:text-slate-900 dark:group-hover:text-white transition-colors font-medium">
                                                        {file.fileName}
                                                    </span>
                                                </div>

                                                {/* File Quick Actions at root */}
                                                <div className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <button className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-zinc-800 text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300">
                                                                <MoreHorizontal className="h-3 w-3" />
                                                            </button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent className="bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 shadow-lg rounded-xl p-1 min-w-[130px]">
                                                            <DropdownMenuItem
                                                                onClick={() => {
                                                                    setSidebarFileToRename(file);
                                                                    setSidebarRenameInput(file.fileName);
                                                                    setIsSidebarRenameOpen(true);
                                                                }}
                                                                className="gap-2 cursor-pointer rounded-lg px-2 py-1.5 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-all text-xs font-medium"
                                                            >
                                                                <Edit2 className="h-3.5 w-3.5 text-slate-500" /> Rename
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => handleSidebarArchive(file)}
                                                                className="gap-2 cursor-pointer rounded-lg px-2 py-1.5 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-all text-xs font-medium"
                                                            >
                                                                <Archive className="h-3.5 w-3.5 text-slate-500" /> {file.archive ? 'Restore' : 'Archive'}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => {
                                                                    setSidebarFileToDelete(file);
                                                                    setIsSidebarDeleteOpen(true);
                                                                }}
                                                                className="gap-2 cursor-pointer rounded-lg px-2 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all text-xs font-medium"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5 text-red-500" /> Delete
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Empty State in sidebar */}
                    {nonArchivedFiles.length === 0 && (
                        <div className="text-center py-8 text-slate-400 dark:text-zinc-600">
                            <FileText className="h-8 w-8 mx-auto stroke-[1.5] opacity-50 mb-1" />
                            <p className="text-[10px]">No active files</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Sidebar Rename Dialog */}
            <Dialog open={isSidebarRenameOpen} onOpenChange={setIsSidebarRenameOpen}>
                <DialogContent className='bg-white border border-slate-200 text-slate-900 max-w-sm rounded-xl p-5 shadow-2xl'>
                    <DialogHeader className="space-y-1.5">
                        <DialogTitle className="text-base font-bold text-slate-900">
                            Rename File
                        </DialogTitle>
                    </DialogHeader>
                    <div className="mt-3">
                        <Input 
                            value={sidebarRenameInput} 
                            onChange={(e) => setSidebarRenameInput(e.target.value)}
                            placeholder="File name"
                            className="bg-white border-slate-200 text-slate-900 placeholder-slate-400 focus:border-blue-500 text-xs h-9 rounded-lg"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && sidebarRenameInput.trim().length > 0) {
                                    handleSidebarRenameSubmit();
                                }
                            }}
                        />
                    </div>
                    <div className="mt-5 flex justify-end gap-2">
                        <Button 
                            variant="ghost" 
                            onClick={() => setIsSidebarRenameOpen(false)}
                            className="text-slate-500 hover:text-slate-800 hover:bg-slate-100 text-xs h-8 px-3 rounded-lg"
                        >
                            Cancel
                        </Button>
                        <Button 
                            onClick={handleSidebarRenameSubmit}
                            disabled={!sidebarRenameInput || sidebarRenameInput.trim().length === 0}
                            className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 px-3 rounded-lg border-0"
                        >
                            Rename
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Sidebar Delete Dialog */}
            <Dialog open={isSidebarDeleteOpen} onOpenChange={setIsSidebarDeleteOpen}>
                <DialogContent className='bg-white border border-slate-200 text-slate-900 max-w-sm rounded-xl p-5 shadow-2xl'>
                    <DialogHeader className="space-y-1.5">
                        <DialogTitle className="text-base font-bold text-red-600">
                            Delete File
                        </DialogTitle>
                        <DialogDescription className="text-slate-500 text-xs">
                            Are you sure you want to permanently delete <span className="font-semibold text-slate-800">"{sidebarFileToDelete?.fileName}"</span>? This action is irreversible.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="mt-5 flex justify-end gap-2">
                        <Button 
                            variant="ghost" 
                            onClick={() => setIsSidebarDeleteOpen(false)}
                            className="text-slate-500 hover:text-slate-800 hover:bg-slate-100 text-xs h-8 px-3 rounded-lg border-0"
                        >
                            Cancel
                        </Button>
                        <Button 
                            onClick={handleSidebarDeleteSubmit}
                            className="bg-red-600 hover:bg-red-700 text-white text-xs h-8 px-3 rounded-lg border-0"
                        >
                            Delete
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>

    )
}

export default SideNavTopSection