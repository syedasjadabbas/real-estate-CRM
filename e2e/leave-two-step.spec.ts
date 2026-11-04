import { test } from "@playwright/test";
import { leaveApprovals, setStaffLeaveSteps } from "./support/data";
import { api, expect, login, seed, unique } from "./support/seed";

/**
 * F-6: a staff request's two approval steps need two different people, even when both steps are
 * the same role. The step order is a client decision (C-4), so the test sets Admin / Admin only for
 * itself and clears it again afterwards (the default is "not set").
 */
test.afterEach(async () => {
  await setStaffLeaveSteps(null, null);
});

test("two-step staff leave: the step 1 Admin can't approve step 2; a Super Admin completes it", async ({ browser }) => {
  await setStaffLeaveSteps("admin", "admin");
  const agent = seed().users.agent1;
  const year = seed().today.slice(0, 4);
  const reason = unique("E2E two-step");
  // Its own October days (a different pair on each --repeat-each run, as overlapping leave is refused).
  const day = (n: number) => `${year}-10-${String(n + 2 * test.info().repeatEachIndex).padStart(2, "0")}`;

  const agentCtx = await browser.newContext();
  const ag = await agentCtx.newPage();
  await login(ag, "agent1");
  const res = await api<{ id: string }>(ag, "/api/v1/leave", { method: "POST", data: { type: "annual", startDate: day(5), endDate: day(6), reason } });
  expect(res.status).toBe(201);
  const id = res.data.id;

  // The Admin opens the queue in two tabs, approves step 1 in the first, then tries step 2 from the second.
  const adminCtx = await browser.newContext();
  const first = await adminCtx.newPage();
  await login(first, "admin");
  await first.goto("/dashboard/hr/leave");
  const second = await adminCtx.newPage();
  await second.goto("/dashboard/hr/leave");
  const itemIn = (page: typeof first) => page.getByRole("list", { name: "Leave waiting for your decision" }).getByRole("listitem").filter({ hasText: reason });
  await expect(itemIn(first)).toContainText("Step 1 of 2");
  await itemIn(first).getByRole("button", { name: `Approve ${agent.name}` }).click();
  // Decided: it leaves this approver's queue (step 2 is someone else's).
  await expect(itemIn(first)).toHaveCount(0);

  await expect(itemIn(second)).toContainText("Step 1 of 2"); // stale tab
  await itemIn(second).getByRole("button", { name: `Approve ${agent.name}` }).click();
  await expect(itemIn(second).getByRole("alert")).toHaveText("You approved step 1 of this request. Step 2 needs a different approver.");
  // After a reload the request is no longer offered to the first approver.
  await second.reload();
  await expect(itemIn(second)).toHaveCount(0);
  await adminCtx.close();

  // The Super Admin (also an Admin-step approver) completes step 2.
  const saCtx = await browser.newContext();
  const sa = await saCtx.newPage();
  await login(sa, "superAdmin");
  await sa.goto("/dashboard/hr/leave");
  await expect(itemIn(sa)).toContainText("Step 2 of 2");
  await itemIn(sa).getByRole("button", { name: `Approve ${agent.name}` }).click();
  await expect(itemIn(sa)).toHaveCount(0);
  await saCtx.close();

  expect(await leaveApprovals(id)).toEqual([
    { step: 1, actorId: seed().users.admin.id, approved: true },
    { step: 2, actorId: seed().users.superAdmin.id, approved: true },
  ]);
  await ag.goto(`/dashboard/workspace`);
  await expect(ag.getByRole("list", { name: "My leave requests" }).getByRole("listitem").filter({ hasText: "Approved" }).first()).toBeVisible();
  await agentCtx.close();
});
