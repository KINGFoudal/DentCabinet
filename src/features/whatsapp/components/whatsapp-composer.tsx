"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MessageCircle } from "lucide-react";
import { localDb } from "@/lib/local/db";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { formatPhone } from "@/lib/format";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/components/ui/cn";
import {
  effectiveText,
  langOf,
  renderPatientMessage,
  type PatientMessageKind,
  type PatientMessageVars,
  type TemplateRow,
} from "../../../../supabase/functions/_shared/patient-messages";
import { waMeLink, waPhone } from "../lib/wa-link";

export type ComposerOption = { kind: PatientMessageKind | "free"; vars?: PatientMessageVars };

/** Modèles WhatsApp du cabinet (base locale). */
export function useWhatsAppTemplates(cabinetId: string | null | undefined): TemplateRow[] | undefined {
  return useLiveQuery(
    async () =>
      cabinetId
        ? (await localDb().message_templates.where("cabinet_id").equals(cabinetId).toArray()).filter((x) => x.channel === "whatsapp" && !x.deleted_at)
        : [],
    [cabinetId],
  );
}

/** Texte rendu d'une option (personnalisation du cabinet ou texte par défaut). */
export function optionText(option: ComposerOption, templates: readonly TemplateRow[], cabinetId: string, locale: string) {
  if (option.kind === "free") return "";
  return renderPatientMessage(effectiveText(templates, cabinetId, option.kind, locale), option.vars ?? {});
}

/**
 * Bouton « Envoyer par WhatsApp » : choix d'un message prédéfini, aperçu modifiable, puis
 * ouverture de https://wa.me/<numéro>?text=<message> (gratuit, sans clé Meta). Masqué si le
 * patient n'a pas de numéro valide. Fonctionne hors ligne (WhatsApp enverra au retour du réseau).
 */
export function WhatsAppButton({
  phone,
  patientName,
  options,
  initial,
  label,
  variant = "secondary",
  size = "sm",
  className,
}: {
  phone: string | null | undefined;
  patientName: string;
  options: ComposerOption[];
  initial?: ComposerOption["kind"];
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!waPhone(phone) || options.length === 0) return null;
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)} data-testid="whatsapp-button">
        <MessageCircle className="size-4" />
        {label ?? t("whatsapp.send")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("whatsapp.dialogTitle")}>
        {open && <Composer phone={phone!} patientName={patientName} options={options} initial={initial} onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function Composer({
  phone,
  patientName,
  options,
  initial,
  onDone,
}: {
  phone: string;
  patientName: string;
  options: ComposerOption[];
  initial?: ComposerOption["kind"];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { cabinet } = useCabinet();
  const cabinetId = cabinet?.id ?? "";
  const lang = langOf(cabinet?.locale);
  const templates = useWhatsAppTemplates(cabinetId);
  const [kind, setKind] = useState<ComposerOption["kind"]>(initial && options.some((o) => o.kind === initial) ? initial : options[0].kind);
  // null : texte non modifié, suit le modèle choisi.
  const [edited, setEdited] = useState<string | null>(null);

  const option = options.find((o) => o.kind === kind) ?? options[0];
  const text = edited ?? (templates ? optionText(option, templates, cabinetId, lang) : "");
  const link = waMeLink(phone, text);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("whatsapp.to", { name: patientName, phone: formatPhone(phone) })}</p>
      <Field label={t("whatsapp.choose")}>
        {(p) => (
          <Select
            {...p}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ComposerOption["kind"]);
              setEdited(null);
            }}
            data-testid="whatsapp-kind"
          >
            {options.map((o) => (
              <option key={o.kind} value={o.kind}>
                {t(`whatsapp.kind.${o.kind}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t("whatsapp.preview")} error={text.trim() ? undefined : t("whatsapp.emptyText")}>
        {(p) => <Textarea {...p} value={text} onChange={(e) => setEdited(e.target.value)} className="min-h-44" data-testid="whatsapp-text" />}
      </Field>
      <p className="text-xs text-muted">{offline ? t("whatsapp.offline") : t("whatsapp.hint")}</p>
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonClass("primary", "md"), "justify-center")}
            onClick={onDone}
            data-testid="whatsapp-open"
          >
            <MessageCircle className="size-4" />
            {t("whatsapp.open")}
          </a>
        ) : (
          <Button disabled>
            <MessageCircle className="size-4" />
            {t("whatsapp.open")}
          </Button>
        )}
      </div>
    </div>
  );
}
