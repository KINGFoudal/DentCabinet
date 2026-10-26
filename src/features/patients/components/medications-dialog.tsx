"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Row } from "@/lib/local/db";
import { mutate, softDelete } from "@/lib/sync/mutate";
import { useAuth } from "@/lib/auth/auth-provider";
import { useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useMedications } from "../lib/hooks";
import { rxDrugLabel } from "../lib/clinical";
import { useCanEditMedications } from "./rx-editor";

type Med = Row<"medications">;
type Draft = { name: string; form: string; strength: string; posology: string; duration: string; instructions: string };
const emptyDraft: Draft = { name: "", form: "", strength: "", posology: "", duration: "", instructions: "" };

/** Liste des médicaments personnalisés du cabinet : ajout, modification, retrait. */
export function MedicationsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} size="lg" title={t("patients.meds.manage")}>
      {open && <Manager />}
    </Dialog>
  );
}

function Manager() {
  const { t } = useI18n();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { user } = useAuth();
  const canEdit = useCanEditMedications();
  const meds = useMedications(cabinetId);
  const [editing, setEditing] = useState<Med | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState(false);

  function start(m: Med | "new") {
    setEditing(m);
    setError(false);
    setDraft(
      m === "new"
        ? emptyDraft
        : { name: m.name, form: m.form ?? "", strength: m.strength ?? "", posology: m.posology ?? "", duration: m.duration ?? "", instructions: m.instructions ?? "" },
    );
  }

  async function save() {
    if (!draft.name.trim()) return setError(true);
    const v = (s: string) => s.trim() || null;
    const fields = {
      name: draft.name.trim(),
      form: v(draft.form),
      strength: v(draft.strength),
      posology: v(draft.posology),
      duration: v(draft.duration),
      instructions: v(draft.instructions),
    };
    await mutate(
      "medications",
      editing && editing !== "new" ? { id: editing.id, ...fields } : { cabinet_id: cabinetId, created_by: user?.id ?? null, deleted_at: null, ...fields },
    );
    toast(t("patients.meds.saved"));
    setEditing(null);
  }

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const sorted = (meds ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, "fr"));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t(canEdit ? "patients.meds.manageHint" : "patients.meds.readOnly")}</p>
      {editing ? (
        <form
          className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label={t("patients.meds.name")} required className="col-span-2 sm:col-span-3" error={error ? t("patients.meds.nameRequired") : undefined}>
            {(p) => <Input {...p} autoFocus value={draft.name} onChange={set("name")} placeholder={t("patients.rx.drugPlaceholder")} />}
          </Field>
          <Field label={t("patients.rx.strength")} className="sm:col-span-1">
            {(p) => <Input {...p} value={draft.strength} onChange={set("strength")} placeholder={t("patients.rx.strengthPlaceholder")} />}
          </Field>
          <Field label={t("patients.rx.form")} className="sm:col-span-2">
            {(p) => <Input {...p} value={draft.form} onChange={set("form")} placeholder={t("patients.rx.formPlaceholder")} />}
          </Field>
          <Field label={t("patients.meds.posology")} className="col-span-2 sm:col-span-4">
            {(p) => <Input {...p} value={draft.posology} onChange={set("posology")} placeholder={t("patients.rx.dosagePlaceholder")} />}
          </Field>
          <Field label={t("patients.rx.duration")} className="col-span-2 sm:col-span-2">
            {(p) => <Input {...p} value={draft.duration} onChange={set("duration")} placeholder={t("patients.rx.durationPlaceholder")} />}
          </Field>
          <Field label={t("patients.rx.instructions")} className="col-span-2 sm:col-span-6">
            {(p) => <Input {...p} value={draft.instructions} onChange={set("instructions")} />}
          </Field>
          <div className="col-span-2 flex justify-end gap-2 sm:col-span-6">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.save")}</Button>
          </div>
        </form>
      ) : (
        canEdit && (
          <div>
            <Button size="sm" onClick={() => start("new")}>
              <Plus className="size-4" />
              {t("patients.meds.new")}
            </Button>
          </div>
        )
      )}
      {sorted.length === 0 ? (
        <p className="rounded-lg bg-background p-3 text-sm text-muted">{t("patients.meds.empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {sorted.map((m) => (
            <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{rxDrugLabel({ drug: m.name, strength: m.strength ?? "", form: m.form ?? "" })}</div>
                <div className="truncate text-xs text-muted">{[m.posology, m.duration].filter(Boolean).join(" · ")}</div>
              </div>
              {canEdit && (
                <>
                  <Button size="sm" variant="ghost" aria-label={t("patients.meds.edit")} onClick={() => start(m)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("patients.meds.delete")}
                    onClick={async () => {
                      await softDelete("medications", m.id);
                      toast(t("patients.meds.deleted"));
                    }}
                  >
                    <Trash2 className="size-4 text-danger" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
