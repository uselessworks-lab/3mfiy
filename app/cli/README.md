# 3mfiy CLI

Local development tool for inspecting and validating 3MF files through the public core API. This workspace is private and is not a separately published npm package.

From the repository root:

```sh
npm ci
npm run build
npm run cli -- inspect path/to/model.3mf
npm run cli -- validate path/to/model.3mf --topology
```

Output is JSON. Invalid input produces an error and a nonzero exit status. The CLI does not generate geometry, slice models, or submit prints. See the [library README](../../package/core/README.md) for document authoring.

Licensed under [MIT](../../LICENSE).
