import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// ──────────────────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────────────────

// Prevent real Supabase network calls
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'mocked' } }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      not: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  },
}));

// Mock loadConfig so we can control success / failure per test
vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>();
  return {
    ...actual,
    loadConfig: vi.fn(),
  };
});

// Stub out page components to keep renders lightweight
vi.mock('@/pages/DashboardPage', () => ({ default: () => <div>Dashboard</div> }));
vi.mock('@/pages/PacingEntryPage', () => ({ default: () => <div>PacingEntry</div> }));
vi.mock('@/pages/PacingViewerPage', () => ({ default: () => <div>PacingViewer</div> }));
vi.mock('@/pages/PageBuilderPage', () => ({ default: () => <div>PageBuilder</div> }));
vi.mock('@/pages/AssignmentsPage', () => ({ default: () => <div>Assignments</div> }));
vi.mock('@/pages/AnnouncementCenterPage', () => ({ default: () => <div>Announcements</div> }));
vi.mock('@/pages/NewsletterPage', () => ({ default: () => <div>Newsletter</div> }));
vi.mock('@/pages/FileOrganizerPage', () => ({ default: () => <div>Files</div> }));
vi.mock('@/pages/ContentRegistryPage', () => ({ default: () => <div>ContentRegistry</div> }));
vi.mock('@/pages/HealthMonitorPage', () => ({ default: () => <div>Health</div> }));
vi.mock('@/pages/SettingsPage', () => ({ default: () => <div>Settings</div> }));
vi.mock('@/pages/MemoryPage', () => ({ default: () => <div>Memory</div> }));
vi.mock('@/pages/AutomationPage', () => ({ default: () => <div>Automation</div> }));
vi.mock('@/pages/CanvasBrainPage', () => ({ default: () => <div>CanvasBrain</div> }));
vi.mock('@/pages/CanvasAuditorPage', () => ({ default: () => <div>CanvasAuditor</div> }));
vi.mock('@/pages/WeekVerifierPage', () => ({ default: () => <div>WeekVerifier</div> }));
vi.mock('@/pages/MasterPacingPage', () => ({ default: () => <div>MasterPacing</div> }));
vi.mock('@/pages/NotFound', () => ({ default: () => <div>NotFound</div> }));
vi.mock('@/components/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/store/useSystemStore', () => ({
  useSystemStore: (selector: (s: { setSelectedMonth: () => void; setSelectedWeek: () => void }) => unknown) => {
    const store = { setSelectedMonth: vi.fn(), setSelectedWeek: vi.fn() };
    return selector(store);
  },
}));

// ──────────────────────────────────────────────────────────────────────────────
// Import App + loadConfig after mocks are in place
// ──────────────────────────────────────────────────────────────────────────────
import App from '../App';
import { loadConfig } from '@/lib/config';
import type { AppConfig } from '@/lib/config';

const mockLoadConfig = vi.mocked(loadConfig);

const fakeConfig: AppConfig = {
  courseIds: { Math: 1 },
  assignmentPrefixes: { Math: 'SM5:' },
  quarterColors: { Q1: '#00c0a5', Q2: '#0065a7', Q3: '#6644bb', Q4: '#c87800' },
  powerUpMap: {},
  spellingWordBank: {},
  autoLogic: {
    mathEvenOdd: true,
    mathTestTriple: true,
    readingTestPhrases: [],
    fridayNoHomework: true,
    historyScienceNoAssign: true,
    frontPageProtection: true,
    pagePublishDefault: false,
    togetherLogicCourseId: 0,
  },
  canvasBaseUrl: 'https://example.instructure.com',
  adminEmail: '',
  morningDigestEmails: [],
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('App initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while config is loading', () => {
    // Never resolves during this test
    mockLoadConfig.mockReturnValue(new Promise(() => {}));
    render(<App />);
    // The spinner is a div with animate-spin; check that no main content is shown
    expect(screen.queryByText('Dashboard')).toBeNull();
  });

  it('renders app content after config loads successfully', async () => {
    mockLoadConfig.mockResolvedValue(fakeConfig);
    render(<App />);
    // Wait for async loadConfig to resolve and state to update
    await waitFor(() => {
      // DashboardLayout stub renders children; AppContent renders routes
      // The boot-week effect falls back to Q4/4 since supabase is mocked with nulls
      expect(document.body.textContent).not.toBe('');
    });
  });

  it('shows error diagnostics when loadConfig rejects', async () => {
    mockLoadConfig.mockRejectedValue(new Error('Network error'));
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Initialization Failed')).toBeDefined();
      // 'Network error' appears in the error panel and possibly the diag log
      expect(screen.getAllByText('Network error').length).toBeGreaterThan(0);
    });
  });

  it('shows the failed step label in the diagnostics panel', async () => {
    mockLoadConfig.mockRejectedValue(new Error('Connection refused'));
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Loading configuration')).toBeDefined();
    });
  });

  it('retries loadConfig when Retry button is clicked', async () => {
    mockLoadConfig
      .mockRejectedValueOnce(new Error('First failure'))
      .mockResolvedValueOnce(fakeConfig);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Initialization Failed')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(mockLoadConfig).toHaveBeenCalledTimes(2);
    });
  });
});
