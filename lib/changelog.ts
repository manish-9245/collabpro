export interface Release {
  version: string;
  date: string;
  type: 'major' | 'minor' | 'patch';
  title: string;
  description: string;
  features: string[];
  uiThemeUpgrade?: {
    primaryColor: string; // CSS gradient class
    bannerGlow: string; // glow color class
    badgeText: string; // text to display on badge
    neonBorder: string; // border style
  };
}

export const CHANGELOG: Release[] = [
  {
    version: '3.0.0',
    date: '2026-07-07',
    type: 'major',
    title: 'Self-Hosted Sovereign Sync Era',
    description: 'Complete removal of third-party SaaS dependencies (Convex & Kinde) in favor of a 100% self-contained local state-sync engine and secure PostgreSQL-backed session authentication.',
    features: [
      'Engineered a highly resilient native polling State Sync engine at @/lib/state-sync/react',
      'Implemented custom secure session cookie auth engine backed by PostgreSQL and Prisma',
      'Polished dynamic real-time folder collapsing & tree actions in the SideNav panel',
      'Added high-end curated animated anime avatar selector with live state preservation'
    ],
    uiThemeUpgrade: {
      primaryColor: 'from-blue-600 via-indigo-600 to-purple-600',
      bannerGlow: 'bg-blue-500/10',
      badgeText: 'Sovereign Sync Active (v3.0.0)',
      neonBorder: 'border-blue-500/30 shadow-blue-500/10'
    }
  },
  {
    version: '2.1.0',
    date: '2026-06-15',
    type: 'minor',
    title: 'Dual-View Whiteboard Workspace',
    description: 'Introduced the state-of-the-art dual-pane editor and canvas workspace allowing parallel system architect design.',
    features: [
      'Integrated Excalidraw infinite-scroll collaborative whiteboard canvas',
      'Integrated Editor.js blocks editor with smooth drag handles and styling',
      'Designed draggable split-screen divider with custom drag handles'
    ]
  },
  {
    version: '1.0.0',
    date: '2026-05-01',
    type: 'major',
    title: 'CollabPro Genesis Launch',
    description: 'First public deployment of CollabPro self-hosted software blueprinting studio.',
    features: [
      'Sleek responsive dashboard with curated metrics tracking',
      'Prisma schema integration with team and multi-tenant scopes',
      'Standard Google and secure email registration client'
    ]
  }
];
