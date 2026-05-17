import { Loader2 } from "lucide-react";

export function LoadingState() {
  return (
    <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-line text-slate-400">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      Loading...
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-line text-slate-400">{label}</div>;
}
