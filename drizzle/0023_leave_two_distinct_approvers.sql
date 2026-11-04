-- F-6 (audit §17): the two staff leave steps need two different people. One approval decision per person
-- per request; the service refuses first with a clear message, this index is the backstop for any other writer.
-- Additive: no existing row is changed (no request had the same approver twice when this was written).
CREATE UNIQUE INDEX "leave_decisions_one_approval_per_actor_uq" ON "leave_decisions" USING btree ("request_id","actor_id") WHERE "leave_decisions"."kind" = 'approval';
