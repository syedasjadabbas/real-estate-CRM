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
  /**
   * Verified client IP of the current request (trusted proxy only, see client-ip.ts), written on
   * audit rows. Null or absent when it can't be trusted, and outside a web request (jobs, tests).
   */
  ip?: string | null;
};
