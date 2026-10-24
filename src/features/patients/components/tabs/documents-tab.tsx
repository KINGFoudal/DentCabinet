"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ExternalLink, FileImage, FileText, FolderOpen, Trash2, Upload, WifiOff } from "lucide-react";
import { localDb, type Row } from "@/lib/local/db";
import { mutate, newId, softDelete } from "@/lib/sync/mutate";
import { supabase } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import type { Enums } from "@/lib/database.types";
import { useAuth } from "@/lib/auth/auth-provider";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { documentPath, formatBytes, MAX_UPLOAD_BYTES } from "../../lib/clinical";
import { compressImage } from "../../lib/image";
import { useOnline } from "../../lib/use-online";

type Doc = Row<"documents"> & { _dirty?: 0 | 1 };
type Kind = Enums<"document_kind">;

const KINDS: Kind[] = ["xray", "photo", "prescription", "scan", "consent", "administrative", "other"];
const BUCKET = "documents";
const SIGNED_URL_SECONDS = 60;

export function DocumentsTab({ patientId }: { patientId: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { can, cabinet } = useCabinet();
  const online = useOnline();
  const [deleting, setDeleting] = useState<Doc | null>(null);
  const docs = useLiveQuery(
    async () =>
      (
        await localDb()
          .documents.where("patient_id")
          .equals(patientId)
          .filter((d) => d.cabinet_id === cabinetId && !d.deleted_at)
          .toArray()
      ).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [patientId, cabinetId],
  );

  async function open(doc: Doc) {
    if (!navigator.onLine) return toast(t("patients.docs.offline"), "error");
    if (doc._dirty) return toast(t("patients.docs.notSynced"), "info");
    // Fenêtre ouverte tout de suite (sinon bloquée par le navigateur après l'attente réseau).
    const win = window.open("", "_blank");
    const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) {
      win?.close();
      return toast(t("patients.docs.openFailed"), "error");
    }
    if (win) {
      win.opener = null;
      win.location.href = data.signedUrl;
    } else {
      window.location.assign(data.signedUrl);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!online && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          <WifiOff className="size-4 shrink-0" />
          {t("patients.docs.offline")}
        </p>
      )}
      {can.patientsWrite && <UploadForm patientId={patientId} online={online} />}
      {!can.clinical && <p className="text-sm text-muted">{t("patients.docs.adminOnly")}</p>}

      {docs && docs.length === 0 ? (
        <Card>
          <EmptyState icon={<FolderOpen />} title={t("patients.docs.empty")} />
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {docs?.map((d) => {
            const Icon = d.mime_type?.startsWith("image/") ? FileImage : FileText;
            return (
              <div key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Icon className="size-8 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <Badge tone="primary">{t(`patients.docs.kinds.${d.kind}`)}</Badge>
                      <span>{formatDate(d.created_at, locale, cabinet?.timezone)}</span>
                      {d.size_bytes != null && <span>{formatBytes(Number(d.size_bytes), locale)}</span>}
                      {d.shared_with_patient && <Badge tone="info">{t("patients.docs.sharedBadge")}</Badge>}
                      {d._dirty ? <Badge tone="warning">{t("patients.docs.notSynced")}</Badge> : null}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={!online} onClick={() => open(d)}>
                    <ExternalLink className="size-4" />
                    {t("patients.docs.open")}
                  </Button>
                  {can.patientsWrite && (
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(d)} aria-label={t("patients.docs.delete")}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await softDelete("documents", deleting.id);
          toast(t("patients.docs.deleted"));
        }}
        title={t("patients.docs.deleteTitle")}
        message={deleting?.title ?? ""}
        confirmLabel={t("patients.docs.delete")}
        cancelLabel={t("common.cancel")}
        danger
      />
    </div>
  );
}

function UploadForm({ patientId, online }: { patientId: string; online: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { can } = useCabinet();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const kinds = can.clinical ? KINDS : (["administrative"] as Kind[]);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>(can.clinical ? "xray" : "administrative");
  const [shared, setShared] = useState(false);
  const [phase, setPhase] = useState<"idle" | "compressing" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);

  function choose(f: File | null) {
    setFile(f);
    setError(null);
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
    if (f && can.clinical && kind === "xray" && !f.type.startsWith("image/")) setKind("scan");
  }

  async function upload() {
    if (!navigator.onLine) return setError(t("patients.docs.offline"));
    if (!file) return setError(t("patients.docs.chooseFile"));
    setError(null);
    try {
      setPhase("compressing");
      const prepared = await compressImage(file);
      if (prepared.size > MAX_UPLOAD_BYTES) {
        setPhase("idle");
        return setError(t("patients.docs.tooLarge"));
      }
      if (prepared !== file) {
        toast(t("patients.docs.compressed", { from: formatBytes(file.size, locale), to: formatBytes(prepared.size, locale) }), "info");
      }
      setPhase("uploading");
      const id = newId();
      const path = documentPath(cabinetId, patientId, id, prepared.name);
      const { error: upErr } = await supabase()
        .storage.from(BUCKET)
        .upload(path, prepared, { contentType: prepared.type || "application/octet-stream", upsert: false });
      if (upErr) throw upErr;
      // La ligne n'est écrite qu'après un envoi réussi du fichier.
      await mutate("documents", {
        id,
        cabinet_id: cabinetId,
        patient_id: patientId,
        kind: can.clinical ? kind : "administrative",
        title: title.trim() || prepared.name,
        storage_path: path,
        mime_type: prepared.type || null,
        size_bytes: prepared.size,
        shared_with_patient: shared,
        uploaded_by: user?.id ?? null,
      });
      toast(t("patients.docs.uploaded"));
      setFile(null);
      setTitle("");
      setShared(false);
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      setError(t("patients.docs.failed"));
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";

  return (
    <Card>
      <CardHeader title={t("patients.docs.upload")} />
      <CardBody>
        <fieldset disabled={!online || busy} className="grid gap-3 sm:grid-cols-2">
          <Field label={t("patients.docs.file")} className="sm:col-span-2">
            {(p) => (
              <input
                {...p}
                ref={inputRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => choose(e.target.files?.[0] ?? null)}
                className="block w-full text-sm file:mr-3 file:h-10 file:rounded-lg file:border-0 file:bg-primary-soft file:px-4 file:font-medium file:text-primary"
              />
            )}
          </Field>
          <Field label={t("patients.docs.title")}>{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label={t("patients.docs.kind")}>
            {(p) => (
              <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as Kind)} disabled={kinds.length === 1}>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {t(`patients.docs.kinds.${k}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Checkbox label={t("patients.docs.shared")} checked={shared} onChange={(e) => setShared(e.target.checked)} className="sm:col-span-2" />
        </fieldset>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-3 flex items-center justify-end gap-3">
          {busy && <span className="text-sm text-muted">{t(phase === "compressing" ? "patients.docs.compressing" : "patients.docs.uploading")}</span>}
          <Button onClick={upload} loading={busy} disabled={!online || !file}>
            <Upload className="size-4" />
            {t("patients.docs.upload")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
