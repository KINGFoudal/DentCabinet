"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { FileSignature, Lock, Pencil, Trash2 } from "lucide-react";
import { localDb, type Row } from "@/lib/local/db";
import { mutate, softDelete } from "@/lib/sync/mutate";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth/auth-provider";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { staffName, useStaffNames } from "../../lib/hooks";

type Note = Row<"clinical_notes">;

export function NotesTab({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const cabinetId = useCabinetId();
  const { can } = useCabinet();
  const names = useStaffNames(cabinetId);
  const notes = useLiveQuery(
    async () =>
      (
        await localDb()
          .clinical_notes.where("patient_id")
          .equals(patientId)
          .filter((n) => n.cabinet_id === cabinetId && !n.deleted_at)
          .toArray()
      ).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [patientId, cabinetId],
  );

  return (
    <div className="flex flex-col gap-4">
      {can.clinicalWrite && <NoteEditor patientId={patientId} />}
      {notes && notes.length === 0 ? (
        <Card>
          <EmptyState icon={<FileSignature />} title={t("patients.notes.empty")} />
        </Card>
      ) : (
        <ol className="flex flex-col gap-3">
          {notes?.map((n) => (
            <li key={n.id}>
              <NoteCard note={n} author={staffName(names, n.author_id)} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function NoteEditor({ patientId, note, onDone }: { patientId: string; note?: Note; onDone?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { user } = useAuth();
  const [body, setBody] = useState(note?.body ?? "");
  const [confirmSign, setConfirmSign] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save(sign: boolean) {
    if (!body.trim()) {
      toast(t("patients.notes.emptyBody"), "error");
      return;
    }
    if (!user) return;
    setSaving(true);
    try {
      await mutate("clinical_notes", {
        ...(note ? { id: note.id } : { cabinet_id: cabinetId, patient_id: patientId, author_id: user.id }),
        body: body.trim(),
        ...(sign ? { signed_at: new Date().toISOString() } : {}),
      });
      toast(t(sign ? "patients.notes.signedToast" : "patients.notes.saved"));
      setBody("");
      onDone?.();
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  const form = (
    <div className="flex flex-col gap-3">
      <Textarea
        aria-label={t("patients.notes.new")}
        rows={note ? 6 : 4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("patients.notes.placeholder")}
        autoFocus={!!note}
      />
      <div className="flex flex-wrap justify-end gap-2">
        {onDone && (
          <Button variant="secondary" onClick={onDone}>
            {t("common.cancel")}
          </Button>
        )}
        <Button variant="secondary" onClick={() => save(false)} loading={saving} disabled={!body.trim()}>
          {t("patients.notes.saveDraft")}
        </Button>
        <Button onClick={() => setConfirmSign(true)} disabled={!body.trim() || saving}>
          <FileSignature className="size-4" />
          {t("patients.notes.sign")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmSign}
        onClose={() => setConfirmSign(false)}
        onConfirm={() => void save(true)}
        title={t("patients.notes.signTitle")}
        message={t("patients.notes.signMessage")}
        confirmLabel={t("patients.notes.sign")}
        cancelLabel={t("common.cancel")}
      />
    </div>
  );

  if (note) return form;
  return (
    <Card>
      <CardHeader title={t("patients.notes.new")} />
      <CardBody>{form}</CardBody>
    </Card>
  );
}

function NoteCard({ note, author }: { note: Note; author: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { cabinet, can } = useCabinet();
  const { user } = useAuth();
  const tz = cabinet?.timezone;
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const signed = !!note.signed_at;
  const mine = note.author_id === user?.id;
  const editable = !signed && mine && can.clinicalWrite;

  return (
    <Card className={signed ? "" : "border-dashed border-warning/60"}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="text-sm">
          <span className="font-medium">{t("patients.notes.by", { name: author })}</span>
          <span className="text-muted"> · {t("patients.notes.createdOn", { date: formatDateTime(note.created_at, locale, tz) })}</span>
        </div>
        {signed ? (
          <Badge tone="success">
            <Lock className="size-3" />
            {t("patients.notes.signed", { date: formatDateTime(note.signed_at, locale, tz) })}
          </Badge>
        ) : (
          <Badge tone="warning">{t("patients.notes.draft")}</Badge>
        )}
      </div>
      <CardBody>
        {editing ? (
          <NoteEditor patientId={note.patient_id} note={note} onDone={() => setEditing(false)} />
        ) : (
          <>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{note.body}</p>
            {editable && (
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-4" />
                  {t("patients.notes.deleteDraft")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" />
                  {t("common.edit")}
                </Button>
              </div>
            )}
            {signed && <p className="mt-2 text-xs text-muted">{t("patients.notes.locked")}</p>}
          </>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await softDelete("clinical_notes", note.id);
          toast(t("patients.notes.deleted"));
        }}
        title={t("patients.notes.deleteTitle")}
        message={note.body.slice(0, 120)}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        danger
      />
    </Card>
  );
}
