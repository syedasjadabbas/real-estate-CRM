import type { Actor, Role } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import type { ProposalSettings } from "./plan";

/**
 * Tasks authorization (USER_ROLES_AND_PERMISSIONS.md): Tasks F/F/T/O/—/—.
 * A task is "own" when the actor is its assignee or its creator; a manager's team scope covers
 * tasks assigned to or created by the manager or a team member. Questionnaire Q45: Admins and Super
 * Admins assign tasks to all users, so HR and Accountants can receive tasks and see / update their
 * own (they don't create tasks).
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
    case "hr":
    case "accountant":
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
  hr: ["view", "edit"],
  accountant: ["view", "edit"],
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

/**
 * Who the actor may assign to (Q45, confirmed 10 Nov 2026): only Admins and Super Admins assign
 * tasks, to any user. Everyone else may only take a task themselves; whether agents and managers keep
 * creating their own tasks is still open (C-29), so self-tasks stay allowed.
 */
export function canAssignTo(actor: Pick<Actor, "id" | "role">, assigneeId: string) {
  return taskScope(actor.role) === "all" || assigneeId === actor.id;
}

/**
 * Q36 (confirmed 10 Nov 2026): anyone with Tasks access can create (own) a proposal, but only the
 * Super Admin edits a saved one: its fields, plan, rows, type, or a rebuild. Status changes stay with
 * the people who can see the task. Whether an owner may correct a proposal before printing is still
 * open (C-25), so the lock applies from the first save.
 */
export function canEditSavedProposal(role: Role) {
  return role === "super_admin";
}

/** Whether the actor may edit this task beyond its status: anything without a saved plan, or as Super Admin. */
export function canEditTaskDetails(role: Role, task: { proposal: unknown }) {
  return task.proposal === null || task.proposal === undefined || canEditSavedProposal(role);
}

/** Roles a task can be assigned to: all users (Q45). */
export const ASSIGNABLE_ROLES: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];

/**
 * FR-091 discount cap. Admins: any. Managers: the manager cap setting (5%, Q41, seeded by migration
 * 0014), or the agent cap while it is unset. Agents: the agent cap (5%, Q40).
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
