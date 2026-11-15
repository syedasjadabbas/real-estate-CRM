"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { StatusTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { selectClass } from "@/features/leads/components/lead-fields";
import { Pagination } from "@/features/leads/components/pagination";
import { SortLinks, type SortLinkColumn } from "@/features/leads/components/sort-links";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { ROLE_LABELS } from "@/server/auth/types";
import type { listTeams } from "@/modules/teams/queries";
import type { TeamSort } from "@/modules/teams/validation";
import { createTeamAction, setTeamLeadAction, setTeamMembersAction, updateTeamAction } from "../actions";
import { CardFilter } from "@/features/leave/components/card-filter";

type Person = { id: string; name: string; role: string };
type Detail = {
  team: { id: string; name: string; managerId: string | null; teamLeadId: string | null; isActive: boolean; weekendDays: number[]; region: string | null };
  members: { id: string; name: string; role: string; status: string }[];
  history: { id: string; action: string; createdAt: Date; actorName: string | null }[];
};

function Msg({ msg }: { msg: { text: string; ok: boolean } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
      {msg.text}
    </p>
  );
}

const HISTORY: Record<string, string> = { "team.create": "Team created", "team.update": "Team details changed", "team.members": "Members changed", "team.lead": "Team Lead changed" };

/** Team setup form (admins): name, manager, active. Used for "New team" and for editing. */

