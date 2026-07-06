import React from "react";
import fs from "fs";
import path from "path";
import Link from "next/link";
import { ArrowLeft, Milestone, Calendar, Sparkles, Terminal, FileText, CheckCircle2, RefreshCw, Trash2, ArrowUpRight } from "lucide-react";
import Header from "../_components/Header";

interface ChangelogSection {
  type: string;
  items: string[];
}

interface ChangelogRelease {
  version: string;
  date: string;
  title?: string;
  description?: string;
  sections: ChangelogSection[];
}

// Resilient server-side markdown parser for CHANGELOG.md
function parseChangelog(content: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  const rawSections = content.split(/\n##\s+/);

  // Skip the header part before the first release
  for (let i = 1; i < rawSections.length; i++) {
    const rawRelease = rawSections[i];
    const lines = rawRelease.split("\n");
    const headerLine = lines[0].trim();

    // Parse version and date, e.g. "[3.0.0] - 2026-07-07"
    const match = headerLine.match(/\[(.*?)\]\s*-\s*(.*)/);
    if (!match) continue;

    const version = match[1];
    const date = match[2];

    const release: ChangelogRelease = {
      version,
      date,
      sections: [],
    };

    let currentSection: ChangelogSection | null = null;
    let descriptionLines: string[] = [];

    for (let j = 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (!line) continue;

      if (line.startsWith("### ")) {
        // New subsection (e.g., Added, Changed, Removed)
        const type = line.replace("### ", "").trim();
        currentSection = { type, items: [] };
        release.sections.push(currentSection);
      } else if (line.startsWith("- ")) {
        // List item inside a subsection
        if (currentSection) {
          currentSection.items.push(line.replace("- ", "").trim());
        }
      } else {
        // Description text or title (if before any "###" section)
        if (release.sections.length === 0) {
          descriptionLines.push(line);
        }
      }
    }

    if (descriptionLines.length > 0) {
      release.description = descriptionLines.join(" ");
    }

    releases.push(release);
  }

  return releases;
}

export default function ReleasesPage() {
  let changelogContent = "";
  let releases: ChangelogRelease[] = [];

  try {
    const filePath = path.join(process.cwd(), "CHANGELOG.md");
    changelogContent = fs.readFileSync(filePath, "utf8");
    releases = parseChangelog(changelogContent);
  } catch (error) {
    console.error("Error loading CHANGELOG.md:", error);
  }

  return (
    <div className="bg-slate-50/50 min-h-screen relative overflow-hidden font-sans">
      {/* Background design elements */}
      <div className="absolute top-0 left-1/4 -mt-32 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 -mt-16 w-[500px] h-[500px] bg-indigo-100/20 rounded-full blur-3xl pointer-events-none" />
      
      {/* Interactive grid mesh overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#f1f5f9_1px,transparent_1px),linear-gradient(to_bottom,#f1f5f9_1px,transparent_1px)] bg-[size:24px_24px] opacity-40 pointer-events-none" />

      {/* Embedded Navigation Header */}
      <Header />

      <main className="max-w-4xl mx-auto px-4 pt-32 pb-24 relative z-10">
        
        {/* Back link */}
        <div className="mb-6">
          <Link 
            href="/" 
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors bg-white px-3 py-1.5 rounded-lg border border-slate-200/60 shadow-sm"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Landing Page
          </Link>
        </div>

        {/* Dynamic Header Banner */}
        <div className="bg-gradient-to-br from-slate-900 to-indigo-950 rounded-3xl p-8 sm:p-12 border border-slate-800 shadow-2xl relative overflow-hidden mb-12">
          {/* Internal glows */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-3 max-w-xl">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-[10px] font-extrabold uppercase tracking-wider">
                <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                <span>Sovereign Releases</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight leading-none">
                Evolutionary Changelog
              </h1>
              <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                Stay updated with the latest releases, design shifts, state synchronization updates, and native security enhancements for CollabPro.
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-3 bg-white/5 border border-white/10 px-5 py-4 rounded-2xl backdrop-blur-md">
              <Milestone className="h-8 w-8 text-indigo-400 animate-bounce" />
              <div>
                <span className="text-[10px] text-slate-500 block font-bold uppercase tracking-widest">LATEST UPGRADE</span>
                <span className="text-sm font-black text-white">v3.0.0 Sovereign</span>
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic Timeline Render */}
        {releases.length > 0 ? (
          <div className="relative border-l-2 border-slate-200 ml-4 sm:ml-6 space-y-12 pl-6 sm:pl-8">
            {releases.map((release, rIdx) => {
              const isMajor = release.version.endsWith(".0.0");
              return (
                <div key={rIdx} className="relative group">
                  {/* Circle timeline connector node */}
                  <span className={`absolute -left-[35px] sm:-left-[41px] top-1.5 flex h-6 w-6 items-center justify-center rounded-full border bg-white shadow-md transition-all duration-300 ${
                    isMajor 
                      ? "border-indigo-600 ring-4 ring-indigo-50 scale-110" 
                      : "border-slate-300 group-hover:border-blue-500"
                  }`}>
                    <div className={`h-2.5 w-2.5 rounded-full ${isMajor ? "bg-indigo-600 animate-pulse" : "bg-slate-400 group-hover:bg-blue-500"}`} />
                  </span>

                  {/* Release Card */}
                  <div className="bg-white border border-slate-200/80 rounded-2xl p-6 sm:p-8 shadow-sm hover:shadow-md transition-all duration-300">
                    {/* Header Row */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 mb-6">
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider ${
                          isMajor 
                            ? "bg-indigo-50 text-indigo-700 border border-indigo-100" 
                            : "bg-blue-50 text-blue-700 border border-blue-100"
                        }`}>
                          v{release.version}
                        </span>
                        {isMajor && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-md border border-amber-100 uppercase tracking-wider animate-pulse">
                            Major Release
                          </span>
                        )}
                      </div>

                      <div className="inline-flex items-center gap-1.5 text-xs text-slate-400 font-medium bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" />
                        <span>{release.date}</span>
                      </div>
                    </div>

                    {/* Description (if exists) */}
                    {release.description && (
                      <p className="text-slate-600 text-xs sm:text-sm leading-relaxed mb-6 bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
                        {release.description}
                      </p>
                    )}

                    {/* Subsections (Added, Changed, Removed) */}
                    <div className="space-y-6">
                      {release.sections.map((sec, sIdx) => {
                        const isAdded = sec.type.toLowerCase() === "added";
                        const isChanged = sec.type.toLowerCase() === "changed";
                        const isRemoved = sec.type.toLowerCase() === "removed";

                        return (
                          <div key={sIdx} className="space-y-3">
                            <h3 className="text-xs font-extrabold uppercase tracking-widest flex items-center gap-2">
                              {isAdded && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
                              {isChanged && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                              {isRemoved && <span className="h-2 w-2 rounded-full bg-rose-500" />}
                              <span className={
                                isAdded ? "text-emerald-700" :
                                isChanged ? "text-blue-700" :
                                isRemoved ? "text-rose-700" : "text-slate-600"
                              }>
                                {sec.type}
                              </span>
                            </h3>

                            <ul className="grid grid-cols-1 gap-2.5 pl-1">
                              {sec.items.map((item, iIdx) => (
                                <li key={iIdx} className="flex items-start gap-2.5 text-xs text-slate-600 leading-relaxed">
                                  {isAdded && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />}
                                  {isChanged && <RefreshCw className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />}
                                  {isRemoved && <Trash2 className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />}
                                  {!isAdded && !isChanged && !isRemoved && <CheckCircle2 className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />}
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>

                    {/* Major theme styling details */}
                    {isMajor && release.version === "3.0.0" && (
                      <div className="mt-8 p-4 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-2xl border border-blue-100/40 flex items-center gap-3.5">
                        <Sparkles className="h-5 w-5 text-indigo-500 shrink-0 animate-bounce" />
                        <div className="text-[11px] leading-relaxed text-slate-600">
                          <span className="font-extrabold text-slate-800">Programmatic Theme Upgrade:</span> Active in this release! The main home landing page has dynamically upgraded details featuring custom glassmorphic glow points and neon outlines.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center shadow-sm">
            <FileText className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-base font-bold text-slate-700">No Releases Logged</h3>
            <p className="text-xs text-slate-400 mt-1">
              Ensure that your CHANGELOG.md is fully populated and saved at the root directory of the project.
            </p>
          </div>
        )}

        {/* Raw View Section */}
        {changelogContent && (
          <div className="mt-16 bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
            <div className="bg-slate-50/80 px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-slate-500" />
                <span className="text-xs font-bold text-slate-700">Raw CHANGELOG.md View</span>
              </div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-0.5 rounded border">ROOT FILE</span>
            </div>
            <pre className="p-6 overflow-x-auto text-[10px] sm:text-xs font-mono text-slate-600 leading-relaxed bg-slate-950 text-slate-300 scrollbar-thin max-h-[300px]">
              <code>{changelogContent}</code>
            </pre>
          </div>
        )}
      </main>
    </div>
  );
}
