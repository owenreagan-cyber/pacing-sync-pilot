export type StepStatus = 'idle' | 'ready' | 'deploying' | 'complete' | 'error';

export interface StepRunSummary {
  message: string;
  generated?: number;
  edited?: number;
  deployed?: number;
  errors?: number;
}

export interface StepContext {
  quarter: string;
  week: number;
}

export interface StepContract {
  load: () => Promise<void>;
  validate: () => Promise<{ valid: boolean; message?: string }>;
  buildPreview: () => Promise<StepRunSummary>;
  deploySelected: () => Promise<StepRunSummary>;
  hasPendingChanges: boolean;
  lastRunSummary: StepRunSummary | null;
}
