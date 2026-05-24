import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface DeployEvent {
  id: string;
  action: string | null;
  subject: string | null;
  status: string | null;
  message: string | null;
  canvas_url: string | null;
  created_at: string | null;
  week_id: string | null;
}

/**
 * Subscribes to realtime deploy_log inserts and shows toast notifications.
 * Optionally calls onEvent for custom handling.
 */
export function useRealtimeDeploy(onEvent?: (event: DeployEvent) => void) {
  useEffect(() => {
    const channel = supabase
      .channel('deploy-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'deploy_log' },
        (payload) => {
          const event = payload.new as DeployEvent;
          
          // Show toast based on status
          const label = [event.action?.replace(/_/g, ' '), event.subject].filter(Boolean).join(' — ');
          
          if (event.status === 'DEPLOYED') {
            toast.success(label, {
              description: event.message || 'Successfully deployed',
              action: event.canvas_url
                ? { label: 'Open', onClick: () => window.open(event.canvas_url, '_blank') }
                : undefined,
            });
          } else if (event.status === 'ERROR') {
            toast.error(label, { description: event.message || 'Deployment failed' });
          }

          onEvent?.(event);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [onEvent]);
}
