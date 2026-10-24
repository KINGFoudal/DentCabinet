import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getPublicCabinet } from "@/features/portal/server/public-cabinet";
import { PublicCabinetView, PublicSkeleton } from "@/features/portal/components/public-cabinet-view";

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const cabinet = await getPublicCabinet(slug);
  if (!cabinet) return { title: "Cabinet introuvable", robots: { index: false } };
  const place = [cabinet.address, cabinet.city].filter(Boolean).join(", ");
  const description =
    cabinet.description?.slice(0, 160) ||
    `${cabinet.name}${place ? ` – ${place}` : ""}. Horaires, praticiens${
      cabinet.online_booking_enabled ? " et prise de rendez-vous en ligne" : ""
    }.`;
  return {
    title: cabinet.name,
    description,
    openGraph: { title: cabinet.name, description, type: "website" },
    alternates: { canonical: `/c/${cabinet.slug}` },
  };
}

export default function CabinetPublicPage({ params }: PageProps<"/c/[slug]">) {
  return (
    <Suspense fallback={<PublicSkeleton />}>
      {params.then(({ slug }) => (
        <CabinetContent slug={slug} />
      ))}
    </Suspense>
  );
}

async function CabinetContent({ slug }: { slug: string }) {
  const cabinet = await getPublicCabinet(slug);
  if (!cabinet) notFound();
  return <PublicCabinetView cabinet={cabinet} />;
}
