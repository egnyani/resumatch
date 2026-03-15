import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ScoreResult } from "@/types";

type ScoreCardProps = {
  title: string;
  score: ScoreResult;
  tone: "muted" | "highlight";
};

export function ScoreCard({ title, score, tone }: ScoreCardProps) {
  return (
    <Card
      className={
        tone === "highlight"
          ? "border-amber-300 bg-amber-50/70 shadow-sm"
          : "border-slate-200 bg-white/90 shadow-sm"
      }
    >
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-4xl font-semibold tracking-tight text-slate-950">
              {score.matchPercent}%
            </p>
            <p className="text-sm text-slate-500">
              {score.matchedKeywords} of {score.totalJdKeywords} tracked keywords matched
            </p>
          </div>
        </div>
        <Progress value={score.matchPercent} />
      </CardContent>
    </Card>
  );
}
