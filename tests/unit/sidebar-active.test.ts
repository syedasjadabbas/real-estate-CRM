import { describe, expect, it } from "vitest";
import { isActive } from "@/components/shell/sidebar";

const hrefs = ["/dashboard", "/dashboard/leads", "/dashboard/leads?stage=new_lead", "/dashboard/leads/todos", "/dashboard/clients"];
const at = (path: string, query = "") => (href: string) => isActive(path, new URLSearchParams(query), href, hrefs);

describe("sidebar active item", () => {
  it("lights up New leads, not Leads, on the New Lead filter", () => {
    const on = at("/dashboard/leads", "stage=new_lead");
    expect(on("/dashboard/leads?stage=new_lead")).toBe(true);
    expect(on("/dashboard/leads")).toBe(false);
  });

  it("lights up Leads on the plain list, other filters and lead pages", () => {
    expect(at("/dashboard/leads")("/dashboard/leads")).toBe(true);
    expect(at("/dashboard/leads")("/dashboard/leads?stage=new_lead")).toBe(false);
    expect(at("/dashboard/leads", "stage=contacted")("/dashboard/leads")).toBe(true);
    expect(at("/dashboard/leads/abc")("/dashboard/leads")).toBe(true);
    expect(at("/dashboard/leads/abc", "stage=new_lead")("/dashboard/leads?stage=new_lead")).toBe(false);
  });

  it("lights up To-dos, not Leads, on the To-dos page", () => {
    expect(at("/dashboard/leads/todos")("/dashboard/leads/todos")).toBe(true);
    expect(at("/dashboard/leads/todos")("/dashboard/leads")).toBe(false);
    expect(at("/dashboard/leads/todos", "bucket=overdue")("/dashboard/leads/todos")).toBe(true);
    expect(at("/dashboard/leads/pipeline")("/dashboard/leads")).toBe(true);
  });

  it("keeps the Dashboard item exact and others by prefix", () => {
    expect(at("/dashboard")("/dashboard")).toBe(true);
    expect(at("/dashboard/clients")("/dashboard")).toBe(false);
    expect(at("/dashboard/clients/1")("/dashboard/clients")).toBe(true);
    expect(isActive(null, null, "/dashboard/leads", hrefs)).toBe(false);
  });
});
