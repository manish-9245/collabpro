# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.0.0] - 2026-07-07
### Added
- Created a beautifully structured release management system integration directly in the landing page Hero.
- Interactive segment/tab controllers to toggle between **Core Features Blueprint** and **Releases & Changelog**.
- Dynamic theme styling engine that upgrades gradients, glowing background borders, and version badges depending on active major version features.
- Dynamic navigation hash-change listener to switch active tabs based on `#blueprint` and `#releases` triggers.
- Multi-channel SEO boost incorporating rich social OpenGraph tags, full-scope robots tags, page crawler instructions, keywords, descriptive titles, and Twitter card schemas.

### Changed
- Refactored `app/layout.tsx` to host clean Next.js SEO tags.
- Cleansed redundant landing navigation options (`About`, `Careers`, `History`, `Services`, `Projects`) from `app/_components/Header.tsx`, streamlining landing actions to `#blueprint` and `#releases` smooth scroll markers.
- Purged all legacy third-party SaaS authentication references (`Kinde`) and external state syncer (`Convex`) across backend sessions and frontend state contexts.
- Consolidated state tracking to local, secure PostgreSQL cookie session and high-speed polling db hooks.

### Removed
- Removed 15+ root-level visual regression screenshots, moving the primary OpenGraph preview (`landing_page_clean.png`) to `/public` to ensure production assets load reliably.

---

## [2.1.0] - 2026-06-15
### Added
- Drag-and-drop split-screen workspace with customizable grid handles for modern system engineers.
- Interactive infinite-canvas whiteboard powered by **Excalidraw Next.js**.
- Structured Editor.js integration featuring Checklist, Paragraph, Header, List, and Warning plugins.
- Smooth collapsible navigation trees with virtual directories to organize documents instantly.

---

## [1.0.0] - 2026-05-01
### Added
- Core software blueprinting studio genesis launch.
- Team and organization workspaces scoped via PostgreSQL models.
- Secure localized credential enrollment.
