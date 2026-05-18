// supabase/functions/canvas-deployer/index.ts
// Thales Academic OS — CanvasDeployer Edge Function
// Handles: Assignments, Agenda Pages, Announcements, Front Page Protection

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Course Routing ───────────────────────────────────────────
const COURSE_IDS: Record<string, number> = {
  Math: 21957,
  LA: 21944,
  "Language Arts": 21944,
  Reading: 21919,
  Spelling: 21919,
  History: 21934,
  Science: 21970,
  Homeroom: 22254,
};

const TOGETHER_SUBJECTS = ["Reading", "Spelling"];

// ─── CIDI Labs Design Tokens ──────────────────────────────────
const QUARTER_COLORS: Record<string, string> = {
  Q2: "#0065a7",
  Q3: "#6644bb",
  Q4: "#c87800",
};

const CIDI = {
  reminder: "#c51062",
  resource: "#00c0a5",
  daily: "#0065a7",
  inClassHome: "#333333",
};

// ─── Assignment Group Mapping ─────────────────────────────────
interface AssignmentGroupMapping {
  group_name: string;
  points: number;
  grading_type: string;
  omit_from_final?: boolean;
}

const ASSIGNMENT_GROUPS: Record<string, AssignmentGroupMapping> = {
  "Math Tests": {
    group_name: "Written Assessments",
    points: 100,
    grading_type: "points",
  },
  "Math Fact Test": {
    group_name: "Fact Assessments",
    points: 100,
    grading_type: "points",
    omit_from_final: false,
  },
  "Math Homework": {
    group_name: "Homework/Class Work",
    points: 100,
    grading_type: "points",
  },
  "Math Study Guide": {
    group_name: "Homework/Class Work",
    points: 0,
    grading_type: "pass_fail",
    omit_from_final: true,
  },
};

// ─── Types ────────────────────────────────────────────────────
interface PacingRow {
  week: number;
  date: string;
  day: string;
  subject: string;
  lesson_num: number | null;
  lesson_title: string;
  type: string;
  create_assign: boolean;
  create_announce: boolean;
  resource_pdf: string | null;
  assignment_title: string | null;
  assignment_group: string | null;
  points: number | null;
  grading_type: string | null;
  due_date_time: string | null;
  flags: string | null;
  object_id: string | null;
}

interface DeployResult {
  success: boolean;
  objectId?: string;
  error?: string;
  subject: string;
  type: string;
}

// ─── Canvas API Client ────────────────────────────────────────
class CanvasDeployer {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    let normalized = baseUrl.trim();
    if (!normalized.startsWith("http")) normalized = `https://${normalized}`;
    this.baseUrl = normalized.replace(/\/+$/, "");
    this.token = token;
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  private courseUrl(subject: string): string {
    const courseId = COURSE_IDS[subject];
    if (!courseId) throw new Error(`Unknown subject: ${subject}`);
    return `${this.baseUrl}/api/v1/courses/${courseId}`;
  }

