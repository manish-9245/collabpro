import fs from "fs";
import path from "path";
import { logger } from "@/lib/logger";

export interface ChangelogSection {
  type: string;
  items: string[];
}

export interface ChangelogRelease {
  version: string;
  date: string;
  title?: string;
  description?: string;
  sections: ChangelogSection[];
}

// Resilient server-side markdown parser for CHANGELOG.md
export function parseChangelog(content: string): ChangelogRelease[] {
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

/**
 * Reads and parses CHANGELOG.md from the given project root (defaults to
 * process.cwd()). Returns an empty array — and logs loudly — if the file is
 * missing or unreadable, rather than letting the /releases page silently
 * render with no content and no signal as to why (this previously happened
 * silently when CHANGELOG.md was excluded from the Docker build context).
 */
export function loadChangelog(projectRoot: string = process.cwd()): ChangelogRelease[] {
  try {
    const filePath = path.join(projectRoot, "CHANGELOG.md");
    const changelogContent = fs.readFileSync(filePath, "utf8");
    return parseChangelog(changelogContent);
  } catch (error) {
    logger.error(
      "Failed to load CHANGELOG.md — the /releases page will render with no release history",
      error
    );
    return [];
  }
}
