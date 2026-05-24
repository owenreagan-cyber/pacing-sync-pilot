import { useEffect, useState } from 'react';
import { useConfig } from '@/lib/config';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { clearSchoolCalendarCache } from '@/lib/school-calendar';

const EVENT_TYPES = ['holiday', 'no_school', 'half_day', 'track_out', 'testing_window', 'early_release'] as const;

const EVENT_TYPE_STYLES: Record<string, string> = {
  holiday: 'bg-red-500/15 text-red-400 border-red-500/30',
  no_school: 'bg-red-500/15 text-red-400 border-red-500/30',
  track_out: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  testing_window: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  half_day: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  early_release: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
};

interface CalendarRow {
  id: string;
  date: string;
  event_type: string;
  label: string;
}

function CalendarTab() {
  const [rows, setRows] = useState<CalendarRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState('');
  const [eventType, setEventType] = useState<string>('holiday');
  const [label, setLabel] = useState('');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('school_calendar')
      .select('id, date, event_type, label')
      .eq('school_year', '2025-2026')
      .order('date');
    setRows((data as CalendarRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const addEvent = async () => {
    if (!date || !label.trim()) {
      toast.error('Date and label are required');
      return;
    }
    const { error } = await supabase
      .from('school_calendar')
      .insert({ school_year: '2025-2026', date, event_type: eventType, label: label.trim() });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Event added');
    setDate(''); setLabel(''); setEventType('holiday');
    clearSchoolCalendarCache();
    void load();
  };

  const deleteEvent = async (id: string) => {
    const { error } = await supabase.from('school_calendar').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    clearSchoolCalendarCache();
    void load();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Calendar Event</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Type</label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-48">
              <label className="text-xs text-muted-foreground">Label</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Labor Day" />
            </div>
            <Button onClick={addEvent} className="gap-1.5"><Plus className="h-4 w-4" /> Add</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">School Calendar 2025-2026 ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events.</p>
          ) : (
            <div className="space-y-1">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center gap-3 text-sm border border-border rounded-md px-3 py-2">
                  <span className="font-mono text-xs text-muted-foreground w-24">{r.date}</span>
                  <Badge variant="outline" className={EVENT_TYPE_STYLES[r.event_type] || ''}>
                    {r.event_type}
                  </Badge>
                  <span className="flex-1">{r.label}</span>
                  <Button variant="ghost" size="icon" onClick={() => deleteEvent(r.id)} className="h-7 w-7">
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const config = useConfig();

  return (
    <Tabs defaultValue="general" className="space-y-4">
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
      </TabsList>

      <TabsContent value="general" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Canvas Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Base URL: </span>
              <span className="font-mono text-xs">{config?.canvasBaseUrl}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Course IDs: </span>
              <pre className="text-xs font-mono mt-1 bg-muted p-3 rounded-lg overflow-auto">
                {JSON.stringify(config?.courseIds, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Spelling Word Bank</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Word bank has{' '}
              <span className="font-semibold text-foreground">
                {Object.values(config?.spellingWordBank ?? {}).filter(
                  (list) => Array.isArray(list) && list.length > 0
                ).length}
              </span>{' '}
              of 24 lists populated
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">App Info</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Thales Academic OS v14.1.0</p>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="calendar">
        <CalendarTab />
      </TabsContent>
    </Tabs>
  );
}
