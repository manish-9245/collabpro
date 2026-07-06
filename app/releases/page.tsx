import React from "react";
import fs from "fs";
import path from "path";
import Link from "next/link";
import { ArrowLeft, Milestone, Calendar, Sparkles, ShieldCheck, Gauge, CheckCircle2, Layers, Cpu, ArrowUpRight, ChevronRight, HelpCircle } from "lucide-react";
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
        // New subsection (e.g., User Impact: New Capabilities)
        const type = line.replace("### ", "").trim();
        currentSection = { type, items: [] };
        release.sections.push(currentSection);
      } else if (line.startsWith("- ")) {
        // List item inside a subsection
        if (currentSection) {
          // Remove Markdown bold markers internally if any
          const cleanItem = line.replace("- ", "").replace(/\*\*/g, "").trim();
          currentSection.items.push(cleanItem);
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
  let releases: ChangelogRelease[] = [];

  try {
    const filePath = path.join(process.cwd(), "CHANGELOG.md");
    const changelogContent = fs.readFileSync(filePath, "utf8");
    releases = parseChangelog(changelogContent);
  } catch (error) {
    console.error("Error loading CHANGELOG.md:", error);
  }

  return (
    <div className="bg-[#f8fafc] min-h-screen relative overflow-hidden font-sans">
      {/* Background design elements */}
      <div className="absolute top-0 left-1/4 -mt-32 w-[600px] h-[600px] bg-slate-200/40 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 -mt-16 w-[500px] h-[500px] bg-slate-100/60 rounded-full blur-3xl pointer-events-none" />
      
      {/* Interactive grid mesh overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:32px_32px] opacity-30 pointer-events-none" />

      {/* Embedded Navigation Header */}
      <Header />

      <main className="max-w-5xl mx-auto px-6 pt-24 pb-28 relative z-10">
        
        {/* Back link */}
        <div className="mb-8">
          <Link 
            href="/" 
            className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors bg-white px-3.5 py-2 rounded-xl border border-slate-200/80 shadow-sm"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Home
          </Link>
        </div>

        {/* Dynamic Header Banner */}
        <div className="bg-white rounded-3xl p-8 sm:p-12 border border-slate-200 shadow-sm relative overflow-hidden mb-16">
          <div className="absolute top-0 right-0 w-80 h-80 bg-slate-50 rounded-full blur-3xl pointer-events-none" />
          
          <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
            <div className="space-y-4 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600 text-[10px] font-extrabold uppercase tracking-wider">
                <Milestone className="h-3.5 w-3.5 text-slate-500" />
                <span>Product Evolution</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-none">
                Platform Releases & User Impacts
              </h1>
              <p className="text-slate-500 text-xs sm:text-sm leading-relaxed">
                Review the structured release notes for CollabPro. This formal log details the direct values, security improvements, and product enhancements implemented across each platform version.
              </p>
            </div>
            
            <div className="shrink-0 flex items-center gap-4 bg-slate-50 border border-slate-200/80 px-6 py-5 rounded-2xl">
              <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-widest">CURRENT PRODUCTION</span>
                <span className="text-base font-extrabold text-slate-900">v3.0.0 Sovereign</span>
              </div>
            </div>
          </div>
        </div>

        {/* Timeline Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          
          {/* Left Column: Side Info & Summary Statistics */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm sticky top-24">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-3 mb-4">
                Release Overview
              </h2>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-medium">Total Releases Logged</span>
                  <span className="font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-700">4 Releases</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-medium">Current Version</span>
                  <span className="font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded">v3.0.0</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-medium">Classification Model</span>
                  <span className="font-bold text-slate-600">User-Impact Focused</span>
                </div>
              </div>

              <div className="mt-6 pt-5 border-t border-slate-100">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Impact Categories</h3>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-blue-600" />
                    <span>New Capabilities</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-emerald-600" />
                    <span>Performance & UX</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-slate-500" />
                    <span>Security & Simplification</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-100/80 text-[11px] leading-relaxed text-slate-500">
                <span className="font-bold text-slate-700 block mb-1">Corporate Compliance Notice</span>
                All changes comply fully with semantic versioning structures. User data protection guarantees remain intact across all platform transitions.
              </div>
            </div>
          </div>

          {/* Right Column: Dynamic Timeline Render */}
          <div className="lg:col-span-8">
            {releases.length > 0 ? (
              <div className="relative border-l-2 border-slate-200/80 ml-4 space-y-16 pl-8">
                {releases.map((release, rIdx) => {
                  const isMajor = release.version.endsWith(".0.0");
                  
                  return (
                    <div key={rIdx} className="relative group">
                      {/* Timeline Dot */}
                      <span className={`absolute -left-[41px] top-1.5 flex h-6 w-6 items-center justify-center rounded-full border bg-white shadow-sm transition-all duration-300 ${
                        isMajor 
                          ? "border-slate-800 ring-4 ring-slate-100 scale-110" 
                          : "border-slate-300 group-hover:border-slate-800"
                      }`}>
                        <div className={`h-2.5 w-2.5 rounded-full ${isMajor ? "bg-slate-800" : "bg-slate-400 group-hover:bg-slate-600"}`} />
                      </span>

                      {/* Release Card */}
                      <div className="space-y-6">
                        {/* Title & Metadata row */}
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                          <h2 className="text-xl font-bold text-slate-950 tracking-tight">
                            Version {release.version}
                          </h2>
                          {isMajor && (
                            <span className="inline-flex items-center text-[10px] font-bold text-slate-800 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md uppercase tracking-wider">
                              Major Release
                            </span>
                          )}
                          <span className="text-xs text-slate-400 font-medium ml-auto flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {release.date}
                          </span>
                        </div>

                        {/* Description (if exists) */}
                        {release.description && (
                          <p className="text-slate-500 text-xs sm:text-sm leading-relaxed border-l-4 border-slate-200 pl-4 py-1">
                            {release.description}
                          </p>
                        )}

                        {/* User Impacts list */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-8">
                          {release.sections.map((sec, sIdx) => {
                            const isNewCapabilities = sec.type.toLowerCase().includes("capabilities");
                            const isPerfAndUX = sec.type.toLowerCase().includes("performance") || sec.type.toLowerCase().includes("ux");
                            const isSecurity = sec.type.toLowerCase().includes("security") || sec.type.toLowerCase().includes("simplification");

                            // Curate colors and icons specifically for formal impact types
                            let icon = <CheckCircle2 className="h-4 w-4" />;
                            let badgeColor = "bg-slate-50 text-slate-700 border-slate-200";
                            
                            if (isNewCapabilities) {
                              icon = <Layers className="h-4 w-4 text-blue-600" />;
                              badgeColor = "bg-blue-50/50 text-blue-700 border-blue-100";
                            } else if (isPerfAndUX) {
                              icon = <Gauge className="h-4 w-4 text-emerald-600" />;
                              badgeColor = "bg-emerald-50/50 text-emerald-700 border-emerald-100";
                            } else if (isSecurity) {
                              icon = <ShieldCheck className="h-4 w-4 text-slate-600" />;
                              badgeColor = "bg-slate-100/50 text-slate-700 border-slate-200";
                            }

                            return (
                              <div key={sIdx} className="space-y-4">
                                <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider ${badgeColor}`}>
                                  {icon}
                                  <span>{sec.type}</span>
                                </div>

                                <ul className="space-y-3.5">
                                  {sec.items.map((item, iIdx) => (
                                    <li key={iIdx} className="flex items-start gap-3 text-xs text-slate-600 leading-relaxed">
                                      <ChevronRight className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center shadow-sm">
                <Milestone className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-base font-bold text-slate-700">No Releases Logged</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Ensure that your CHANGELOG.md is fully populated and saved at the root directory of the project.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
