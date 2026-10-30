import type { Actor } from "@/server/auth/types";

/**
 * Targets (USER_ROLES_AND_PERMISSIONS.md): set F/F/T/—/—/—; view F/F/T/O/—/—.
 * Targets are per agent (FR-110; assumption T-A8).
 */
export type TargetScope = "all" | "team" | "own" | "none";

export function targetScope(role: Actor["role"]): TargetScope {
  switch (role) {
    case "super_admin":
    case "admin":
      return "all";
    case "manager":
      return "team";
    case "agent":
      return "own";
    default:
      return "none";
  }
}

export const canViewTargets = (actor: Pick<Actor, "role">) => targetScope(actor.role) !== "none";
export const canSetTargets = (actor: Pick<Actor, "role">) => ["all", "team"].includes(targetScope(actor.role));

/** Whether the actor may set a target for `agentId` (admins: any agent; managers: their teams' agents). */
export function canSetTargetFor(actor: Pick<Actor, "role">, agentId: string, teamMemberIds: readonly string[]) {
  const scope = targetScope(actor.role);
  return scope === "all" || (scope === "team" && teamMemberIds.includes(agentId));
}
