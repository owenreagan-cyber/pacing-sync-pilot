import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DashboardLayout } from '@/components/DashboardLayout';
import { ConfigContext, loadConfig, type AppConfig } from '@/lib/config';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSystemStore } from '@/store/useSystemStore';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorDiagnostics } from '@/components/ErrorDiagnostics';

import DashboardPage from '@/pages/DashboardPage';
import PacingEntryPage from '@/pages/PacingEntryPage';
import PacingViewerPage from '@/pages/PacingViewerPage';
import PageBuilderPage from '@/pages/PageBuilderPage';
import AssignmentsPage from '@/pages/AssignmentsPage';
import AnnouncementCenterPage from '@/pages/AnnouncementCenterPage';
import NewsletterPage from '@/pages/NewsletterPage';
import FileOrganizerPage from '@/pages/FileOrganizerPage';
import ContentRegistryPage from '@/pages/ContentRegistryPage';
import HealthMonitorPage from '@/pages/HealthMonitorPage';
import SettingsPage from '@/pages/SettingsPage';
import MemoryPage from '@/pages/MemoryPage';
import AutomationPage from '@/pages/AutomationPage';
import CanvasBrainPage from '@/pages/CanvasBrainPage';
import CanvasAuditorPage from '@/pages/CanvasAuditorPage';
import WeekVerifierPage from '@/pages/WeekVerifierPage';
import MasterPacingPage from '@/pages/MasterPacingPage';
import NotFound from '@/pages/NotFound';

const queryClient = new QueryClient();

// Quarter color map (hex for inline styles)
const QUARTER_HEX: Record<string, string> = {
  Q1: '#00c0a5',
  Q2: '#0065a7',
  Q3: '#6644bb',
  Q4: '#c87800',
};

