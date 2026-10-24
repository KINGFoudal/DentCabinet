"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, ArrowLeft, Copy, MailPlus, Pencil, Share2, UserX } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { localDb, type Row } from "@/lib/local/db";
import { mutate } from "@/lib/sync/mutate";
import { supabase } from "@/lib/supabase/client";
import { formatDate, formatGNF } from "@/lib/format";
import { tierChange, type PlanLike } from "@/lib/payments/pricing";
import type { Role } from "@/lib/permissions";
import type { Tables } from "@/lib/database.types";
import { Card, CardHeader, PageHeader, PageSpinner } from "@/components/ui/card";
import { Button, buttonClass } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RequirePermission } from "@/components/app/app-gate";
import { activeDentists, ALL_ROLES, dentistsAfter, removesLastAdmin } from "../team";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_COLOR = "#0f766e";

type Member = Row<"memberships">;
type Invitation = Tables<"invitations">;

export function TeamSettings() {
  const { can } = useCabinet();
  const { t } = useI18n();
  return (
    <RequirePermission allowed={can.settings}>
      <Link href="/app/parametres" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" />
        {t("nav.settings")}
      </Link>
      <TeamContent />
    </RequirePermission>
  );
}

/** Avertissement de changement de palier d'abonnement. */
function TierWarning({ plans, before, after }: { plans: PlanLike[]; before: number; after: number }) {
  const { t, locale } = useI18n();
  const change = tierChange(plans, before, after);
  if (!change) return null;
  const price = formatGNF(change.priceAfter, locale);
  const text = change.changed
    ? change.from && change.direction === "up"
      ? t("settings.team.tierUp", { from: change.from.name, to: change.to.name, price })
      : t("settings.team.tierDown", { to: change.to.name, price })
    : t("settings.team.priceChange", { price });
  return (
    <div className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning" role="status">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <p>{text}</p>
        <p className="text-xs">{t("settings.team.tierNote")}</p>
      </div>
    </div>
  );
}

function RolesPicker({ value, onChange, disabled }: { value: Role[]; onChange: (r: Role[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t("settings.team.roles")}</legend>
      {ALL_ROLES.map((r) => (
        <Checkbox
          key={r}
          label={t(`roles.${r}`)}
          checked={value.includes(r)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))}
        />
      ))}
    </fieldset>
  );
}

