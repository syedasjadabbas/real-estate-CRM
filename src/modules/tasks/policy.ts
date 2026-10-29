import type { Actor, Role } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import type { ProposalSettings } from "./plan";

/**
 * Tasks authorization (USER_ROLES_AND_PERMISSIONS.md): Tasks F/F/T/O/—/—.
 * A task is "own" when the actor is its assignee or its creator; a manager's team scope covers
 * tasks assigned to or created by the manager or a team member.
 */
export type TaskScope = "all" | "team" | "own" | "none";

export function taskScope(role: Role): TaskScope {
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

export type TaskAction = "view" | "create" | "edit" | "settings";

const ROLE_ACTIONS: Record<Role, TaskAction[]> = {
  super_admin: ["view", "create", "edit", "settings"],
  admin: ["view", "create", "edit", "settings"],
  manager: ["view", "create", "edit"],
  agent: ["view", "create", "edit"],
  hr: [],
  accountant: [],
};

export function canDoTask(actor: Pick<Actor, "role">, action: TaskAction) {
  return ROLE_ACTIONS[actor.role].includes(action);
}

export function assertCanTask(actor: Pick<Actor, "role">, action: TaskAction) {
  if (!canDoTask(actor, action)) throw forbidden();
}

export function canAccessTask(
  actor: Pick<Actor, "id" | "role">,
  task: { assigneeId: string; createdById: string | null },
  teamMemberIds: readonly string[] = [],
) {
  const people = [task.assigneeId, task.createdById].filter((id): id is string => id !== null);
  switch (taskScope(actor.role)) {
    case "all":
      return true;
    case "team":
      return people.some((id) => id === actor.id || teamMemberIds.includes(id));
    case "own":
      return people.includes(actor.id);
    default:
      return false;
  }
}

/** Who the actor may assign to: anyone (admins), self or team (managers), self (agents). */
export function canAssignTo(actor: Pick<Actor, "id" | "role">, assigneeId: string, teamMemberIds: readonly string[] = []) {
  switch (taskScope(actor.role)) {
    case "all":
      return true;
    case "team":
      return assigneeId === actor.id || teamMemberIds.includes(assigneeId);
    case "own":
      return assigneeId === actor.id;
    default:
      return false;
  }
}

/** Roles a task can be assigned to (the roles that work tasks). */
export const ASSIGNABLE_ROLES: Role[] = ["super_admin", "admin", "manager", "agent"];

/**
 * FR-091 discount cap. Admins: any. Managers: the manager cap setting, or the agent cap while it is
 * unset (decision 29 Oct 2026). Agents: the agent cap (5% observed).
 */
export function discountCap(role: Role, settings: Pick<ProposalSettings, "agentCap" | "managerCap">) {
  if (taskScope(role) === "all") return 100;
  if (role === "manager") return settings.managerCap ?? settings.agentCap;
  return settings.agentCap;
}

/** Agents can't change the down payment % (observed read-only; decision 29 Oct 2026). */
export function canEditDownPayment(role: Role) {
  return role !== "agent";
}
