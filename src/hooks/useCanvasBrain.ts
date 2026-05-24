import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { callEdge } from '@/lib/edge';
import {
  fetchDetectedChanges,
  fetchLastSync,
  fetchLearnedPatterns,
  fetchSnapshotStats,
} from '@/lib/canvas-brain';
import { getStyleConfidence } from '@/lib/canvas-brain-suggest';

export function useStyleConfidence() {
  return useQuery({ queryKey: ['canvas-brain', 'confidence'], queryFn: getStyleConfidence });
}

export function useSnapshotStats() {
  return useQuery({ queryKey: ['canvas-brain', 'snapshots'], queryFn: fetchSnapshotStats });
}

export function useLearnedPatterns() {
  return useQuery({ queryKey: ['canvas-brain', 'patterns'], queryFn: fetchLearnedPatterns });
}

export function useLastSync() {
  return useQuery({ queryKey: ['canvas-brain', 'last-sync'], queryFn: fetchLastSync });
}

export function useDetectedChanges() {
  return useQuery({ queryKey: ['canvas-brain', 'changes'], queryFn: fetchDetectedChanges });
}

export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => callEdge<{ ok: boolean; results: unknown[] }>('canvas-sync-nightly', {}),
    onSuccess: (data) => {
      if (data?.ok) toast.success('Canvas Brain sync complete');
      else toast.warning('Sync completed with errors — check log');
      void qc.invalidateQueries({ queryKey: ['canvas-brain'] });
    },
    onError: (e: Error) => toast.error(`Sync failed: ${e.message}`),
  });
}
