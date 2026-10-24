import Link from "next/link";
import { CalendarCheck, ClipboardList, Receipt, Smartphone, WifiOff, ShieldCheck } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

const features = [
  { icon: CalendarCheck, title: "Agenda et rappels", text: "Planning par praticien et par fauteuil, rappels WhatsApp et email." },
  { icon: ClipboardList, title: "Dossier patient", text: "Schéma dentaire, plans de traitement, ordonnances, radios." },
  { icon: Receipt, title: "Devis et factures", text: "En francs guinéens, paiements Orange Money et MTN Mobile Money." },
  { icon: WifiOff, title: "Fonctionne hors ligne", text: "Continuez à travailler pendant les coupures, tout se synchronise ensuite." },
  { icon: Smartphone, title: "Espace patient", text: "Prise de rendez-vous en ligne, devis et factures consultables." },
  { icon: ShieldCheck, title: "Données protégées", text: "Accès par rôle, journal des consultations, sauvegardes." },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- icône SVG statique */}
          <img src="/icon.svg" alt="" className="size-9" />
          <span className="text-lg font-semibold text-primary">Nimba Dentaire</span>
        </div>
        <Link href="/connexion" className={buttonClass("secondary", "sm")}>
          Connexion
        </Link>
      </header>
      <section className="bg-primary-soft">
        <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:py-24">
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">Le logiciel des cabinets dentaires guinéens</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">
            Agenda, dossiers patients, devis et factures, paiement mobile. Pensé pour les connexions instables.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/inscription" className={buttonClass("primary", "lg")}>
              Essai gratuit de 30 jours
            </Link>
            <Link href="/connexion" className={buttonClass("secondary", "lg")}>
              J&apos;ai déjà un compte
            </Link>
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-5xl gap-4 px-4 py-12 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-surface p-5">
            <f.icon className="size-6 text-primary" />
            <h2 className="mt-3 font-semibold">{f.title}</h2>
            <p className="mt-1 text-sm text-muted">{f.text}</p>
          </div>
        ))}
      </section>
      <footer className="mt-auto border-t border-border py-6 text-center text-sm text-muted">Nimba Dentaire</footer>
    </div>
  );
}
