import type { KeywordMatch, ScoreResult } from "@/types";

const stopWords = new Set([
  "a",
  "about",
  "ability",
  "across",
  "after",
  "also",
  "and",
  "are",
  "based",
  "but",
  "candidate",
  "collaborate",
  "company",
  "computer",
  "degree",
  "development",
  "drive",
  "engineer",
  "engineering",
  "environment",
  "experience",
  "for",
  "from",
  "highly",
  "have",
  "including",
  "into",
  "job",
  "knowledge",
  "manager",
  "must",
  "need",
  "needed",
  "preferred",
  "requirements",
  "required",
  "responsibilities",
  "responsible",
  "our",
  "passion",
  "position",
  "role",
  "skills",
  "software",
  "that",
  "team",
  "teams",
  "the",
  "their",
  "this",
  "using",
  "join",
  "life",
  "appropriately",
  "operational",
  "paid",
  "support",
  "systems",
  "workflows",
  "reviews",
  "cross-functional",
  "client",
  "clients",
  "process",
  "processes",
  "communication",
  "problem",
  "solving",
  "want",
  "will",
  "work",
  "with",
  "you",
  "your",
]);

const bannedKeywordPatterns = [
  /^(join|life|appropriately|communication|problem solving)$/i,
  /^(cross-functional|operational experience|paid-support|client life-cycle)$/i,
  /experience\.$/i,
];

const knownMultiWordKeywords = [
  "rest api",
  "restful api",
  "machine learning",
  "deep learning",
  "natural language processing",
  "large language models",
  "data science",
  "data engineering",
  "data pipeline",
  "cloud computing",
  "amazon web services",
  "google cloud platform",
  "google cloud",
  "microsoft azure",
  "continuous integration",
  "continuous delivery",
  "continuous deployment",
  "object oriented",
  "object oriented programming",
  "test automation",
  "unit testing",
  "integration testing",
  "end to end testing",
  "microservices architecture",
  "distributed systems",
  "event driven",
  "event driven architecture",
  "agile methodology",
  "scrum framework",
  "project management",
  "risk management",
  "design systems",
  "quality assurance",
  "data analysis",
  "data visualization",
  "version control",
  "code review",
  "pair programming",
  "infrastructure as code",
  "site reliability",
  "load balancing",
  "high availability",
  "fault tolerance",
  "zero downtime",
  "feature flags",
  "a/b testing",
  "prompt engineering",
  "retrieval augmented generation",
  "vector database",
  "spring boot",
  "lightning web components",
  "github actions",
  "gitlab ci",
  "experience cloud",
  "sales cloud",
  "service cloud",
  "marketing cloud",
  "flow builder",
  "process builder",
  "platform events",
];

const knownTechnicalKeywords = [
  // Salesforce ecosystem
  "salesforce",
  "salesforce crm",
  "salesforce dx",
  "sfdc",
  "apex",
  "lwc",
  "lightning web components",
  "aura components",
  "copado",
  "soql",
  "sosl",
  "aura",
  "visualforce",
  "experience cloud",
  "sales cloud",
  "service cloud",
  "marketing cloud",
  "cpq",
  "pardot",
  "mulesoft",
  "tableau crm",
  "einstein analytics",
  "flow builder",
  "process builder",
  "platform events",
  "change data capture",
  // Languages
  "python",
  "java",
  "javascript",
  "typescript",
  "c#",
  "c++",
  "go",
  "rust",
  "kotlin",
  "swift",
  "scala",
  "ruby",
  "php",
  "r",
  // Web / JS ecosystem
  "node.js",
  "node",
  "react",
  "next.js",
  "angular",
  "vue",
  "svelte",
  "express",
  "fastapi",
  "flask",
  "django",
  "spring boot",
  "spring",
  "graphql",
  "rest api",
  "restful",
  "api",
  "websocket",
  "tailwindcss",
  "webpack",
  "vite",
  // DevOps / Cloud
  "kubernetes",
  "docker",
  "terraform",
  "ansible",
  "jenkins",
  "github actions",
  "gitlab ci",
  "ci/cd",
  "aws",
  "azure",
  "gcp",
  "lambda",
  "s3",
  "ec2",
  "cloudformation",
  "helm",
  "argocd",
  "prometheus",
  "grafana",
  "datadog",
  "newrelic",
  "nginx",
  "linux",
  "bash",
  "shell",
  // Databases
  "sql",
  "postgresql",
  "mysql",
  "sqlite",
  "mongodb",
  "redis",
  "elasticsearch",
  "cassandra",
  "dynamodb",
  "bigquery",
  "firestore",
  "cosmos db",
  // Data / ML
  "spark",
  "hadoop",
  "airflow",
  "snowflake",
  "dbt",
  "tableau",
  "power bi",
  "looker",
  "pandas",
  "numpy",
  "scikit-learn",
  "pytorch",
  "tensorflow",
  "keras",
  "huggingface",
  "langchain",
  "openai",
  "mlflow",
  "sagemaker",
  "databricks",
  // Methodologies / patterns
  "agile",
  "scrum",
  "kanban",
  "microservices",
  "serverless",
  "oauth",
  "sso",
  "etl",
  "elt",
  "event-driven",
  "tdd",
  "bdd",
  "devops",
  "devsecops",
  "sre",
  "owasp",
  "jwt",
  "grpc",
  "kafka",
  "rabbitmq",
  "celery",
  "redux",
  "mobx",
  "zustand",
  "jest",
  "cypress",
  "playwright",
  "selenium",
  "pytest",
  "junit",
];

