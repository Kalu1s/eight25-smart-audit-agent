const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const path = require("path");
require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────
// SCRAPING LAYER
// ─────────────────────────────────────────────
async function scrapeMetrics(url) {
  const { data: html } = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; SiteAuditBot/1.0; +https://eight25media.com)",
    },
  });

  const $ = cheerio.load(html);

  // ── Word Count ──────────────────────────────
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

  // ── Headings ────────────────────────────────
  const headings = {
    h1: $("h1").map((_, el) => $(el).text().trim()).get(),
    h2: $("h2").map((_, el) => $(el).text().trim()).get(),
    h3: $("h3").map((_, el) => $(el).text().trim()).get(),
  };

  // ── CTA Detection ───────────────────────────
  const ctaKeywords = /\b(get started|sign up|buy|shop|contact|request|demo|free trial|learn more|subscribe|download|book|schedule|try|start|join|claim|get a quote|order|register)\b/i;
  const ctaElements = [];

  $("a, button").each((_, el) => {
    const text = $(el).text().trim();
    const role = $(el).attr("role") || "";
    const cls = ($(el).attr("class") || "").toLowerCase();
    const isCTAClass = /btn|button|cta/.test(cls);
    const isButton = el.tagName === "button";
    const isCtaText = ctaKeywords.test(text);

    if (isButton || isCTAClass || isCtaText) {
      ctaElements.push({
        tag: el.tagName,
        text,
        href: $(el).attr("href") || null,
      });
    }
  });

  // ── Links ────────────────────────────────────
  const hostname = new URL(url).hostname;
  const internalLinks = [];
  const externalLinks = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    try {
      const resolved = new URL(href, url);
      if (resolved.hostname === hostname) internalLinks.push(href);
      else externalLinks.push(href);
    } catch {
      internalLinks.push(href); // relative URL
    }
  });

  // ── Images ──────────────────────────────────
  const images = [];
  $("img").each((_, el) => {
    const alt = $(el).attr("alt");
    images.push({
      src: $(el).attr("src") || "",
      alt: alt !== undefined ? alt : null,
      missingAlt: alt === undefined || alt === null || alt.trim() === "",
    });
  });
  const missingAltPct =
    images.length > 0
      ? Math.round(
          (images.filter((i) => i.missingAlt).length / images.length) * 100
        )
      : 0;

  // ── Meta ─────────────────────────────────────
  const metaTitle = $("title").first().text().trim() || null;
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    null;

  // ── Page Content Sample ──────────────────────
  const contentSample = $("main, article, section, body")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);

  return {
    url,
    wordCount,
    headings,
    headingCounts: {
      h1: headings.h1.length,
      h2: headings.h2.length,
      h3: headings.h3.length,
    },
    ctas: ctaElements,
    ctaCount: ctaElements.length,
    links: { internal: internalLinks.length, external: externalLinks.length },
    images: {
      total: images.length,
      missingAltCount: images.filter((i) => i.missingAlt).length,
      missingAltPct,
    },
    metaTitle,
    metaDescription,
    contentSample,
  };
}

// ─────────────────────────────────────────────
// AI ANALYSIS LAYER
// ─────────────────────────────────────────────
function buildPrompts(metrics) {
  const systemPrompt = `You are an expert Website Strategist and SEO Consultant at EIGHT25MEDIA. Your goal is to provide high-impact, data-driven website audits focused on SEO, conversion optimization, content clarity, and UX.

GUIDELINES:
1. Ground EVERY insight in the provided factual metrics. Do not hallucinate or use generic advice.
2. Maintain a professional, actionable, and concise tone.
3. Use the following structured categories: SEO Structure, Messaging Clarity, CTA Usage, Content Depth, UX/Structural Concerns.
4. Be SPECIFIC — e.g., "H1 reads '${metrics.headings.h1[0] || "(missing)"}' which lacks keyword intent" — not "optimize your headings."
5. Tie every recommendation to a specific extracted metric.

OUTPUT: Return ONLY valid JSON (no markdown fences) matching this exact schema:
{
  "seoStructure": { "score": 1-10, "summary": "...", "issues": ["..."] },
  "messagingClarity": { "score": 1-10, "summary": "...", "issues": ["..."] },
  "ctaUsage": { "score": 1-10, "summary": "...", "issues": ["..."] },
  "contentDepth": { "score": 1-10, "summary": "...", "issues": ["..."] },
  "uxConcerns": { "score": 1-10, "summary": "...", "issues": ["..."] },
  "recommendations": [
    {
      "priority": 1,
      "recommendation": "...",
      "reasoning": "...",
      "impact": "...",
      "metricRef": "exact metric name that supports this"
    }
  ]
}`;

  const userPrompt = `Analyze the following webpage and return a JSON audit report.

<extracted_metrics>
URL: ${metrics.url}
Total Word Count: ${metrics.wordCount}
Heading Counts: H1: ${metrics.headingCounts.h1}, H2: ${metrics.headingCounts.h2}, H3: ${metrics.headingCounts.h3}
H1 Texts: ${metrics.headings.h1.join(" | ") || "(none)"}
H2 Texts (first 5): ${metrics.headings.h2.slice(0, 5).join(" | ") || "(none)"}
CTA Count: ${metrics.ctaCount}
CTA Texts: ${metrics.ctas.map((c) => c.text).slice(0, 10).join(", ") || "(none)"}
Internal Links: ${metrics.links.internal}
External Links: ${metrics.links.external}
Total Images: ${metrics.images.total}
Images Missing Alt Text: ${metrics.images.missingAltCount} (${metrics.images.missingAltPct}%)
Meta Title: ${metrics.metaTitle || "(missing)"}
Meta Description: ${metrics.metaDescription || "(missing)"}
</extracted_metrics>

<page_content>
${metrics.contentSample}
</page_content>

Generate 3–5 prioritized recommendations. Be specific, non-generic, and reference the exact metrics above.`;

  return { systemPrompt, userPrompt };
}


