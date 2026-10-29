import type { Actor, Role } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Meetings authorization (USER_ROLES_AND_PERMISSIONS.md): Meetings F/F/T/O/—/—.
 * A meeting is "own" when the actor organizes or created it (assumption M-A1); a manager's team
 * scope covers meetings organized or created by the manager or a team member.
 */
export type MeetingScope = "all" | "team" | "own" | "none";

export function meetingScope(role: Role): MeetingScope {
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

export type MeetingAction = "view" | "create" | "edit";

const ROLE_ACTIONS: Record<Role, MeetingAction[]> = {
  super_admin: ["view", "create", "edit"],
  admin: ["view", "create", "edit"],
  manager: ["view", "create", "edit"],
  agent: ["view", "create", "edit"],
  hr: [],
  accountant: [],
};

export function canDoMeeting(actor: Pick<Actor, "role">, action: MeetingAction) {
  return ROLE_ACTIONS[actor.role].includes(action);
}

export function assertCanMeeting(actor: Pick<Actor, "role">, action: MeetingAction) {
  if (!canDoMeeting(actor, action)) throw forbidden();
}

export function canAccessMeeting(
  actor: Pick<Actor, "id" | "role">,
  meeting: { organizerId: string; createdById: string | null },
  teamMemberIds: readonly string[] = [],
) {
  const people = [meeting.organizerId, meeting.createdById].filter((id): id is string => id !== null);
  switch (meetingScope(actor.role)) {
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

/** Organizer choice (assumption M-A2): anyone (admins), self or team (managers), self (agents). */
export function canPickOrganizer(actor: Pick<Actor, "id" | "role">, organizerId: string, teamMemberIds: readonly string[] = []) {
  switch (meetingScope(actor.role)) {
    case "all":
      return true;
    case "team":
      return organizerId === actor.id || teamMemberIds.includes(organizerId);
    case "own":
      return organizerId === actor.id;
    default:
      return false;
  }
}

/** Roles that can organize meetings (the roles that work leads). */
export const ORGANIZER_ROLES: Role[] = ["super_admin", "admin", "manager", "agent"];
