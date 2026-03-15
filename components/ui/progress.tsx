"use client";

type ProgressProps = {
  value: number;
  className?: string;
};

export function Progress({ value, className }: ProgressProps) {
  return (
    <div className={["h-3 w-full overflow-hidden rounded-full bg-slate-200", className].filter(Boolean).join(" ")}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
