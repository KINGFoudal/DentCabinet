import type { Metadata } from "next";
import { PatientLogin } from "@/features/portal/components/patient-login";

export const metadata: Metadata = {
  title: "Connexion patient",
  description: "Connexion à l'espace patient par code reçu par email.",
  robots: { index: false },
};

export default function PatientLoginPage() {
  return <PatientLogin />;
}
