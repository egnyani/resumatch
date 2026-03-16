export interface ParsedJD {
  required_skills: string[];
  preferred_skills: string[];
  years_experience: number | null;
  education_requirement: string | null;
  employment_type: string | null;  // 'full-time' | 'contract' | 'part-time'
  remote_policy: string | null;    // 'remote' | 'hybrid' | 'onsite'
  summary: string;                 // first 800 chars of JD for context
}

export function parseJD(description: string): ParsedJD {
  const lower = description.toLowerCase();

  // Remote policy
  let remote_policy: string | null = null;
  if (lower.includes('fully remote') || lower.includes('100% remote') || lower.includes('fully-remote')) {
    remote_policy = 'remote';
  } else if (lower.includes('remote')) {
    remote_policy = 'remote';
  } else if (lower.includes('hybrid')) {
    remote_policy = 'hybrid';
  } else if (lower.includes('on-site') || lower.includes('onsite') || lower.includes('in-office') || lower.includes('in office')) {
    remote_policy = 'onsite';
  }

  // Years of experience — take the first match
  const yearsMatch = description.match(/(\d+)\+?\s*years?\s+of\s+(relevant\s+)?experience/i);
  const years_experience = yearsMatch ? parseInt(yearsMatch[1]) : null;

  // Employment type
  let employment_type: string | null = null;
  if (lower.includes('full-time') || lower.includes('full time')) {
    employment_type = 'full-time';
  } else if (lower.includes('contract')) {
    employment_type = 'contract';
  } else if (lower.includes('part-time') || lower.includes('part time')) {
    employment_type = 'part-time';
  }

  // Education
  let education_requirement: string | null = null;
  if (lower.includes('phd') || lower.includes('doctorate')) {
    education_requirement = 'phd';
  } else if (lower.includes("master's") || lower.includes('masters degree') || lower.includes('ms in')) {
    education_requirement = 'masters';
  } else if (lower.includes("bachelor's") || lower.includes('bs in') || lower.includes('b.s.') || lower.includes('undergraduate degree')) {
    education_requirement = 'bachelors';
  }

  return {
    required_skills: [],  // LLM handles this
    preferred_skills: [],
    years_experience,
    education_requirement,
    employment_type,
    remote_policy,
    summary: description.slice(0, 800),
  };
}
