import { describe, expect, it } from "vitest";
import { parsePropertyType, parseSize, sizeFields } from "@/modules/leads/size";

describe("lead sizes (client, 24 Nov 2026)", () => {
  it.each([
    ["1 kanal", 4500],
    ["20 marla", 4500],
    ["4,500 sq ft", 4500],
    ["4500 sqft", 4500],
    ["500 sq. yards", 4500],
    ["1 kanal house", 4500],
    ["A 1 Kanal House", 4500],
    ["1 kanal 5 marla", 5625],
    ["2.5 Marla", 562.5],
    ["5marla plot", 1125],
  ])("%s", (text, sqft) => expect(parseSize(text)?.sqft).toBe(sqft));

  it.each(["2 bed", "674", "large", "5-7 marla", "5 or 10 marla", "5 marla 10 marla", "around 5 marla", "1 kanal 500 sq ft", "0 marla", ""])("%s is unclear, not guessed", (text) => expect(parseSize(text)).toBeNull());

  it("uses the project's marla", () => {
    expect(parseSize("1 kanal", 250)?.sqft).toBe(5000);
    expect(parseSize("1 kanal", 272.25)?.sqft).toBe(5445);
    expect(parseSize("900 sq ft", 250)?.sqft).toBe(900);
  });

  it("reads the type, and a chosen type wins", () => {
    expect(parsePropertyType("1 kanal farm house")).toBe("farmhouse");
    expect(parsePropertyType("house or plot")).toBeNull();
    expect(sizeFields("1 kanal house", null, 225)).toEqual({ sizeSqft: 4500, propertyType: "house" });
    expect(sizeFields("2 bed flat", "villa", 225)).toEqual({ sizeSqft: null, propertyType: "villa" });
    expect(sizeFields(null, null, 225)).toEqual({ sizeSqft: null, propertyType: null });
  });
});