async function analyzeWithGemini(metrics) {
  // 1. Initialize the model using the standard SDK
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `You are an expert Website Strategist. Analyze these metrics and return a JSON audit.
DO NOT wrap the response in an "audit" or "report" tag. Return the EXACT JSON structure below, starting with the root keys:

{
  "seoStructure": { "score": 8, "summary": "2 sentences about SEO.", "issues": ["Issue 1"] },
  "messagingClarity": { "score": 7, "summary": "2 sentences about messaging.", "issues": ["Issue 1"] },
  "ctaUsage": { "score": 6, "summary": "2 sentences about CTAs.", "issues": ["Issue 1"] },
  "contentDepth": { "score": 9, "summary": "2 sentences about content.", "issues": ["Issue 1"] },
  "uxConcerns": { "score": 5, "summary": "2 sentences about UX.", "issues": ["Issue 1"] },
  "recommendations": [
    {
      "priority": 1,
      "title": "Clear Actionable Title",
      "details": "Detailed explanation.",
      "impact": "High"
    }
  ]
}

<extracted_metrics>
URL: ${metrics.url}
Word Count: ${metrics.wordCount}
H1s: ${metrics.headings.h1.join(" | ") || "(none)"}
CTA Count: ${metrics.ctaCount}
Missing Image Alt Text: ${metrics.images.missingAltPct}%
</extracted_metrics>
`;

  const startTime = Date.now();
  
  // 2. Generate content using the exact syntax that worked earlier
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" }
  });

  const rawOutput = result.response.text();
  let parsed = JSON.parse(rawOutput.replace(/```json|```/g, "").trim());

  // 🚨 BULLETPROOF PARSING LAYER 🚨
  if (parsed.audit && !parsed.seoStructure) {
    parsed = parsed.audit;
  }
  if (parsed.analysis && !parsed.seoStructure) {
    parsed = parsed.analysis;
  }

  return { 
    analysis: parsed, 
    promptLog: { promptUsed: prompt, parsedOutput: parsed, latencyMs: Date.now() - startTime } 
  };
}

// ─────────────────────────────────────────────
// API ENDPOINT
// ─────────────────────────────────────────────
app.post("/api/audit", async (req, res) => {
  const { url } = req.body;
    const apiKey = process.env.GEMINI_API_KEY; // Get key from .env

    if (!url) {
      return res.status(400).json({ error: "url is required." });
    }
    if (!apiKey) {
      return res.status(500).json({ error: "API key is missing in server configuration." });
    }

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = "https://" + normalizedUrl;
  }

  try {
    // Step 1: Scrape
    const metrics = await scrapeMetrics(normalizedUrl);

    // Step 2: AI Analysis
    const { analysis, promptLog } = await analyzeWithGemini(metrics, apiKey);

    return res.json({
      success: true,
      metrics,
      analysis,
      promptLog,
    });
  } catch (err) {
    console.error(err.message);
    const detail =
      err.response?.data?.error?.message || err.message || "Unknown error";
    return res.status(500).json({ error: detail });
  }
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(process.env.PORT || 3000, () => {
  console.log("🚨🚨🚨 THE NEW SERVER V2 IS FINALLY ALIVE!!! 🚨🚨🚨");
});
