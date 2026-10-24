"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, ChevronRight, Plus, Search, Users } from "lucide-react";
import { localDb } from "@/lib/local/db";
import { mutate } from "@/lib/sync/mutate";
import { ageFrom, formatDate, formatPhone, fullName } from "@/lib/format";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, PageSpinner } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { filterPatient, matchesPatient, sortPatients, type PatientFilter, type PatientSort } from "../lib/search";
import { PatientFormDialog } from "./patient-form-dialog";
import { Avatar } from "./avatar";

const PREFS_KEY = "nimba-patients-list";
const PAGE_SIZE = 100;

function readPrefs(): { sort: PatientSort; filter: PatientFilter } {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return { sort: v.sort ?? "name", filter: v.filter === "archived" ? "all" : (v.filter ?? "all") };
  } catch {
    return { sort: "name", filter: "all" };
  }
}

export function PatientList() {
  const cabinetId = useCabinetId();
  const { can, roles, cabinet } = useCabinet();
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const tz = cabinet?.timezone ?? "Africa/Conakry";
  const isAdmin = roles.includes("admin");

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PatientSort>("name");
  const [filter, setFilter] = useState<PatientFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const p = readPrefs();
    /* eslint-disable react-hooks/set-state-in-effect -- préférences locales lues au montage */
    setSort(p.sort);
    setFilter(p.filter);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ sort, filter }));
    } catch {}
  }, [sort, filter]);

  const patients = useLiveQuery(() => localDb().patients.where("cabinet_id").equals(cabinetId).toArray(), [cabinetId]);
  const alertIds = useLiveQuery(async () => {
    if (!can.medical) return new Set<string>();
    const rows = await localDb().patient_medical.where("cabinet_id").equals(cabinetId).toArray();
    return new Set(rows.filter((m) => !m.deleted_at && m.alerts.length > 0).map((m) => m.patient_id));
  }, [cabinetId, can.medical]);

  const activeCount = useMemo(() => (patients ?? []).filter((p) => !p.deleted_at).length, [patients]);
  const results = useMemo(() => {
    const alerts = alertIds ?? new Set<string>();
    const list = (patients ?? []).filter((p) => filterPatient(p, filter, alerts) && matchesPatient(p, query));
    return sortPatients(list, sort);
  }, [patients, alertIds, filter, query, sort]);

  if (!patients) return <PageSpinner />;

  const visible = results.slice(0, limit);
  const filters: PatientFilter[] = ["all", "female", "male", ...(can.medical ? (["withAlerts"] as const) : []), "provisional", ...(isAdmin ? (["archived"] as const) : [])];

  async function restore(id: string) {
    await mutate("patients", { id, deleted_at: null });
    toast(t("patients.archive.restored"));
  }

  return (
    <>
      <PageHeader
        title={t("patients.title")}
        subtitle={t("patients.count", { count: activeCount })}
        actions={
          can.patientsWrite && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              {t("patients.new")}
            </Button>
          )
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            type="search"
            className="pl-9"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE_SIZE);
            }}
            placeholder={t("patients.searchPlaceholder")}
            aria-label={t("patients.searchPlaceholder")}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select aria-label={t("patients.filter.label")} value={filter} onChange={(e) => setFilter(e.target.value as PatientFilter)} className="sm:w-48">
            {filters.map((f) => (
              <option key={f} value={f}>
                {t(`patients.filter.${f}`)}
              </option>
            ))}
          </Select>
          <Select aria-label={t("patients.sort.label")} value={sort} onChange={(e) => setSort(e.target.value as PatientSort)} className="sm:w-44">
            {(["name", "fileNumber", "recent", "age"] as const).map((s) => (
              <option key={s} value={s}>
                {t("patients.sort.label")} : {t(`patients.sort.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {activeCount === 0 && filter !== "archived" ? (
        <Card>
          <EmptyState
            icon={<Users />}
            title={t("patients.empty")}
            description={t("patients.emptyDesc")}
            action={
              can.patientsWrite && (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="size-4" />
                  {t("patients.new")}
                </Button>
              )
            }
          />
        </Card>
      ) : results.length === 0 ? (
        <Card>
          <EmptyState icon={<Search />} title={t("patients.noResults")} />
        </Card>
      ) : (
        <>
          {/* Mobile : liste */}
          <Card className="divide-y divide-border md:hidden">
            {visible.map((p) => {
              const age = ageFrom(p.birth_date);
              return (
                <div key={p.id} className="flex items-center gap-2 px-3 py-2.5">
                  <Link href={`/app/patients/fiche?id=${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar first={p.first_name} last={p.last_name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate font-medium">
                        {fullName(p)}
                        {alertIds?.has(p.id) && <AlertTriangle className="size-4 shrink-0 text-danger" aria-label={t("patients.summary.alertsTitle")} />}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {[p.file_number ?? t("patients.provisional"), formatPhone(p.phone), age != null ? t("patients.years", { count: age }) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    {!p.deleted_at && <ChevronRight className="size-4 shrink-0 text-muted" />}
                  </Link>
                  {p.deleted_at && isAdmin && can.patientsWrite && (
                    <Button size="sm" variant="secondary" onClick={() => restore(p.id)}>
                      {t("patients.archive.restore")}
                    </Button>
                  )}
                </div>
              );
            })}
          </Card>

          {/* Desktop : tableau */}
          <Card className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>{t("patients.fields.lastName")}</Th>
                  <Th>{t("patients.fields.fileNumber")}</Th>
                  <Th>{t("patients.fields.phone")}</Th>
                  <Th>{t("patients.fields.age")}</Th>
                  <Th>{t("patients.fields.city")}</Th>
                  <Th>{t("patients.fields.createdAt")}</Th>
                  <Th className="text-right">
                    <span className="sr-only">{t("common.actions")}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const age = ageFrom(p.birth_date);
                  return (
                    <tr
                      key={p.id}
                      className="cursor-pointer hover:bg-primary-soft"
                      onClick={() => router.push(`/app/patients/fiche?id=${p.id}`)}
                    >
                      <Td>
                        <Link href={`/app/patients/fiche?id=${p.id}`} className="flex items-center gap-2 font-medium" onClick={(e) => e.stopPropagation()}>
                          {fullName(p)}
                          {alertIds?.has(p.id) && <AlertTriangle className="size-4 text-danger" aria-label={t("patients.summary.alertsTitle")} />}
                        </Link>
                      </Td>
                      <Td>
                        {p.file_number ?? (
                          <Badge tone="warning" className="whitespace-nowrap">
                            {t("patients.provisional")}
                          </Badge>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">{formatPhone(p.phone)}</Td>
                      <Td>{age ?? ""}</Td>
                      <Td>{p.city}</Td>
                      <Td className="whitespace-nowrap text-muted">{formatDate(p.created_at, locale, tz)}</Td>
                      <Td className="text-right">
                        {p.deleted_at && isAdmin && can.patientsWrite ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              void restore(p.id);
                            }}
                          >
                            {t("patients.archive.restore")}
                          </Button>
                        ) : (
                          <ChevronRight className="ml-auto size-4 text-muted" />
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          {results.length > limit && (
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                {t("patients.showMore", { count: results.length - limit })}
              </Button>
            </div>
          )}
        </>
      )}

      <PatientFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        initial={initialFromQuery(query)}
        onSaved={(p) => router.push(`/app/patients/fiche?id=${p.id}`)}
      />
    </>
  );
}

/** Pré-remplit la création avec la recherche : « 620… » → téléphone, « Mariama Diallo » → prénom + nom. */
function initialFromQuery(query: string) {
  const q = query.trim();
  if (!q) return undefined;
  if (/^[\d\s+]+$/.test(q)) return { phone: q };
  const [first, ...rest] = q.split(/\s+/);
  return { first_name: first, last_name: rest.join(" ") };
}
