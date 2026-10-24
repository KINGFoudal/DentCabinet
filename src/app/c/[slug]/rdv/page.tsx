import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getPublicCabinet } from "@/features/portal/server/public-cabinet";
import { PublicSkeleton } from "@/features/portal/components/public-cabinet-view";
import { BookingFlow } from "@/features/portal/components/booking-flow";

export async function generateMetadata({ params }: PageProps<"/c/[slug]/rdv">): Promise<Metadata> {
  const { slug } = await params;
  const cabinet = await getPublicCabinet(slug);
  if (!cabinet) return { title: "Cabinet introuvable", robots: { index: false } };
  return {
    title: `Rendez-vous – ${cabinet.name}`,
    description: `Prendre rendez-vous en ligne au ${cabinet.name}.`,
    robots: { index: false },
  };
}

export default function BookingPage({ params }: PageProps<"/c/[slug]/rdv">) {
  return (
    <Suspense fallback={<PublicSkeleton />}>
      {params.then(({ slug }) => (
        <BookingContent slug={slug} />
      ))}
    </Suspense>
  );
}

async function BookingContent({ slug }: { slug: string }) {
  const cabinet = await getPublicCabinet(slug);
  if (!cabinet) notFound();
  return <BookingFlow cabinet={cabinet} />;
}
