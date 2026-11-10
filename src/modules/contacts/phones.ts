import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { normalizePhone, type NormalizedPhone } from "@/modules/leads/phone";
import type { Tx } from "@/modules/leads/support";
import type { Database } from "@/server/db";
import { clientPhones, clients, leadPhones, leads } from "@/server/db/schema";
import { AppError } from "@/server/errors";

/**
 * Up to four extra numbers per lead or client (positions 2–5). Phone numbers are the only way a
 * customer is recognised, so every stored number is normalised and every one is used for matching.
 */
export type ExtraPhone = NormalizedPhone & { position: number };

/** Normalises the extra numbers, skipping blank slots. Refuses invalid numbers and repeats. */
export function normalizeExtraPhones(primaryE164: string, input: { countryCode?: string; number?: string }[] | undefined): ExtraPhone[] {
  const out: ExtraPhone[] = [];
  const fields: Record<string, string> = {};
  const seen = new Set([primaryE164]);
  (input ?? []).forEach((p, i) => {
    const raw = (p.number ?? "").trim();
    if (!raw) return;
    const phone = normalizePhone(p.countryCode || "+92", raw);
    if (!phone) {
      fields[`phones.${i}`] = "Enter a valid phone number";
      return;
    }
    if (seen.has(phone.e164)) {
      fields[`phones.${i}`] = "This number is already entered";
      return;
    }
    seen.add(phone.e164);
    out.push({ ...phone, position: out.length + 2 });
  });
  if (Object.keys(fields).length) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields });
  return out;
}

/**
 * Serialises work on these numbers across the whole CRM until the transaction ends, so two requests
 * can't both decide a number is new. Locks are taken in sorted order, so two requests can't deadlock.
 */
export async function lockNumbers(tx: Tx, e164s: string[]) {
  for (const e164 of [...new Set(e164s)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`phone:${e164}`}, 0))`);
  }
}

/** Leads holding any of these numbers, as primary or extra, oldest first. */
export async function leadsWithAnyNumber(
  db: Database | Tx,
  e164s: string[],
  options: { projectId?: string; exceptLeadId?: string; originalsOnly?: boolean } = {},
) {
  if (e164s.length === 0) return [];
  return db
    .select()
    .from(leads)
    .where(
      and(
        isNull(leads.deletedAt),
        options.projectId ? eq(leads.projectId, options.projectId) : undefined,
        options.exceptLeadId ? ne(leads.id, options.exceptLeadId) : undefined,
        options.originalsOnly ? isNull(leads.duplicateOfId) : undefined,
        or(
          inArray(leads.phoneE164, e164s),
          sql`exists (select 1 from ${leadPhones} lp where lp.lead_id = ${leads.id} and lp.e164 in ${e164s})`,
        ),
      ),
    )
    .orderBy(asc(leads.createdAt), asc(leads.id));
}

/** The client holding any of these numbers, as primary or extra. */
export async function clientWithAnyNumber(db: Database | Tx, e164s: string[], exceptClientId?: string) {
  if (e164s.length === 0) return null;
  const [row] = await db
    .select()
    .from(clients)
    .where(
      and(
        exceptClientId ? ne(clients.id, exceptClientId) : undefined,
        or(
          inArray(clients.phoneE164, e164s),
          sql`exists (select 1 from ${clientPhones} cp where cp.client_id = ${clients.id} and cp.e164 in ${e164s})`,
        ),
      ),
    )
    .orderBy(asc(clients.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * A returning customer: the client holding one of the numbers, else the earliest lead with one,
 * in any project. The original agent is that client's owner, else that lead's owner.
 */
export async function findCustomer(db: Database | Tx, e164s: string[]) {
  const client = await clientWithAnyNumber(db, e164s);
  const [firstLead] = await leadsWithAnyNumber(db, e164s);
  if (!client && !firstLead) return null;
  return {
    clientId: client?.id ?? firstLead?.clientId ?? null,
    originalOwnerId: client?.ownerId ?? firstLead?.ownerId ?? null,
    firstLeadId: firstLead?.id ?? null,
  };
}

export async function replaceLeadPhones(tx: Tx, leadId: string, phones: ExtraPhone[]) {
  await tx.delete(leadPhones).where(eq(leadPhones.leadId, leadId));
  if (phones.length) {
    await tx.insert(leadPhones).values(phones.map((p) => ({ leadId, position: p.position, countryCode: p.countryCode, number: p.national, e164: p.e164 })));
  }
}

export async function replaceClientPhones(tx: Tx, clientId: string, phones: ExtraPhone[]) {
  await tx.delete(clientPhones).where(eq(clientPhones.clientId, clientId));
  if (phones.length) {
    await tx.insert(clientPhones).values(phones.map((p) => ({ clientId, position: p.position, countryCode: p.countryCode, number: p.national, e164: p.e164 })));
  }
}

export async function leadPhonesOf(db: Database | Tx, leadId: string) {
  return db
    .select({ position: leadPhones.position, countryCode: leadPhones.countryCode, number: leadPhones.number, e164: leadPhones.e164 })
    .from(leadPhones)
    .where(eq(leadPhones.leadId, leadId))
    .orderBy(asc(leadPhones.position));
}

export async function clientPhonesOf(db: Database | Tx, clientId: string) {
  return db
    .select({ position: clientPhones.position, countryCode: clientPhones.countryCode, number: clientPhones.number, e164: clientPhones.e164 })
    .from(clientPhones)
    .where(eq(clientPhones.clientId, clientId))
    .orderBy(asc(clientPhones.position));
}

/** Copies a lead's extra numbers onto a client, skipping any the client already holds. */
export async function copyLeadPhonesToClient(tx: Tx, leadId: string, clientId: string) {
  const [client] = await tx.select({ e164: clients.phoneE164 }).from(clients).where(eq(clients.id, clientId));
  const existing = await clientPhonesOf(tx, clientId);
  const held = new Set([client?.e164, ...existing.map((p) => p.e164)]);
  let position = existing.length + 2;
  const [lead] = await tx.select({ countryCode: leads.phoneCountryCode, national: leads.phoneNumber, e164: leads.phoneE164 }).from(leads).where(eq(leads.id, leadId));
  const candidates = [...(lead ? [lead] : []), ...(await leadPhonesOf(tx, leadId)).map((p) => ({ countryCode: p.countryCode, national: p.number, e164: p.e164 }))];
  for (const phone of candidates) {
    if (held.has(phone.e164) || position > 5) continue;
    await tx.insert(clientPhones).values({ clientId, position, countryCode: phone.countryCode, number: phone.national, e164: phone.e164 });
    held.add(phone.e164);
    position += 1;
  }
}
