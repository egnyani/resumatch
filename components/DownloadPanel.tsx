import { FileDown, FileText, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TailorResult } from "@/types";

type DownloadPanelProps = {
  result: TailorResult;
};

export function DownloadPanel({ result }: DownloadPanelProps) {
  return (
    <Card className="border-slate-200 bg-slate-950 text-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileDown className="h-5 w-5 text-amber-300" />
          Tailored Output
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">
            <Sparkles className="h-4 w-4" />
            Claude Summary
          </p>
          <p className="text-sm leading-6 text-slate-300">{result.claudeSummary}</p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Key Changes</p>
          <ul className="space-y-2 text-sm leading-6 text-slate-300">
            {result.changes.map((change) => (
              <li key={change} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                {change}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button asChild variant="secondary">
            <a href={result.tailoredDocxUrl} target="_blank" rel="noreferrer">
              <FileText className="mr-2 h-4 w-4" />
              Download DOCX
            </a>
          </Button>
          {result.tailoredPdfUrl ? (
            <Button asChild variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10">
              <a href={result.tailoredPdfUrl} target="_blank" rel="noreferrer">
                <FileDown className="mr-2 h-4 w-4" />
                Download PDF
              </a>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
