import Link from "next/link";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-primary-soft px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- icône SVG statique */}
        <img src="/icon.svg" alt="" className="size-10" />
        <span className="text-xl font-semibold text-primary">Nimba Dentaire</span>
      </Link>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm">{children}</div>
    </div>
  );
}
