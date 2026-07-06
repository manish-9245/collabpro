"use client"

import React, { useContext, useEffect, useState } from 'react'
import Header from '../_components/Header'
import { ActiveTeamContext } from '@/app/_context/ActiveTeamContext'
import { useSessionAuth } from '@/lib/session-auth/client'
import { useQuery, useMutation, useConvex } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { toast } from 'sonner'
import { User, Shield, Globe, Github, Twitter, Linkedin, Briefcase, Sparkles, CheckCircle2, Lock, Loader2 } from 'lucide-react'

const ANIME_AVATARS = [
  {
    name: "Gojo Satoru",
    anime: "Jujutsu Kaisen",
    url: "https://media.giphy.com/media/U783FB3Ch9YPC1G69t/giphy.gif"
  },
  {
    name: "Naruto Uzumaki",
    anime: "Naruto Shippuden",
    url: "https://media.giphy.com/media/t8KeuVfD9pXMY/giphy.gif"
  },
  {
    name: "Monkey D. Luffy",
    anime: "One Piece",
    url: "https://media.giphy.com/media/tuCFp8cWPG7ss/giphy.gif"
  },
  {
    name: "Tanjiro Kamado",
    anime: "Demon Slayer",
    url: "https://media.giphy.com/media/DY6IfJ6f87680/giphy.gif"
  },
  {
    name: "Nezuko Kamado",
    anime: "Demon Slayer",
    url: "https://media.giphy.com/media/Z68p4wC6kBO5q/giphy.gif"
  },
  {
    name: "Zenitsu Agatsuma",
    anime: "Demon Slayer",
    url: "https://media.giphy.com/media/V89K3ov9rscb9mRGlW/giphy.gif"
  },
  {
    name: "Sailor Moon",
    anime: "Sailor Moon",
    url: "https://media.giphy.com/media/b69Xgg660k46I/giphy.gif"
  },
  {
    name: "Pikachu Spark",
    anime: "Pokemon",
    url: "https://media.giphy.com/media/13GKP7xGjTCv1C/giphy.gif"
  }
]

