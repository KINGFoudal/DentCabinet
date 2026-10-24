/** Pastille avec les initiales du patient. */
export function Avatar({ first, last, size = "md" }: { first: string; last: string; size?: "md" | "lg" }) {
  const initials = `${first.trim()[0] ?? ""}${last.trim()[0] ?? ""}`.toUpperCase();
  return (
    <span
      aria-hidden
      className={
        size === "lg"
          ? "flex size-12 shrink-0 sm:size-14 items-center justify-center rounded-full bg-primary-soft text-lg font-semibold text-primary"
          : "flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary"
      }
    >
      {initials}
    </span>
  );
}
