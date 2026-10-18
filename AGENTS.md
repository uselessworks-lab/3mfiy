# 3mfiy

Before work, read and follow `../useless.works/handbook/AGENTS.md` from the sibling checkout. This repository does not mount handbook; this file contains only 3mfiy-specific instructions.

## Product boundary

3mfiy creates and controls 3MF documents for model generators. Read `README.md` and `docs/architecture.md` before changing public contracts.

- Preserve the object-oriented API: document → model → resources. Bambu authoring is a separate package entrypoint; do not restore standalone function exports.
- Core runs in Node.js, browsers, and Workers without Node filesystem or DOM dependencies. Apps use only the public package API.
- Preserve snapshot ownership, numeric precision, resource identity, and explicit errors for unsupported model XML. Printer profiles and placement decisions remain caller-owned.
- Keep Git-root and `package/core` npm entrypoints equivalent, including runtime dependencies in both manifests. Do not add machine-local sibling package dependencies.
- Update the public API documentation and standard/vendor support matrices when behavior changes. Record actual slicer validation separately from 3MF or mesh checks. Preserve upstream license notices for third-party fixtures.

## Commands and outputs

- `npm run verify`: code and packaging CI/release gate; select focused checks during iteration under handbook's testing policy.
- `npm run test:browser`: browser-runtime gate when that runtime is affected or the release workflow requires it.
- XML schema checks require `xmllint`.
- `typecheck`, `cli`, `prepare`, and `prepack` are existing development and distribution entrypoints; see `docs/releasing.md` for release steps.

Generated files belong in ignored `dist/`, `artifacts/`, or `.runtime/`. Publishing is a separate release action.
