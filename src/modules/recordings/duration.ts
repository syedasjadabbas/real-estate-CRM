import { MAX_DURATION_SEC, type RecordingFormat } from "./validation";

/**
 * Reads a recording's length from the audio file itself, on the server (owner, 15 Nov 2026: call
 * duration must be fetched, not typed or taken from the browser). No external library: each of the
 * five allowed formats is read from its own headers or frames. Returns whole seconds, or null when
 * the file can't be read (the call still counts, with its duration shown as unknown).
 */
export function measureDuration(b: Uint8Array, format: RecordingFormat): number | null {
  let seconds: number | null = null;
  try {
    if (format === "wav") seconds = wav(b);
    else if (format === "m4a") seconds = m4a(b);
    else if (format === "ogg") seconds = ogg(b);
    else if (format === "mp3") seconds = mpeg(b);
    else if (format === "aac") seconds = adts(b);
  } catch {
    seconds = null;
  }
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0 || seconds > MAX_DURATION_SEC) return null;
  return Math.round(seconds);
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** ID3v2 tag length at the start (header + body + optional footer), or 0. */
function id3Length(b: Uint8Array, at = 0) {
  if (b.length < at + 10 || ascii(b, at, 3) !== "ID3") return 0;
  const size = ((b[at + 6] & 0x7f) << 21) | ((b[at + 7] & 0x7f) << 14) | ((b[at + 8] & 0x7f) << 7) | (b[at + 9] & 0x7f);
  const footer = b[at + 5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

// ─── WAV: data size / byte rate ──────────────────────────────────────────────

function wav(b: Uint8Array) {
  const v = view(b);
  let at = 12;
  let byteRate = 0;
  while (at + 8 <= b.length) {
    const id = ascii(b, at, 4);
    const size = v.getUint32(at + 4, true);
    if (id === "fmt ") byteRate = v.getUint32(at + 16, true);
    if (id === "data") {
      if (!byteRate) return null;
      // A recorder that stopped early may leave a size bigger than the file.
      return Math.min(size, b.length - at - 8) / byteRate;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

// ─── M4A: the movie header's duration / time scale ───────────────────────────

function m4a(b: Uint8Array) {
  const v = view(b);
  const find = (start: number, end: number, type: string): [number, number] | null => {
    let at = start;
    while (at + 8 <= end) {
      let size = v.getUint32(at);
      let header = 8;
      if (size === 1) {
        size = Number(v.getBigUint64(at + 8));
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header) return null;
      if (ascii(b, at + 4, 4) === type) return [at + header, at + size];
      at += size;
    }
    return null;
  };
  const moov = find(0, b.length, "moov");
  if (!moov) return null;
  const mvhd = find(moov[0], moov[1], "mvhd");
  if (!mvhd) return null;
  const at = mvhd[0];
  const version = b[at];
  const timescale = version === 1 ? v.getUint32(at + 20) : v.getUint32(at + 12);
  const duration = version === 1 ? Number(v.getBigUint64(at + 24)) : v.getUint32(at + 16);
  return timescale ? duration / timescale : null;
}

// ─── OGG (Vorbis / Opus): last page's granule position / sample rate ─────────

function ogg(b: Uint8Array) {
  const v = view(b);
  if (ascii(b, 0, 4) !== "OggS") return null;
  const packet = 27 + b[26];
  let rate = 0;
  let preSkip = 0;
  if (ascii(b, packet, 8) === "OpusHead") {
    rate = 48_000; // Opus granules always count 48 kHz samples.
    preSkip = v.getUint16(packet + 10, true);
  } else if (b[packet] === 1 && ascii(b, packet + 1, 6) === "vorbis") {
    rate = v.getUint32(packet + 12, true);
  }
  if (!rate) return null;
  for (let at = b.length - 27; at >= 0; at--) {
    if (b[at] === 0x4f && ascii(b, at, 4) === "OggS") {
      const granule = v.getBigInt64(at + 6, true);
      if (granule < BigInt(0)) continue;
      return Math.max(0, Number(granule) - preSkip) / rate;
    }
  }
  return null;
}

// ─── MP3: count every frame's samples (works for constant and variable bit rate) ─

const MPEG_BITRATES: Record<string, number[]> = {
  // [version 1, layer 3], [version 1, layer 2], [version 1, layer 1], [version 2/2.5, layer 2/3], [version 2/2.5, layer 1]
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
};
const MPEG_RATES = [
  [11_025, 12_000, 8_000], // version 2.5
  null,
  [22_050, 24_000, 16_000], // version 2
  [44_100, 48_000, 32_000], // version 1
];

function mpegFrame(b: Uint8Array, at: number) {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null;
  const versionBits = (b[at + 1] >> 3) & 3;
  const layerBits = (b[at + 1] >> 1) & 3;
  const bitrateIndex = b[at + 2] >> 4;
  const rateIndex = (b[at + 2] >> 2) & 3;
  const padding = (b[at + 2] >> 1) & 1;
  const rates = MPEG_RATES[versionBits];
  if (!rates || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const layer = 4 - layerBits; // 1, 2 or 3
  const v1 = versionBits === 3;
  const table = v1 ? MPEG_BITRATES[`1-${layer}`] : MPEG_BITRATES[layer === 1 ? "2-1" : "2-3"];
  const bitrate = table[bitrateIndex] * 1000;
  const sampleRate = rates[rateIndex];
  const samples = layer === 1 ? 384 : layer === 2 ? 1152 : v1 ? 1152 : 576;
  const length = layer === 1 ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4 : Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
  return length > 4 ? { length, samples, sampleRate } : null;
}

function mpeg(b: Uint8Array) {
  let at = id3Length(b);
  // Find the first frame that is followed by another frame (skips stray bytes after the tag).
  while (at + 4 < b.length) {
    const f = mpegFrame(b, at);
    if (f && mpegFrame(b, at + f.length)) break;
    at++;
    if (at > 1024 * 1024) return null;
  }
  let seconds = 0;
  let frames = 0;
  while (at + 4 <= b.length) {
    const f = mpegFrame(b, at);
    if (!f) break;
    seconds += f.samples / f.sampleRate;
    frames++;
    at += f.length;
  }
  return frames ? seconds : null;
}

// ─── AAC (ADTS): count frames; each holds 1024 samples per raw data block ────

const AAC_RATES = [96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000, 7_350];

function adts(b: Uint8Array) {
  let at = id3Length(b);
  if (ascii(b, at, 4) === "ADIF") return null; // rare, no frame timing to read
  let seconds = 0;
  let frames = 0;
  while (at + 7 <= b.length) {
    if (b[at] !== 0xff || (b[at + 1] & 0xf6) !== 0xf0) break;
    const rate = AAC_RATES[(b[at + 2] >> 2) & 0x0f];
    const length = ((b[at + 3] & 0x03) << 11) | (b[at + 4] << 3) | (b[at + 5] >> 5);
    const blocks = (b[at + 6] & 0x03) + 1;
    if (!rate || length < 7) break;
    seconds += (blocks * 1024) / rate;
    frames++;
    at += length;
  }
  return frames ? seconds : null;
}
