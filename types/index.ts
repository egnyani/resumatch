export interface TailorRequest {
  resumePath: string;
  resumeFileName?: string;
  jobDescriptionUrl?: string;
  jobDescriptionText?: string;
}

export interface TailoringResult {
  originalScore: number;
  tailoredScore: number;
  addedKeywords: AddedKeyword[];
  tailoredDocxBase64: string;
  tailoredPdfBase64: string;
}

export interface AddedKeyword {
  keyword: string;
  section: string;
  context: string;
  originalText: string;
  updatedText: string;
}

export interface Section {
  name: string;
  startIndex: number;
  endIndex: number;
  content: string;
}

export interface Modification {
  findText: string;
  replaceText: string;
}

export interface JobDescription {
  url: string;
  rawText: string;
  keywords: string[];
  title: string;
  company: string;
  summary: string;
}

export interface KeywordMatch {
  keyword: string;
  inResume: boolean;
  inJd: boolean;
  context?: string;
}

export interface ScoreResult {
  matchPercent: number;
  totalJdKeywords: number;
  matchedKeywords: number;
  missing: KeywordMatch[];
  matched: KeywordMatch[];
}

export interface TailorResult {
  originalScore: ScoreResult;
  tailoredScore: ScoreResult;
  tailoredDocxUrl: string;
  tailoredPdfUrl: string | null;
  missingKeywords: string[];
  changes: string[];
  claudeSummary: string;
  scrapedJobDescription: string;
}

export interface ParsedResume {
  rawText: string;
  xmlContent: string;
  sections: Section[];
}

export interface UploadedFile {
  name: string;
  url: string;
  path: string;
  size: number;
}

export type TailorStatus =
  | "idle"
  | "uploading"
  | "scraping"
  | "scoring"
  | "tailoring"
  | "saving"
  | "done"
  | "error";
