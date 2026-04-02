# 🔍 Website Audit Tool — EIGHT25MEDIA Assignment

An AI-powered single-page website auditor built for the EIGHT25MEDIA AI-Native Software Engineer assignment. Accepts a URL, extracts factual metrics via scraping, and uses Claude AI to generate structured SEO/CRO/UX insights grounded in those metrics.

**Live demo:** Deploy locally with the instructions below.

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/your-username/website-audit-tool.git
cd website-audit-tool

# 2. Install dependencies
npm install

# 3. Start the server
node server.js
# → Running at http://localhost:3000

# 4. Open http://localhost:3000 in your browser
#    Enter a URL and your Gemini API key, click Run Audit
```

**Requirements:** Node.js 18+, an Gemini API key (`sk-ant-...`)

---

## Architecture Overview

```
Browser (UI)
    │
    ▼ POST /api/audit { url, apiKey }
Express Server (server.js)
    ├── Scraping Layer (axios + cheerio)
    │     └── scrapeMetrics(url) → structured metrics object
    │
    └── AI Analysis Layer (Google Generative AI SDK)
          ├── buildPrompts(metrics) → { systemPrompt, userPrompt }
          └── analyzeWithGemini(metrics, apiKey) → { analysis, promptLog }
```

### Three Clean Layers

| Layer | Responsibility | Technology |
|-------|---------------|------------|
| **Scraping** | Fetch HTML, extract raw metrics | `axios` + `cheerio` |
| **AI Analysis** | Generate structured insights from metrics | Gemini 1.5 Flash |
| **UI** | Display metrics + analysis, expose prompt log | Vanilla HTML/CSS/JS |

The scraping layer never calls the AI. The AI layer only receives structured metrics and a content sample, ensuring the model's output is grounded in data rather than hallucinated HTML.

---

## What Gets Extracted (Scraping Layer)

| Metric | Method |
|--------|--------|
| Word count | `$('body').text()` → split on whitespace |
| H1/H2/H3 counts + text | Cheerio selector + `.map()` |
| CTA detection | Matches `<button>`, `.btn`/`.cta` classes, and CTA keyword regex against link text |
| Internal vs external links | Resolves `href` against page origin via `new URL()` |
| Images + alt text coverage | Checks `alt` attribute presence and emptiness |
| Meta title / description | `<title>`, `<meta name="description">`, fallback to OG tags |
| Page content sample | First 3,000 chars of `main/article/section/body` text |

---

## AI Design Decisions

### 1. Metrics-First, AI-Second
The AI receives **only structured metrics + a text content sample** — never raw HTML. This forces Claude to reason about numbers and content patterns rather than doing its own re-scraping. It also keeps prompt tokens low and reasoning focused.

### 2. Strict System Prompt
The system prompt instructs Claude to:
- Reference specific metric values (e.g., "H1 reads 'Welcome' which lacks keyword intent")
- Return ONLY valid JSON — no markdown fences, no preamble
- Score each category 1–10 with issues array + summary

This prevents generic advice ("optimize your SEO") and makes the output directly renderable.

### 3. Structured JSON Output Schema
```json
{
  "seoStructure":      { "score": 1–10, "summary": "...", "issues": ["..."] },
  "messagingClarity":  { "score": 1–10, "summary": "...", "issues": ["..."] },
  "ctaUsage":          { "score": 1–10, "summary": "...", "issues": ["..."] },
  "contentDepth":      { "score": 1–10, "summary": "...", "issues": ["..."] },
  "uxConcerns":        { "score": 1–10, "summary": "...", "issues": ["..."] },
  "recommendations":   [{ "priority": 1, "recommendation": "...", "reasoning": "...", "impact": "...", "metricRef": "..." }]
}
```
The `metricRef` field forces Claude to cite which specific metric supports each recommendation.

### 4. Prompt Log as First-Class Output
Every API call returns a `promptLog` object containing `systemPrompt`, `userPrompt`, `rawModelOutput`, `parsedOutput`, `usage`, and `latencyMs`. The UI exposes this in a collapsible panel. Nothing is hidden.

### 5. CTA Heuristic (Not AI)
CTA detection is done in the scraping layer via regex + class name matching — no AI needed. This keeps factual counts reliable and reproducible, separate from interpretation.

---

## Trade-offs

| Decision | Trade-off |
|----------|-----------|
| **Client-side API key** | Simpler setup; not suitable for multi-user production. A real deployment would proxy through a server with auth. |
| **Content sample 3,000 chars** | Reduces token cost; may miss important content on long pages. Configurable in `server.js`. |
| **Vanilla JS frontend** | No build step required; less component reusability than React. |
| **CTA regex detection** | Fast and deterministic, but may over/undercount on unusual markup (e.g., custom web components). |
| **No caching** | Every run re-scrapes + re-calls Gemini. A Redis cache keyed on URL+date would cut costs significantly. |

---

## What I'd Improve With More Time

1. **Multi-model support** — Let users pick GPT-4o vs Gemini and compare audit quality
2. **Diff view** — Re-audit the same URL and show what changed (great for client reporting)
3. **PDF export** — Generate a branded audit PDF using Puppeteer
4. **Lighthouse integration** — Pull Core Web Vitals (LCP, CLS, FID) to complement the content audit
5. **Auth + history** — Store past audits per user; trends over time
6. **Streaming responses** — Stream Gemini's output token-by-token for faster perceived performance
7. **Better CTA detection** — Train a small classifier on CTA patterns rather than regex
8. **Rate limiting + caching** — Redis cache on `(url, date)` to avoid redundant API calls

---

## Prompt Log Sample

See the UI's "Prompt Log" panel after running an audit. All prompts, inputs, raw model outputs, and token usage are exposed there.

---

## Stack

- **Runtime:** Node.js 18+
- **Framework:** Express 4
- **Scraping:** axios + cheerio
- **AI:** @google/generative-ai (Gemini 1.5 Flash)
- **Frontend:** Vanilla HTML/CSS/JS (no build step)


### Prompts
Spec File + 
You are an expert Website Strategist and SEO Consultant at EIGHT25MEDIA. Your goal is to provide high-impact, data-driven website audits focused on SEO, conversion optimization, and UX clarity.
GUIDELINES:
1. Ground every insight in the provided factual metrics. Do not hallucinate or use generic advice.
2. Maintain a professional, actionable, and concise tone.
3. Use the following structured categories for analysis: SEO Structure, Messaging Clarity, CTA Usage, Content Depth, and UX/Structural Concerns.
4. For every recommendation, provide clear reasoning tied directly to a specific metric.
INPUT FORMAT:
You will receive data in <extracted_metrics> and <page_content> tags.
OUTPUT FORMAT:
Return your analysis in a structured format (JSON or Markdown as requested) following the "Recommendations" section of the assignment brief.

Please analyze the following webpage data and provide a structured audit report.

<extracted_metrics>
- URL: [Insert URL]
- Total Word Count: [Value]
- Heading Counts: H1: [X], H2: [Y], H3: [Z]
- CTAs: [Number of buttons/links]
- Links: Internal: [X], External: [Y]
- Images: [Total count] (% missing alt text: [X]%)
- Meta Title: [Title]
- Meta Description: [Description]
</extracted_metrics>

<page_content>
[Insert raw text or HTML snippet of the page here]
</page_content>

TASK:
1. Review the metrics and content.
2. Generate 3-5 prioritized recommendations. 
3. For each recommendation, use this format:
   - **Recommendation**: [Actionable step]
   - **Reasoning**: [Why this matters, referencing a specific metric from the data above]
   - **Impact**: [Expected result for SEO or UX]

Final Output must be specific and non-generic. Avoid "improve your SEO"; instead use "Increase H1 keyword density because the current H1 is 'Welcome' which lacks search intent."

### Prompt 2
check the accuracy and the improvements + server.js + index.html
