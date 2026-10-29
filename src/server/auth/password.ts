import { hash, verify } from "@node-rs/argon2";

/** Argon2id with library defaults (memory-hard; see SECURITY_AND_PRIVACY.md §1). */
export function hashPassword(password: string) {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Used when the account does not exist, so response time does not reveal it. */
const DUMMY_HASH = hash("timing-equaliser-not-a-real-password");
export async function burnPasswordCheck(password: string) {
  await verifyPassword(await DUMMY_HASH, password);
}
