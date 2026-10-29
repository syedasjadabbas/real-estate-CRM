export const ROLES = ["super_admin", "admin", "manager", "agent", "hr", "accountant"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Sales Manager",
  agent: "Sales Agent",
  hr: "HR",
  accountant: "Accountant",
};

/** The authenticated user as seen by services and policies. */
export type Actor = {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Teams this user manages (manager scope). */
  managedTeamIds: string[];
};
