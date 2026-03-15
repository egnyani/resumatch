"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, FileText, Link2, Loader2, Sparkles, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { extractKeywords } from "@/lib/keyword-scorer";
import type { JobDescription, TailoringResult } from "@/types";

type ViewState = "input" | "processing" | "results";

type FlowState = {
  view: ViewState;
  activeProgressIndex: number;
};

type FlowAction =
  | { type: "SET_VIEW"; view: ViewState }
  | { type: "SET_PROGRESS"; index: number }
  | { type: "RESET" };

const processingSteps = [
  "Analyzing job description...",
  "Reading your resume...",
  "Finding keyword gaps...",
  "Tailoring content...",
  "Generating files...",
];

function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "SET_VIEW":
      return { ...state, view: action.view };
    case "SET_PROGRESS":
      return { ...state, activeProgressIndex: action.index };
    case "RESET":
      return { view: "input", activeProgressIndex: 0 };
    default:
      return state;
  }
}

function CircularScore({ label, score, accent = false }: { label: string; score: number; accent?: boolean }) {
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    let frame = 0;
    const duration = 800;
    const start = performance.now();

    const animate = (time: number) => {
      const progress = Math.min((time - start) / duration, 1);
      setDisplayScore(Math.round(score * progress));
      if (progress < 1) {
        frame = requestAnimationFrame(animate);
      }
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (displayScore / 100) * circumference;

  return (
    <Card className="glass-panel border-white/10">
      <CardContent className="flex items-center gap-6 p-6">
        <div className="relative h-32 w-32">
          <svg className="h-32 w-32 -rotate-90" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth="10" fill="none" />
            <circle
              cx="70"
              cy="70"
              r={radius}
              stroke={accent ? "#00ff87" : "#94a3b8"}
              strokeWidth="10"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-3xl text-white">{displayScore}%</span>
            <span className="text-xs uppercase tracking-[0.24em] text-slate-400">ATS Match</span>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">{label}</p>
          <h3 className="text-2xl text-white">{accent ? "Keyword-tailored resume" : "Original resume"}</h3>
          <p className="max-w-sm text-sm leading-6 text-slate-400">
            {accent
              ? "Updated after targeted keyword insertion and section-specific wording changes."
              : "Baseline keyword alignment before ATS-focused tailoring."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function highlightKeyword(text: string, keyword: string) {
  const index = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (index === -1) {
    return text;
  }

  return (
    <>
      {text.slice(0, index)}
      <strong className="font-semibold text-white">{text.slice(index, index + keyword.length)}</strong>
      {text.slice(index + keyword.length)}
    </>
  );
}

function downloadBase64File(base64: string, filename: string, mimeType: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function slugifyFilenamePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildDownloadFilename(job: JobDescription | null, extension: "docx" | "pdf") {
  const title = slugifyFilenamePart(job?.title || "resume");
  const company = slugifyFilenamePart(job?.company || "company");
  return `${title}-${company}-resume.${extension}`;
}

export default function HomePage() {
  const { toast } = useToast();
  const [state, dispatch] = useReducer(flowReducer, { view: "input", activeProgressIndex: 0 });
  const [useTextInput, setUseTextInput] = useState(false);
  const [jobUrl, setJobUrl] = useState("");
  const [jobText, setJobText] = useState("");
  const [jobTextHint, setJobTextHint] = useState("");
  const [jobData, setJobData] = useState<JobDescription | null>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [result, setResult] = useState<TailoringResult | null>(null);
  const [fetchingJob, setFetchingJob] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const progressTimer = useRef<number | null>(null);
  const resumeInputRef = useRef<HTMLInputElement | null>(null);

  const canTailor = useMemo(() => Boolean(resumeFile && jobData), [resumeFile, jobData]);
  const visibleChanges = result?.addedKeywords.slice(0, 4) ?? [];

  useEffect(() => {
    if (state.view !== "processing") {
      if (progressTimer.current) {
        window.clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
      return;
    }

    progressTimer.current = window.setInterval(() => {
      dispatch({
        type: "SET_PROGRESS",
        index: Math.min(processingSteps.length - 2, state.activeProgressIndex + 1),
      });
    }, 1100);

    return () => {
      if (progressTimer.current) {
        window.clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
    };
  }, [state.activeProgressIndex, state.view]);

  useEffect(() => {
    if (!resumeFile) {
      void useBundledResume();
    }
  }, []);

  function acceptResumeFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      toast({ title: "Invalid file type", description: "Upload a .docx resume only." });
      return false;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Resume files must be 5MB or smaller." });
      return false;
    }

    setResumeFile(file);
    return true;
  }

  async function useBundledResume() {
    try {
      const response = await fetch("/resumes/Gnyani_Resume_Final.docx");
      if (!response.ok) {
        throw new Error("Bundled resume could not be loaded.");
      }

      const blob = await response.blob();
      const file = new File([blob], "Gnyani_Resume_Final.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      acceptResumeFile(file);
    } catch (error) {
      toast({
        title: "Resume unavailable",
        description: error instanceof Error ? error.message : "Could not load the bundled resume.",
      });
    }
  }

  async function fetchJobDescription() {
    if (useTextInput) {
      const trimmed = jobText.trim();

      // If the user pasted a URL into the text box, switch to URL mode for them.
      if (/^https?:\/\//i.test(trimmed) && !trimmed.includes("\n")) {
        setUseTextInput(false);
        setJobUrl(trimmed);
        setJobText("");
        setJobTextHint("");
        toast({
          title: "Switched to URL mode",
          description: "We detected a URL — click Fetch Job to load it.",
        });
        return;
      }

      if (trimmed.length < 200) {
        toast({
          title: "Job description too short",
          description: "Paste the full job description text (at least 200 characters), not the URL.",
        });
        return;
      }

      setJobData({
        url: "",
        rawText: jobText.trim(),
        keywords: extractKeywords(jobText.trim()),
        title: "Pasted Job Description",
        company: "Manual entry",
        summary: "Using manually pasted job description text for tailoring.",
      });
      setJobTextHint("");
      return;
    }

    if (!jobUrl.trim()) {
      toast({ title: "URL required", description: "Paste a job posting URL before fetching." });
      return;
    }

    try {
      new URL(jobUrl.trim());
    } catch {
      toast({ title: "Invalid URL", description: "Enter a valid http or https job posting URL." });
      return;
    }

    setFetchingJob(true);

    try {
      const response = await fetch("/api/scrape-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: jobUrl.trim() }),
      });
      const payload = (await response.json()) as JobDescription | { error: string };

      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Failed to fetch job description.");
      }

      setJobData(payload as JobDescription);
      setJobText((payload as JobDescription).rawText);
      setJobTextHint("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not fetch job description.";
      setUseTextInput(true);
      setJobData(null);
      setJobText("");
      setJobTextHint(message);
      toast({
        title: "Couldn't fetch job",
        description: message,
      });
    } finally {
      setFetchingJob(false);
    }
  }

  async function handleTailor() {
    if (!resumeFile || !jobData) {
      toast({ title: "Missing inputs", description: "Add both a job description and a .docx resume first." });
      return;
    }

    setTailoring(true);
    setResult(null);
    dispatch({ type: "SET_VIEW", view: "processing" });
    dispatch({ type: "SET_PROGRESS", index: 0 });

    try {
      const formData = new FormData();
      formData.append("resume", resumeFile);
      formData.append("jobDescription", jobData.rawText);
      formData.append("jobKeywords", JSON.stringify(jobData.keywords));
      formData.append("jobTitle", jobData.title);
      formData.append("jobCompany", jobData.company);

      const response = await fetch("/api/tailor-resume", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as TailoringResult | { error: string };

      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Tailoring failed.");
      }

      dispatch({ type: "SET_PROGRESS", index: processingSteps.length - 1 });
      setTimeout(() => {
        setResult(payload as TailoringResult);
        dispatch({ type: "SET_VIEW", view: "results" });
      }, 350);
    } catch (error) {
      dispatch({ type: "SET_VIEW", view: "input" });
      toast({
        title: "Tailoring failed",
        description: error instanceof Error ? error.message : "Unable to tailor the resume.",
      });
    } finally {
      setTailoring(false);
    }
  }

  function resetAll() {
    setUseTextInput(false);
    setJobUrl("");
    setJobText("");
    setJobTextHint("");
    setJobData(null);
    setResumeFile(null);
    setResult(null);
    dispatch({ type: "RESET" });
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#00ff87]/30 bg-[#00ff87]/10 px-3 py-1 text-xs uppercase tracking-[0.28em] text-[#00ff87]">
              <Sparkles className="h-3.5 w-3.5" />
              Resumatch
            </div>
            <div className="space-y-2">
              <h1 className="max-w-4xl text-4xl tracking-tight text-white sm:text-5xl">
                ATS resume tailoring for technical roles.
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-slate-400 sm:text-base">
                Parse a live job post, compare keyword coverage, and generate tailored DOCX and PDF outputs
                without leaving the browser workflow.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs uppercase tracking-[0.24em] text-slate-500">
            Next.js 14 + OpenAI
          </div>
        </header>

        {state.view === "input" ? (
          <section className="grid gap-6 lg:grid-cols-2">
            <Card className="glass-panel border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Paste the job URL</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {!useTextInput ? (
                  <>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <div className="relative flex-1">
                        <Link2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <input
                          value={jobUrl}
                          onChange={(event) => setJobUrl(event.target.value)}
                          placeholder="https://company.com/jobs/platform-engineer"
                          className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-3 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#00ff87]/50 focus:ring-2 focus:ring-[#00ff87]/20"
                        />
                      </div>
                      <Button onClick={fetchJobDescription} disabled={fetchingJob}>
                        {fetchingJob ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch Job"}
                      </Button>
                    </div>
                    <button
                      type="button"
                      className="text-sm text-slate-400 transition hover:text-white"
                      onClick={() => {
                        setUseTextInput(true);
                        setJobData(null);
                        setJobTextHint("");
                      }}
                    >
                      Paste JD text instead
                    </button>
                  </>
                ) : (
                  <>
                    {jobTextHint && (
                      <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-300">
                        {jobTextHint}
                      </div>
                    )}
                    <textarea
                      value={jobText}
                      onChange={(event) => setJobText(event.target.value)}
                      rows={14}
                      placeholder="Paste the full job description here — include the role summary, responsibilities, requirements, and technologies."
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#00ff87]/50 focus:ring-2 focus:ring-[#00ff87]/20"
                    />
                    <p className="text-sm leading-6 text-slate-500">
                      Paste at least 200 characters from the role summary, responsibilities, and requirements.
                    </p>
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        className="text-sm text-slate-400 transition hover:text-white"
                        onClick={() => {
                          setUseTextInput(false);
                          setJobData(null);
                          setJobTextHint("");
                        }}
                      >
                        Use URL fetch instead
                      </button>
                      <Button onClick={fetchJobDescription}>Use Pasted JD</Button>
                    </div>
                  </>
                )}

                {jobData ? (
                  <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Job Metadata</p>
                      <h2 className="text-xl text-white">{jobData.title}</h2>
                      <p className="text-sm text-slate-400">{jobData.company}</p>
                      <p className="text-sm leading-6 text-slate-400">{jobData.summary}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {jobData.keywords.length ? (
                        jobData.keywords.map((keyword) => (
                          <span
                            key={keyword}
                            className="rounded-full border border-[#00ff87]/20 bg-[#00ff87]/10 px-3 py-1 text-xs font-medium text-[#00ff87]"
                          >
                            {keyword}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-500">Keywords will be derived from the pasted JD at tailoring time.</span>
                      )}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="glass-panel border-white/10">
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <CardTitle className="text-white">Your resume</CardTitle>
                  <button
                    type="button"
                    className="rounded-full border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-slate-400 transition hover:border-[#00ff87]/30 hover:text-white"
                    onClick={() => resumeInputRef.current?.click()}
                  >
                    Upload new one
                  </button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <label
                  className="flex min-h-[320px] cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-white/[0.03] px-6 py-8 text-center transition hover:border-[#00ff87]/40 hover:bg-[#00ff87]/[0.04]"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const file = event.dataTransfer.files?.[0];
                    if (!file) {
                      return;
                    }
                    acceptResumeFile(file);
                  }}
                >
                  <div className="mb-5 rounded-full border border-[#00ff87]/20 bg-[#00ff87]/10 p-4 text-[#00ff87]">
                    <UploadCloud className="h-7 w-7" />
                  </div>
                  <h2 className="text-xl text-white">{resumeFile ? resumeFile.name : "Using your saved resume"}</h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
                    {resumeFile
                      ? "We read the original DOCX, preserve its XML structure, and apply exact text replacements only."
                      : "Your bundled resume will be used automatically. You can still replace it with a new .docx any time."}
                  </p>
                  <input
                    ref={resumeInputRef}
                    type="file"
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) {
                        return;
                      }
                      acceptResumeFile(file);
                    }}
                  />
                </label>

                {resumeFile ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-[#00ff87]" />
                      {resumeFile.name}
                    </div>
                  </div>
                ) : null}

                <Button className="w-full" disabled={!canTailor || tailoring} onClick={handleTailor}>
                  {tailoring ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tailor My Resume"}
                </Button>
              </CardContent>
            </Card>
          </section>
        ) : null}

        {state.view === "processing" ? (
          <section className="flex min-h-[520px] items-center justify-center">
            <div className="glass-panel w-full max-w-3xl rounded-[32px] border border-white/10 px-8 py-12 text-center">
              <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full border border-[#00ff87]/30 bg-[#00ff87]/10 text-[#00ff87]">
                <Loader2 className="h-9 w-9 animate-spin" />
              </div>
              <h2 className="text-3xl text-white">Tailoring your resume</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                We’re mapping the role requirements, detecting gaps, and generating updated DOCX and PDF outputs.
              </p>
              <div className="mx-auto mt-10 max-w-xl space-y-4 text-left">
                {processingSteps.map((step, index) => {
                  const complete = index < state.activeProgressIndex;
                  const active = index === state.activeProgressIndex;
                  return (
                    <div
                      key={step}
                      className={[
                        "flex items-center gap-4 rounded-2xl border px-4 py-3 transition",
                        complete || active
                          ? "border-[#00ff87]/30 bg-[#00ff87]/10 text-white"
                          : "border-white/10 bg-white/[0.02] text-slate-500",
                      ].join(" ")}
                    >
                      <div
                        className={[
                          "flex h-8 w-8 items-center justify-center rounded-full border",
                          complete
                            ? "border-[#00ff87] bg-[#00ff87] text-slate-950"
                            : active
                              ? "border-[#00ff87]/50 text-[#00ff87]"
                              : "border-white/10 text-slate-500",
                        ].join(" ")}
                      >
                        {complete ? <Check className="h-4 w-4" /> : <span className="text-xs">{index + 1}</span>}
                      </div>
                      <span className={active ? "text-white" : undefined}>{step}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}

        {state.view === "results" && result ? (
          <section className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <CircularScore label="Before" score={result.originalScore} />
              <CircularScore label="After" score={result.tailoredScore} accent />
            </div>

            <Card className="glass-panel border-white/10">
              <CardHeader>
                <CardTitle className="text-white">What Changed</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {visibleChanges.map((item, index) => (
                  <div
                    key={`${item.keyword}-${index}`}
                    className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded-full bg-[#00ff87] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-950">
                        {item.keyword}
                      </span>
                      <p className="text-sm text-slate-500">{item.section}</p>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded-2xl border border-red-400/10 bg-red-500/[0.04] p-3">
                        <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-slate-500">Original</p>
                        <p className="line-clamp-3 text-sm leading-6 text-slate-400">{item.originalText}</p>
                      </div>
                      <div className="rounded-2xl border border-[#00ff87]/10 bg-[#00ff87]/[0.04] p-3">
                        <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-slate-500">Updated</p>
                        <p className="line-clamp-3 text-sm leading-6 text-slate-200">
                          {highlightKeyword(item.updatedText, item.keyword)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}

                {result.addedKeywords.length > visibleChanges.length ? (
                  <p className="text-sm text-slate-500">
                    Showing the top {visibleChanges.length} changes that moved the resume most clearly.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card className="glass-panel border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Download Files</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() =>
                      downloadBase64File(
                        result.tailoredDocxBase64,
                        buildDownloadFilename(jobData, "docx"),
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      )
                    }
                  >
                    Download .docx
                  </Button>
                  <Button
                    variant="outline"
                    className="border-white/10 bg-white/[0.03] text-white hover:bg-white/10"
                    onClick={() =>
                      downloadBase64File(
                        result.tailoredPdfBase64,
                        buildDownloadFilename(jobData, "pdf"),
                        "application/pdf"
                      )
                    }
                  >
                    Download .pdf
                  </Button>
                </div>
                <button
                  type="button"
                  className="text-sm text-slate-400 transition hover:text-white"
                  onClick={resetAll}
                >
                  Start Over
                </button>
              </CardContent>
            </Card>
          </section>
        ) : null}

        <section className="grid gap-4 rounded-[28px] border border-white/10 bg-white/[0.03] p-5 md:grid-cols-3">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.24em] text-[#00ff87]">Paste job URL</p>
            <p className="text-sm text-slate-300">Pull in the role details and extract the technical keywords worth targeting.</p>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.24em] text-[#00ff87]">Upload resume</p>
            <p className="text-sm text-slate-300">Read the original DOCX safely and compare your current wording against the job.</p>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.24em] text-[#00ff87]">Download tailored version</p>
            <p className="text-sm text-slate-300">Get a keyword-optimized DOCX and PDF ready for ATS submission.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
