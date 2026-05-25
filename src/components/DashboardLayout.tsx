import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { Badge } from '@/components/ui/badge';
import { useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useSystemStore } from '@/store/useSystemStore';

interface DashboardLayoutProps {
  children: React.ReactNode;
  activeQuarter: string;
  activeWeek: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskScore: number;
  quarterColor: string;
}

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/pacing': 'Pacing Entry',
  '/pacing-viewer': 'Pacing Viewer',
  '/pages': 'Page Builder',
  '/assignments': 'Assignments Gatekeeper',
  '/announcements': 'Announcements',
  '/newsletter': 'Newsletter Architect',
  '/files': 'File Organizer',
  '/health': 'Health Monitor',
  '/settings': 'Settings',
};

export function DashboardLayout({
  children,
  activeQuarter,
  activeWeek,
  riskLevel,
  riskScore,
  quarterColor,
}: DashboardLayoutProps) {
  const location = useLocation();
  const pageTitle = ROUTE_TITLES[location.pathname] || 'Thales OS';
  const { systemStatus, fetchHealthCheck } = useSystemStore();

  useEffect(() => {
    void fetchHealthCheck();
    const interval = setInterval(() => { void fetchHealthCheck(); }, 60_000);
    return () => clearInterval(interval);
  }, [fetchHealthCheck]);

  const statusColor =
    systemStatus === 'online'
      ? 'bg-success'
      : systemStatus === 'offline'
        ? 'bg-destructive'
        : 'bg-warning animate-pulse';

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar
          activeQuarter={activeQuarter}
          activeWeek={activeWeek}
          riskLevel={riskLevel}
          riskScore={riskScore}
          quarterColor={quarterColor}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 flex items-center border-b border-border bg-card px-4 sticky top-0 z-30">
            <SidebarTrigger className="mr-4" />
            <h1 className="text-2xl font-extrabold tracking-tight">{pageTitle}</h1>
            <div className="ml-auto flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${statusColor}`} />
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {systemStatus === 'checking' ? 'Checking…' : systemStatus}
                </span>
              </div>
              <Badge variant="outline" className="text-xs font-semibold">
                {activeQuarter} · Week {activeWeek}
              </Badge>
            </div>
          </header>
          <main className="flex-1 overflow-auto bg-background p-6 lg:p-10">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
