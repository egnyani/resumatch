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

  const selectors = [
    '[data-testid*="job-description"]',
    '[data-qa*="job-description"]',
    '[id*="job-description"]',
    '[id*="description"]',
    '[class*="job-description"]',
    '[class*="description"]',
    '[class*="content"]',
    '[class*="posting"]',
    '[role="main"]',
    "main",
    "article",
    "body",
  ];

  for (const selector of selectors) {
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

async function renderJobPage(url: string) {
  const browser = await launchHeadlessBrowser();

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    );
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 15_000,
    });

    await page.waitForSelector("body", { timeout: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const text = await page.evaluate(() => {
      document.querySelectorAll("script, style, nav, header, footer, noscript, svg").forEach((node) => node.remove());

      const selectors = [
        '[data-testid*="job-description"]',
        '[data-qa*="job-description"]',
        '[id*="job-description"]',
        '[id*="description"]',
        '[class*="job-description"]',
        '[class*="description"]',
        '[class*="content"]',
        '[class*="posting"]',
        '[role="main"]',
        "main",
        "article",
        "body",
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector) as HTMLElement | null;
        const value = element?.innerText?.replace(/\s+/g, " ").trim();
        if (value && value.length >= 200) {
          return value.slice(0, 20_000);
        }
      }

      return "";
    });

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

export async function POST(request: Request) {
  try {
    const { url } = (await request.json()) as { url?: string };

    if (!url?.trim()) {
      return NextResponse.json({ error: "Please provide a job posting URL." }, { status: 400 });
    }

    if (!isValidUrl(url)) {
      return NextResponse.json({ error: "Invalid URL. Please enter a valid http or https URL." }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let html: string;
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        return NextResponse.json(
          {
            error:
              "Could not access this URL. Try pasting the job description text directly instead.",
          },
          { status: 400 }
        );
      }

      html = await response.text();
    } catch {
      return NextResponse.json(
        {
          error: "Could not access this URL. Try pasting the job description text directly instead.",
        },
        { status: 400 }
      );
    } finally {
      clearTimeout(timeout);
    }

    let text = extractReadableText(html);

    if (text.length < 200) {
      const structuredText = extractTextFromStructuredData(html);
      if (structuredText.length > text.length) {
        text = structuredText;
      }
    }

    if (text.length < 300) {
      try {
        const renderedText = await renderJobPage(url);
        if (renderedText.length > text.length) {
          text = renderedText;
        }
      } catch {
        // If browser rendering also fails, fall through to the existing parse error.
      }
    }

    if (!text) {
      return NextResponse.json(
        { error: "Could not parse readable job description text from this page." },
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
