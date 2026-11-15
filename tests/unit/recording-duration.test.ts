import { describe, expect, it } from "vitest";
import { measureDuration } from "@/modules/recordings/duration";
import { sniffAudio } from "@/modules/recordings/validation";
import { aacSeconds, m4aSeconds, mp3Seconds, oggSeconds, wavSeconds } from "../support/audio";

describe("call duration read from the recording file (server side)", () => {
  it.each([
    ["mp3", mp3Seconds(95)],
    ["mp3 without a tag", mp3Seconds(95, { id3: false })],
    ["wav", wavSeconds(95)],
    ["m4a", m4aSeconds(95)],
    ["ogg vorbis", oggSeconds(95)],
    ["ogg opus", oggSeconds(95, "opus")],
    ["aac", aacSeconds(95)],
  ])("%s: 95 seconds", (_, bytes) => {
    const format = sniffAudio(bytes);
    expect(format).not.toBeNull();
    expect(measureDuration(bytes, format!)).toBe(95);
  });

  it("returns null for a file it can't read instead of guessing", () => {
    const junk = new Uint8Array(2048);
    junk.set([0x49, 0x44, 0x33, 4, 0, 0]);
    expect(measureDuration(junk, "mp3")).toBeNull();
    expect(measureDuration(new Uint8Array([...wavSeconds(1).subarray(0, 20)]), "wav")).toBeNull();
    expect(measureDuration(new Uint8Array(16), "m4a")).toBeNull();
  });

  it("caps a recording that stopped early at the bytes actually there", () => {
    const cut = wavSeconds(10).subarray(0, 44 + 16_000 * 4); // header says 10 s, file holds 4 s
    expect(measureDuration(cut, "wav")).toBe(4);
  });
});
