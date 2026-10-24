import type { Metadata } from "next";
import { PatientPortal } from "@/features/portal/components/patient-portal";

export const metadata: Metadata = {
  title: "Espace patient",
  description: "Vos rendez-vous, devis, factures, ordonnances et documents.",
  robots: { index: false },
};

export default function PatientPage() {
  return <PatientPortal />;
}