function TeamForm({ team, managers, onDone }: { team?: Detail["team"]; managers: Person[]; onDone?: () => void }) {
  const [name, setName] = useState(team?.name ?? "");
  const [managerId, setManagerId] = useState(team?.managerId ?? "");
  const [isActive, setIsActive] = useState(team?.isActive ?? true);
  // Kept as it was: weekly days off are now the one HR setting (15 Nov 2026).
  const weekendDays = team?.weekendDays ?? [];
  const [region, setRegion] = useState(team?.region ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      noValidate
      aria-label={team ? "Edit team" : "New team"}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const input = { name, managerId: managerId || null, isActive, weekendDays, region };
          const result = team ? await updateTeamAction(team.id, input) : await createTeamAction(input);
          if (result.ok) {
            setErrors({});
            setMsg({ text: team ? "Team saved." : "Team created.", ok: true });
            if (!team) {
              setName("");
              setManagerId("");
            }
            onDone?.();
          } else {
            setErrors(result.fields ?? {});
            setMsg({ text: result.message, ok: false });
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Team name" required error={errors.name}>
          {(id, d) => <Input id={id} aria-describedby={d} invalid={Boolean(errors.name)} value={name} maxLength={80} disabled={pending} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Team admin" error={errors.managerId}>
          {(id, d) => (
            <select id={id} aria-describedby={d} value={managerId} onChange={(e) => setManagerId(e.target.value)} className={selectClass} disabled={pending}>
              <option value="">No team admin</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="Holiday region" error={errors.region} hint="Members see company holidays plus this region's holidays in My Workplace. Leave blank for none.">
        {(id, d) => <Input id={id} aria-describedby={d} invalid={Boolean(errors.region)} value={region} maxLength={80} disabled={pending} onChange={(e) => setRegion(e.target.value)} />}
      </Field>
      {/* Weekly days off are one company setting in HR → Attendance, used by the roster and attendance (15 Nov 2026). */}
      <p className="text-[11px] text-zinc-500">Weekly days off are set once for everyone in HR → Attendance → Office hours and days off.</p>
      <label className="flex items-start gap-2 text-xs font-semibold text-zinc-800">
        <input type="checkbox" className="mt-0.5 size-4 accent-[#107c41]" checked={isActive} disabled={pending} onChange={(e) => setIsActive(e.target.checked)} />
        <span>
          Active (assignable)
          <span className="block text-[11px] font-medium text-zinc-500">Inactive teams are hidden from lead assignment (rotation).</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Msg msg={msg} />
        <Button type="submit" variant="primary" disabled={pending} className="px-4">
          {pending ? "Saving…" : team ? "Save team" : "Create team"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Appoint the team's Team Lead (owner, 15 Nov 2026): one of its active agents, or none. The Team Lead
 * keeps working as an agent and gets a read-only view of the team.
 */
function TeamLeadPicker({ teamId, teamLeadId, members }: { teamId: string; teamLeadId: string | null; members: Detail["members"] }) {
  const agents = members.filter((m) => m.role === "agent" && m.status === "active");
  const [value, setValue] = useState(teamLeadId ?? "");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <Field label="Team Lead" hint="One of this team's agents. Optional. Add the agent as a member first.">
        {(id, d) => (
          <select id={id} aria-describedby={d} value={value} onChange={(e) => setValue(e.target.value)} className={selectClass} disabled={pending}>
            <option value="">No team lead</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Msg msg={msg} />
        <Button
          type="button"
          variant="secondary"
          disabled={pending || value === (teamLeadId ?? "")}
          onClick={() =>
            startTransition(async () => {
              const result = await setTeamLeadAction(teamId, value || null);
              setMsg(result.ok ? { text: value ? "Team Lead appointed." : "Team Lead removed.", ok: true } : { text: result.message, ok: false });
            })
          }
        >
          {pending ? "Saving…" : "Save Team Lead"}
        </Button>
      </div>
    </div>
  );
}

function MembersEditor({ teamId, members, candidates }: { teamId: string; members: Detail["members"]; candidates: Person[] }) {
  const [selected, setSelected] = useState<string[]>(members.map((m) => m.id));
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  // Former members who are no longer active agents / managers stay listed so they can be removed.
  // Agents first, then Admins (who can also be members, so their own leads count for the team).
  const options = [...candidates, ...members.filter((m) => !candidates.some((c) => c.id === m.id))].sort(
    (a, b) => Number(a.role !== "agent") - Number(b.role !== "agent") || a.name.localeCompare(b.name),
  );
  const term = query.trim().toLowerCase();
  // Search and "selected only" help once there are many people (15 Nov 2026).
  const shown = options.filter((p) => (!term || p.name.toLowerCase().includes(term) || (ROLE_LABELS[p.role as keyof typeof ROLE_LABELS] ?? p.role).toLowerCase().includes(term)) && (!onlySelected || selected.includes(p.id)));
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1.5 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">
          Members · {selected.length} selected
        </legend>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Input type="search" aria-label="Search people to add" placeholder="Search by name or role" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1" />
          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
            <input type="checkbox" className="size-4 accent-[#107c41]" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />
            Selected only
          </label>
        </div>
        <ul className="max-h-72 space-y-1 overflow-auto rounded-xl border border-zinc-200/80 p-2">
          {shown.length === 0 ? <li className="px-2 py-3 text-center text-xs text-zinc-500">{term ? `No one matches “${query}”.` : "No one selected yet."}</li> : null}
          {shown.map((p) => (
            <li key={p.id}>
              <label className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-zinc-50">
                <span className="flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    className="size-4 accent-[#107c41]"
                    checked={selected.includes(p.id)}
                    disabled={pending}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))}
                  />
                  {p.name}
                </span>
                <span className="flex items-center gap-2 text-[11px] text-zinc-500">
                  {ROLE_LABELS[p.role as keyof typeof ROLE_LABELS] ?? p.role}
                  <Link href={`/dashboard/people/${p.id}`} className="font-bold text-brand hover:underline">
                    Profile
                  </Link>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Msg msg={msg} />
        <Button
          type="button"
          variant="primary"
          disabled={pending}
          className="px-4"
          onClick={() =>
            startTransition(async () => {
              const result = await setTeamMembersAction(teamId, selected);
              setMsg(result.ok ? { text: `Members saved (${result.data.added.length} added, ${result.data.removed.length} removed).`, ok: true } : { text: result.message, ok: false });
            })
          }
        >
          {pending ? "Saving…" : "Save members"}
        </Button>
      </div>
    </div>
  );
}

const SORT_COLUMNS: SortLinkColumn<TeamSort>[] = [
  { key: "name", label: "Name" },
  { key: "manager", label: "Team admin" },
  { key: "members", label: "Members", firstDir: "desc" },
  { key: "status", label: "Status" },
];

/**
 * One team's settings in three short sections instead of one long scroll (15 Nov 2026):
 * Members (opened first, the most used), Team Lead and Details. Scores and History sit below.
 */
function TeamSections({ details, lead, members }: { details: React.ReactNode; lead: React.ReactNode; members: React.ReactNode }) {
  const [section, setSection] = useState<"members" | "lead" | "details">("members");
  const tabs = [
    { key: "members", label: "Members" },
    { key: "lead", label: "Team Lead" },
    { key: "details", label: "Details" },
  ] as const;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Team sections" className="inline-flex rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-1 shadow-hairline">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={section === t.key}
              onClick={() => setSection(t.key)}
              className={cn("rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors", section === t.key ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-white")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="flex gap-3 text-[11px] font-bold">
          <a href="#agent-scores" className="text-brand hover:underline">
            Scores ↓
          </a>
          <a href="#team-history" className="text-brand hover:underline">
            History ↓
          </a>
        </span>
      </div>
      <div role="tabpanel">{section === "members" ? members : section === "lead" ? lead : details}</div>
    </div>
  );
}

/** Teams tab: team list (select a team) and its members; admins create / edit teams and membership. */
export function TeamsPanel({
  list,
  detail,
  canManage,
  managers,
  candidates,
  params,
}: {
  list: Awaited<ReturnType<typeof listTeams>>;
  detail: Detail | null;
  canManage: boolean;
  managers: Person[];
  candidates: Person[];
  params: Record<string, string>;
}) {
  const teams = list.rows;
  const href = (id: string) => `/dashboard/teams?${new URLSearchParams({ ...params, tab: "teams", team: id }).toString()}`;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <PanelCard title="Teams">
          <p className="-mt-1 mb-3 text-[11px] text-zinc-500">Select a team to manage members.</p>
          {/* Find a team among many (15 Nov 2026). */}
          <CardFilter
            path="/dashboard/teams"
            params={params}
            label="Find teams"
            search={{ name: "tq", placeholder: "Team name" }}
            selects={[{ name: "tstatus", label: "Status", all: "All", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] }]}
          />
          {teams.length > 0 ? (
            <div className="mb-3">
              <SortLinks path="/dashboard/teams" params={params} name="Sort teams" columns={SORT_COLUMNS} sort={list.query.sort} dir={list.query.dir} />
            </div>
          ) : null}
          {teams.length === 0 ? (
            <EmptyState size="sm">{params.tq || params.tstatus ? "No teams match this search." : "No teams found."}</EmptyState>
          ) : (
            <ul className="space-y-1.5">
              {teams.map((t) => {
                const selected = detail?.team.id === t.id;
                return (
                  <li key={t.id}>
                    <Link
                      href={href(t.id)}
                      aria-current={selected ? "true" : undefined}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-xs shadow-hairline transition-colors",
                        selected ? "border-brand bg-brand-50" : "border-zinc-200/80 bg-white hover:bg-zinc-50",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block font-bold break-words">{t.name}</span>
                        <span className="block text-[11px] text-zinc-500">
                          {t.managerName ? `Team admin: ${t.managerName}` : "No team admin"} · {t.teamLeadName ? `Team Lead: ${t.teamLeadName}` : "No team lead"} · {t.members} {t.members === 1 ? "member" : "members"}
                        </span>
                      </span>
                      <StatusTag tone={t.isActive ? "brand" : "neutral"}>{t.isActive ? "Active" : "Inactive"}</StatusTag>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {list.total > 0 ? (
            <div className="mt-3">
              <Pagination page={list.page} pageCount={list.pageCount} total={list.total} params={params} />
            </div>
          ) : null}
        </PanelCard>
        {canManage ? (
          <PanelCard title="New team">
            <TeamForm managers={managers} />
          </PanelCard>
        ) : null}
      </div>
      <div className="min-w-0 space-y-6">
        <PanelCard title={detail ? detail.team.name : "Members"}>
          {!detail ? (
            <EmptyState size="sm">Select a team to manage members.</EmptyState>
          ) : canManage ? (
            <TeamSections
              details={<TeamForm key={`${detail.team.id}-form`} team={detail.team} managers={managers} />}
              lead={<TeamLeadPicker key={`${detail.team.id}-lead-${detail.team.teamLeadId ?? "none"}`} teamId={detail.team.id} teamLeadId={detail.team.teamLeadId} members={detail.members} />}
              members={<MembersEditor key={`${detail.team.id}-members`} teamId={detail.team.id} members={detail.members} candidates={candidates} />}
            />
          ) : detail.members.length === 0 ? (
            <EmptyState size="sm">No members yet.</EmptyState>
          ) : (
            <ul className="space-y-1.5">
              {detail.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
                  <span className="font-semibold">{m.name}</span>
                  <span className="text-[11px] text-zinc-500">
                    {m.id === detail.team.teamLeadId ? "Team Lead · " : ""}
                    {ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] ?? m.role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
        {detail ? (
          <PanelCard title="History" className="scroll-mt-24" id="team-history">
            {detail.history.length === 0 ? (
              <EmptyState size="sm">No changes recorded yet.</EmptyState>
            ) : (
              <ol className="space-y-2">
                {detail.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 pb-2 text-xs last:border-b-0 last:pb-0">
                    <span className="font-semibold text-zinc-800">{HISTORY[h.action] ?? h.action}</span>
                    <span className="text-[11px] text-zinc-500">
                      {h.actorName ?? "System"} · {formatDateTime(h.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </PanelCard>
        ) : null}
      </div>
    </div>
  );
}