function normalizeText(text: string) {
  return text.toLowerCase();
}

function normalizeKeyword(keyword: string) {
  return keyword.toLowerCase().trim();
}

function canonicalizeComparableText(text: string) {
  return normalizeText(text)
    .replace(/[^a-z0-9+.#/ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toDisplayKeyword(keyword: string) {
  return keyword
    .split(/\s+/)
    .map((part) => {
      if (/^(aws|gcp|api|sql|etl|sso|ci\/cd)$/i.test(part)) {
        return part.toUpperCase();
      }

      if (/^(node\.js|next\.js)$/i.test(part)) {
        return part.toLowerCase();
      }

      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function isHighValueKeyword(keyword: string) {
  const normalized = normalizeKeyword(keyword);

  if (
    !normalized ||
    stopWords.has(normalized) ||
    bannedKeywordPatterns.some((pattern) => pattern.test(normalized))
  ) {
    return false;
  }

  if (normalized.length < 3 && !/^(c#|c\+\+|go|ai|ml|r)$/i.test(normalized)) {
    return false;
  }

  if (normalized.split(/\s+/).length > 5) {
    return false;
  }

  // Known lists — always pass
  if (
    knownMultiWordKeywords.includes(normalized) ||
    knownTechnicalKeywords.includes(normalized)
  ) {
    return true;
  }

  // Contains technical punctuation (e.g. node.js, c++, c#, ci/cd)
  if (/[+/#.-]/.test(normalized) || /^[a-z]+\.js$/i.test(normalized)) {
    return true;
  }

  // All-uppercase acronyms 2–6 chars that aren't stop words (e.g. LWC, SFDC, ETL, SSO)
  if (/^[A-Z]{2,6}$/.test(keyword)) {
    return true;
  }

  // Version-tagged tech (e.g. "Python 3", "Java 17", "Angular 17")
  if (/^[A-Za-z]+\s+\d+(\.\d+)?$/.test(keyword)) {
    return true;
  }

  // Catch remaining single technical tokens that look like tools/frameworks
  return /^(aws|azure|gcp|react|angular|vue|docker|kubernetes|terraform|ansible|jenkins|python|java|javascript|typescript|postgresql|mysql|mongodb|redis|graphql|spark|hadoop|airflow|snowflake|dbt|tableau|pandas|numpy|pytorch|tensorflow|linux|bash|agile|scrum|kanban|microservices|serverless|oauth|etl|rest api|restful api|machine learning|data engineering|cloud computing|test automation|unit testing|integration testing|distributed systems|event driven|kafka|rabbitmq|celery|redux|jest|cypress|playwright|selenium|pytest|junit|devops|devsecops|sre|owasp|jwt|grpc|elt|tdd|bdd)$/i.test(
    normalized
  );
}

export function filterHighValueKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map(normalizeKeyword).filter(isHighValueKeyword))]
    .map(toDisplayKeyword)
    .slice(0, 40);
}

function keywordMatchesText(text: string, keyword: string) {
  const normalizedText = canonicalizeComparableText(text);
  const normalizedKeyword = canonicalizeComparableText(keyword);

  if (!normalizedKeyword) {
    return false;
  }

  if (normalizedText.includes(normalizedKeyword)) {
    return true;
  }

  const keywordParts = normalizedKeyword.split(/\s+/).filter(Boolean);

  if (keywordParts.length > 1 && keywordParts.length <= 4) {
    const escapedParts = keywordParts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const orderedLoosePattern = new RegExp(escapedParts.join("[\\s/-]{0,6}"));
    return orderedLoosePattern.test(normalizedText);
  }

  return false;
}

function looksTechnical(token: string) {
  return (
    knownTechnicalKeywords.includes(token) ||
    /[+/#.-]/.test(token) ||
    /^[a-z]{1,4}\d*$/.test(token) ||
    /^[a-z]+\.js$/.test(token)
  );
}

export function extractKeywords(jdText: string): string[] {
  const normalized = normalizeText(jdText);
  const found = new Map<string, number>();

  for (const phrase of knownMultiWordKeywords) {
    const count = normalized.split(phrase).length - 1;
    if (count > 0) {
      found.set(phrase, count + 1);
    }
  }

  for (const keyword of knownTechnicalKeywords) {
    const pattern = new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`, "g");
    const matches = normalized.match(pattern);
    if (matches?.length) {
      found.set(keyword, Math.max(found.get(keyword) || 0, matches.length + 1));
    }
  }

  const tokens = normalized.match(/[a-z0-9][a-z0-9+.#/-]{1,}/g) || [];
  for (const rawToken of tokens) {
    const token = rawToken.replace(/^[^a-z0-9]+|[^a-z0-9+.#/-]+$/g, "");

    if (
      token.length < 2 ||
      stopWords.has(token) ||
      /^[0-9]+$/.test(token) ||
      (!looksTechnical(token) && token.length < 4)
    ) {
      continue;
    }

    if (looksTechnical(token)) {
      found.set(token, (found.get(token) || 0) + 1);
    }
  }

  return filterHighValueKeywords(
    [...found.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([keyword]) => keyword)
    .filter((keyword, index, array) => array.indexOf(keyword) === index)
    .slice(0, 50)
  );
}

export function scoreKeywordMatch(resumeText: string, jdKeywords: string[]): number {
  const uniqueKeywords = [...new Set(jdKeywords.map(normalizeKeyword).filter(Boolean))];

  if (uniqueKeywords.length === 0) {
    return 0;
  }

  const matchedCount = uniqueKeywords.filter((keyword) => keywordMatchesText(resumeText, keyword)).length;
  return Math.round((matchedCount / uniqueKeywords.length) * 100);
}

function buildKeywordMatch(keyword: string, resumeText: string, jobDescriptionText: string): KeywordMatch {
  const normalizedResume = normalizeText(resumeText);
  const normalizedJd = normalizeText(jobDescriptionText);
  const sentence =
    jobDescriptionText
      .split(/(?<=[.!?])\s+/)
      .find((item) => item.toLowerCase().includes(keyword)) || undefined;

  return {
    keyword,
    inResume: keywordMatchesText(resumeText, keyword),
    inJd: normalizedJd.includes(keyword),
    context: sentence?.trim(),
  };
}

export function scoreResumeAgainstJobDescription(
  resumeText: string,
  jobDescriptionText: string
): ScoreResult {
  const keywords = extractKeywords(jobDescriptionText);
  const matches = keywords.map((keyword) => buildKeywordMatch(keyword, resumeText, jobDescriptionText));
  const matched = matches.filter((item) => item.inResume);
  const missing = matches.filter((item) => !item.inResume);
  const matchPercent = scoreKeywordMatch(resumeText, keywords);

  return {
    matchPercent,
    totalJdKeywords: keywords.length,
    matchedKeywords: matched.length,
    missing,
    matched,
  };
}
