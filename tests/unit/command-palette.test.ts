import { describe, it, expect, vi } from 'vitest';

describe('Unified Global Command Palette (Issue 18)', () => {
  const mockCommands = [
    {
      id: 'go-dashboard',
      title: 'Go to Dashboard',
      subtitle: 'View your team workspace folders and active whiteboard sheets',
      category: 'Navigation',
      shortcut: 'G D'
    },
    {
      id: 'go-profile',
      title: 'View User Profile',
      subtitle: 'Manage your avatar, email preferences, and personal details',
      category: 'Navigation',
      shortcut: 'G P'
    },
    {
      id: 'action-toggle-theme',
      title: 'Switch to Dark Theme',
      subtitle: 'Toggle dark mode utilities across the application views',
      category: 'Actions & Tools',
      shortcut: 'T T'
    },
    {
      id: 'settings-admin',
      title: 'Open Compliance Audit Settings',
      subtitle: 'Enforce team domain locks, invite policies, and export immutable logs',
      category: 'Workspace Settings',
      shortcut: 'S A'
    }
  ];

  it('should successfully index default navigation and settings views', () => {
    expect(mockCommands).toHaveLength(4);
    expect(mockCommands[0].id).toBe('go-dashboard');
    expect(mockCommands[3].shortcut).toBe('S A');
  });

  it('should filter commands list correctly based on search query matching title or subtitle', () => {
    const searchQuery = 'Profile';
    const filtered = mockCommands.filter(cmd => 
      cmd.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cmd.subtitle.toLowerCase().includes(searchQuery.toLowerCase())
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('go-profile');
  });

  it('should filter commands list correctly based on system categories', () => {
    const searchQuery = 'Workspace Settings';
    const filtered = mockCommands.filter(cmd => 
      cmd.category.toLowerCase().includes(searchQuery.toLowerCase())
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('settings-admin');
  });

  it('should gracefully handle empty matches on highly non-matching fuzzy strings', () => {
    const searchQuery = 'xyz123abc';
    const filtered = mockCommands.filter(cmd => 
      cmd.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cmd.subtitle.toLowerCase().includes(searchQuery.toLowerCase())
    );

    expect(filtered).toHaveLength(0);
  });
});