function TeamContent() {
  const { t, locale } = useI18n();
  const { cabinetId, cabinet, can } = useCabinet();
  const { user } = useAuth();
  const [editing, setEditing] = useState<Member | null>(null);
  const [inviting, setInviting] = useState(false);

  const members = useLiveQuery(
    () =>
      cabinetId
        ? localDb()
            .memberships.where("cabinet_id")
            .equals(cabinetId)
            .filter((m) => !m.deleted_at)
            .toArray()
        : [],
    [cabinetId],
  );
  const profiles = useLiveQuery(() => localDb().profiles.toArray(), []);
  const plans = useLiveQuery(() => localDb().plans.toArray(), []);
  const names = useMemo(() => new Map((profiles ?? []).map((p) => [p.id, p.full_name])), [profiles]);

  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [invError, setInvError] = useState<string | null>(null);
  const loadInvitations = useCallback(async () => {
    if (!cabinetId) return;
    if (!navigator.onLine) return setInvError(t("settings.team.onlineOnly"));
    const { data, error } = await supabase()
      .from("invitations")
      .select("*")
      .eq("cabinet_id", cabinetId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) return setInvError(t("settings.team.loadError"));
    setInvError(null);
    setInvitations(data);
  }, [cabinetId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial depuis le serveur
    void loadInvitations();
  }, [loadInvitations]);

  if (!members || !plans || !cabinet) return <PageSpinner />;

  const dentists = activeDentists(members);
  const sorted = [...members].sort((a, b) => Number(b.active) - Number(a.active) || nameOf(a).localeCompare(nameOf(b)));
  function nameOf(m: Member) {
    return m.display_name || names.get(m.user_id) || "—";
  }

  return (
    <>
      <PageHeader
        title={t("settings.team.title")}
        subtitle={t("settings.team.dentistsCounted", { count: dentists })}
        actions={
          <Button onClick={() => setInviting(true)} disabled={!can.settingsWrite}>
            <MailPlus className="size-4" />
            {t("settings.team.invite")}
          </Button>
        }
      />
      {!can.settingsWrite && <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{t("settings.readOnly")}</p>}

      <Card className="mb-4">
        <CardHeader title={t("settings.team.members")} />
        <ul className="divide-y divide-border">
          {sorted.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3">
              <span className="size-3 shrink-0 rounded-full border border-border" style={{ backgroundColor: m.color ?? undefined }} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{nameOf(m)}</span>
                  {m.user_id === user?.id && <span className="text-xs text-muted">({t("settings.team.you")})</span>}
                  {!m.active && <Badge tone="neutral">{t("settings.team.inactive")}</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.roles.map((r) => (
                    <Badge key={r} tone={r === "dentist" ? "primary" : r === "admin" ? "info" : "neutral"}>
                      {t(`roles.${r}`)}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(m)} disabled={!can.settingsWrite} aria-label={t("settings.team.editMember")}>
                <Pencil className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title={t("settings.team.invitations")} />
        {invError ? (
          <p className="px-4 py-3 text-sm text-muted">{invError}</p>
        ) : !invitations ? (
          <PageSpinner />
        ) : invitations.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">{t("settings.team.noInvitations")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {invitations.map((inv) => (
              <InvitationRow key={inv.id} inv={inv} cabinetName={cabinet.name} onChanged={loadInvitations} disabled={!can.settingsWrite} />
            ))}
          </ul>
        )}
      </Card>

      {editing && (
        <MemberDialog
          member={editing}
          members={members}
          plans={plans}
          name={nameOf(editing)}
          onClose={() => setEditing(null)}
        />
      )}
      {inviting && (
        <InviteDialog
          cabinetId={cabinet.id}
          cabinetName={cabinet.name}
          members={members}
          plans={plans}
          onClose={() => setInviting(false)}
          onCreated={loadInvitations}
          locale={locale}
        />
      )}
    </>
  );
}

