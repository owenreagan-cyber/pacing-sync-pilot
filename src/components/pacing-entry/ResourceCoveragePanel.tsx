/**
 * ResourceCoveragePanel — turns silent content_map misses into a visible,
 * one-click fix.
 *
 * Renders the output of `resourceCoverage(rows, contentMap)` as a collapsible
 * card: total counts up top, then a list of every unresolved `lesson_ref`
 * emitted by this week's rows. Clicking a missing ref opens a popover to
 * paste a Canvas URL — we upsert into `content_map` and the coverage refreshes.
 *
 * This is Item D from the pacing pipeline redesign (.lovable/plan.md).
 */
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CheckCircle2, AlertCircle, Link2, ChevronDown, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { resourceCoverage, type PacingRowLike } from '@/lib/pacing/select';
import type { ContentMapEntry } from '@/lib/auto-link';

interface Props {
  rows: PacingRowLike[];
  contentMap: ContentMapEntry[];
  /** Called after a successful mapping so the parent can refresh contentMap. */
  onMapped?: () => void;
}

export function ResourceCoveragePanel({ rows, contentMap, onMapped }: Props) {
  const coverage = useMemo(() => resourceCoverage(rows, contentMap), [rows, contentMap]);
  const [open, setOpen] = useState(false);

  const resolved = coverage.filter((c) => c.resolved).length;
  const missing = coverage.length - resolved;

  if (coverage.length === 0) return null;

  return (
    <Card className={missing > 0 ? 'border-amber-500/40' : 'border-emerald-500/30'}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer py-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm flex items-center gap-2">
              {missing > 0 ? (
                <AlertCircle className="h-4 w-4 text-amber-500" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              )}
              Resource Coverage
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                {resolved} resolved
              </Badge>
              {missing > 0 && (
                <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30">
                  {missing} missing
                </Badge>
              )}
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-1">
            {coverage.map((item) => (
              <CoverageRow key={item.ref} item={item} onMapped={onMapped} />
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function CoverageRow({
  item,
  onMapped,
}: {
  item: ReturnType<typeof resourceCoverage>[number];
  onMapped?: () => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState(item.canonical_name ?? '');
  const [saving, setSaving] = useState(false);

  // Guess subject from ref prefix for the content_map insert.
  const guessedSubject = item.subject ?? guessSubjectFromRef(item.ref);

  const saveMapping = async () => {
    if (!url.trim()) {
      toast.error('Paste a Canvas URL first');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('content_map')
      .upsert(
        {
          lesson_ref: item.ref,
          subject: guessedSubject ?? 'Math',
          canvas_url: url.trim(),
          canonical_name: name.trim() || item.ref,
        },
        { onConflict: 'lesson_ref' },
      );
    setSaving(false);
    if (error) {
      toast.error('Could not save mapping', { description: error.message });
      return;
    }
    toast.success(`Mapped ${item.ref}`);
    setPopoverOpen(false);
    onMapped?.();
  };

  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {item.resolved ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
        ) : (
          <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
        )}
        <span className="font-mono text-[11px] truncate">{item.ref}</span>
        {item.canonical_name && (
          <span className="text-muted-foreground truncate">— {item.canonical_name}</span>
        )}
      </div>
      {item.resolved && item.canvas_url ? (
        <a
          href={item.canvas_url}
          target="_blank"
          rel="noopener"
          className="text-primary hover:underline inline-flex items-center gap-1"
        >
          Open <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1">
              <Link2 className="h-3 w-3" /> Map…
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-2">
            <div className="text-xs font-semibold">Map {item.ref}</div>
            <Input
              placeholder="Canvas URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
              placeholder="Canonical display name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-xs"
            />
            <div className="text-[10px] text-muted-foreground">
              Subject: {guessedSubject ?? 'Math (default)'}
            </div>
            <Button size="sm" onClick={saveMapping} disabled={saving} className="w-full h-8 text-xs">
              {saving ? 'Saving…' : 'Save mapping'}
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function guessSubjectFromRef(ref: string): string | null {
  if (ref.startsWith('Math_') || ref === 'HW_Evens' || ref === 'HW_Odds') return 'Math';
  if (ref.startsWith('Reading_')) return 'Reading';
  if (ref.startsWith('Spelling_')) return 'Spelling';
  if (ref.startsWith('Classroom_Practice_')) return 'Language Arts';
  return null;
}