function ProfilePage() {
  const { user }: any = useSessionAuth();
  const { activeTeam } = useContext(ActiveTeamContext);
  const convex = useConvex();

  const [activeSubTab, setActiveSubTab] = useState<'person' | 'team'>('person');
  
  // Person profile states
  const [profileTitle, setProfileTitle] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [profileGithub, setProfileGithub] = useState('');
  const [profileTwitter, setProfileTwitter] = useState('');
  const [profileLinkedin, setProfileLinkedin] = useState('');
  const [profilePortfolio, setProfilePortfolio] = useState('');
  const [profilePrivate, setProfilePrivate] = useState(false);
  const [profileImage, setProfileImage] = useState('');
  const [isSavingPerson, setIsSavingPerson] = useState(false);

  // Team profile states
  const [teamDesc, setTeamBio] = useState('');
  const [teamIndustry, setTeamIndustry] = useState('');
  const [teamWebsite, setTeamWebsite] = useState('');
  const [teamGithub, setTeamGithub] = useState('');
  const [teamPrivate, setTeamPrivate] = useState(false);
  const [isSavingTeam, setIsSavingTeam] = useState(false);

  const updateUserProfile = useMutation(api.user.updateUserProfile);
  const updateUserImage = useMutation(api.user.updateUserImage);
  const updateTeamProfile = useMutation(api.teams.updateTeamProfile);

  // Fetch profiles on mount or user change
  useEffect(() => {
    if (user?.email) {
      fetchUserProfile();
    }
  }, [user]);

  useEffect(() => {
    if (activeTeam?._id) {
      fetchTeamProfile();
    }
  }, [activeTeam]);

  const fetchUserProfile = async () => {
    try {
      const data = await convex.query(api.user.getUserProfile, {
        email: user.email,
        requesterEmail: user.email
      });
      if (data) {
        setProfileTitle(data.title || '');
        setProfileBio(data.description || '');
        setProfileGithub(data.github || '');
        setProfileTwitter(data.twitter || '');
        setProfileLinkedin(data.linkedin || '');
        setProfilePortfolio(data.portfolio || '');
        setProfilePrivate(data.isPrivate || false);
        setProfileImage(data.image || '');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchTeamProfile = async () => {
    try {
      const data = await convex.query(api.teams.getTeamProfile, {
        teamId: activeTeam._id,
        requesterEmail: user?.email
      });
      if (data) {
        setTeamBio(data.description || '');
        setTeamIndustry(data.industry || '');
        setTeamWebsite(data.website || '');
        setTeamGithub(data.github || '');
        setTeamPrivate(data.isPrivate || false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSavePerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;
    setIsSavingPerson(true);
    try {
      await updateUserProfile({
        email: user.email,
        title: profileTitle.trim(),
        description: profileBio.trim(),
        github: profileGithub.trim(),
        twitter: profileTwitter.trim(),
        linkedin: profileLinkedin.trim(),
        portfolio: profilePortfolio.trim(),
        isPrivate: profilePrivate
      });
      toast.success("Personal profile updated successfully!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update personal profile.");
    } finally {
      setIsSavingPerson(false);
    }
  };

  const handleAvatarSelect = async (avatarUrl: string) => {
    if (!user?.email) return;
    try {
      // Find the database ID of the logged in user
      const users = await convex.query(api.user.getUser, { email: user.email });
      if (users && users.length > 0) {
        await updateUserImage({
          _id: users[0]._id,
          image: avatarUrl
        });
        setProfileImage(avatarUrl);
        toast.success("Premium animated avatar updated successfully!");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to save selected avatar.");
    }
  };

  const handleSaveTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam?._id) return;
    setIsSavingTeam(true);
    try {
      await updateTeamProfile({
        teamId: activeTeam._id,
        description: teamDesc.trim(),
        industry: teamIndustry.trim(),
        website: teamWebsite.trim(),
        github: teamGithub.trim(),
        isPrivate: teamPrivate
      });
      toast.success("Team profile updated successfully!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update team profile.");
    } finally {
      setIsSavingTeam(false);
    }
  };

  return (
    <div className='p-8 min-h-screen bg-slate-50/30 dark:bg-zinc-950/20'>
      <Header />

      {/* Main Profile Tabs Segmented Controller */}
      <div className="flex justify-between items-center mt-8 mb-6 gap-4 flex-wrap">
        <div className="flex bg-slate-100/80 dark:bg-zinc-900/60 p-1 rounded-xl border border-slate-200/50 dark:border-zinc-800/80 shadow-inner">
          <button
            onClick={() => setActiveSubTab('person')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center gap-2 ${
              activeSubTab === 'person'
                ? 'bg-white dark:bg-zinc-950 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/20 dark:border-zinc-800/30'
                : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            <User className="h-4 w-4" />
            <span>Personal Profile</span>
          </button>
          
          <button
            onClick={() => setActiveSubTab('team')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center gap-2 ${
              activeSubTab === 'team'
                ? 'bg-white dark:bg-zinc-950 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/20 dark:border-zinc-800/30'
                : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            <Briefcase className="h-4 w-4" />
            <span>Team / Organization Profile</span>
          </button>
        </div>

        <div className="text-xs font-semibold text-slate-500 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-900/30 px-3 py-1.5 rounded-lg border border-slate-100 dark:border-zinc-800/50">
          Editing: <span className="text-blue-600 dark:text-blue-400">{activeSubTab === 'person' ? 'Personal Details' : activeTeam?.teamName || 'Team Details'}</span>
        </div>
      </div>

      {activeSubTab === 'person' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Persona Card & Avatar Selector */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 p-6 rounded-2xl shadow-sm text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600" />
              
              <div className="relative inline-block mx-auto mt-4 mb-4">
                <img 
                  src={profileImage || user?.picture || '/logo-1.png'}
                  alt="avatar"
                  className="w-24 h-24 rounded-full border-4 border-white dark:border-zinc-950 shadow-md object-cover relative z-10"
                />
                <div className="absolute -bottom-1 -right-1 z-20 h-6 w-6 rounded-full bg-blue-600 border-2 border-white dark:border-zinc-950 flex items-center justify-center text-white">
                  <Sparkles className="h-3 w-3" />
                </div>
              </div>

              <h2 className="text-lg font-black text-slate-800 dark:text-white">{user?.given_name || 'Innovator'}</h2>
              <p className="text-xs text-slate-400 dark:text-zinc-500">{user?.email}</p>
              
              {profileTitle && (
                <span className="inline-block mt-3 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase tracking-wider border border-blue-100/30">
                  {profileTitle}
                </span>
              )}
            </div>

            {/* Premium Animated Avatar Selector */}
            <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 p-6 rounded-2xl shadow-sm">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-1.5 mb-4">
                <Sparkles className="h-4 w-4 text-purple-500 animate-bounce" />
                Select Premium Animated Avatar
              </h3>
              
              <div className="grid grid-cols-4 gap-3">
                {ANIME_AVATARS.map((avatar, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAvatarSelect(avatar.url)}
                    className={`relative rounded-xl overflow-hidden border-2 transition-all hover:scale-105 active:scale-95 group shadow-sm ${
                      profileImage === avatar.url ? 'border-blue-500 scale-105 shadow-md shadow-blue-500/10' : 'border-slate-100 dark:border-zinc-900 hover:border-blue-400'
                    }`}
                    title={`${avatar.name} (${avatar.anime})`}
                  >
                    <img 
                      src={avatar.url} 
                      alt={avatar.name} 
                      className="w-full h-12 object-cover"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <span className="text-[8px] font-bold text-white text-center px-1 truncate leading-none">
                        {avatar.name}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Persona Edit Form */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 p-6 sm:p-8 rounded-2xl shadow-sm">
              <h3 className="text-base font-bold text-slate-800 dark:text-white mb-6 flex items-center gap-2">
                <User className="h-4 w-4 text-blue-600" />
                Personal Profile Customizations
              </h3>

              <form onSubmit={handleSavePerson} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-500 dark:text-zinc-400">Professional Title / Role</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Lead System Architect, UI Designer" 
                      value={profileTitle}
                      onChange={(e) => setProfileTitle(e.target.value)}
                      className="bg-slate-50 border border-slate-200 text-slate-800 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-500 dark:text-zinc-400">Personal Portfolio Link</label>
                    <input 
                      type="text" 
                      placeholder="https://yourportfolio.com" 
                      value={profilePortfolio}
                      onChange={(e) => setProfilePortfolio(e.target.value)}
                      className="bg-slate-50 border border-slate-200 text-slate-800 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 dark:text-zinc-400">Biography / Description</label>
                  <textarea 
                    placeholder="Tell your team about yourself..." 
                    rows={4}
                    value={profileBio}
                    onChange={(e) => setProfileBio(e.target.value)}
                    className="bg-slate-50 border border-slate-200 text-slate-800 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                  />
                </div>

                <h4 className="text-xs font-black text-slate-400 dark:text-zinc-500 uppercase tracking-widest mt-6 mb-2">Social Profile Blueprints</h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                      <Github className="h-3 w-3 text-slate-600 dark:text-zinc-400" /> GitHub URL
                    </label>
                    <input 
                      type="text" 
                      placeholder="https://github.com/user" 
                      value={profileGithub}
                      onChange={(e) => setProfileGithub(e.target.value)}
                      className="bg-slate-50 border border-slate-200 text-slate-800 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                      <Twitter className="h-3 w-3 text-slate-600 dark:text-zinc-400" /> Twitter (X) URL
                    </label>
                    <input 
                      type="text" 
                      placeholder="https://x.com/user" 
                      value={profileTwitter}
                      onChange={(e) => setProfileTwitter(e.target.value)}
                      className="bg-slate-50 border border-slate-200 text-slate-800 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                      <Linkedin className="h-3 w-3 text-slate-600 dark:text-zinc-400" /> LinkedIn URL
                    </label>
                    <input 
                      type="text" 
                      placeholder="https://linkedin.com/in/user" 
                      value={profileLinkedin}
                      onChange={(e) => setProfileLinkedin(e.target.value)}
                      className="bg-slate-50 border border-slate-200 text-slate-800 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                </div>

                {/* Privacy Toggle */}
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 dark:bg-zinc-900/40 dark:border-zinc-900 mt-6">
                  <div className="flex gap-2.5 items-start">
                    <Lock className="h-4 w-4 text-slate-500 dark:text-zinc-400 mt-0.5" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-800 dark:text-zinc-200">Keep Profile Private</span>
                      <span className="text-[10px] text-slate-500 dark:text-zinc-500 leading-normal max-w-sm">
                        When enabled, details are hidden from public directories, but remain visible to team and organization members.
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setProfilePrivate(!profilePrivate)}
                    className={`h-5 w-9 rounded-full relative transition-colors ${
                      profilePrivate ? 'bg-blue-600' : 'bg-slate-300 dark:bg-zinc-800'
                    }`}
                  >
                    <span className={`h-4.5 w-4.5 bg-white rounded-full absolute top-0.5 transition-transform shadow ${
                      profilePrivate ? 'translate-x-4' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>

                <div className="flex justify-end mt-6">
                  <button 
                    type="submit" 
                    disabled={isSavingPerson}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs py-2.5 px-6 rounded-lg shadow-md hover:shadow-blue-500/15 flex items-center gap-1.5 transition-all"
                  >
                    {isSavingPerson ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Profile Details"
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-950 border border-slate-100 dark:border-zinc-900 p-6 sm:p-8 rounded-2xl shadow-sm max-w-2xl mx-auto">
          <h3 className="text-base font-bold text-slate-800 dark:text-white mb-6 flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-blue-600" />
            Manage Active Team Profile
          </h3>

          {!activeTeam ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              Please select or create an active team from the top-left sidebar first.
            </div>
          ) : (
            <form onSubmit={handleSaveTeam} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 dark:text-zinc-400">Team Industry</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Software, Finance, Design" 
                    value={teamIndustry}
                    onChange={(e) => setTeamIndustry(e.target.value)}
                    className="bg-slate-50 border border-slate-200 text-slate-800 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 dark:text-zinc-400">Website URL</label>
                  <input 
                    type="text" 
                    placeholder="https://company.com" 
                    value={teamWebsite}
                    onChange={(e) => setTeamWebsite(e.target.value)}
                    className="bg-slate-50 border border-slate-200 text-slate-800 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 dark:text-zinc-400">Organization Bio / Description</label>
                <textarea 
                  placeholder="Describe your organization / team blueprints..." 
                  rows={4}
                  value={teamDesc}
                  onChange={(e) => setTeamBio(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-slate-800 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 dark:text-zinc-400">Team GitHub Link</label>
                <input 
                  type="text" 
                  placeholder="https://github.com/organization" 
                  value={teamGithub}
                  onChange={(e) => setTeamGithub(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-slate-800 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* Team Privacy Toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 dark:bg-zinc-900/40 dark:border-zinc-900 mt-6">
                <div className="flex gap-2.5 items-start">
                  <Lock className="h-4 w-4 text-slate-500 dark:text-zinc-400 mt-0.5" />
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-800 dark:text-zinc-200">Keep Team Profile Private</span>
                    <span className="text-[10px] text-slate-500 dark:text-zinc-500 leading-normal max-w-sm">
                      When enabled, this team's repository details will be locked from external organization search, accessible only by invited team members.
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTeamPrivate(!teamPrivate)}
                  className={`h-5 w-9 rounded-full relative transition-colors ${
                    teamPrivate ? 'bg-blue-600' : 'bg-slate-300 dark:bg-zinc-800'
                  }`}
                >
                  <span className={`h-4.5 w-4.5 bg-white rounded-full absolute top-0.5 transition-transform shadow ${
                    teamPrivate ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>

              <div className="flex justify-end mt-6">
                <button 
                  type="submit" 
                  disabled={isSavingTeam}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs py-2.5 px-6 rounded-lg shadow-md hover:shadow-blue-500/15 flex items-center gap-1.5 transition-all"
                >
                  {isSavingTeam ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Team Details"
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

export default ProfilePage
