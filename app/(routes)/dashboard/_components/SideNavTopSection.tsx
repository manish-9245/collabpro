import { ChevronDown, LayoutGrid, LogOut, Settings, Users, Loader2, Check, Sparkles, Globe, User } from 'lucide-react'
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
    const { activeTab, setActiveTab } = useContext(FileListContext);
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
    const router = useRouter();
    const convex = useConvex();
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
                            width={40}
                            height={40} />
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
                <DialogContent className='bg-slate-900 border border-slate-800 text-slate-100 max-w-lg rounded-2xl shadow-2xl p-6'>
                    <DialogHeader className='space-y-1.5'>
                        <DialogTitle className='text-xl font-bold flex items-center gap-2 text-white'>
                            <Sparkles className='h-5 w-5 text-amber-400' />
                            Personalize Your Avatar
                        </DialogTitle>
                        <DialogDescription className='text-slate-400 text-xs'>
                            Choose a customized modern style or specify an image URL to style your CollabPro profile.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Current Preview Panel */}
                    <div className='flex items-center gap-4 bg-slate-950/50 border border-slate-800/80 rounded-xl p-4 mt-3'>
                        <div className='relative shrink-0'>
                            <img 
                                src={customUrl.trim() !== '' ? customUrl.trim() : selectedAvatar || '/logo-1.png'} 
                                alt='Preview Avatar' 
                                className='w-14 h-14 rounded-full border border-blue-500/50 bg-slate-900 shadow-md shadow-blue-500/10 object-cover'
                                onError={(e) => {
                                    (e.target as HTMLImageElement).src = '/logo-1.png';
                                }}
                            />
                            <div className='absolute -bottom-1.5 -right-1.5 bg-blue-600 rounded-full p-0.5 border border-slate-900 shadow'>
                                <Check className='h-3 w-3 text-white' />
                            </div>
                        </div>
                        <div className='min-w-0 flex-1'>
                            <span className='inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-wider mb-1'>
                                Avatar Preview
                            </span>
                            <h3 className='text-sm font-semibold text-white truncate'>{user?.given_name} {user?.family_name}</h3>
                            <p className='text-xs text-slate-400 truncate'>{user?.email}</p>
                        </div>
                    </div>

                    {/* Curated Grid */}
                    <div className='mt-4'>
                        <h4 className='text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5'>
                            <User className='h-3.5 w-3.5 text-slate-400' />
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
                                                ? 'border-blue-500 bg-blue-950/20 shadow-md shadow-blue-500/20' 
                                                : 'border-slate-800/80 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-900/60'
                                        }`}
                                    >
                                        <img 
                                            src={avatar.url} 
                                            alt={avatar.name} 
                                            className='w-full h-11 object-contain rounded-lg transition-transform group-hover:scale-105'
                                        />
                                        <div className='mt-1 text-[9px] text-slate-400 group-hover:text-slate-200 text-center truncate px-0.5'>
                                            {avatar.name}
                                        </div>
                                        {isSel && (
                                            <div className='absolute top-1 right-1 bg-blue-500 rounded-full p-0.5 border border-slate-900 shadow'>
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
                        <h4 className='text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
                            <Globe className='h-3.5 w-3.5 text-slate-400' />
                            Or Provide Custom Image URL
                        </h4>
                        <Input
                            type='url'
                            placeholder='https://images.unsplash.com/photo-...'
                            value={customUrl}
                            onChange={(e) => setCustomUrl(e.target.value)}
                            className='bg-slate-950 border-slate-800 text-white rounded-lg text-xs placeholder-slate-600 focus:ring-blue-500/40 focus:border-blue-500'
                        />
                        <p className='text-[10px] text-slate-500'>
                            Paste any public link (JPEG, PNG, SVG). Curated selection is deactivated when custom URL is specified.
                        </p>
                    </div>

                    {/* Actions */}
                    <div className='mt-6 flex justify-end gap-2.5 border-t border-slate-800/80 pt-4'>
                        <Button 
                            variant='ghost' 
                            onClick={() => setIsAvatarModalOpen(false)}
                            className='hover:bg-slate-800/60 text-slate-300 text-xs'
                            disabled={isSaving}
                        >
                            Cancel
                        </Button>
                        <Button 
                            onClick={handleSaveAvatar}
                            className='bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 rounded-lg flex items-center gap-1.5'
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
        </div>

    )
}

export default SideNavTopSection