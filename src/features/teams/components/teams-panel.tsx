"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { StatusTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { selectClass } from "@/features/leads/components/lead-fields";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { ROLE_LABELS } from "@/server/auth/types";
import type { TeamRow } from "@/modules/teams/queries";
import { createTeamAction, setTeamMembersAction, updateTeamAction } from "../actions";

type Person = { id: string; name: string; role: string };
type Detail = {
  team: { id: string; name: string; managerId: string | null; isActive: boolean };
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

const HISTORY: Record<string, string> = { "team.create": "Team created", "team.update": "Team details changed", "team.members": "Members changed" };

/** Team setup form (admins): name, manager, active. Used for "New team" and for editing. */
function TeamForm({ team, managers, onDone }: { team?: Detail["team"]; managers: Person[]; onDone?: () => void }) {
  const [name, setName] = useState(team?.name ?? "");
  const [managerId, setManagerId] = useState(team?.managerId ?? "");
  const [isActive, setIsActive] = useState(team?.isActive ?? true);
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
          const input = { name, managerId: managerId || null, isActive };
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
        <Field label="Manager" error={errors.managerId}>
          {(id, d) => (
            <select id={id} aria-describedby={d} value={managerId} onChange={(e) => setManagerId(e.target.value)} className={selectClass} disabled={pending}>
              <option value="">No manager</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
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

function MembersEditor({ teamId, members, candidates }: { teamId: string; members: Detail["members"]; candidates: Person[] }) {
  const [selected, setSelected] = useState<string[]>(members.map((m) => m.id));
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  // Former members who are no longer active agents / managers stay listed so they can be removed.
  const options = [...candidates, ...members.filter((m) => !candidates.some((c) => c.id === m.id))];
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1.5 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Members</legend>
        <ul className="max-h-72 space-y-1 overflow-auto rounded-xl border border-zinc-200/80 p-2">
          {options.map((p) => (
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
                <span className="text-[11px] text-zinc-500">{ROLE_LABELS[p.role as keyof typeof ROLE_LABELS] ?? p.role}</span>
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

/** Teams tab: team list (select a team) and its members; admins create / edit teams and membership. */
export function TeamsPanel({
  teams,
  detail,
  canManage,
  managers,
  candidates,
  params,
}: {
  teams: TeamRow[];
  detail: Detail | null;
  canManage: boolean;
  managers: Person[];
  candidates: Person[];
  params: Record<string, string>;
}) {
  const href = (id: string) => `/dashboard/teams?${new URLSearchParams({ ...params, tab: "teams", team: id }).toString()}`;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <PanelCard title="Teams">
          <p className="-mt-1 mb-3 text-[11px] text-zinc-500">Select a team to manage members.</p>
          {teams.length === 0 ? (
            <EmptyState size="sm">No teams found.</EmptyState>
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
                          {t.managerName ? `Manager: ${t.managerName}` : "No manager"} · {t.members} {t.members === 1 ? "member" : "members"}
                        </span>
                      </span>
                      <StatusTag tone={t.isActive ? "brand" : "neutral"}>{t.isActive ? "Active" : "Inactive"}</StatusTag>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
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
            <div className="space-y-6">
              <TeamForm key={`${detail.team.id}-form`} team={detail.team} managers={managers} />
              <MembersEditor key={`${detail.team.id}-members`} teamId={detail.team.id} members={detail.members} candidates={candidates} />
            </div>
          ) : detail.members.length === 0 ? (
            <EmptyState size="sm">No members yet.</EmptyState>
          ) : (
            <ul className="space-y-1.5">
              {detail.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
                  <span className="font-semibold">{m.name}</span>
                  <span className="text-[11px] text-zinc-500">{ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] ?? m.role}</span>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
        {detail ? (
          <PanelCard title="History">
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
