import { describe, expect, it } from "vitest";
import { filterBalances, filterRequests } from "@/modules/leave/card-filters";

describe("HR → Leave card filters (15 Nov 2026)", () => {
  const requests = [
    { userName: "Ali Khan", reason: "Family wedding", type: "annual" },
    { userName: "Sara Malik", reason: null, type: "medical" },
  ];
  it("filters requests by name or reason, and leave type", () => {
    expect(filterRequests(requests, "khan", undefined).map((r) => r.userName)).toEqual(["Ali Khan"]);
    expect(filterRequests(requests, "wedding", undefined).map((r) => r.userName)).toEqual(["Ali Khan"]);
    expect(filterRequests(requests, undefined, "medical").map((r) => r.userName)).toEqual(["Sara Malik"]);
    expect(filterRequests(requests, undefined, "bogus")).toHaveLength(2);
  });

  const balances = [
    { name: "Ali Khan", role: "agent", granted: 3, pending: 0, remaining: 27, noLogin: false },
    { name: "Office Driver", role: null, granted: 0, pending: 2, remaining: 28, noLogin: true },
    { name: "Dev HR", role: "hr", granted: 26, pending: 0, remaining: 4, noLogin: false },
  ];
  it("filters balances by name, role and who to show", () => {
    expect(filterBalances(balances, { bq: "dev" }).map((r) => r.name)).toEqual(["Dev HR"]);
    expect(filterBalances(balances, { brole: "none" }).map((r) => r.name)).toEqual(["Office Driver"]);
    expect(filterBalances(balances, { brole: "agent" }).map((r) => r.name)).toEqual(["Ali Khan"]);
    expect(filterBalances(balances, { bshow: "taken" }).map((r) => r.name)).toEqual(["Ali Khan", "Dev HR"]);
    expect(filterBalances(balances, { bshow: "pending" }).map((r) => r.name)).toEqual(["Office Driver"]);
    expect(filterBalances(balances, { bshow: "low" }).map((r) => r.name)).toEqual(["Dev HR"]);
    expect(filterBalances(balances, { bshow: "nologin" }).map((r) => r.name)).toEqual(["Office Driver"]);
  });
});
