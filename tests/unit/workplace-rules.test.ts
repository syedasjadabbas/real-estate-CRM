import { describe, expect, it } from "vitest";
import { daysBetween } from "@/modules/holidays/service";
import { browserLabel } from "@/modules/workplace/user-agent";
import { signinListQuerySchema } from "@/modules/workplace/validation";

const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  operaLinux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/115.0.0.0",
};

describe("browser label (W4)", () => {
  it("names the browser and operating system the user agent states", () => {
    expect(browserLabel(UA.chromeWin)).toBe("Chrome · Windows");
    expect(browserLabel(UA.edgeWin)).toBe("Edge · Windows");
    expect(browserLabel(UA.firefoxMac)).toBe("Firefox · macOS");
    expect(browserLabel(UA.safariMac)).toBe("Safari · macOS");
    expect(browserLabel(UA.safariIphone)).toBe("Safari · iOS");
    expect(browserLabel(UA.chromeIos)).toBe("Chrome · iOS");
    expect(browserLabel(UA.chromeAndroid)).toBe("Chrome · Android");
    expect(browserLabel(UA.samsung)).toBe("Samsung Internet · Android");
    expect(browserLabel(UA.operaLinux)).toBe("Opera · Linux");
  });

  it("falls back to Unknown browser without guessing", () => {
    expect(browserLabel(null)).toBe("Unknown browser");
    expect(browserLabel("   ")).toBe("Unknown browser");
    expect(browserLabel("curl/8.9.1")).toBe("Unknown browser");
    expect(browserLabel("SomeBot/1.0 (Windows NT 10.0)")).toBe("Unknown browser · Windows");
  });
});

describe("sign-in list query", () => {
  it("parses leniently", () => {
    expect(signinListQuerySchema.parse({ event: "sign_out", page: "3" })).toEqual({ event: "sign_out", page: 3 });
    expect(signinListQuerySchema.parse({ event: "login", page: "-1" })).toEqual({ event: undefined, page: 1 });
  });
});

describe("holiday day distance", () => {
  it("counts calendar days across month, year and DST-free boundaries", () => {
    expect(daysBetween("2026-10-30", "2026-10-30")).toBe(0);
    expect(daysBetween("2026-10-30", "2026-10-31")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
});
