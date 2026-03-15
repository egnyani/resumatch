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

const MAX_MODIFICATIONS = 8;
const MAX_TOTAL_ADDED_WORDS = 80;
const MAX_WORD_DELTA_PER_MODIFICATION = 20;
// Relaxed caps for the second aggressive pass
const MAX_MODIFICATIONS_AGGRESSIVE = 12;
const MAX_TOTAL_ADDED_WORDS_AGGRESSIVE = 120;

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

const systemPrompt = `You are an expert ATS resume optimizer. You will be given a resume and a job description.
Your goal is to maximize the resume's ATS keyword match score by suggesting targeted text modifications that naturally incorporate the missing keywords.

RULES:
1. NEVER change any job title at RELI Group Inc. - both 'Software Developer' and 'Software Developer Intern' are locked and cannot be modified under any circumstances.
2. You MAY suggest changing the Acmesia Consultants LLP job title if a different title better matches the job description.
3. Only ADD or MODIFY content — never remove existing achievements, metrics, or bullet points.
4. Keywords must flow naturally in context — do not dump a raw list of keywords.
5. Prioritize adding keywords in this order: (a) Skills / Technologies section — appending keywords here is the safest, highest-impact change; (b) bullet points in experience; (c) project descriptions.
6. Each modification must make grammatical sense and read as natural professional writing.
7. The tailored resume must stay within a one-page budget. Prefer replacing a short phrase with a tighter ATS-rich version rather than appending long clauses.
8. You may add up to 20 words per modification. Aim to cover as many missing keywords as possible.
9. Return up to 8 modifications. Cover as many high-priority missing keywords as you can within that budget.
10. Focus on technical keywords: programming languages, frameworks, cloud platforms, tooling, testing, data platforms, architecture terms, and methodologies.
11. DO NOT add soft skills, filler words, or vague business phrases such as "communication", "problem solving", "operational experience", or similar low-signal wording.
12. Keyword substitutions are encouraged — if the resume says "web frameworks" but the JD requires "React and Vue.js", make the swap even if the replacement is shorter.
13. For the Skills section, you may append a comma-separated list of missing keywords to an existing skills line, or add a new "Additional: ..." line.

Return ONLY valid JSON, no markdown, no explanation:
{
  "modifications": [
    {
      "findText": "exact text to find in resume (must be unique, 10+ chars)",
      "replaceText": "replacement text with keyword naturally woven in",
      "keyword": "the keyword being added",
      "section": "section name e.g. RELI Group Inc. - Software Developer",
      "reason": "one sentence why this change helps"
    }
  ]
}`;

function getWordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
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

      // Allow keyword swaps (addedWords can be negative) and additions up to the per-mod limit
      return (
        addedWords <= MAX_WORD_DELTA_PER_MODIFICATION &&
        item.replaceText.length <= item.findText.length + 200
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

  const userMessage = `RESUME TEXT:
${params.resumeText}

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

      const validModifications = parsed.modifications.filter(
        (item) =>
          typeof item.findText === "string" &&
          typeof item.replaceText === "string" &&
          typeof item.keyword === "string" &&
          typeof item.section === "string" &&
          typeof item.reason === "string" &&
          item.findText.trim().length >= 10 &&
          item.replaceText.trim().length >= 5 &&
          item.replaceText.trim() !== item.findText.trim()
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
