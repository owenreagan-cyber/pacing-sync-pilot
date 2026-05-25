import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdge } from '@/lib/edge';
import { toast } from 'sonner';

interface DeployPageInput {
  weekId: string;
  subject: string;
  html: string;
  pageTitle: string;
  isFrontPage?: boolean;
}

interface DeployAssignmentInput {
  rowId: string;
  subject?: string;
  day?: string;
  type?: string;
  isSynthetic?: boolean;
  title?: string;
  description?: string;
  dueAt?: string;
  points?: number;
  assignmentGroupId?: number;
}

interface EdgeResult {
  status?: string;
  message?: string;
  canvas_url?: string;
  [k: string]: unknown;
}

export function useDeployPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeployPageInput) => callEdge<EdgeResult>('canvas-deploy-page', input),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['deploy_log'] });
      void qc.invalidateQueries({ queryKey: ['weeks'] });
      if (data?.status === 'BLOCKED') toast.warning(data.message || 'Page deploy blocked');
      else toast.success('Page deployed');
    },
    onError: (e: Error) => toast.error(`Page deploy failed: ${e.message}`),
  });
}

export function useDeployAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeployAssignmentInput) =>
      callEdge<EdgeResult>('canvas-deploy-assignment', input),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['deploy_log'] });
      void qc.invalidateQueries({ queryKey: ['pacing_rows'] });
      if (data?.status === 'BLOCKED') toast.warning(data.message || 'Assignment blocked by rule');
      else toast.success('Assignment deployed');
    },
    onError: (e: Error) => toast.error(`Assignment deploy failed: ${e.message}`),
  });
}

export function useFilesSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => callEdge<EdgeResult>('canvas-files-sync', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['files'] });
      toast.success('Canvas files synced');
    },
    onError: (e: Error) => toast.error(`File sync failed: ${e.message}`),
  });
}
