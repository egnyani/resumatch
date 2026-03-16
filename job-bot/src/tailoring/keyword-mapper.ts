import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import rawSettings from '../../config/settings.json';

const apiKey = process.env.OPENAI_API_KEY || (rawSettings.llm as any).api_key as string;
const llmModel = (rawSettings.llm as any).model as string;
const client = new OpenAI({ apiKey });

export interface KeywordReport {
  jd_keywords: string[];
  covered: string[];
  missing: string[];
  warnings: Array<{ keyword: string; reason: string }>;
  coverage_percent: number;
}

const KEYWORD_EXTRACT_PROMPT = `Extract the most important keywords from this job description.
Return ONLY a JSON object with no other text.

Job Description:
{{JD}}

{
  "required_skills": ["<skill>"],
  "preferred_skills": ["<skill>"],
  "domain_keywords": ["<term>"],
  "tools_and_platforms": ["<tool>"],
  "methodologies": ["<method>"]
}

Focus on keywords that would help a resume ATS scan pass.
Include specific version numbers or variants if mentioned (e.g. "Python 3.10+", "React 18").
Maximum 10 items per category.`;

export async function mapKeywords(
  jdText: string,
  resumeText: string
): Promise<KeywordReport> {
  const prompt = KEYWORD_EXTRACT_PROMPT.replace('{{JD}}', jdText.slice(0, 3000));

  const response = await client.chat.completions.create({
    model: llmModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 800,
  });

  const raw = response.choices[0]?.message?.content ?? '{}';

  let parsed: {
    required_skills?: string[];
    preferred_skills?: string[];
    domain_keywords?: string[];
    tools_and_platforms?: string[];
    methodologies?: string[];
  } = {};

  try {
    // Strip code blocks if present
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn('keyword-mapper: JSON parse failed, returning empty report');
    return { jd_keywords: [], covered: [], missing: [], warnings: [], coverage_percent: 0 };
  }

  const allKeywords = [
    ...(parsed.required_skills ?? []),
    ...(parsed.preferred_skills ?? []),
    ...(parsed.domain_keywords ?? []),
    ...(parsed.tools_and_platforms ?? []),
    ...(parsed.methodologies ?? []),
  ];

  const resumeLower = resumeText.toLowerCase();
  const covered: string[] = [];
  const missing: string[] = [];

  for (const kw of allKeywords) {
    const kwLower = kw.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    if (resumeLower.includes(kwLower)) {
      covered.push(kw);
    } else {
      missing.push(kw);
    }
  }

  const coverage_percent =
    allKeywords.length > 0
      ? Math.round((covered.length / allKeywords.length) * 100)
      : 0;

  return {
    jd_keywords: allKeywords,
    covered,
    missing,
    warnings: [],
    coverage_percent,
  };
}
