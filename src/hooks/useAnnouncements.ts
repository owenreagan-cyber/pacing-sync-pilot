import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { callEdge } from '@/lib/edge';
import { toast } from 'sonner';
import type { AnnouncementDraft } from '@/types/thales';

export function useAnnouncementsList(filters?: { weekId?: string; status?: string }) {
  return useQuery({
    queryKey: ['announcements', filters],
    queryFn: async () => {
      let q = supabase.from('announcements').select('*').order('scheduled_post', { ascending: true, nullsFirst: false });
      if (filters?.weekId) q = q.eq('week_id', filters.weekId);
      if (filters?.status) q = q.eq('status', filters.status);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as AnnouncementDraft[];
    },
  });
}

export function useUpcomingAnnouncements(limit = 5) {
  return useQuery({
    queryKey: ['announcements', 'upcoming', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .eq('status', 'SCHEDULED')
        .gte('scheduled_post', new Date().toISOString())
        .order('scheduled_post', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data || []) as AnnouncementDraft[];
    },
  });
}

export function useDraftAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<AnnouncementDraft>) => {
      const { data, error } = await supabase
        .from('announcements')
        .insert({ ...input, status: input.status ?? 'DRAFT' })
        .select()
        .single();
      if (error) throw error;
      return data as AnnouncementDraft;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      toast.success('Draft saved');
    },
    onError: (e: Error) => toast.error(`Draft failed: ${e.message}`),
  });
}

export function useScheduleAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, scheduledPost }: { id: string; scheduledPost: string }) => {
      const { data, error } = await supabase
        .from('announcements')
        .update({ status: 'SCHEDULED', scheduled_post: scheduledPost })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      toast.success('Announcement scheduled');
    },
    onError: (e: Error) => toast.error(`Schedule failed: ${e.message}`),
  });
}

export function usePostNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callEdge<{ status?: string; message?: string }>('canvas-post-announcement', { id }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      if (data?.status === 'BLOCKED') toast.warning(data.message || 'Post blocked');
      else toast.success('Announcement posted');
    },
    onError: (e: Error) => toast.error(`Post failed: ${e.message}`),
  });
}
