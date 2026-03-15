import { CheckCircle2, CircleAlert } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TailorResult } from "@/types";

type KeywordDiffProps = {
  result: TailorResult;
};

export function KeywordDiff({ result }: KeywordDiffProps) {
  return (
    <Card className="border-slate-200 bg-white/90 shadow-sm">
      <CardHeader>
        <CardTitle>Keyword Coverage</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Matched Keywords
          </h3>
          <div className="flex flex-wrap gap-2">
            {result.tailoredScore.matched.map((item) => (
              <span
                key={item.keyword}
                className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-900"
              >
                {item.keyword}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-amber-800">
            <CircleAlert className="h-4 w-4" />
            Still Missing
          </h3>
          <div className="flex flex-wrap gap-2">
            {result.tailoredScore.missing.length ? (
              result.tailoredScore.missing.map((item) => (
                <span
                  key={item.keyword}
                  className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-950"
                  title={item.context}
                >
                  {item.keyword}
                </span>
              ))
            ) : (
              <p className="text-sm text-slate-500">No tracked keywords are missing after tailoring.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
