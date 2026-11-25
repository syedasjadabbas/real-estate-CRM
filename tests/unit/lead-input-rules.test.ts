import { describe, expect, it } from "vitest";
import { leadInputErrors, nameProblem, phoneProblem, splitPrefix } from "@/modules/leads/input-rules";

describe("lead input rules (client, 25 Nov 2026)", () => {
  it.each([
    ["+92", "0300 1234567"],
    ["+92", "3001234567"],
    ["+92", "+92 300 1234567"],
    ["+92", "923001234567"],
    ["+971", "0501234567"],
    ["+44", "07400 123456"],
    ["+1", "201 555 0123"],
    ["+86", "13800138000"],
  ])("%s %s is fine", (cc, n) => expect(phoneProblem(cc, n)).toBeNull());

  it.each([
    ["+92", "030012345"],
    ["+92", "0300123456789"],
    ["+92", "0512345678"],
    ["+92", "03ab1234567"],
    ["+92", ""],
    ["+971", "0301234567"],
    ["+1", "12345"],
  ])("%s %s is refused", (cc, n) => expect(phoneProblem(cc, n)).toBeTruthy());

  it("names are letters in any script", () => {
    for (const ok of ["Ali Raza", "O'Neil", "Al-Amin", "محمد علی", "Abdul Majeed / Rubina"]) expect(nameProblem(ok)).toBeNull();
    for (const bad of ["Ali 2", "A", "Ali@home", "1234"]) expect(nameProblem(bad)).toBeTruthy();
  });

  it("a title is its own field and stays with the first name", () => {
    expect(splitPrefix("Mr Ali")).toEqual({ prefix: "Mr", rest: "Ali" });
    expect(splitPrefix("dr. Sana")).toEqual({ prefix: "Dr", rest: "Sana" });
    expect(splitPrefix("Mariam")).toEqual({ prefix: "", rest: "Mariam" });
    expect(leadInputErrors({ firstName: "Mr ", lastName: "", phoneCountryCode: "+92", phoneNumber: "1", email: "a@b" })).toMatchObject({ firstName: expect.any(String), phoneNumber: expect.any(String), email: expect.any(String) });
    expect(leadInputErrors({ firstName: "Mr Ali", lastName: "Raza", phoneCountryCode: "+92", phoneNumber: "03001234567", email: "ali@example.com" })).toEqual({});
  });
});