  // ── Front Page Protection (MANDATORY) ──
  private async getPageInfo(
    subject: string,
    pageUrl: string
  ): Promise<{ exists: boolean; isFrontPage: boolean }> {
    const res = await fetch(`${this.courseUrl(subject)}/pages/${pageUrl}`, {
      headers: this.headers(),
    });

    if (res.status === 404) {
      return { exists: false, isFrontPage: false };
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GET page failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    return { exists: true, isFrontPage: data.front_page === true };
  }

  // ── Create or Update Page with Front Page Protection ──
  async upsertPage(
    subject: string,
    pageUrl: string,
    title: string,
    htmlBody: string
  ): Promise<string> {
    const { exists, isFrontPage } = await this.getPageInfo(subject, pageUrl);

    const payload: Record<string, unknown> = {
      wiki_page: {
        title,
        body: htmlBody,
        // MANDATORY: if front_page is true, published MUST be true
        ...(isFrontPage ? { published: true } : {}),
      },
    };

    const method = exists ? "PUT" : "POST";
    const url = exists
      ? `${this.courseUrl(subject)}/pages/${pageUrl}`
      : `${this.courseUrl(subject)}/pages`;

    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} page failed: ${res.status} ${text}`);
    }

    const result = await res.json();
    return result.url;
  }

  // ── Create Assignment ──
  async createAssignment(
    subject: string,
    row: PacingRow,
    resourceUrl?: string
  ): Promise<string> {
    let title = row.assignment_title || `${row.subject} ${row.lesson_title}`;

    // Math Evens/Odds rule
    if (
      subject === "Math" &&
      row.lesson_num &&
      !String(row.type || "").toLowerCase().includes("test") &&
      !String(row.assignment_group || "").toLowerCase().includes("test") &&
      !String(row.assignment_group || "").toLowerCase().includes("study guide")
    ) {
      title += row.lesson_num % 2 === 0 ? " Evens" : " Odds";
    }

    // Build HTML description with embedded resource links
    let description = `<p>${title}</p>`;
    if (resourceUrl) {
      description += `<p><a href="${resourceUrl}" target="_blank">\uD83D\uDCC4 Download Resource</a></p>`;
    }

    // LA Jingles link
    if (subject === "LA" || subject === "Language Arts") {
      description += `<p><a href="https://youtube.com/playlist?list=PLKTUEjoI9EhsLRrAQwC9hOp9MJMcXOG54" target="_blank">\uD83C\uDFB5 LA Jingles Playlist</a></p>`;
    }

    const groupMapping = row.assignment_group
      ? ASSIGNMENT_GROUPS[row.assignment_group]
      : null;

    const payload = {
      assignment: {
        name: title,
        description,
        points_possible: row.points || groupMapping?.points || 100,
        grading_type: row.grading_type || groupMapping?.grading_type || "points",
        due_at: row.due_date_time,
        published: true,
        ...(groupMapping?.omit_from_final
          ? { omit_from_final_grade: true }
          : {}),
      },
    };

    const res = await fetch(`${this.courseUrl(subject)}/assignments`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Create assignment failed: ${res.status} ${text}`);
    }

    const result = await res.json();
    return String(result.id);
  }

  // ── Create Announcement (Friday 4PM Queue) ──
  async createAnnouncement(
    subject: string,
    title: string,
    htmlMessage: string,
    delayedPostAt?: string
  ): Promise<string> {
    const payload = {
      title,
      message: htmlMessage,
      is_announcement: true,
      published: true,
      ...(delayedPostAt ? { delayed_post_at: delayedPostAt } : {}),
    };

    const res = await fetch(
      `${this.courseUrl(subject)}/discussion_topics`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Create announcement failed: ${res.status} ${text}`);
    }

    const result = await res.json();
    return String(result.id);
  }

  // ── Together Logic (Reading + Spelling) ──
  isTogether(subject: string): boolean {
    return TOGETHER_SUBJECTS.includes(subject);
  }

  // ── Generate CIDI Labs Agenda Page HTML ──
  generateAgendaHtml(
    rows: PacingRow[],
    quarter: string,
    assignmentUrls: Record<string, string>
  ): string {
    const bannerColor = QUARTER_COLORS[quarter] || QUARTER_COLORS.Q2;

    const dailyBlocks = rows
      .map((row) => {
        const lessonLabel = `Lesson ${row.lesson_num || ""}`.trim();
        const inClass = `<h4 class="kl_solid_border" style="background-color: ${CIDI.inClassHome}; color: #ffffff; padding: 8px;">In Class</h4>
<ul><li>${lessonLabel}</li></ul>`;

        // At Home section — ONLY if there's a linked assignment
        const assignmentKey = `${row.subject}_${row.lesson_num}`;
        const assignmentUrl = assignmentUrls[assignmentKey];
        let atHome = "";
        if (assignmentUrl) {
          atHome = `<h4 class="kl_solid_border" style="background-color: ${CIDI.inClassHome}; color: #ffffff; padding: 8px;">At Home</h4>
<ul><li><a href="${assignmentUrl}">\uD83D\uDCDD ${row.assignment_title || lessonLabel}</a></li></ul>`;
        }
        // Omission Rule: if no homework, omit At Home entirely

        return `<h3 style="background-color: ${CIDI.daily}; color: #ffffff; padding: 10px; border-radius: 4px;">${row.day} \u2014 ${row.date}</h3>
${inClass}
${atHome}`;
      })
      .join("\n");

    return `<div id="kl_wrapper_3" class="kl_circle_left kl_wrapper">
<div id="kl_banner" style="background-color: ${bannerColor}; color: #ffffff; padding: 20px; text-align: center; border-radius: 8px;">
<h2>Week ${rows[0]?.week || ""} Agenda</h2>
</div>

<div id="kl_custom_block_0" style="margin: 16px 0;">
<h3 style="background-color: ${CIDI.reminder}; color: #ffffff; padding: 10px; border-radius: 4px;">\uD83D\uDCE2 Reminders</h3>
<ul><li>Check Canvas daily for updates.</li></ul>
</div>

<div id="kl_custom_block_1" style="margin: 16px 0;">
<h3 style="background-color: ${CIDI.resource}; color: #ffffff; padding: 10px; border-radius: 4px;">\uD83D\uDCDA Resources</h3>
<ul><li>All resources are linked in assignments below.</li></ul>
</div>

${dailyBlocks}
</div>`;
  }

  // ── Generate Announcement HTML ──
  generateAnnouncementHtml(
    row: PacingRow,
    resourceUrl?: string,
    studyGuideUrl?: string
  ): string {
    let body = `<p>\uD83D\uDCE2 <strong>${row.assignment_title || row.lesson_title}</strong></p>`;

    // Reading test: tracking and tapping, 100 wpm
    if (row.subject === "Reading" && row.type === "Test") {
      body += `<p>Remember: <strong>tracking and tapping</strong>, aim for <strong>100 words per minute</strong>.</p>`;
    }

    // Spelling test: words 21-25
    if (
      row.subject === "Spelling" &&
      row.type === "Test" &&
      row.flags?.includes("words_21_25")
    ) {
      body += `<p>Study <strong>words 21\u201325</strong> from your cumulative word bank.</p>`;
    }

    // Embedded resource/study guide links
    if (resourceUrl) {
      body += `<p><a href="${resourceUrl}">\uD83D\uDCC4 Download Resource</a></p>`;
    }
    if (studyGuideUrl) {
      body += `<p><a href="${studyGuideUrl}">\uD83D\uDCD6 Study Guide</a></p>`;
    }

    return body;
  }

  // ── Full Deploy Pipeline ──
  async deploy(
    rows: PacingRow[],
    quarter: string
  ): Promise<DeployResult[]> {
    const results: DeployResult[] = [];
    const assignmentUrls: Record<string, string> = {};

    // Group together subjects
    const togetherRows = rows.filter((r) => this.isTogether(r.subject));
    const regularRows = rows.filter((r) => !this.isTogether(r.subject));

    // 1. Create Assignments
    for (const row of rows) {
      if (!row.create_assign) continue;
      try {
        const rowType = String(row.type || "").toLowerCase();
        const isMathTest = row.subject === "Math" && rowType.includes("test");

        const variants: Array<{ keySuffix: string; payload: PacingRow; resultType: string }> = isMathTest
          ? [
              {
                keySuffix: "written_test",
                payload: {
                  ...row,
                  assignment_title: `Math Lesson ${row.lesson_num ?? ""} Written Test`.trim(),
                  assignment_group: "Math Tests",
                  points: 100,
                  grading_type: "points",
                  lesson_num: null,
                },
                resultType: "assignment_written_test",
              },
              {
                keySuffix: "fact_test",
                payload: {
                  ...row,
                  assignment_title: `Math Fact Test ${row.lesson_num ?? ""}`.trim(),
                  assignment_group: "Math Fact Test",
                  points: 100,
                  grading_type: "points",
                  lesson_num: null,
                },
                resultType: "assignment_fact_test",
              },
              {
                keySuffix: "study_guide",
                payload: {
                  ...row,
                  assignment_title: `Math Study Guide ${row.lesson_num ?? ""}`.trim(),
                  assignment_group: "Math Study Guide",
                  points: 0,
                  grading_type: "pass_fail",
                  lesson_num: null,
                },
                resultType: "assignment_study_guide",
              },
            ]
          : [{ keySuffix: "default", payload: row, resultType: "assignment" }];

        for (const variant of variants) {
          const objId = await this.createAssignment(variant.payload.subject, variant.payload);
          const url = `${this.courseUrl(variant.payload.subject)}/assignments/${objId}`;
          const key = `${row.subject}_${row.lesson_num}_${row.type || "assignment"}_${variant.keySuffix}`;
          assignmentUrls[key] = url;
          const legacyKey = `${row.subject}_${row.lesson_num}`;
          if (!assignmentUrls[legacyKey]) assignmentUrls[legacyKey] = url;
          results.push({
            success: true,
            objectId: objId,
            subject: row.subject,
            type: variant.resultType,
          });
        }
      } catch (e) {
        results.push({
          success: false,
          error: e instanceof Error ? e.message : "Unknown error",
          subject: row.subject,
          type: "assignment",
        });
      }
    }

    // 2. Create Agenda Pages
    // Regular subjects: one page each
    const subjectGroups = new Map<string, PacingRow[]>();
    for (const row of regularRows) {
      const existing = subjectGroups.get(row.subject) || [];
      existing.push(row);
      subjectGroups.set(row.subject, existing);
    }

    for (const [subject, subjectRows] of subjectGroups) {
      try {
        const html = this.generateAgendaHtml(subjectRows, quarter, assignmentUrls);
        const pageUrl = `week-${subjectRows[0].week}-${subject.toLowerCase()}-agenda`;
        await this.upsertPage(
          subject,
          pageUrl,
          `Week ${subjectRows[0].week} ${subject} Agenda`,
          html
        );
        results.push({ success: true, subject, type: "agenda_page" });
      } catch (e) {
        results.push({
          success: false,
          error: e instanceof Error ? e.message : "Unknown error",
          subject,
          type: "agenda_page",
        });
      }
    }

    // Together subjects (Reading+Spelling): merged into single page on course 21919
    if (togetherRows.length > 0) {
      try {
        const html = this.generateAgendaHtml(togetherRows, quarter, assignmentUrls);
        const pageUrl = `week-${togetherRows[0].week}-reading-spelling-agenda`;
        // Use "Reading" for the course ID (same as Spelling: 21919)
        await this.upsertPage(
          "Reading",
          pageUrl,
          `Week ${togetherRows[0].week} Reading & Spelling Agenda`,
          html
        );
        results.push({
          success: true,
          subject: "Reading/Spelling",
          type: "agenda_page",
        });
      } catch (e) {
        results.push({
          success: false,
          error: e instanceof Error ? e.message : "Unknown error",
          subject: "Reading/Spelling",
          type: "agenda_page",
        });
      }
    }

    // 3. Create Announcements (Friday 4:00 PM)
    for (const row of rows) {
      if (!row.create_announce) continue;
      try {
        const announcementHtml = this.generateAnnouncementHtml(row);
        // Together subjects: single merged announcement
        const targetSubject = this.isTogether(row.subject) ? "Reading" : row.subject;
        const delayedPost = getNextFriday4PM(row.date);

        await this.createAnnouncement(
          targetSubject,
          `${row.assignment_title || row.lesson_title} \u2014 Reminder`,
          announcementHtml,
          delayedPost
        );
        results.push({ success: true, subject: row.subject, type: "announcement" });
      } catch (e) {
        results.push({
          success: false,
          error: e instanceof Error ? e.message : "Unknown error",
          subject: row.subject,
          type: "announcement",
        });
      }
    }

    return results;
  }
}

// ── Utilities ─────────────────────────────────────────────────
function getNextFriday4PM(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDay();
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilFriday);
  date.setHours(16, 0, 0, 0);
  return date.toISOString();
}

// ── Risk Evaluation ───────────────────────────────────────────
function evaluateRisk(rows: PacingRow[]): {
  score: number;
  issues: string[];
  proceed: boolean;
} {
  const issues: string[] = [];
  let score = 0;

  const tests = rows.filter((r) => r.type === "Test");
  if (tests.length > 3) {
    score += 30;
    issues.push(`${tests.length} tests (max 3)`);
  }

  const totalPoints = rows.reduce((sum, r) => sum + (r.points || 0), 0);
  if (totalPoints > 400) {
    score += 25;
    issues.push(`${totalPoints} grading pts (max 400)`);
  }

  return { score, issues, proceed: score < 50 };
}

// ── Edge Function Handler ─────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, rows, quarter } = await req.json();

    const CANVAS_URL = Deno.env.get("CANVAS_BASE_URL");
    const CANVAS_TOKEN = Deno.env.get("CANVAS_API_TOKEN");

    if (!CANVAS_URL || !CANVAS_TOKEN) {
      return new Response(
        JSON.stringify({ error: "Canvas credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const deployer = new CanvasDeployer(CANVAS_URL, CANVAS_TOKEN);

    // ── Course Mapping Drift Assertion (log-only, non-blocking) ──
    // Compares the deployer's canonical COURSE_IDS against system_config.course_ids
    // and emits a warn notification if they diverge. Code wins; this just surfaces drift.
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        const sb = createClient(supabaseUrl, serviceKey);
        const { data: cfg } = await sb
          .from("system_config")
          .select("course_ids")
          .eq("id", "current")
          .maybeSingle();
        const dbIds = (cfg?.course_ids as Record<string, number> | null) ?? {};
        // Alias map: deployer uses "LA"; system_config uses "Language Arts"
        const aliasToConfig: Record<string, string> = { LA: "Language Arts" };
        const drifts: Array<{ subject: string; code: number; db: number | null }> = [];
        for (const [subject, codeId] of Object.entries(COURSE_IDS)) {
          const dbKey = aliasToConfig[subject] ?? subject;
          const dbId = dbIds[dbKey] ?? null;
          if (dbId !== null && dbId !== codeId) {
            drifts.push({ subject, code: codeId, db: dbId });
          }
        }
        if (drifts.length > 0) {
          const summary = drifts
            .map((d) => `${d.subject}: code=${d.code} db=${d.db}`)
            .join("; ");
          console.warn("[course-id-drift]", summary);
          await sb.from("deploy_notifications").insert({
            level: "warn",
            title: "Course ID drift detected",
            message: `Canonical code differs from system_config: ${summary}. Code wins.`,
            entity_ref: "system_config:course_ids",
          });
          await sb.from("deploy_log").insert({
            action: "course_id_drift_check",
            status: "WARN",
            message: summary,
            payload: { drifts } as unknown as Record<string, unknown>,
          });
        }
      }
    } catch (driftErr) {
      console.error("[course-id-drift] check failed:", driftErr);
    }

    if (action === "deploy") {
      // Risk check
      const risk = evaluateRisk(rows);
      if (!risk.proceed) {
        return new Response(
          JSON.stringify({
            error: "Risk too high",
            risk,
          }),
          {
            status: 422,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const results = await deployer.deploy(rows, quarter || "Q2");

      return new Response(JSON.stringify({ results, risk }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "risk_check") {
      const risk = evaluateRisk(rows);
      return new Response(JSON.stringify({ risk }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("canvas-deployer error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
