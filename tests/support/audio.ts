/**
 * Small but genuine audio files for tests, built byte by byte (silent): each one has the headers
 * or frames a player reads its length from, so the server-side duration can be checked.
 */

const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u64le = (n: number) => [...u32le(n % 2 ** 32), ...u32le(Math.floor(n / 2 ** 32))];

/** MPEG-1 Layer III, 128 kbps, 44.1 kHz: 417-byte frames of 1152 samples, after an ID3 tag. */
export function mp3Seconds(seconds: number, { id3 = true } = {}) {
  const frames = Math.round((seconds * 44_100) / 1152);
  const tag = id3 ? [...text("ID3"), 4, 0, 0, 0, 0, 0, 0] : [];
  const b = new Uint8Array(tag.length + frames * 417);
  b.set(tag);
  for (let i = 0; i < frames; i++) b.set([0xff, 0xfb, 0x90, 0x00], tag.length + i * 417);
  return b;
}

/** 16-bit mono PCM at 8 kHz. */
export function wavSeconds(seconds: number) {
  const data = seconds * 16_000;
  const header = [...text("RIFF"), ...u32le(36 + data), ...text("WAVE"), ...text("fmt "), ...u32le(16), ...u16le(1), ...u16le(1), ...u32le(8000), ...u32le(16_000), ...u16le(2), ...u16le(16), ...text("data"), ...u32le(data)];
  const b = new Uint8Array(header.length + data);
  b.set(header);
  return b;
}

/** An MP4 audio file whose movie header says `seconds` at a 1000 Hz time scale. */
export function m4aSeconds(seconds: number) {
  const mvhd = [...u32be(108), ...text("mvhd"), 0, 0, 0, 0, ...u32be(0), ...u32be(0), ...u32be(1000), ...u32be(seconds * 1000), ...new Array(80).fill(0)];
  const moov = [...u32be(8 + mvhd.length), ...text("moov"), ...mvhd];
  const ftyp = [...u32be(16), ...text("ftyp"), ...text("M4A "), ...u32be(0)];
  return new Uint8Array([...ftyp, ...moov]);
}

function oggPage(granule: number, packet: number[]) {
  return [...text("OggS"), 0, packet.length ? 2 : 4, ...u64le(granule), ...u32le(1), ...u32le(0), ...u32le(0), packet.length ? 1 : 0, ...(packet.length ? [packet.length] : []), ...packet];
}

/** Ogg Vorbis at 16 kHz, or Ogg Opus (48 kHz granules with a pre-skip). */
export function oggSeconds(seconds: number, codec: "vorbis" | "opus" = "vorbis") {
  if (codec === "opus") {
    const preSkip = 312;
    const head = [...text("OpusHead"), 1, 1, ...u16le(preSkip), ...u32le(16_000), 0, 0, 0];
    return new Uint8Array([...oggPage(0, head), ...oggPage(seconds * 48_000 + preSkip, [])]);
  }
  const head = [1, ...text("vorbis"), ...u32le(0), 1, ...u32le(16_000), ...new Array(14).fill(0)];
  return new Uint8Array([...oggPage(0, head), ...oggPage(seconds * 16_000, [])]);
}

/** AAC in ADTS frames (header only), 44.1 kHz stereo, 1024 samples per frame. */
export function aacSeconds(seconds: number) {
  const frames = Math.round((seconds * 44_100) / 1024);
  const frame = [0xff, 0xf1, 0x50, 0x80, 0x00, 0xff, 0xfc];
  const b = new Uint8Array(frames * 7);
  for (let i = 0; i < frames; i++) b.set(frame, i * 7);
  return b;
}
