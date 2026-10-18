import type { Diagnostic } from "./model/types.js";
export class ThreeMFError extends Error {
  readonly code: string;
  readonly diagnostics: readonly Diagnostic[];
  constructor(
    code: string,
    message: string,
    diagnostics: readonly Diagnostic[] = [],
  ) {
    super(message);
    this.name = "ThreeMFError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}
export function fail(code: string, message: string): never {
  throw new ThreeMFError(code, message);
}