function MemberDialog({
  member,
  members,
  plans,
  name,
  onClose,
}: {
  member: Member;
  members: Member[];
  plans: PlanLike[];
  name: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(member.display_name ?? "");
  const [roles, setRoles] = useState<Role[]>(member.roles as Role[]);
  const [color, setColor] = useState(member.color ?? DEFAULT_COLOR);
  const [active, setActive] = useState(member.active);
  const [error, setError] = useState<string | null>(null);

  const edited = { ...member, roles, active };
  const lastAdmin = removesLastAdmin(members, edited);
  const before = activeDentists(members);
  const after = dentistsAfter(members, edited);

  async function save() {
    if (roles.length === 0) return setError(t("settings.team.rolesRequired"));
    if (lastAdmin) return setError(t("settings.team.lastAdmin"));
    const ordered = ALL_ROLES.filter((r) => roles.includes(r));
    await mutate("memberships", { id: member.id, display_name: displayName.trim() || null, roles: ordered, color, active });
    toast(t("settings.team.saved"));
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${t("settings.team.editMember")} · ${name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={lastAdmin || roles.length === 0}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("settings.team.name")}>
          {(p) => <Input {...p} value={displayName} placeholder={name} onChange={(e) => setDisplayName(e.target.value)} />}
        </Field>
        <RolesPicker value={roles} onChange={setRoles} />
        <Field label={t("settings.team.color")}>
          {(p) => <Input {...p} type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-20! p-1" />}
        </Field>
        <Checkbox label={t("settings.team.active")} checked={active} onChange={(e) => setActive(e.target.checked)} />
        {lastAdmin && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{t("settings.team.lastAdmin")}</p>}
        <TierWarning plans={plans} before={before} after={after} />
        {error && !lastAdmin && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

function inviteLink(token: string) {
  return `${window.location.origin}/invitation?token=${token}`;
}

function ShareButtons({ token, cabinetName }: { token: string; cabinetName: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const link = inviteLink(token);
  const wa = `https://wa.me/?text=${encodeURIComponent(t("settings.team.whatsappText", { cabinet: cabinetName, link }))}`;
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            toast(t("settings.team.copied"));
          } catch {
            toast(link, "info");
          }
        }}
      >
        <Copy className="size-4" />
        {t("settings.team.copy")}
      </Button>
      <a href={wa} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
        <Share2 className="size-4" />
        {t("settings.team.whatsapp")}
      </a>
    </div>
  );
}

function InvitationRow({
  inv,
  cabinetName,
  onChanged,
  disabled,
}: {
  inv: Invitation;
  cabinetName: string;
  onChanged: () => void;
  disabled: boolean;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);

  async function revoke() {
    if (!navigator.onLine) return toast(t("settings.team.onlineOnly"), "error");
    const { error } = await supabase().from("invitations").update({ expires_at: new Date().toISOString() }).eq("id", inv.id);
    if (error) return toast(t("common.error"), "error");
    toast(t("settings.team.revoked"));
    onChanged();
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{inv.email}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {inv.roles.map((r) => (
            <Badge key={r}>{t(`roles.${r}`)}</Badge>
          ))}
          <span className="text-xs text-muted">{t("settings.team.expires", { date: formatDate(inv.expires_at, locale) })}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <ShareButtons token={inv.token} cabinetName={cabinetName} />
        <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} disabled={disabled}>
          <UserX className="size-4" />
          {t("settings.team.revoke")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => void revoke()}
        title={t("settings.team.revoke")}
        message={t("settings.team.revokeConfirm", { email: inv.email })}
        confirmLabel={t("settings.team.revoke")}
        cancelLabel={t("common.cancel")}
        danger
      />
    </li>
  );
}

function InviteDialog({
  cabinetId,
  cabinetName,
  members,
  plans,
  onClose,
  onCreated,
  locale,
}: {
  cabinetId: string;
  cabinetName: string;
  members: Member[];
  plans: PlanLike[];
  onClose: () => void;
  onCreated: () => void;
  locale: "fr" | "en";
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<Role[]>(["dentist"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Invitation | null>(null);

  const before = activeDentists(members);
  const after = roles.includes("dentist") ? before + 1 : before;

  async function create() {
    setError(null);
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) return setError(t("settings.team.emailInvalid"));
    if (roles.length === 0) return setError(t("settings.team.rolesRequired"));
    if (!navigator.onLine) return setError(t("settings.team.onlineOnly"));
    setBusy(true);
    const { data, error: insError } = await supabase()
      .from("invitations")
      .insert({ cabinet_id: cabinetId, email: e, roles: ALL_ROLES.filter((r) => roles.includes(r)), invited_by: user?.id ?? null })
      .select()
      .single();
    setBusy(false);
    if (insError || !data) return setError(t("common.error"));
    setCreated(data);
    onCreated();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("settings.team.inviteTitle")}
      footer={
        created ? (
          <Button onClick={onClose}>{t("common.close")}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void create()} loading={busy}>
              {t("settings.team.sendInvite")}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-success">{t("settings.team.inviteCreated")}</p>
          <Field label={t("settings.team.inviteLink")} hint={t("settings.team.inviteHint", { date: formatDate(created.expires_at, locale) })}>
            {(p) => <Input {...p} readOnly value={inviteLink(created.token)} onFocus={(e) => e.target.select()} />}
          </Field>
          <ShareButtons token={created.token} cabinetName={cabinetName} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label={t("settings.team.email")} required>
            {(p) => <Input {...p} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <RolesPicker value={roles} onChange={setRoles} />
          <TierWarning plans={plans} before={before} after={after} />
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}
