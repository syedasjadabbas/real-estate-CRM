/** Call results offered on the lead page's "Update after call" card (owner, 14 Nov 2026). */
export const CALL_RESULTS = ["talked", "no_answer", "busy", "switched_off", "wrong_number", "no_call"] as const;
export type CallResult = (typeof CALL_RESULTS)[number];
export const CALL_RESULT_LABELS: Record<CallResult, string> = {
  talked: "Talked",
  no_answer: "No answer",
  busy: "Busy",
  switched_off: "Switched off",
  wrong_number: "Wrong number",
  /** Stage, note, meeting or follow-up without a call (the card replaced the separate forms). */
  no_call: "No call (update only)",
};
