/** Client-safe view of the signed-in user (no tokens, no hashes). */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  /** Leads at least one active team (shows "My team"). */
  isTeamLead?: boolean;
};

export type ProjectOption = { id: string; name: string };
