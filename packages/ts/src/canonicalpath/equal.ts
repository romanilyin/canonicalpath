import { normalize } from "./normalize.js";
import type { NormalizeOptions } from "./types.js";

export function isEqual(left: string, right: string, options: NormalizeOptions = {}): boolean {
  return normalize(left, options) === normalize(right, options);
}
