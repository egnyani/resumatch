import { NextResponse } from "next/server";

import { generateJsonFromPrompt } from "@/lib/claude";
import {
  applyModificationsToText,
  buildDocx,
  docxToBase64,
  modifyDocx,
  parseDocx,
} from "@/lib/docx-parser";
import { extractKeywords, filterHighValueKeywords, scoreKeywordMatch } from "@/lib/keyword-scorer";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import type { Modification, TailoringResult } from "@/types";

type ClaudeModification = Modification & {
  keyword: string;
  section: string;
  reason: string;
};

type ClaudeResponse = {
  modifications: ClaudeModification[];
};

const MAX_MODIFICATIONS = 10;
const MAX_TOTAL_ADDED_WORDS = 60;
const MAX_WORD_DELTA_PER_MODIFICATION = 15;
// Relaxed caps for the second aggressive pass
const MAX_MODIFICATIONS_AGGRESSIVE = 12;
const MAX_TOTAL_ADDED_WORDS_AGGRESSIVE = 80;

async function applyResumeModifications(params: {
  sourceBuffer: Buffer;
  sourceText: string;
  sourceFileName: string;
  modifications: ClaudeModification[];
}) {
  const xmlBuffer = await modifyDocx(params.sourceBuffer, params.modifications);
  const xmlResume = await parseDocx(xmlBuffer);

  if (xmlResume.text !== params.sourceText) {
    return {
      buffer: xmlBuffer,
      parsed: xmlResume,
      appliedModifications: params.modifications,
    };
  }

  const textFallback = applyModificationsToText(params.sourceText, params.modifications);

  if (textFallback.appliedModifications.length === 0) {
    return {
      buffer: params.sourceBuffer,
      parsed: await parseDocx(params.sourceBuffer),
      appliedModifications: [] as ClaudeModification[],
    };
  }

  const rebuiltBuffer = await buildDocx(textFallback.text, {
    sourceName: params.sourceFileName,
    title: "Tailored Resume",
  });

  return {
    buffer: rebuiltBuffer,
    parsed: await parseDocx(rebuiltBuffer),
    appliedModifications: params.modifications.filter((modification) =>
      textFallback.appliedModifications.some(
        (applied) =>
          applied.findText === modification.findText &&
          applied.replaceText === modification.replaceText
      )
    ),
  };
}

const modificationsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["modifications"],
  properties: {
    modifications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["findText", "replaceText", "keyword", "section", "reason"],
        properties: {
          findText: { type: "string" },
          replaceText: { type: "string" },
          keyword: { type: "string" },
          section: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};

const systemPrompt = `You are an expert ATS resume optimizer. Maximize keyword match score while keeping the resume exactly one page and grammatically correct.

══════════════════════════════════════════
MODIFICATION TYPES — use in priority order
══════════════════════════════════════════

TYPE A — SKILLS SECTION (use 3-4 of your modifications here, highest ROI):
  Append a comma-separated list of 3-6 missing keywords to an existing skills line.
  The current skills section will be provided. Only add keywords NOT already present there.
  ✅ GOOD example:
    findText:    "AWS, Docker, Kubernetes, NumPy, Pandas, Cassandra, LangChain, Maven."
    replaceText: "AWS, Docker, Kubernetes, NumPy, Pandas, Cassandra, LangChain, Maven, Redis, Celery, Terraform, gRPC."
  ✅ GOOD example:
    findText:    "MySQL, Node.js, Next.js, Express.js, ReactJS, Jenkins, GraphQL, Apache Kafka, Git, Linux, Oracle, Postgres."
    replaceText: "MySQL, Node.js, Next.js, Express.js, ReactJS, Jenkins, GraphQL, Apache Kafka, Git, Linux, Oracle, Postgres, Spark, Airflow, Flink."

TYPE B — BULLET POINT TERM SWAP (replace one tech name/phrase with a richer equivalent):
  findText must be a complete, meaningful technical phrase (a tool name, library, or architecture term).
  replaceText swaps it for a keyword-enriched equivalent of similar length.
  ✅ GOOD: findText "Flask/Django" → replaceText "Flask/Django/FastAPI"
  ✅ GOOD: findText "CI/CD pipelines" → replaceText "CI/CD pipelines with GitHub Actions and Terraform"
  ❌ BAD:  findText "systems and AI automation" → inserting a keyword between "and" and "AI" — this creates incoherent text
  ❌ BAD:  Any findText that is just bridging words like "and", "with", "using", "through"
  ❌ BAD:  Any modification that appends a clause AFTER a sentence ending in a period or percentage

══════════════════════════════════════════
HARD CONSTRAINTS
══════════════════════════════════════════
• NEVER touch: candidate name, contact line, section headers (EXPERIENCE, EDUCATION, TECHNICAL SKILLS, PROJECTS)
• NEVER modify RELI Group Inc. job titles (Software Developer / Software Developer Intern are locked)
• NEVER append after a sentence-ending period or after a metric like "99.9%" or "40%"
• NEVER insert a keyword between two existing words mid-phrase — only replace whole phrases
• NEVER use the hiring company's name as a keyword ("Meta-scale", "Google-grade" etc.)
• NEVER add hardware/kernel/firmware terms (RDMA, CUDA, Linux Kernel, Network Drivers) for SWE roles unless JD explicitly requires them
• NO vague business phrases: "communication", "problem solving", "cross-functional", "stakeholder" etc.
• Net words added across ALL modifications combined: ≤ 60 words total
• Each modification individually: ≤ 15 words added

Return ONLY valid JSON, no markdown, no explanation:
{
  "modifications": [
    {
      "findText": "exact verbatim text from resume (must be unique, 10+ chars)",
      "replaceText": "replacement with keywords naturally integrated",
      "keyword": "primary keyword added",
      "section": "Skills / RELI Group Inc. - Software Developer / etc.",
      "reason": "one sentence why this helps ATS score"
    }
  ]
}`;

function getWordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Extracts the TECHNICAL SKILLS / SKILLS section lines from a plain-text resume.
 * Returns an empty string if the section is not found.
 */
function extractSkillsSection(resumeText: string): string {
  const lines = resumeText.split("\n");
  const sectionHeaderRe = /^(TECHNICAL SKILLS|SKILLS|CORE COMPETENCIES|TECHNICAL SKILLS & TOOLS)/i;
  const nextSectionRe = /^(EXPERIENCE|EDUCATION|PROJECTS|CERTIFICATIONS|AWARDS|PUBLICATIONS|SUMMARY|OBJECTIVE)/i;

  let inside = false;
  const skillsLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (sectionHeaderRe.test(trimmed)) {
      inside = true;
      continue;
    }
    if (inside) {
      if (nextSectionRe.test(trimmed)) break;
      if (trimmed) skillsLines.push(trimmed);
    }
  }

  return skillsLines.join("\n");
}

function selectCompactModifications(
  modifications: ClaudeModification[],
  maxMods = MAX_MODIFICATIONS,
  maxTotalWords = MAX_TOTAL_ADDED_WORDS
) {
  let totalAddedWords = 0;

  return modifications
    .filter((item) => {
      const findWordCount = getWordCount(item.findText);
      const replaceWordCount = getWordCount(item.replaceText);
      const addedWords = replaceWordCount - findWordCount;

      // Reject clause-appending: if findText ends a sentence (period/digit) and
      // replaceText is strictly longer, the LLM is tacking on extra content.
      const findTrimmed = item.findText.trimEnd();
      const isFinishedSentence = /[.%]$|\d+$/.test(findTrimmed);
      if (isFinishedSentence && addedWords > 2) return false;

      // Allow keyword swaps (addedWords can be negative) and additions up to the per-mod limit
      return (
        addedWords <= MAX_WORD_DELTA_PER_MODIFICATION &&
        item.replaceText.length <= item.findText.length + 120
      );
    })
    // Sort by most added words first (highest impact changes first) so they
    // get priority when we enforce the total word budget below.
    .sort((left, right) => {
      const leftAddedWords = getWordCount(left.replaceText) - getWordCount(left.findText);
      const rightAddedWords = getWordCount(right.replaceText) - getWordCount(right.findText);
      return rightAddedWords - leftAddedWords; // descending: more words = higher impact
    })
    .filter((item) => {
      const addedWords = Math.max(0, getWordCount(item.replaceText) - getWordCount(item.findText));

      if (totalAddedWords + addedWords > maxTotalWords) {
        return false;
      }

      totalAddedWords += addedWords;
      return true;
    })
    .slice(0, maxMods);
}

function getAppOrigin() {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

function parseJsonKeywords(value: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("jobKeywords must be a valid JSON array.");
  }

  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("jobKeywords must be a JSON array of strings.");
  }

  return filterHighValueKeywords(parsed.map((item) => item.trim()).filter(Boolean));
}

function cleanClaudeJson(text: string) {
  return text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
}

function parseModelJson<T>(text: string): T {
  const cleaned = cleanClaudeJson(text);

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }

    throw new Error("The model returned invalid JSON.");
  }
}

