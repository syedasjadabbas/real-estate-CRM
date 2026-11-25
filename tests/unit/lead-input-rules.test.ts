import { describe, expect, it } from "vitest";
import { extraPhoneProblem, isPhoneTooLong, leadInputErrors, nameProblem, phoneExample, phoneProblem, splitPrefix } from "@/modules/leads/input-rules";

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

  it("follows the country: example, too long, and further numbers may be landlines", () => {
    expect(phoneExample("+1")).toBe("201 555 0123");
    for (const cc of ["92", "971", "966", "974", "968", "965", "973", "44", "1", "61", "49"]) expect(phoneProblem(cc, phoneExample(cc))).toBeNull();
    expect(phoneProblem("+1", "0300 1234567")).toBeTruthy(); // ten digits, but not a US number
    expect(phoneProblem("+1", "1 201 555 0123")).toBeNull();
    expect(phoneProblem("+974", "0300 1234")).toBeTruthy();
    expect(phoneProblem("+971", "0300 1234567")).toMatch(/9 digits/);
    expect(isPhoneTooLong("+92", "0300 1234567")).toBe(false);
    expect(isPhoneTooLong("+92", "0300 12345678")).toBe(true);
    expect(extraPhoneProblem("+92", "051 1234567")).toBeNull();
    expect(extraPhoneProblem("+92", "123")).toBeTruthy();
    expect(extraPhoneProblem("+92", "0300 123456789")).toBeTruthy();
    expect(leadInputErrors({ phones: [{ countryCode: "+92", number: "" }, { countryCode: "+92", number: "12" }] })).toEqual({ "phones.1": "The number is too short" });
  });

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
