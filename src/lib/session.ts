/** Client-safe view of the signed-in user (no tokens, no hashes). */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
};

export type ProjectOption = { id: string; name: string };
