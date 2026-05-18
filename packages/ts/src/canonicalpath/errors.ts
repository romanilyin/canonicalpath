export type ErrorCode =
  | "ERR_ABSOLUTE_PATH"
  | "ERR_ALTERNATE_DATA_STREAM"
  | "ERR_DRIVE_RELATIVE_PATH"
  | "ERR_EMPTY_PATH"
  | "ERR_ENCODED_SEPARATOR"
  | "ERR_INVALID_COMPONENT"
  | "ERR_INVALID_PATH"
  | "ERR_INVALID_PERCENT_ENCODING"
  | "ERR_INVALID_URI"
  | "ERR_NUL_BYTE"
  | "ERR_OUTSIDE_ROOT"
  | "ERR_RESERVED_DEVICE_NAME"
  | "ERR_UNSUPPORTED_URI_SCHEME";

export class CanonicalPathError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "CanonicalPathError";
    this.code = code;
  }
}

export function pathError(code: ErrorCode, message: string): CanonicalPathError {
  return new CanonicalPathError(code, message);
}

export function errorCode(error: unknown): string {
  if (error instanceof CanonicalPathError) return error.code;
  if (error instanceof Error) return error.message;
  return String(error);
}
