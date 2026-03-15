import { load } from "cheerio";
import { NextResponse } from "next/server";

import { launchHeadlessBrowser } from "@/lib/browser";
import { generateJsonFromPrompt } from "@/lib/claude";
import { extractKeywords, filterHighValueKeywords } from "@/lib/keyword-scorer";
import type { JobDescription } from "@/types";

const jobDescriptionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "company", "keywords", "summary"],
  properties: {
    title: { type: "string" },
    company: { type: "string" },
    keywords: {
      type: "array",
      items: { type: "string" },
    },
    summary: { type: "string" },
  },
};

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function extractReadableText(html: string) {
  const $ = load(html);

  $("script, style, nav, header, footer, noscript, svg").remove();
  $("[hidden], [aria-hidden='true']").remove();

  for (const selector of JOB_SELECTORS) {
    const text = normalizeWhitespace($(selector).first().text()).slice(0, 20_000);
    if (text.length >= 200) {
      return text;
    }
  }

  return "";
}

function stripHtml(value: string) {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " "));
}

function collectStructuredDescriptions(input: unknown, results: string[]) {
  if (!input) {
    return;
  }

  if (typeof input === "string") {
    const cleaned = stripHtml(input);
    if (cleaned.length >= 200) {
      results.push(cleaned);
    }
    return;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      collectStructuredDescriptions(item, results);
    }
    return;
  }

  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    const type = typeof record["@type"] === "string" ? record["@type"].toLowerCase() : "";

    if (type.includes("jobposting")) {
      collectStructuredDescriptions(record.description, results);
      collectStructuredDescriptions(record.responsibilities, results);
      collectStructuredDescriptions(record.qualifications, results);
      collectStructuredDescriptions(record.skills, results);
    }

    for (const value of Object.values(record)) {
      collectStructuredDescriptions(value, results);
    }
  }
}

function extractTextFromStructuredData(html: string) {
  const $ = load(html);
  const descriptions: string[] = [];

  $('script[type="application/ld+json"], script[type="application/json"]').each((_, element) => {
    const raw = $(element).html()?.trim();
    if (!raw) {
      return;
    }

    try {
      collectStructuredDescriptions(JSON.parse(raw), descriptions);
    } catch {
      const matches = raw.match(/"description"\s*:\s*"([\s\S]*?)"/gi) || [];
      for (const match of matches) {
        const value = match.replace(/^"description"\s*:\s*"/i, "").replace(/"$/, "");
        const cleaned = stripHtml(value);
        if (cleaned.length >= 200) {
          descriptions.push(cleaned);
        }
      }
    }
  });

  return descriptions.sort((left, right) => right.length - left.length)[0] || "";
}

const JOB_SELECTORS = [
  // Greenhouse
  "#content",
  ".job-post",
  // Lever
  ".posting-headline",
  ".section-wrapper",
  // Workday
  '[data-automation-id="jobPostingDescription"]',
  '[data-automation-id="job-posting-details"]',
  // Ashby
  '[data-testid="job-description"]',
  // SmartRecruiters
  ".job-description",
  // LinkedIn (rarely works without login, but worth trying)
  ".description__text",
  ".show-more-less-html__markup",
  // Indeed
  "#jobDescriptionText",
  ".jobsearch-jobDescriptionText",
  // Glassdoor
  '[class*="JobDetails"]',
  '[class*="jobDescription"]',
  // Generic
  '[data-testid*="job-description"]',
  '[data-qa*="job-description"]',
  '[id*="job-description"]',
  '[id*="description"]',
  '[class*="job-description"]',
  '[class*="description"]',
  '[class*="posting"]',
  '[class*="content"]',
  '[role="main"]',
  "main",
  "article",
  "body",
];

async function renderJobPage(url: string) {
  const browser = await launchHeadlessBrowser();

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 18_000,
    });

    // Wait for body, then give JS a moment to hydrate.
    await page.waitForSelector("body", { timeout: 5_000 }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 2_500));

    const selectors = JOB_SELECTORS;

    const text = await page.evaluate((sels) => {
      document.querySelectorAll("script, style, nav, header, footer, noscript, svg").forEach((node) => node.remove());

      for (const selector of sels) {
        const element = document.querySelector(selector) as HTMLElement | null;
        const value = element?.innerText?.replace(/\s+/g, " ").trim();
        if (value && value.length >= 200) {
          return value.slice(0, 20_000);
        }
      }

      return "";
    }, selectors);

    return text;
  } finally {
    await browser.close();
  }
}

async function parseJobDescriptionWithClaude(rawText: string): Promise<Omit<JobDescription, "url" | "rawText">> {
  const system =
    'You are a job description parser. Extract structured information from the job posting text provided.\nReturn ONLY valid JSON in this exact format, no markdown, no explanation:\n{\n  "title": "exact job title",\n  "company": "company name",\n  "keywords": ["keyword1", "keyword2", ...],\n  "summary": "2 sentence summary of the role"\n}\nFor keywords: extract up to 40 technical skills, tools, frameworks, methodologies, and platforms mentioned.\nFocus on specific technical terms. Exclude soft skills, generic verbs, and company-specific jargon.';
  const rawJson = await generateJsonFromPrompt(system, rawText, 1200, jobDescriptionSchema);

  try {
    const parsed = JSON.parse(rawJson) as {
      title?: string;
      company?: string;
      keywords?: string[];
      summary?: string;
    };

    return {
      title: parsed.title?.trim() || "",
      company: parsed.company?.trim() || "",
      keywords: Array.isArray(parsed.keywords) ? filterHighValueKeywords(parsed.keywords).slice(0, 40) : [],
      summary: parsed.summary?.trim() || "",
    };
  } catch {
    throw new Error("Could not parse the job description content.");
  }
}

