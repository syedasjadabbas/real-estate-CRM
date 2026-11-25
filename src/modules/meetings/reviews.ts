import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db";
import { auditLogs, meetingHistory, meetingReviews, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { parseTask as parse } from "@/modules/tasks/support";
import { loadAccessibleMeeting } from "./commands";
import { assertCanMeeting } from "./policy";

/** Reviews of a held meeting, by its agent and by Admins: stars and a comment (client, 25 Nov 2026). */
const schema = z.object({
  rating: z.coerce.number("Choose 1 to 5 stars").int("Choose 1 to 5 stars").min(1, "Choose 1 to 5 stars").max(5, "Choose 1 to 5 stars"),
  body: z.string().trim().min(3, "Write what you thought of it").max(2000, "Use at most 2,000 characters"),
});

export async function addMeetingReview(db: Database, actor: Actor, meetingId: string, input: unknown) {
  assertCanMeeting(actor, "edit");
  const data = parse(schema, input);
  return db.transaction(async (tx) => {
    const { meeting } = await loadAccessibleMeeting(tx, actor, meetingId, true);
    if (meeting.status !== "completed") throw new AppError("BUSINESS_RULE", "A meeting is reviewed after it is held.");
    const [row] = await tx.insert(meetingReviews).values({ meetingId, reviewerId: actor.id, ...data }).returning({ id: meetingReviews.id });
    await tx.insert(meetingHistory).values({ meetingId, actorId: actor.id, action: "review", data });
    await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "meeting.review", entity: "meeting", entityId: meetingId, before: null, after: data });
    return { id: row.id };
  });
}

export async function meetingReviewsFor(db: Database, actor: Actor, meetingId: string) {
  await loadAccessibleMeeting(db, actor, meetingId);
  return db
    .select({ id: meetingReviews.id, rating: meetingReviews.rating, body: meetingReviews.body, createdAt: meetingReviews.createdAt, reviewerName: users.name, reviewerRole: users.role })
    .from(meetingReviews)
    .innerJoin(users, eq(users.id, meetingReviews.reviewerId))
    .where(eq(meetingReviews.meetingId, meetingId))
    .orderBy(desc(meetingReviews.createdAt));
}
