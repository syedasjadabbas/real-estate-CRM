export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUSINESS_RULE"
  | "RATE_LIMITED";

const statusByCode: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BUSINESS_RULE: 422,
  RATE_LIMITED: 429,
};

/** Expected, user-facing failure. Anything else is treated as an internal error. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options: { fields?: Record<string, string>; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.fields = options.fields;
    this.details = options.details;
  }

  get status() {
    return statusByCode[this.code];
  }
}

export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const forbidden = (message = "You do not have permission to do that.") => new AppError("FORBIDDEN", message);

/** Serializable result returned from server actions. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ErrorCode | "INTERNAL";
      message: string;
      fields?: Record<string, string>;
      details?: Record<string, unknown>;
    };

export function toActionError(error: unknown): Extract<ActionResult, { ok: false }> {
  if (error instanceof AppError) {
    return { ok: false, code: error.code, message: error.message, fields: error.fields, details: error.details };
  }
  console.error(error);
  return { ok: false, code: "INTERNAL", message: "Something went wrong. Please try again." };
}
