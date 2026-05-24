import { useEffect, useState } from 'react';
import { Sparkles, Copy, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { getSuggestions, type PatternType, type Suggestion } from '@/lib/canvas-brain-suggest';
import { toast } from 'sonner';

interface Props {
  type: PatternType;
  subject: string;
  label?: string;
  onPick?: (value: string) => void;
}

/**
 * Compact strip of learned Canvas patterns for a given subject + type.
 * Click to copy or call onPick. Shows nothing if no patterns learned yet.
 */
export function StyleSuggestions({ type, subject, label, onPick }: Props) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Institutional brand color — AI suggestions MUST NOT propose changing this.
  const INSTITUTIONAL_PRIMARY = '#0065a7';

  useEffect(() => {
    getSuggestions(type, subject, 5)
      .then((all) => {
        // Suggestion lockdown: drop any pattern whose value contains a hex
        // color that would override the institutional primary #0065a7.
        const locked = (all || []).filter((s) => {
          const v = (s?.value ?? '').toLowerCase();
          const hexes = v.match(/#[0-9a-f]{3,8}\b/g) || [];
          if (hexes.length === 0) return true;
          return hexes.every((h) => h === INSTITUTIONAL_PRIMARY.toLowerCase());
        });
        setItems(locked);
      })
      .catch(() => setItems([]));
  }, [type, subject]);

  if (items.length === 0) return null;

  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="uppercase tracking-wider">
          {label ?? `Learned ${type.replace(/_/g, ' ')} — ${subject}`}
        </span>
      </div>
      <div className="space-y-1">
        {items.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              if (onPick) onPick(s.value);
              else void navigator.clipboard.writeText(s.value);
              setCopiedIdx(i);
              toast.success(onPick ? 'Applied' : 'Copied');
              setTimeout(() => setCopiedIdx(null), 1200);
            }}
            className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
          >
            <span className="font-mono text-xs flex-1 truncate">{s.value}</span>
            <div className="w-16 shrink-0">
              <Progress value={s.confidence} className="h-1" />
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {s.confidence}%
            </Badge>
            {copiedIdx === i ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
