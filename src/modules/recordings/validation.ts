/**
 * Call recording upload rules (FR-038; SECURITY_AND_PRIVACY.md §6): audio allow-list mp3, m4a,
 * aac, ogg, wav; at most 25 MB. The file content is checked, not just its name or browser type.
 */
export const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
/** Multipart overhead allowed on top of the file when checking Content-Length. */
export const UPLOAD_OVERHEAD_BYTES = 64 * 1024;
export const MAX_DURATION_SEC = 86_400;

export const RECORDING_FORMATS = {
  mp3: { mime: "audio/mpeg", label: "MP3" },
  m4a: { mime: "audio/mp4", label: "M4A" },
  aac: { mime: "audio/aac", label: "AAC" },
  ogg: { mime: "audio/ogg", label: "OGG" },
  wav: { mime: "audio/wav", label: "WAV" },
} as const;
export type RecordingFormat = keyof typeof RECORDING_FORMATS;
export const RECORDING_EXTENSIONS = Object.keys(RECORDING_FORMATS) as RecordingFormat[];
export const RECORDING_ACCEPT = RECORDING_EXTENSIONS.map((e) => `.${e}`).join(",");

const ascii = (b: Uint8Array, start: number, length: number) => String.fromCharCode(...b.subarray(start, start + length));

/** Audio container detected from the first bytes, or null. */
export function sniffAudio(b: Uint8Array): RecordingFormat | null {
  if (b.length < 12) return null;
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav";
  if (ascii(b, 0, 4) === "OggS") return "ogg";
  if (ascii(b, 4, 4) === "ftyp") return "m4a";
  if (ascii(b, 0, 3) === "ID3") return "mp3";
  if (ascii(b, 0, 4) === "ADIF") return "aac";
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) {
    const layer = (b[1] >> 1) & 0x03;
    // ADTS AAC uses MPEG layer bits 00; MP3 frames use a non-zero layer.
    return layer === 0 ? "aac" : "mp3";
  }
  return null;
}

export function extensionOf(name: string) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** Base name only, without control characters, at most 200 characters. */
export function cleanFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "recording";
  if (cleaned.length <= 200) return cleaned;
  const ext = extensionOf(cleaned);
  return ext ? `${cleaned.slice(0, 199 - ext.length)}.${ext}` : cleaned.slice(0, 200);
}

/** Whether the content matches the name: an MP3 file may be named .mp3 only, and so on. */
export function formatMatchesExtension(format: RecordingFormat, ext: string) {
  return format === ext;
}

/** Whole seconds, or null when blank or out of range. */
export function parseDuration(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_DURATION_SEC) return null;
  return Math.round(n);
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatClock(sec: number | null) {
  if (sec === null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