function AppContent({ config }: { config: AppConfig }) {
  const [activeQuarter, setActiveQuarter] = useState<string>('Q4');
  const [activeWeek, setActiveWeek] = useState<number>(4);
  const [riskLevel, setRiskLevel] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('LOW');
  const [riskScore, setRiskScore] = useState(100);
  const [bootLoading, setBootLoading] = useState(true);
  const setSelectedMonth = useSystemStore((s) => s.setSelectedMonth);
  const setSelectedWeek = useSystemStore((s) => s.setSelectedWeek);

  useEffect(() => {
    setSelectedMonth(activeQuarter);
  }, [activeQuarter, setSelectedMonth]);

  useEffect(() => {
    setSelectedWeek(activeWeek);
  }, [activeWeek, setSelectedWeek]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const apply = (q: string, w: number) => {
        if (cancelled) return;
        setActiveQuarter(q);
        setActiveWeek(w);
        setBootLoading(false);
      };
      try {
        // 0) Prefer the explicitly active week
        const { data: activeRow } = await supabase
          .from('weeks')
          .select('quarter, week_num')
          .eq('is_active', true)
          .maybeSingle();
        if (activeRow) {
          apply((activeRow as any).quarter, (activeRow as any).week_num);
          return;
        }
        // 1) Try to find a week whose date_range covers today
        const { data: allWeeks } = await supabase
          .from('weeks')
          .select('quarter, week_num, date_range');
        const today = new Date();
        const matched = (allWeeks || []).find((w: any) => {
          if (!w?.date_range) return false;
          // Parse a range like "July 12-16, 2026" or "July 28 - August 1, 2026"
          const m = String(w.date_range).match(
            /([A-Za-z]+)\s+(\d+)\s*[-–]\s*(?:([A-Za-z]+)\s+)?(\d+),\s*(\d{4})/,
          );
          if (!m) return false;
          const [, m1, d1, m2, d2, y] = m;
          const start = new Date(`${m1} ${d1}, ${y}`);
          const end = new Date(`${m2 || m1} ${d2}, ${y}`);
          end.setHours(23, 59, 59, 999);
          return today >= start && today <= end;
        });
        if (matched) {
          apply(matched.quarter, matched.week_num);
          return;
        }
        // 2) Fallback: latest quarter with pacing rows, highest week_num
        const { data: rows } = await supabase
          .from('pacing_rows')
          .select('week_id')
          .not('week_id', 'is', null);
        const ids = Array.from(new Set((rows || []).map((r: any) => r.week_id)));
        if (ids.length && allWeeks) {
          const candidates = allWeeks.filter((w: any) =>
            ids.includes((w as any).id),
          ) as any[];
          // Re-fetch with id since prior select didn't include it
          const { data: weeksWithId } = await supabase
            .from('weeks')
            .select('id, quarter, week_num')
            .in('id', ids as string[]);
          if (weeksWithId && weeksWithId.length) {
            const sorted = [...weeksWithId].sort((a: any, b: any) => {
              const qa = parseInt(String(a.quarter).replace(/\D/g, ''), 10) || 0;
              const qb = parseInt(String(b.quarter).replace(/\D/g, ''), 10) || 0;
              if (qb !== qa) return qb - qa;
              return (b.week_num || 0) - (a.week_num || 0);
            });
            apply(sorted[0].quarter, sorted[0].week_num);
            return;
          }
        }
      } catch (e) {
        console.warn('Initial week lookup failed, using fallback', e);
      }
      apply('Q4', 4);
    })();
    return () => {
      cancelled = true;
    };
  }, [setSelectedMonth, setSelectedWeek]);

  const quarterColor = QUARTER_HEX[activeQuarter] || QUARTER_HEX.Q2;

  if (bootLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }


  return (
    <BrowserRouter>
      <DashboardLayout
        activeQuarter={activeQuarter}
        activeWeek={activeWeek}
        riskLevel={riskLevel}
        riskScore={riskScore}
        quarterColor={quarterColor}
      >
        <Routes>
          <Route
            path="/"
            element={
              <DashboardPage
                activeQuarter={activeQuarter}
                activeWeek={activeWeek}
                quarterColor={quarterColor}
              />
            }
          />
          <Route
            path="/pacing"
            element={
              <PacingEntryPage
                activeQuarter={activeQuarter}
                setActiveQuarter={setActiveQuarter}
                activeWeek={activeWeek}
                setActiveWeek={setActiveWeek}
                setRiskLevel={setRiskLevel}
                setRiskScore={setRiskScore}
                quarterColor={quarterColor}
              />
            }
          />
          <Route path="/pacing-viewer" element={<PacingViewerPage />} />
          <Route path="/master-pacing" element={<MasterPacingPage />} />
          <Route path="/pages" element={<PageBuilderPage />} />
          <Route path="/assignments" element={<AssignmentsPage />} />
          <Route path="/announcements" element={<AnnouncementCenterPage />} />
          <Route path="/newsletter" element={<NewsletterPage />} />
          <Route path="/files" element={<FileOrganizerPage />} />
          <Route path="/content-registry" element={<ContentRegistryPage />} />
          <Route path="/health" element={<HealthMonitorPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/automation" element={<AutomationPage />} />
          <Route path="/canvas-brain" element={<CanvasBrainPage />} />
          <Route path="/canvas-auditor" element={<CanvasAuditorPage />} />
          <Route path="/week-verifier" element={<WeekVerifierPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </DashboardLayout>
    </BrowserRouter>
  );
}

const App = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedStep] = useState<'load-config'>('load-config');

  const runLoadConfig = () => {
    setError(null);
    loadConfig()
      .then((cfg) => setConfig(cfg))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      });
  };

  useEffect(() => {
    runLoadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <ErrorDiagnostics
        failedStep={failedStep}
        errorMessage={error}
        onRetry={runLoadConfig}
      />
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConfigContext.Provider value={config}>
          <Toaster />
          <Sonner />
          <ErrorBoundary>
            <AppContent config={config} />
          </ErrorBoundary>
        </ConfigContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
