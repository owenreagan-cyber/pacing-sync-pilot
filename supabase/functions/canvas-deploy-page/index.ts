import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 || res.status === 429) {
        if (i < attempts - 1) {
          const backoff = 500 * Math.pow(2, i);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        const backoff = 500 * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Network error");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { subject, courseId, pageUrl, pageTitle, bodyHtml, published, setFrontPage, weekId, contentHash } = await req.json();

    if (!courseId || !pageUrl || !pageTitle || !bodyHtml) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const canvasToken = Deno.env.get("CANVAS_API_TOKEN");
    let canvasBase = Deno.env.get("CANVAS_BASE_URL") || "https://thalesacademy.instructure.com";
    if (!canvasBase.startsWith("http")) canvasBase = `https://${canvasBase}`;
    canvasBase = canvasBase.replace(/\/+$/, "");
    if (!canvasToken) {
      return new Response(JSON.stringify({ error: "CANVAS_API_TOKEN not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const canvasHeaders = {
      Authorization: `Bearer ${canvasToken}`,
      "Content-Type": "application/json",
    };

    const courseBase = `${canvasBase}/api/v1/courses/${courseId}`;
    const normalizeName = (value: string): string =>
      value.trim().replace(/\s+/g, " ").toLowerCase();
    const parseNextLink = (linkHeader: string | null): string | null => {
      if (!linkHeader) return null;
      const parts = linkHeader.split(",");
      for (const part of parts) {
        const match = part.match(/<([^>]+)>;\s*rel="next"/);
        if (match) return match[1];
      }
      return null;
    };
    const getPageByUrl = async (
      urlSlug: string,
    ): Promise<{ id: string; url: string; title: string; frontPage: boolean; published: boolean; body: string | null } | null> => {
      const detailRes = await fetchWithRetry(`${courseBase}/pages/${urlSlug}`, { headers: canvasHeaders });
      if (detailRes.status === 404) return null;
      if (!detailRes.ok) {
        const detailErr = await detailRes.text();
        throw new Error(`Page detail lookup failed (${detailRes.status}): ${detailErr}`);
      }
      const detail = await detailRes.json();
      return {
        id: String(detail.id),
        url: detail.url || urlSlug,
        title: detail.title || "",
        frontPage: detail.front_page === true,
        published: detail.published === true,
        body: detail.body ?? null,
      };
    };
    const findPageByExactUrlOrTitle = async (
      urlSlug: string,
      exactTitle: string,
    ): Promise<{ id: string; url: string; title: string; frontPage: boolean; published: boolean; body: string | null } | null> => {
      const byUrl = await getPageByUrl(urlSlug);
      if (byUrl) return byUrl;

      const normalizedTitle = normalizeName(exactTitle);
      let nextUrl: string | null =
        `${courseBase}/pages?per_page=100&search_term=${encodeURIComponent(exactTitle)}`;
      let safety = 0;
      const candidateUrls = new Set<string>();

      while (nextUrl && safety < 50) {
        const listRes = await fetchWithRetry(nextUrl, { headers: canvasHeaders });
        if (!listRes.ok) {
          const errText = await listRes.text();
          throw new Error(`Page lookup failed (${listRes.status}): ${errText}`);
        }
        const pages = (await listRes.json()) as Array<{ url?: string; title?: string }>;
        for (const page of pages) {
          if (!page.url) continue;
          const isUrlMatch = page.url === urlSlug;
          const isExactNormalizedTitleMatch = page.title ? normalizeName(page.title) === normalizedTitle : false;
          if (isUrlMatch || isExactNormalizedTitleMatch) {
            candidateUrls.add(page.url);
          }
        }
        nextUrl = parseNextLink(listRes.headers.get("link"));
        safety += 1;
      }

      const candidates: Array<{ id: string; url: string; title: string; frontPage: boolean; published: boolean; body: string | null }> = [];
      for (const candidateUrl of candidateUrls) {
        const detail = await getPageByUrl(candidateUrl);
        if (detail) candidates.push(detail);
      }

      if (candidates.length === 0) return null;

      const normalizedCandidates = candidates.filter((candidate) => normalizeName(candidate.title) === normalizedTitle);
      const exactUrlMatch = normalizedCandidates.find((candidate) => candidate.url === urlSlug);
      const selected = exactUrlMatch || normalizedCandidates[0] || candidates[0];

      if (normalizedCandidates.length > 1) {
        console.warn(
          `[canvas-deploy-page] Multiple exact title matches for "${exactTitle}" in course ${courseId}. Candidates=${normalizedCandidates.map((c) => `${c.id}:${c.url}`).join(", ")} selected=${selected.id}:${selected.url}`,
        );
      }

      return selected;
    };

    // Helper: if Canvas page is a front_page but not published, return the
    // corrective payload that re-asserts published:true. Returns null if no
    // repair is needed. Front-page publish guard — every PUT touching a
    // front_page MUST include published:true.
    const assertFrontPagePublished = (pageData: { front_page?: boolean; published?: boolean } | null) => {
      if (!pageData) return null;
      if (pageData.front_page === true && pageData.published === false) {
        return { wiki_page: { front_page: true, published: true } };
      }
      return null;
    };

    // 0. HASH PRE-SKIP — fast path. If the client-provided hash matches the
    // stored hash, we still GET Canvas once to detect manual drift on
    // front_page pages (e.g., teacher unpublished it directly in Canvas) and
    // auto-repair before skipping.
    let resolvedExistingPage = await findPageByExactUrlOrTitle(pageUrl, pageTitle);
    let resolvedPageId: string | null = resolvedExistingPage?.id ?? null;
    let resolvedPageUrl = resolvedExistingPage?.url || pageUrl;

    if (weekId && subject && contentHash) {
      const { data: weekRow } = await sb
        .from("weeks")
        .select("page_hashes")
        .eq("id", weekId)
        .maybeSingle();
      const storedHash = (weekRow?.page_hashes as Record<string, string> | null)?.[subject];
      if (storedHash && storedHash === contentHash) {
        if (!resolvedExistingPage) {
          // Hash matches but page no longer exists in Canvas; continue into deploy flow
          // so the page is re-created instead of incorrectly returning NO_CHANGE.
        } else {
          const driftRes = await fetchWithRetry(`${courseBase}/pages/${resolvedExistingPage.url}`, { headers: canvasHeaders });
          let repaired = false;
          if (driftRes.ok) {
            const driftData = await driftRes.json();
            const repairPayload = assertFrontPagePublished(driftData);
            if (repairPayload) {
              const repairRes = await fetchWithRetry(`${courseBase}/pages/${resolvedExistingPage.url}`, {
                method: "PUT",
                headers: canvasHeaders,
                body: JSON.stringify(repairPayload),
              });
              repaired = repairRes.ok;
              await sb.from("deploy_log").insert({
                week_id: weekId,
                subject,
                action: "page_deploy",
                status: repaired ? "REPAIRED" : "ERROR",
                canvas_url: `${canvasBase}/courses/${courseId}/pages/${resolvedExistingPage.url}`,
                message: repaired
                  ? `Hash match — front_page was unpublished, re-published [canvas_id:${resolvedExistingPage.id}]`
                  : `Hash match — repair PUT failed [canvas_id:${resolvedExistingPage.id}]`,
              });
              if (repaired) {
                await sb.from("deploy_notifications").insert({
                  title: `Front page re-published — ${subject}`,
                  message: `${pageTitle} was unpublished in Canvas; auto-repaired.`,
                  level: "warn",
                  entity_ref: `${subject}:${resolvedExistingPage.url}`,
                });
              }
            }
          } else {
            await driftRes.text();
          }

          if (!repaired) {
            await sb.from("deploy_log").insert({
              week_id: weekId,
              subject,
              action: "page_deploy",
              status: "NO_CHANGE",
              canvas_url: `${canvasBase}/courses/${courseId}/pages/${resolvedExistingPage.url}`,
              message: `Hash match — skipped (front-page state OK) [canvas_id:${resolvedExistingPage.id}]`,
            });
          }

          return new Response(JSON.stringify({
            status: repaired ? "REPAIRED" : "NO_CHANGE",
            pageId: resolvedExistingPage.id,
            pageUrl: resolvedExistingPage.url,
            canvasUrl: `${canvasBase}/courses/${courseId}/pages/${resolvedExistingPage.url}`,
            skipReason: "hash_match",
            repaired,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // 1. Resolve existing page by slug fast-path, then normalized-title lookup
    let exists = !!resolvedExistingPage;
    let isFrontPage = resolvedExistingPage?.frontPage === true;
    let existingBody = "";
    if (resolvedExistingPage) {
      existingBody = resolvedExistingPage.body || "";
    }

    // Helper to write the deploy hash back to weeks.page_hashes[subject]
    const persistHash = async () => {
      if (!weekId || !subject || !contentHash) return;
      const { data: w } = await sb
        .from("weeks")
        .select("page_hashes")
        .eq("id", weekId)
        .maybeSingle();
      const current = (w?.page_hashes as Record<string, string> | null) || {};
      current[subject] = contentHash;
      await sb.from("weeks").update({ page_hashes: current }).eq("id", weekId);
    };

    // 2. Body-compare fallback — skip if body matches
    if (exists && existingBody === bodyHtml) {
      // Even on no-content-change, ensure homepage stays published
      if ((setFrontPage && !isFrontPage) || isFrontPage) {
        await fetchWithRetry(`${courseBase}/pages/${resolvedPageUrl}`, {
          method: "PUT",
          headers: canvasHeaders,
          body: JSON.stringify({
            wiki_page: { front_page: setFrontPage || isFrontPage, published: true },
          }),
        });
      }

      await persistHash();

      await sb.from("deploy_log").insert({
        week_id: weekId || null,
        subject: subject || null,
        action: "page_deploy",
        status: "NO_CHANGE",
        canvas_url: `${canvasBase}/courses/${courseId}/pages/${resolvedPageUrl}`,
        message: `Content unchanged — skipped${setFrontPage ? " (set as homepage)" : ""} [canvas_id:${resolvedPageId || "n/a"}]`,
      });

      return new Response(JSON.stringify({
        status: "NO_CHANGE",
        pageId: resolvedPageId,
        pageUrl: resolvedPageUrl,
        canvasUrl: `${canvasBase}/courses/${courseId}/pages/${resolvedPageUrl}`,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Create or update the page
    // FRONT-PAGE GUARD — non-negotiable.
    // Per Core rule: every PUT touching a front_page MUST include
    // published:true. We just performed a GET above; if Canvas reports
    // front_page:true we forcefully inject published:true into the PUT
    // payload, ignoring whatever the frontend requested. This plays nicely
    // with friday-publish (which only flips published true→true on Fridays)
    // because we never publish a page that wasn't already a front page.
    let pub = published ?? false;
    const willBeFrontPage = isFrontPage || setFrontPage === true;
    if (willBeFrontPage) {
      if (pub !== true) {
        console.warn(
          `[front-page-guard] Forcing published:true on PUT for ${pageUrl} (frontend sent published=${published})`,
        );
      }
      pub = true;
    }

    const payload = {
      wiki_page: {
        title: pageTitle,
        body: bodyHtml,
        published: pub,
        ...(willBeFrontPage ? { front_page: true } : {}),
      },
    };

    const method = exists ? "PUT" : "POST";
    const url = exists ? `${courseBase}/pages/${resolvedPageUrl}` : `${courseBase}/pages`;

    const res = await fetchWithRetry(url, {
      method,
      headers: canvasHeaders,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      await sb.from("deploy_log").insert({
        week_id: weekId || null,
        subject: subject || null,
        action: "page_deploy",
        status: "ERROR",
        message: `${method} ${res.status}: ${errText} [canvas_id:${resolvedPageId || "n/a"}]`,
        payload: payload as unknown as Record<string, unknown>,
      });

      await sb.from("deploy_notifications").insert({
        title: `Page deploy failed — ${subject || "?"}`,
        message: `${method} ${res.status}: ${errText.slice(0, 200)}`,
        level: "error",
        entity_ref: `${subject || ""}:${pageUrl}`,
      });

      return new Response(JSON.stringify({ error: errText, status: "ERROR" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await res.json();
    const pageId = String(result.id || resolvedPageId || "");
    const canonicalPageUrl = result.url || resolvedPageUrl;
    resolvedPageId = pageId || resolvedPageId;
    resolvedPageUrl = canonicalPageUrl;
    const canvasUrl = `${canvasBase}/courses/${courseId}/pages/${canonicalPageUrl}`;

    // 4. If page was just created (POST), separate PUT to set front_page
    if (!exists && setFrontPage) {
      const fpRes = await fetchWithRetry(`${courseBase}/pages/${canonicalPageUrl}`, {
        method: "PUT",
        headers: canvasHeaders,
        body: JSON.stringify({ wiki_page: { front_page: true, published: true } }),
      });
      if (!fpRes.ok) {
        const fpErr = await fpRes.text();
        console.error("Failed to set front page:", fpErr);
      }
    }

    await persistHash();

    await sb.from("deploy_log").insert({
      week_id: weekId || null,
      subject: subject || null,
      action: "page_deploy",
      status: "DEPLOYED",
      canvas_url: canvasUrl,
      message: `${exists ? "Updated" : "Created"} page: ${pageTitle}${setFrontPage ? " (set as homepage)" : ""} [canvas_id:${resolvedPageId || "n/a"}]`,
    });

    await sb.from("deploy_notifications").insert({
      title: `${subject || "Page"} agenda deployed`,
      message: `${exists ? "Updated" : "Created"} ${pageTitle}${setFrontPage ? " — set as homepage" : ""}`,
      level: "info",
      entity_ref: `${subject || ""}:${pageUrl}`,
    });

    return new Response(JSON.stringify({
      status: "DEPLOYED",
      pageId: resolvedPageId,
      pageUrl: resolvedPageUrl,
      canvasUrl,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