function summarizeText(rawText: string) {
  const sentences = rawText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences.slice(0, 2).join(" ").slice(0, 320);
}

function deriveJobDescriptionFallback(rawText: string, url: string): Omit<JobDescription, "url" | "rawText"> {
  const lines = rawText
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const hostname = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "Unknown company";
    }
  })();

  const probableTitle =
    lines.find((line) => line.length > 6 && line.length < 120 && !/@|https?:\/\//i.test(line)) ||
    "Job Opportunity";

  const probableCompany =
    lines.find((line) => /inc|llc|ltd|corp|company|technologies|systems|group/i.test(line)) ||
    hostname;

  return {
    title: probableTitle,
    company: probableCompany,
    keywords: extractKeywords(rawText).slice(0, 40),
    summary: summarizeText(rawText) || "Job description extracted from the posting.",
  };
}

/**
 * Sites known to block all automated access (bot-detection, login walls, etc.).
 * Returns a user-friendly message, or null if the domain is not on the list.
 */
function detectBlockedSite(hostname: string): string | null {
  const blocked: Record<string, string> = {
    "metacareers.com": "Meta Careers blocks automated scraping. Please copy the job description from the page and paste it below.",
    "linkedin.com": "LinkedIn requires a login to view job postings and blocks scrapers. Please copy the job description and paste it below.",
    "glassdoor.com": "Glassdoor blocks automated access. Please copy the job description and paste it below.",
    "indeed.com": "Indeed blocks automated scraping. Please copy the job description and paste it below.",
  };

  for (const [domain, message] of Object.entries(blocked)) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return message;
    }
  }

  return null;
}

/**
 * Returns a human-readable hint when a URL looks like a search/listing page
 * rather than a single job posting. Returns null if the URL looks fine.
 */
function detectListingPage(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const path = parsed.pathname.toLowerCase();
  const params = parsed.searchParams;

  // Common search/listing path segments
  const listingSegments = [
    "jobsearch", "job-search", "jobs/search", "search",
    "careers/search", "careers/explore", "careers/results",
    "openings", "positions", "vacancies",
  ];
  if (listingSegments.some((seg) => path.includes(seg))) {
    return "That looks like a jobs search page. Please open a specific job posting and paste that URL instead.";
  }

  // Query-parameter patterns that indicate search/filter pages
  const searchParams = ["q", "query", "keyword", "keywords", "search", "filter", "category", "roles", "offices", "location"];
  for (const p of searchParams) {
    if (params.has(p)) {
      return "That looks like a search results page. Please open a single job posting and paste that URL instead.";
    }
  }

  return null;
}

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      headers: FETCH_HEADERS,
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null; // Caller will fall back to browser rendering.
    }

    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    const { url } = (await request.json()) as { url?: string };

    if (!url?.trim()) {
      return NextResponse.json({ error: "Please provide a job posting URL." }, { status: 400 });
    }

    if (!isValidUrl(url)) {
      return NextResponse.json({ error: "Invalid URL. Please enter a valid http or https URL." }, { status: 400 });
    }

    const { hostname } = new URL(url);

    const blockedMsg = detectBlockedSite(hostname);
    if (blockedMsg) {
      return NextResponse.json({ error: blockedMsg }, { status: 400 });
    }

    const listingHint = detectListingPage(url);
    if (listingHint) {
      return NextResponse.json({ error: listingHint }, { status: 400 });
    }

    let text = "";

    // Step 1 – plain fetch (fast, no JS execution).
    const html = await fetchHtml(url);
    if (html) {
      text = extractReadableText(html);

      if (text.length < 200) {
        const structuredText = extractTextFromStructuredData(html);
        if (structuredText.length > text.length) {
          text = structuredText;
        }
      }
    }

    // Step 2 – headless browser (handles JavaScript-heavy pages and soft blocks).
    // Run this whenever plain fetch failed OR yielded too little text.
    if (text.length < 300) {
      try {
        const renderedText = await renderJobPage(url);
        if (renderedText.length > text.length) {
          text = renderedText;
        }
      } catch {
        // Swallow — if both methods fail, we surface a clear error below.
      }
    }

    if (!text) {
      return NextResponse.json(
        {
          error:
            "Could not extract the job description from this page — it may be heavily JavaScript-rendered, behind a login, or blocking automated access. Try pasting the job description text directly instead.",
        },
        { status: 422 }
      );
    }

    let parsed: Omit<JobDescription, "url" | "rawText">;

    try {
      parsed = await parseJobDescriptionWithClaude(text);
    } catch {
      parsed = deriveJobDescriptionFallback(text, url);
    }

    return NextResponse.json<JobDescription>({
      url,
      title: parsed.title,
      company: parsed.company,
      keywords: parsed.keywords,
      rawText: text,
      summary: parsed.summary,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to scrape the job description." },
      { status: 500 }
    );
  }
}
