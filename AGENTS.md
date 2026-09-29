# 3mfiy development

3mfiy creates and controls 3MF documents for 3D-printing model generators such as Formify and Flexify. Read README.md and docs/architecture.md before changing public contracts.

- Keep the object-oriented public API: document → model → resources; Bambu authoring is a separate package entrypoint. Do not restore standalone function exports.
- Core must run in Node.js, browsers, and Workers without Node filesystem or DOM dependencies. Apps consume only the public package API.
- Preserve snapshot ownership, numeric precision, resource identity, and explicit errors for unsupported model XML. Keep printer profiles and placement decisions caller-owned.
- The repository root is the sole library package. Keep its Git-install and packed entrypoints equivalent. Do not add machine-local sibling dependencies.
- Update API documentation and the standard/vendor support matrices when behavior changes. Focus tests on invariants and real regressions; do not add implementation-mirroring tests.
- Use npm run verify for code/packaging changes and npm run test:browser for runtime changes. XML schema checks require xmllint. Generated files belong in ignored dist/, artifacts/, or .runtime/.
- Record actual slicer validation separately; a valid 3MF or mesh does not guarantee a successful physical print.
- The project uses MIT. Preserve upstream license notices for third-party fixtures. Publishing remains an explicit release action.
