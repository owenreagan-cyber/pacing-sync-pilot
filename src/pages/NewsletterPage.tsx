import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Mail, Wand2, Send, Eye, Code, Copy, Plus, Trash2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useConfig } from '@/lib/config';
import { callEdge } from '@/lib/edge';
import { Label } from '@/components/ui/label';
import { generateHomeroomPageHtml } from '@/lib/canvas-html';

interface ContactEntry { name: string; role: string; email: string }
interface LinkEntry { label: string; url: string }

interface Newsletter {
  id: string;
  date_range: string | null;
  homeroom_notes: string | null;
  homeroom_notes_html?: string | null;
  birthdays: string | null;
  extra_sections: { title: string; body: string }[];
  html_content: string | null;
  status: string | null;
  posted_at: string | null;
  created_at: string | null;
  school_news?: string | null;
  points_of_contact?: ContactEntry[];
  quick_links?: LinkEntry[];
  footer_line?: string | null;
}

const DEFAULT_FOOTER = 'Thales Academy Grade 4A — Mr. Reagan';

export default function NewsletterPage() {
  const config = useConfig();
  const [newsletters, setNewsletters] = useState<Newsletter[]>([]);
  const [loading, setLoading] = useState(false);

  // Editor state
  const [pastedText, setPastedText] = useState('');
  const [dateRange, setDateRange] = useState('');
  const [homeroomNotes, setHomeroomNotes] = useState('');
  const [homeroomNotesHtml, setHomeroomNotesHtml] = useState('');
  const [birthdays, setBirthdays] = useState('');
  const [extraSections, setExtraSections] = useState<{ title: string; body: string }[]>([]);
  const [calendarEvents, setCalendarEvents] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [previewMode, setPreviewMode] = useState<'edit' | 'preview' | 'code'>('edit');
  const [activeNewsletterId, setActiveNewsletterId] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [schoolNews, setSchoolNews] = useState('');
  const [pointsOfContact, setPointsOfContact] = useState<ContactEntry[]>([]);
  const [quickLinks, setQuickLinks] = useState<LinkEntry[]>([]);
  const [footerLine, setFooterLine] = useState<string>(DEFAULT_FOOTER);

  useEffect(() => {
    loadNewsletters();
  }, []);

  const loadNewsletters = async () => {
    const { data } = await supabase.from('newsletters').select('*').order('created_at', { ascending: false }).limit(20);
    if (data) setNewsletters(data.map((n: any) => ({
      ...n,
      extra_sections: (n.extra_sections as any) || [],
      points_of_contact: Array.isArray(n.points_of_contact) ? n.points_of_contact : [],
      quick_links: Array.isArray(n.quick_links) ? n.quick_links : [],
    })) as Newsletter[]);
  };

  const handleExtract = async () => {
    if (!pastedText.trim()) { toast.error('Paste newsletter text first'); return; }
    setExtracting(true);
    try {
      const result = await callEdge<{
        date_range: string;
        homeroom_notes: string;
        birthdays: string;
        sections: { title: string; body: string }[];
      }>('newsletter-extract', { text: pastedText });

      setDateRange(result.date_range || '');
      setHomeroomNotes(result.homeroom_notes || '');
      setBirthdays(result.birthdays || '');
      setExtraSections(result.sections || []);
      toast.success('Content extracted!');
    } catch (e: any) {
      toast.error('Extraction failed', { description: e.message });
    }
    setExtracting(false);
  };

  const handlePolish = async () => {
    if (!homeroomNotes && extraSections.length === 0) { toast.error('Add content first'); return; }
    setPolishing(true);
    try {
      const result = await callEdge<{
        homeroom_notes: string;
        birthdays: string;
        sections: { title: string; body: string }[];
      }>('newsletter-extract', {
        action: 'polish',
        homeroom_notes: homeroomNotes,
        birthdays,
        sections: extraSections,
      });
      setHomeroomNotes(result.homeroom_notes || homeroomNotes);
      setBirthdays(result.birthdays || birthdays);
      if (result.sections?.length) setExtraSections(result.sections);
      toast.success('Content polished by AI!');
    } catch (e: any) {
      toast.error('Polish failed', { description: e.message });
    }
    setPolishing(false);
  };

  // Auto-rebuild preview when any field changes
  useEffect(() => {
    const html = generateHomeroomPageHtml({
      weekNum: 0,
      quarter: '',
      dateRange: dateRange || 'This Week',
      quarterColor: '#6644bb',
      calendarReminders: calendarEvents,
      homeroomNotesHtml: homeroomNotesHtml || undefined,
      homeroomNotes: homeroomNotes || undefined,
      birthdays,
      schoolNews,
      pointsOfContact,
      quickLinks,
      footer: footerLine || DEFAULT_FOOTER,
    });
    setHtmlContent(html);
  }, [dateRange, homeroomNotesHtml, homeroomNotes, birthdays, schoolNews, calendarEvents, pointsOfContact, quickLinks, footerLine]);

  const handleSave = async () => {
    const allSections = calendarEvents.trim()
      ? [{ title: 'Mark Your Calendars', body: calendarEvents }, ...extraSections]
      : extraSections;
    const payload = {
      date_range: dateRange,
      homeroom_notes: homeroomNotes,
      homeroom_notes_html: homeroomNotesHtml,
      birthdays,
      extra_sections: allSections,
      html_content: htmlContent,
      status: 'DRAFT',
      school_news: schoolNews,
      points_of_contact: pointsOfContact as any,
      quick_links: quickLinks as any,
      footer_line: footerLine || DEFAULT_FOOTER,
    };

    if (activeNewsletterId) {
      await supabase.from('newsletters').update(payload).eq('id', activeNewsletterId);
      toast.success('Newsletter updated');
    } else {
      const { data } = await supabase.from('newsletters').insert(payload).select('id').single();
      if (data) setActiveNewsletterId(data.id);
      toast.success('Newsletter saved');
    }
    loadNewsletters();
  };

  const handlePost = async () => {
    if (!htmlContent) { toast.error('Generate HTML first'); return; }
    setPosting(true);
    try {
      // QUEUE — does NOT publish to Canvas immediately. The Friday automation
      // (automation-friday-deploy) will pick up QUEUED newsletters at 4 PM ET
      // and deploy them to the Homeroom course (22254).
      const allSections = calendarEvents.trim()
        ? [{ title: 'Mark Your Calendars', body: calendarEvents }, ...extraSections]
        : extraSections;
      const payload = {
        date_range: dateRange,
        homeroom_notes: homeroomNotes,
        homeroom_notes_html: homeroomNotesHtml,
        birthdays,
        extra_sections: allSections,
        html_content: htmlContent,
        status: 'QUEUED',
        school_news: schoolNews,
        points_of_contact: pointsOfContact as any,
        quick_links: quickLinks as any,
        footer_line: footerLine || DEFAULT_FOOTER,
      };
      if (activeNewsletterId) {
        await supabase.from('newsletters').update(payload).eq('id', activeNewsletterId);
      } else {
        const { data } = await supabase.from('newsletters').insert(payload).select('id').single();
        if (data) setActiveNewsletterId(data.id);
      }
      toast.success('Newsletter queued', {
        description: 'It will deploy to Canvas Homeroom on Friday at 4 PM ET.',
      });
      loadNewsletters();
    } catch (e: any) {
      toast.error('Queue failed', { description: e.message });
    }
    setPosting(false);
  };

  const loadNewsletter = (n: Newsletter) => {
    setActiveNewsletterId(n.id);
    setDateRange(n.date_range || '');
    setHomeroomNotes(n.homeroom_notes || '');
    setHomeroomNotesHtml((n as any).homeroom_notes_html || '');
    setBirthdays(n.birthdays || '');
    const sections = n.extra_sections || [];
    const calSection = sections.find(s => s.title === 'Mark Your Calendars');
    setCalendarEvents(calSection?.body || '');
    setExtraSections(sections.filter(s => s.title !== 'Mark Your Calendars'));
    setHtmlContent(n.html_content || '');
    setSchoolNews(n.school_news || '');
    setPointsOfContact(Array.isArray(n.points_of_contact) ? n.points_of_contact : []);
    setQuickLinks(Array.isArray(n.quick_links) ? n.quick_links : []);
    setFooterLine(n.footer_line || DEFAULT_FOOTER);
    setPreviewMode('edit');
    toast.success('Loaded newsletter');
  };

  const handleNew = () => {
    setActiveNewsletterId(null);
    setDateRange(''); setHomeroomNotes(''); setHomeroomNotesHtml(''); setBirthdays('');
    setExtraSections([]); setCalendarEvents(''); setHtmlContent(''); setPastedText('');
    setSchoolNews(''); setPointsOfContact([]); setQuickLinks([]); setFooterLine(DEFAULT_FOOTER);
    setPreviewMode('edit');
  };

  const handleCopyLastWeek = async () => {
    const last = newsletters[0];
    if (!last) { toast.error('No previous newsletter found'); return; }
    if (!last.html_content?.trim()) { toast.error('Last newsletter has no saved HTML — save it first'); return; }

    setCopying(true);
    try {
      const today = new Date();
      const dow = today.getDay();
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const mon = new Date(today);
      mon.setDate(today.getDate() + mondayOffset);
      const fri = new Date(mon);
      fri.setDate(mon.getDate() + 4);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const { data, error } = await supabase.functions.invoke('newsletter-rollover', {
        body: { previousHtml: last.html_content, newStartDate: fmt(mon), newEndDate: fmt(fri) }
      });

      if (error) throw error;
      if (!data?.html) throw new Error(data?.error || 'No HTML returned');

      setHtmlContent(data.html);
      setActiveNewsletterId(null);
      setDateRange(`${mon.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${fri.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`);

      if (Array.isArray(last.points_of_contact) && last.points_of_contact.length) setPointsOfContact(last.points_of_contact);
      if (Array.isArray(last.quick_links) && last.quick_links.length) setQuickLinks(last.quick_links);
      setFooterLine(last.footer_line || DEFAULT_FOOTER);

      toast.success('Newsletter updated for new week — review and edit before saving');
    } catch (e: any) {
      toast.error('Rollover failed', { description: e.message });
    }
    setCopying(false);
  };

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Newsletter Builder</h1>
          <p className="text-muted-foreground mt-1">AI-assisted newsletter for Homeroom Canvas page</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleNew} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopyLastWeek} disabled={copying} className="gap-1.5">
            <Mail className="h-3.5 w-3.5" /> {copying ? 'Copying...' : 'Copy Last Week'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave} className="gap-1.5">
            Save Draft
          </Button>
          <Button size="sm" onClick={handlePost} disabled={posting || !htmlContent} className="gap-1.5">
            <Send className="h-3.5 w-3.5" /> Queue for Friday
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* LEFT — Editor */}
        <div className="xl:col-span-2 space-y-4">
          {/* AI extraction */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-primary" /> AI Text Extraction
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder="Paste raw newsletter text here and click Extract..."
                value={pastedText}
                onChange={e => setPastedText(e.target.value)}
                rows={5}
                className="text-sm"
              />
              <Button size="sm" onClick={handleExtract} disabled={extracting} className="gap-1.5">
                <Wand2 className="h-3.5 w-3.5" />
                {extracting ? 'Extracting...' : 'Extract with AI'}
              </Button>
            </CardContent>
          </Card>

          {/* Manual fields */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <Input placeholder="Date range (e.g. Jan 13–17)" value={dateRange} onChange={e => setDateRange(e.target.value)} />
              
              <div className="space-y-1">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Homeroom Notes — Rich HTML</Label>
                <p className="text-[11px] text-muted-foreground">Use HTML tags: &lt;p&gt;, &lt;strong&gt;, &lt;ul&gt;&lt;li&gt;, &lt;a href="..."&gt;. When filled, this replaces the plain notes field below.</p>
                <Textarea
                  value={homeroomNotesHtml}
                  onChange={e => setHomeroomNotesHtml(e.target.value)}
                  rows={8}
                  className="text-xs font-mono"
                  placeholder={'<p><strong>Spring Performance</strong></p>\n<p>Tuesday May 19th at 6:00 PM.</p>'}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase">Homeroom Notes</label>
                <Textarea value={homeroomNotes} onChange={e => setHomeroomNotes(e.target.value)} rows={4} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase">Birthdays</label>
                <Input value={birthdays} onChange={e => setBirthdays(e.target.value)} placeholder="Names..." />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-medium">Mark Your Calendars</Label>
                <Textarea
                  placeholder={"May 8th: Progress Reports\nMay 11th: CLT Testing begins\nMay 19th (6:00): Spring Performance"}
                  value={calendarEvents}
                  onChange={(e) => setCalendarEvents(e.target.value)}
                  rows={5}
                  className="text-sm font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  One event per line. Will appear in the "Mark Your Calendars" section.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Extra Sections</label>
                  <Button size="sm" variant="ghost" onClick={() => setExtraSections([...extraSections, { title: '', body: '' }])}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                {extraSections.map((sec, i) => (
                  <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                    <Input placeholder="Title" value={sec.title} onChange={e => {
                      const s = [...extraSections]; s[i].title = e.target.value; setExtraSections(s);
                    }} className="text-sm" />
                    <Input placeholder="Body" value={sec.body} onChange={e => {
                      const s = [...extraSections]; s[i].body = e.target.value; setExtraSections(s);
                    }} className="text-sm" />
                    <Button size="sm" variant="ghost" onClick={() => setExtraSections(extraSections.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-medium">School News</Label>
                <Textarea
                  value={schoolNews}
                  onChange={(e) => setSchoolNews(e.target.value)}
                  placeholder="School-wide announcements (HTML allowed)..."
                  rows={3}
                  className="text-sm"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Points of Contact</label>
                  <Button size="sm" variant="ghost" onClick={() => setPointsOfContact([...pointsOfContact, { name: '', role: '', email: '' }])}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                {pointsOfContact.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1.4fr_auto] gap-2">
                    <Input placeholder="Name" value={c.name} onChange={e => {
                      const arr = [...pointsOfContact]; arr[i] = { ...arr[i], name: e.target.value }; setPointsOfContact(arr);
                    }} className="text-sm" />
                    <Input placeholder="Role" value={c.role} onChange={e => {
                      const arr = [...pointsOfContact]; arr[i] = { ...arr[i], role: e.target.value }; setPointsOfContact(arr);
                    }} className="text-sm" />
                    <Input placeholder="Email" value={c.email} onChange={e => {
                      const arr = [...pointsOfContact]; arr[i] = { ...arr[i], email: e.target.value }; setPointsOfContact(arr);
                    }} className="text-sm" />
                    <Button size="sm" variant="ghost" onClick={() => setPointsOfContact(pointsOfContact.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Quick Links</label>
                  <Button size="sm" variant="ghost" onClick={() => setQuickLinks([...quickLinks, { label: '', url: '' }])}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                {quickLinks.map((l, i) => (
                  <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                    <Input placeholder="Label" value={l.label} onChange={e => {
                      const arr = [...quickLinks]; arr[i] = { ...arr[i], label: e.target.value }; setQuickLinks(arr);
                    }} className="text-sm" />
                    <Input placeholder="https://..." value={l.url} onChange={e => {
                      const arr = [...quickLinks]; arr[i] = { ...arr[i], url: e.target.value }; setQuickLinks(arr);
                    }} className="text-sm" />
                    <Button size="sm" variant="ghost" onClick={() => setQuickLinks(quickLinks.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-medium">Footer Line</Label>
                <Input
                  value={footerLine}
                  onChange={(e) => setFooterLine(e.target.value)}
                  placeholder={DEFAULT_FOOTER}
                  className="text-sm"
                />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={handlePolish} disabled={polishing} className="gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> {polishing ? 'Polishing...' : 'AI Polish'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Preview */}
          {htmlContent && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant={previewMode === 'preview' ? 'default' : 'outline'} onClick={() => setPreviewMode('preview')} className="gap-1">
                    <Eye className="h-3 w-3" /> Preview
                  </Button>
                  <Button size="sm" variant={previewMode === 'code' ? 'default' : 'outline'} onClick={() => setPreviewMode('code')} className="gap-1">
                    <Code className="h-3 w-3" /> HTML
                  </Button>
                  {previewMode === 'code' && (
                    <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(htmlContent); toast.success('Copied!'); }} className="gap-1 ml-auto">
                      <Copy className="h-3 w-3" /> Copy
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {previewMode === 'preview' ? (
                  <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
                ) : (
                  <pre className="text-xs bg-slate-950 text-slate-100 p-4 rounded-lg overflow-auto max-h-[400px] whitespace-pre-wrap font-mono">
                    {htmlContent}
                  </pre>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT — Saved newsletters */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Saved Newsletters</h3>
          {newsletters.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet</p>
          ) : newsletters.map(n => (
            <Card key={n.id} className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => loadNewsletter(n)}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{n.date_range || 'Untitled'}</p>
                    <p className="text-xs text-muted-foreground">
                      {n.created_at ? new Date(n.created_at).toLocaleDateString() : ''}
                    </p>
                  </div>
                  <Badge className={`text-[10px] ${n.status === 'POSTED' ? 'bg-success text-success-foreground' : ''}`}>
                    {n.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