async function requestModificationsFromClaude(params: {
  resumeText: string;
  jobDescription: string;
  missingKeywords: string[];
  jobTitle: string;
  jobCompany: string;
  aggressive?: boolean;
}) {
  if (params.missingKeywords.length === 0) {
    return [] as ClaudeModification[];
  }

  const modLimit = params.aggressive ? MAX_MODIFICATIONS_AGGRESSIVE : MAX_MODIFICATIONS;
  const wordLimit = params.aggressive ? MAX_TOTAL_ADDED_WORDS_AGGRESSIVE : MAX_TOTAL_ADDED_WORDS;

  const skillsSection = extractSkillsSection(params.resumeText);

  const userMessage = `RESUME TEXT:
${params.resumeText}

CURRENT SKILLS SECTION (already present — do NOT re-add these in TYPE A modifications):
${skillsSection || "(not found)"}

JOB DESCRIPTION:
${params.jobDescription}

MISSING KEYWORDS TO ADD (prioritize these, cover as many as possible):
${params.missingKeywords.join(", ")}

Job Title: ${params.jobTitle}
Company: ${params.jobCompany}

${
    params.aggressive
      ? `This is a second optimization pass. The first pass did not improve the score enough. Be more aggressive: target the Skills section directly, add multiple missing keywords per modification, and use keyword substitutions wherever natural. Return up to ${modLimit} modifications.`
      : `Return up to ${modLimit} modifications that maximize keyword coverage for this role.`
  }`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const rawJson = await generateJsonFromPrompt(
        systemPrompt,
        userMessage,
        4096,
        modificationsSchema
      );
      const parsed = parseModelJson<ClaudeResponse>(rawJson);

      if (!Array.isArray(parsed.modifications)) {
        throw new Error("The model returned an invalid modifications payload.");
      }

      // Lines that must never be modified: name, contact info, section headers.
      const headerLines = new Set(
        params.resumeText
          .split("\n")
          .slice(0, 6) // first 6 lines always contain name + contact
          .map((l) => l.trim().toLowerCase())
          .filter(Boolean)
      );

      const isHeaderText = (text: string) => {
        const lower = text.toLowerCase();
        // Reject if it matches a known header line
        if ([...headerLines].some((line) => lower.includes(line) || line.includes(lower.slice(0, 20)))) return true;
        // Reject if it contains contact-info signals
        if (/@|linkedin|github|portfolio|\(\d{3}\)|\d{3}-\d{3}/.test(lower)) return true;
        // Reject if the candidate's name appears in findText (first non-empty line)
        const name = params.resumeText.split("\n").find((l) => l.trim())?.trim().toLowerCase() ?? "";
        if (name && lower.includes(name.split(" ")[0])) return true;
        return false;
      };

      const validModifications = parsed.modifications.filter(
        (item) =>
          typeof item.findText === "string" &&
          typeof item.replaceText === "string" &&
          typeof item.keyword === "string" &&
          typeof item.section === "string" &&
          typeof item.reason === "string" &&
          item.findText.trim().length >= 10 &&
          item.replaceText.trim().length >= 5 &&
          item.replaceText.trim() !== item.findText.trim() &&
          !isHeaderText(item.findText)
      );

      return selectCompactModifications(validModifications, modLimit, wordLimit);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("The model returned invalid JSON.");
    }
  }

  throw lastError || new Error("The model returned invalid JSON.");
}

