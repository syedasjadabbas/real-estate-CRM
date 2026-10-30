import { describe, expect, it } from "vitest";
import { telHref } from "@/modules/leads/phone";
import {
  cleanFileName,
  extensionOf,
  formatBytes,
  formatClock,
  parseDuration,
  sniffAudio,
} from "@/modules/recordings/validation";
import { resolveKey } from "@/server/storage/local";
import { parseRange } from "@/server/storage/range";

const bytes = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p));
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
};

describe("audio content detection", () => {
  it("recognises each allowed container from its first bytes", () => {
    expect(sniffAudio(bytes("RIFF", [0, 0, 0, 0], "WAVE"))).toBe("wav");
    expect(sniffAudio(bytes("OggS"))).toBe("ogg");
    expect(sniffAudio(bytes([0, 0, 0, 0x20], "ftypM4A "))).toBe("m4a");
    expect(sniffAudio(bytes("ID3"))).toBe("mp3");
    expect(sniffAudio(bytes([0xff, 0xfb, 0x90]))).toBe("mp3"); // MPEG-1 layer III frame
    expect(sniffAudio(bytes([0xff, 0xf1, 0x50]))).toBe("aac"); // ADTS
    expect(sniffAudio(bytes("ADIF"))).toBe("aac");
  });

  it("rejects anything else", () => {
    for (const b of [bytes("%PDF-1.7"), bytes("<html>"), bytes("MZ"), bytes([0x89], "PNG"), bytes("#!AMR\n"), new Uint8Array(4)]) {
      expect(sniffAudio(b)).toBeNull();
    }
  });
});

describe("file names", () => {
  it("keeps only a clean base name with its extension", () => {
    expect(cleanFileName("C:\\Users\\a\\Call 0300.m4a")).toBe("Call 0300.m4a");
    expect(cleanFileName("../../etc/passwd.mp3")).toBe("passwd.mp3");
    expect(cleanFileName("a\u0000b\nc.wav")).toBe("abc.wav");
    expect(cleanFileName("   ")).toBe("recording");
    const long = cleanFileName(`${"x".repeat(300)}.ogg`);
    expect(long).toHaveLength(200);
    expect(long.endsWith(".ogg")).toBe(true);
    expect(extensionOf("Rec.M4A")).toBe("m4a");
    expect(extensionOf("noext")).toBe("");
  });
});

describe("duration and display", () => {
  it("accepts 0–86400 seconds, rounds, and ignores anything else", () => {
    expect(parseDuration("125.6")).toBe(126);
    expect(parseDuration(0)).toBe(0);
    for (const v of ["", null, undefined, "-1", "86401", "abc", "Infinity"]) expect(parseDuration(v)).toBeNull();
  });

  it("formats sizes and clock times", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatClock(null)).toBe("—");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});

describe("byte ranges for playback", () => {
  it("parses open, closed and suffix ranges and rejects unsatisfiable ones", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    for (const h of ["bytes=100-", "bytes=20-10", "bytes=-0", "bytes=-", "items=0-1", "bytes=0-1,5-6"]) expect(parseRange(h, 100)).toBe("invalid");
  });
});

describe("storage keys", () => {
  it("accept only generated keys, so no path can escape the storage folder", () => {
    expect(() => resolveKey("recordings/2026/10/0fea3a33-719f-4a72-a224-c87769289217.mp3")).not.toThrow();
    for (const key of ["../secret.mp3", "recordings/../../x/0fea3a33-719f-4a72-a224-c87769289217.mp3", "/etc/passwd", "recordings\\2026\\a.mp3", "recordings/2026/notauuid.mp3"]) {
      expect(() => resolveKey(key)).toThrow();
    }
  });
});

describe("click-to-call", () => {
  it("builds a dialer link from the stored country code and number", () => {
    expect(telHref("+92", "3001234567")).toBe("tel:+923001234567");
    expect(telHref("+971", "50 123-4567")).toBe("tel:+971501234567");
  });
});
