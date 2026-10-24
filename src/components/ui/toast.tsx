"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "./cn";

type Toast = { id: number; message: string; tone: "success" | "error" | "info" };
type Ctx = { toast: (message: string, tone?: Toast["tone"]) => void };

const ToastContext = createContext<Ctx | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = nextId++;
    setItems((l) => [...l, { id, message, tone }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastContext value={{ toast }}>
      {children}
      <div aria-live="polite" className="no-print fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "rounded-lg px-4 py-2 text-sm shadow-lg",
              t.tone === "success" && "bg-primary text-on-primary",
              t.tone === "error" && "bg-danger text-white",
              t.tone === "info" && "bg-text text-surface",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx.toast;
}
