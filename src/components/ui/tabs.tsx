"use client";

import type { ReactNode } from "react";
import { cn } from "./cn";

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode }[];
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          type="button"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            value === it.value ? "border-primary text-primary" : "border-transparent text-muted hover:text-text",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
