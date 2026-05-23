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
    const parseNextLink = (linkHeader: string | null): string | null => {
      if (!linkHeader) return null;
      const parts = linkHeader.split(",");
      for (const part of parts) {
        const match = part.match(/<([^>]+)>;\s*rel="next"/);
        if (match) return match[1];
      }
      return null;
    };
    const findPageByExactTitle = async (
      exactTitle: string,
    ): Promise<{ url: string; frontPage: boolean; body: string | null } | null> => {
      let nextUrl: string | null =
        `${courseBase}/pages?per_page=100&search_term=${encodeURIComponent(exactTitle)}`;
      let safety = 0;

      while (nextUrl && safety < 50) {
        const listRes = await fetchWithRetry(nextUrl, { headers: canvasHeaders });
        if (!listRes.ok) {
          const errText = await listRes.text();
          throw new Error(`Page lookup failed (${listRes.status}): ${errText}`);
        }
        const pages = (await listRes.json()) as Array<{ url?: string; title?: string }>;
        const match = pages.find((p) => p.title === exactTitle);
        if (match?.url) {
          const detailRes = await fetchWithRetry(`${courseBase}/pages/${match.url}`, { headers: canvasHeaders });
          if (!detailRes.ok) {
            const detailErr = await detailRes.text();
            throw new Error(`Page detail lookup failed (${detailRes.status}): ${detailErr}`);
          }
          const detail = await detailRes.json();
          return {
            url: detail.url || match.url,
            frontPage: detail.front_page === true,
            body: detail.body ?? null,
          };
        }
        nextUrl = parseNextLink(listRes.headers.get("link"));
        safety += 1;
      }
      return null;
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
    if (weekId && subject && contentHash) {
      const { data: weekRow } = await sb
        .from("weeks")
        .select("page_hashes")
        .eq("id", weekId)
        .maybeSingle();
      const storedHash = (weekRow?.page_hashes as Record<string, string> | null)?.[subject];
      if (storedHash && storedHash === contentHash) {
        const driftRes = await fetchWithRetry(`${courseBase}/pages/${pageUrl}`, { headers: canvasHeaders });
        let repaired = false;
        if (driftRes.ok) {
          const driftData = await driftRes.json();
          const repairPayload = assertFrontPagePublished(driftData);
          if (repairPayload) {
            const repairRes = await fetchWithRetry(`${courseBase}/pages/${pageUrl}`, {
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
              canvas_url: `${canvasBase}/courses/${courseId}/pages/${pageUrl}`,
              message: repaired
                ? "Hash match — front_page was unpublished, re-published"
                : "Hash match — repair PUT failed",
            });
            if (repaired) {
              await sb.from("deploy_notifications").insert({
                title: `Front page re-published — ${subject}`,
                message: `${pageTitle} was unpublished in Canvas; auto-repaired.`,
                level: "warn",
                entity_ref: `${subject}:${pageUrl}`,
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
            canvas_url: `${canvasBase}/courses/${courseId}/pages/${pageUrl}`,
            message: "Hash match — skipped (front-page state OK)",
          });
        }

        return new Response(JSON.stringify({
          status: repaired ? "REPAIRED" : "NO_CHANGE",
          canvasUrl: `${canvasBase}/courses/${courseId}/pages/${pageUrl}`,
          skipReason: "hash_match",
          repaired,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 1. GET page to check existence + front_page
    const getRes = await fetchWithRetry(`${courseBase}/pages/${pageUrl}`, { headers: canvasHeaders });
    let exists = false;
    let isFrontPage = false;
    let existingBody = "";
    let resolvedPageUrl = pageUrl;
    let existenceCheckError: string | null = null;

    if (getRes.ok) {
      const pageData = await getRes.json();
      exists = true;
      isFrontPage = pageData.front_page === true;
      existingBody = pageData.body || "";
      resolvedPageUrl = pageData.url || pageUrl;
    } else if (getRes.status !== 404) {
      existenceCheckError = await getRes.text();
    }

    if (!exists && existenceCheckError) {
      await sb.from("deploy_log").insert({
        week_id: weekId || null,
        subject: subject || null,
        action: "page_deploy",
        status: "ERROR",
        message: `GET ${getRes.status}: ${existenceCheckError}`,
      });
      return new Response(JSON.stringify({ error: existenceCheckError, status: "ERROR" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert guard: before creating (POST), query Canvas by the target title.
    if (!exists) {
      const matchedPage = await findPageByExactTitle(pageTitle);
      if (matchedPage) {
        exists = true;
        isFrontPage = matchedPage.frontPage;
        existingBody = matchedPage.body || "";
        resolvedPageUrl = matchedPage.url;
      }
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
        message: "Content unchanged — skipped" + (setFrontPage ? " (set as homepage)" : ""),
      });

      return new Response(JSON.stringify({
        status: "NO_CHANGE",
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
        message: `${method} ${res.status}: ${errText}`,
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
    const canonicalPageUrl = result.url || resolvedPageUrl;
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
      message: `${exists ? "Updated" : "Created"} page: ${pageTitle}${setFrontPage ? " (set as homepage)" : ""}`,
    });

    await sb.from("deploy_notifications").insert({
      title: `${subject || "Page"} agenda deployed`,
      message: `${exists ? "Updated" : "Created"} ${pageTitle}${setFrontPage ? " — set as homepage" : ""}`,
      level: "info",
      entity_ref: `${subject || ""}:${pageUrl}`,
    });

    return new Response(JSON.stringify({ status: "DEPLOYED", canvasUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
