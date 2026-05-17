import type { ReactNode } from "react";

export function HeaderActions({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <h1 className="mr-auto text-2xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

export function IconButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button className="rounded-md border border-line bg-panel px-3 py-2 text-sm transition hover:border-brand hover:text-white" onClick={onClick}>
      {children}
    </button>
  );
}
