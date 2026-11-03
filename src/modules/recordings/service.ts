import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { assertCanUploadTo, hideLeadFile, listLeadFiles, openLeadFile, saveLeadFile, type LeadFileRow } from "@/modules/files/lead-files";
import {
  cleanFileName,
  extensionOf,
  formatMatchesExtension,
  MAX_RECORDING_BYTES,
  parseDuration,
  RECORDING_EXTENSIONS,
  RECORDING_FORMATS,
  sniffAudio,
  type RecordingFormat,
} from "./validation";

const fileError = (message: string) => new AppError("VALIDATION_FAILED", message, { fields: { file: message } });

/**
 * Call recordings on leads (FR-038). Who may upload and play follows the lead rules
 * (see `modules/files/lead-files.ts`); the content must be an allowed audio format.
 */
export async function uploadRecording(
  db: Database,
  actor: Actor,
  leadId: string,
  input: { bytes: Uint8Array; name: string; durationSec?: unknown },
) {
  await assertCanUploadTo(db, actor, leadId);
  const name = cleanFileName(input.name);
  const ext = extensionOf(name);
  if (input.bytes.byteLength === 0) throw fileError("The file is empty.");
  if (input.bytes.byteLength > MAX_RECORDING_BYTES) throw fileError("Recordings can be at most 25 MB.");
  if (!(RECORDING_EXTENSIONS as string[]).includes(ext)) throw fileError("Upload an MP3, M4A, AAC, OGG or WAV recording.");
  const format = sniffAudio(input.bytes);
  if (!format || !formatMatchesExtension(format, ext)) throw fileError("The file content is not a valid recording of that type.");
  return saveLeadFile(db, actor, leadId, {
    kind: "call_recording",
    bytes: input.bytes,
    name,
    ext,
    mime: RECORDING_FORMATS[format as RecordingFormat].mime,
    durationSec: parseDuration(input.durationSec),
    auditAction: "lead.recording_upload",
  });
}

export const listRecordings = (db: Database, actor: Actor, leadId: string) => listLeadFiles(db, actor, leadId, "call_recording");
export type RecordingRow = LeadFileRow;

export const openRecording = (db: Database, actor: Actor, fileId: string) => openLeadFile(db, actor, fileId, "call_recording");

/** Super Admin only (Q53). Hides the recording; the audio file is kept pending C-33. */
export function deleteRecording(db: Database, actor: Actor, fileId: string) {
  return hideLeadFile(db, actor, fileId, "call_recording");
}
