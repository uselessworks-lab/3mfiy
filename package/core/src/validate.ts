import { ThreeMFError } from "./errors.js";
import { ModelValidator } from "./model/validate.js";
import type { Diagnostic, Document, ValidationOptions } from "./model/types.js";
import {
  checkRelationships,
  documentRelationships,
} from "./opc/relationships.js";
/** Validates model semantics and OPC relationships as one reusable policy. */
export class DocumentValidator {
  constructor(private readonly options: ValidationOptions = {}) {}
  validate(document: Document): Diagnostic[] {
    const diagnostics = new ModelValidator(document, this.options).validate();
    try {
      checkRelationships(document, documentRelationships(document));
    } catch (error) {
      if (!(error instanceof ThreeMFError)) throw error;
      diagnostics.push({
        severity: "error",
        code: error.code,
        path: "/",
        message: error.message,
      });
    }
    return diagnostics;
  }
  assertValid(document: Document): Diagnostic[] {
    const diagnostics = this.validate(document);
    if (diagnostics.some((d) => d.severity === "error"))
      throw new ThreeMFError(
        "VALIDATION",
        diagnostics
          .filter((d) => d.severity === "error")
          .map((d) => `${d.path}: ${d.message}`)
          .join("\n"),
        diagnostics,
      );
    return diagnostics;
  }
}
/** Convenience façade for a single validation run. */
export function validateDocument(
  document: Document,
  options: ValidationOptions = {},
): Diagnostic[] {
  return new DocumentValidator(options).validate(document);
}
export function assertValidDocument(
  document: Document,
  options: ValidationOptions = {},
): Diagnostic[] {
  return new DocumentValidator(options).assertValid(document);
}
