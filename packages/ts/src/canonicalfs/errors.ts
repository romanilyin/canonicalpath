export type CanonicalFSErrorCode =
  | "ERR_ABSOLUTE_PATH"
  | "ERR_ARCHIVE_TRAVERSAL"
  | "ERR_DAEMON"
  | "ERR_DRIVE_RELATIVE_PATH"
  | "ERR_NUL_BYTE"
  | "ERR_OUTSIDE_ROOT"
  | "ERR_RACE_DETECTED"
  | "ERR_READ_LIMIT_EXCEEDED"
  | "ERR_REQUEST_TOO_LARGE"
  | "ERR_RESPONSE_TOO_LARGE"
  | "ERR_ROOT_NOT_ALLOWED"
  | "ERR_UNAUTHORIZED"
  | "ERR_UNSUPPORTED_OPERATION"
  | "ERR_SYMLINK_ESCAPE";

export class CanonicalFSError extends Error {
  readonly code: CanonicalFSErrorCode;

  constructor(code: CanonicalFSErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "CanonicalFSError";
    this.code = code;
  }
}

export function fsError(code: CanonicalFSErrorCode, message: string): CanonicalFSError {
  return new CanonicalFSError(code, message);
}

export function fsErrorCode(error: unknown): string {
  if (error instanceof CanonicalFSError) return error.code;
  if (error instanceof Error) return error.message;
  return String(error);
}
