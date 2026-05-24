import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ShieldCheck,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ValidationResult, CheckLevel } from '@/lib/pre-deploy-validator';

interface SafetyDiffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  week: number;
  action: 'DEPLOY_AGENDAS' | 'DEPLOY_ASSIGNMENTS';
  itemCount: number;
  items: { label: string; subject: string }[];
  onApprove: () => Promise<void>;
  /** Optional 6-check validation result. When omitted, modal works as before. */
  validation?: ValidationResult;
}

const LEVEL_CONFIG: Record<CheckLevel, {
  icon: typeof CheckCircle2;
  text: string;
  bg: string;
  border: string;
  label: string;
}> = {
  pass: {
    icon: CheckCircle2,
    text: 'text-success',
    bg: 'bg-success/10',
    border: 'border-success/30',
    label: 'OK',
  },
  warn: {
    icon: AlertTriangle,
    text: 'text-warning',
    bg: 'bg-warning/10',
    border: 'border-warning/30',
    label: 'WARN',
  },
  fail: {
    icon: XCircle,
    text: 'text-destructive',
    bg: 'bg-destructive/10',
    border: 'border-destructive/30',
    label: 'FAIL',
  },
};

export default function SafetyDiffModal({
  open,
  onOpenChange,
  month,
  week,
  action,
  itemCount,
  items,
  onApprove,
  validation,
}: SafetyDiffModalProps) {
  const [executing, setExecuting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const actionLabel = action === 'DEPLOY_AGENDAS' ? 'Agenda Pages' : 'Assignments';

  const blocked = validation?.hasFailures ?? false;
  const needsAck = validation?.hasWarnings ?? false;
  const canApprove = !blocked && (!needsAck || acknowledged);

  const summary = useMemo(() => {
    if (!validation) return null;
    const counts = { pass: 0, warn: 0, fail: 0 };
    for (const c of validation.checks) counts[c.level]++;
    return counts;
  }, [validation]);

  const handleApprove = async () => {
    setExecuting(true);
    await onApprove();
    setExecuting(false);
    setAcknowledged(false);
    onOpenChange(false);
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-warning" />
            Safety Diff — Confirm Deployment
          </DialogTitle>
          <DialogDescription>
            Review the following changes and safety checks before executing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Target summary */}
          <div className="rounded-lg bg-muted p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Target</span>
              <span className="font-semibold">{month} Week {week}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Action</span>
              <Badge variant="outline" className="text-xs">{actionLabel}</Badge>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total items to sync</span>
              <span className="font-bold text-primary">{itemCount}</span>
            </div>
          </div>

          {/* Validation checks */}
          {validation && summary && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Pre-Deploy Safety Checks
                </h3>
                <div className="flex gap-1.5 text-[10px]">
                  <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                    {summary.pass} OK
                  </Badge>
                  {summary.warn > 0 && (
                    <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
                      {summary.warn} WARN
                    </Badge>
                  )}
                  {summary.fail > 0 && (
                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                      {summary.fail} FAIL
                    </Badge>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                {validation.checks.map((check) => {
                  const cfg = LEVEL_CONFIG[check.level];
                  const Icon = cfg.icon;
                  const isOpen = expanded.has(check.id);
                  const hasItems = check.items && check.items.length > 0;

                  return (
                    <div
                      key={check.id}
                      className={`rounded-md border ${cfg.border} ${cfg.bg}`}
                    >
                      <button
                        type="button"
                        onClick={() => hasItems && toggle(check.id)}
                        className="w-full flex items-center gap-2 p-2.5 text-left"
                        disabled={!hasItems}
                      >
                        <Icon className={`h-4 w-4 shrink-0 ${cfg.text}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{check.label}</span>
                            <Badge variant="outline" className={`text-[9px] ${cfg.text} ${cfg.border}`}>
                              {cfg.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{check.detail}</p>
                        </div>
                        {hasItems && (
                          isOpen ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          )
                        )}
                      </button>
                      {isOpen && hasItems && (
                        <div className="border-t border-border/50 px-3 py-2 space-y-0.5 max-h-32 overflow-auto">
                          {check.items.map((item, i) => (
                            <div
                              key={i}
                              className="text-[11px] font-mono text-muted-foreground"
                            >
                              • {item}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {needsAck && !blocked && (
                <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 cursor-pointer">
                  <Checkbox
                    checked={acknowledged}
                    onCheckedChange={(v) => setAcknowledged(v === true)}
                    className="mt-0.5"
                  />
                  <span className="text-xs">
                    I acknowledge the warnings above and want to proceed with deployment anyway.
                  </span>
                </label>
              )}

              {blocked && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  <strong>Deployment blocked.</strong> Resolve the failed checks above before proceeding.
                </div>
              )}
            </div>
          )}

          {/* Item list */}
          {items.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Items
              </h3>
              <div className="max-h-48 overflow-auto rounded-lg border p-3 space-y-1">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Badge className="text-[9px] bg-primary/10 text-primary border-primary/20" variant="outline">
                      {item.subject}
                    </Badge>
                    <span className="text-foreground">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={executing}>
            Cancel
          </Button>
          <Button
            onClick={handleApprove}
            disabled={executing || !canApprove}
            className="gap-1.5 bg-success hover:bg-success/90 text-success-foreground"
          >
            {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Approve & Execute Sync
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
