/**
 * Lead document rules (FR-038; SECURITY_AND_PRIVACY.md §6): PDF, JPG, PNG, DOCX, XLSX; at most
 * 10 MB. The content is checked, not just the name: Office files must be the matching OOXML package.
 */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const DOCUMENT_FORMATS = {
  pdf: { mime: "application/pdf", label: "PDF", inline: false },
  jpg: { mime: "image/jpeg", label: "JPG", inline: true },
  png: { mime: "image/png", label: "PNG", inline: true },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "DOCX", inline: false },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "XLSX", inline: false },
} as const;
export type DocumentFormat = keyof typeof DOCUMENT_FORMATS;
export const DOCUMENT_EXTENSIONS = Object.keys(DOCUMENT_FORMATS) as DocumentFormat[];
/** `.jpeg` is the same JPEG format as the documented `.jpg`. */
export const EXTENSION_ALIASES: Record<string, DocumentFormat> = { jpeg: "jpg" };
export const DOCUMENT_ACCEPT = [...DOCUMENT_EXTENSIONS, ...Object.keys(EXTENSION_ALIASES)].map((e) => `.${e}`).join(",");

const ascii = (b: Uint8Array, start: number, length: number) => String.fromCharCode(...b.subarray(start, start + length));

/** Whether `needle` occurs in the bytes (OOXML part names are stored as plain text in the ZIP). */
function contains(b: Uint8Array, needle: string) {
  const n = [...needle].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= b.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (b[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

/** Document format detected from the content, or null. */
export function sniffDocument(b: Uint8Array): DocumentFormat | null {
  if (b.length < 8) return null;
  if (ascii(b, 0, 5) === "%PDF-") return "pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) return "png";
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 && contains(b, "[Content_Types].xml")) {
    if (contains(b, "word/document.xml")) return "docx";
    if (contains(b, "xl/workbook.xml")) return "xlsx";
  }
  return null;
}

/** The documented format for an extension (with the .jpeg alias), or null. */
export function documentFormatOf(ext: string): DocumentFormat | null {
  if ((DOCUMENT_EXTENSIONS as string[]).includes(ext)) return ext as DocumentFormat;
  return EXTENSION_ALIASES[ext] ?? null;
}
