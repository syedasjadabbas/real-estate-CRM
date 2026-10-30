"use server";

import { refresh } from "next/cache";
import { createTeam, saveDailyReport, saveRoster, setTeamMembers, updateTeam } from "@/modules/teams/commands";
import { setTarget } from "@/modules/targets/service";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/** Server actions for Teams and Targets: session re-read on every call; the service layer enforces permissions. */
async function run<T>(fn: (db: ReturnType<typeof getDb>, actor: Awaited<ReturnType<typeof requireActor>>) => Promise<T>) {
  try {
    const actor = await requireActor();
    const data = await fn(getDb(), actor);
    refresh();
    return { ok: true, data } as ActionResult<T>;
  } catch (error) {
    return toActionError(error) as ActionResult<T>;
  }
}

export async function createTeamAction(input: Record<string, unknown>) {
  return run((db, actor) => createTeam(db, actor, input));
}

export async function updateTeamAction(teamId: string, input: Record<string, unknown>) {
  return run((db, actor) => updateTeam(db, actor, teamId, input));
}

export async function setTeamMembersAction(teamId: string, userIds: string[]) {
  return run((db, actor) => setTeamMembers(db, actor, teamId, { userIds }));
}

export async function saveDailyReportAction(teamId: string, date: string, lines: Record<string, unknown>[]) {
  return run((db, actor) => saveDailyReport(db, actor, teamId, date, { lines }));
}

export async function saveRosterAction(teamId: string, date: string, entries: { userId: string; status: string | null }[]) {
  return run((db, actor) => saveRoster(db, actor, teamId, date, { entries }));
}

export async function setTargetAction(input: Record<string, unknown>) {
  return run((db, actor) => setTarget(db, actor, input));
}