async function convertDocxToPdfBuffer(docxBuffer: Buffer, filename: string) {
  const response = await fetch(`${getAppOrigin()}/api/convert-pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      docxBase64: docxToBase64(docxBuffer),
      filename,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    let errorMessage = "Failed to convert the tailored DOCX to PDF.";

    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        errorMessage = payload.error;
      }
    } catch {
      // Keep the fallback error message.
    }

    throw new Error(errorMessage);
  }

  const payload = (await response.json()) as { pdfBase64?: string };

  if (!payload.pdfBase64) {
    throw new Error("Failed to convert the tailored DOCX to PDF.");
  }

  return Buffer.from(payload.pdfBase64, "base64");
}

export async function POST(request: Request) {
  try {
    const limit = rateLimit(`tailor:${getClientIp(request)}`, 5, 60 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again in about an hour." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)),
          },
        }
      );
    }

    const formData = await request.formData();
    const resume = formData.get("resume");
    const jobDescription = formData.get("jobDescription");
    const jobKeywords = formData.get("jobKeywords");
    const jobTitle = formData.get("jobTitle");
    const jobCompany = formData.get("jobCompany");

    if (!(resume instanceof File)) {
      return NextResponse.json({ error: "resume must be a .docx file upload." }, { status: 400 });
    }

    if (!resume.name.toLowerCase().endsWith(".docx")) {
      return NextResponse.json({ error: "Only .docx resumes are supported." }, { status: 400 });
    }

    if (resume.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Resume file must be 5MB or smaller." }, { status: 400 });
    }

    if (
      typeof jobDescription !== "string" ||
      typeof jobKeywords !== "string" ||
      typeof jobTitle !== "string" ||
      typeof jobCompany !== "string"
    ) {
      return NextResponse.json(
        { error: "jobDescription, jobKeywords, jobTitle, and jobCompany are required." },
        { status: 400 }
      );
    }

    if (jobDescription.trim().length < 200) {
      return NextResponse.json(
        { error: "Job description text must be at least 200 characters." },
        { status: 400 }
      );
    }

    const submittedKeywords = parseJsonKeywords(jobKeywords);
    const extractedKeywords = extractKeywords(jobDescription);
    const keywordList = filterHighValueKeywords([...submittedKeywords, ...extractedKeywords]).slice(0, 40);

    if (keywordList.length === 0) {
      return NextResponse.json(
        { error: "No high-value technical keywords were found in this job description." },
        { status: 400 }
      );
    }
    const originalBuffer = Buffer.from(await resume.arrayBuffer());
    let parsedResume: Awaited<ReturnType<typeof parseDocx>>;

    try {
      parsedResume = await parseDocx(originalBuffer);
    } catch {
      return NextResponse.json(
        { error: "The uploaded file is not a valid .docx document." },
        { status: 400 }
      );
    }
    const originalScore = scoreKeywordMatch(parsedResume.text, keywordList);

    const missingKeywords = keywordList.filter(
      (keyword) => !parsedResume.text.toLowerCase().includes(keyword.toLowerCase())
    );

    let modifications = await requestModificationsFromClaude({
      resumeText: parsedResume.text,
      jobDescription,
      missingKeywords,
      jobTitle,
      jobCompany,
    });

    if (modifications.length === 0) {
      const result: TailoringResult = {
        originalScore,
        tailoredScore: originalScore,
        addedKeywords: [],
        tailoredDocxBase64: docxToBase64(originalBuffer),
        tailoredPdfBase64: "",
      };

      try {
        const pdfBuffer = await convertDocxToPdfBuffer(originalBuffer, resume.name);
        result.tailoredPdfBase64 = docxToBase64(pdfBuffer);
      } catch {
        result.tailoredPdfBase64 = "";
      }

      return NextResponse.json(result);
    }

    let applied = await applyResumeModifications({
      sourceBuffer: originalBuffer,
      sourceText: parsedResume.text,
      sourceFileName: resume.name,
      modifications,
    });
    let modifiedBuffer = applied.buffer;
    let modifiedResume = applied.parsed;
    let appliedModifications = applied.appliedModifications;
    let tailoredScore = scoreKeywordMatch(modifiedResume.text, keywordList);

    if (tailoredScore - originalScore < 10) {
      modifications = await requestModificationsFromClaude({
        resumeText: modifiedResume.text,
        jobDescription,
        missingKeywords: keywordList.filter(
          (keyword) => !modifiedResume.text.toLowerCase().includes(keyword.toLowerCase())
        ),
        jobTitle,
        jobCompany,
        aggressive: true,
      });

      applied = await applyResumeModifications({
        sourceBuffer: modifiedBuffer,
        sourceText: modifiedResume.text,
        sourceFileName: resume.name,
        modifications,
      });
      modifiedBuffer = applied.buffer;
      modifiedResume = applied.parsed;
      appliedModifications = applied.appliedModifications;
      tailoredScore = scoreKeywordMatch(modifiedResume.text, keywordList);
    }

    const result: TailoringResult = {
      originalScore,
      tailoredScore,
      addedKeywords: appliedModifications.map((item) => ({
        keyword: item.keyword,
        section: item.section,
        context: item.replaceText.slice(0, 100),
        originalText: item.findText,
        updatedText: item.replaceText,
      })),
      tailoredDocxBase64: docxToBase64(modifiedBuffer),
      tailoredPdfBase64: "",
    };

    try {
      const pdfBuffer = await convertDocxToPdfBuffer(modifiedBuffer, resume.name);
      result.tailoredPdfBase64 = docxToBase64(pdfBuffer);
    } catch {
      result.tailoredPdfBase64 = "";
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to tailor resume." },
      { status: 500 }
    );
  }
}
