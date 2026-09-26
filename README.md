# 3mfiy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[API documentation](package/core/README.md) · [3MF support](docs/spec-support.md) · [Bambu Studio support](docs/bambu-support.md)

3mfiy creates, reads, and edits 3MF files for 3D printing. It helps model generators such as **Formify** and **Flexify** package meshes, parts, materials, and placements into a single `.3mf` file for a slicer.

Use it to export generated models, inspect existing files, or update their contents before saving. It runs in Node.js, browsers, and Web Workers. Bambu Studio support adds plates, filament assignments, printer and print settings, embedded presets, and thumbnails.

```text
Model generator → meshes and parts → 3mfiy → .3mf → slicer → printer
```

Your application supplies the geometry, placements, and printer profiles. A slicer prepares the resulting file for printing.

## Features

- Create and edit meshes, component assemblies, materials, colors, and textures
- Position multiple parts and instances with transforms
- Read, inspect, validate, and save 3MF documents
- Build Bambu Studio projects with multiple plates, filament settings, embedded presets, and PNG thumbnails
- Use the same API in Node.js, browsers, and Web Workers, with TypeScript declarations included

Core, Materials, and Production support is **partial**. The [3MF support matrix](docs/spec-support.md) and [Bambu Studio support matrix](docs/bambu-support.md) list supported features and limitations, including restrictions on editing sliced projects. File validation does not replace checking the result in a slicer or verifying printability.

## Installation

### From GitHub

Install directly from GitHub:

```sh
npm install git+https://github.com/uselessworks-lab/3mfiy.git
```

Or declare a Git dependency:

```json
{
  "dependencies": {
    "@uselessworks/3mfiy": "git+https://github.com/uselessworks-lab/3mfiy.git#main"
  }
}
```

Pin a commit SHA or a release tag instead of `main` for reproducible builds. Git installation runs the core TypeScript build through `prepare`; use **Node.js 22+** with npm lifecycle scripts enabled.

### From the npm registry

The package is being prepared for its first npm release. After publication:

```sh
npm install @uselessworks/3mfiy
```

Both installation paths expose the same API and runtime dependencies. For local package testing before publication, run `npm run pack:core` and install the archive in `artifacts/npm/`.

## Create a 3MF document

```ts
import {
  ThreeMFDocument,
  MeshGeometry,
  ThreeMFUnit,
} from "@uselessworks/3mfiy";

const geometry = new MeshGeometry(
  [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10],
  [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
);
const { document } = ThreeMFDocument.create3mf(
  [{ name: "Generated part", parts: [{ mesh: geometry, color: "#F08040" }] }],
  { unit: ThreeMFUnit.Millimeter },
);

const bytes = document.write({ validation: { topology: true } });
const reopened = ThreeMFDocument.read(bytes);
console.log(reopened.rootModel.objects);
```

Save in Node.js:

```ts
import { writeFile } from "node:fs/promises";
await writeFile("generated-part.3mf", bytes);
```

In a browser, wrap the bytes in a `Blob` for your application's download flow:

```ts
const blob = new Blob([new Uint8Array(bytes)], { type: "model/3mf" });
```

Use `ThreeMFBuilder` to add parts incrementally. See the [API documentation](package/core/README.md) for editing models, assigning materials, applying transforms, and creating Bambu Studio projects. The [integration guide](docs/migration.md) describes how to connect model generator output to 3mfiy.

## Repository layout

```text
package/core/  publishable @uselessworks/3mfiy library
app/cli/       private inspection/validation CLI
app/web/       private browser example
examples/      executable consumer examples
tests/         format, ownership, conformance, and package-consumer checks
tools/         browser/Worker integration tooling
docs/          architecture, support matrices, migration, and release guide
.github/       CI and contribution templates
```

The repository root supports installation from Git; `package/core` is the npm package. The CLI and browser app are development tools and examples.

## Development

```sh
npm ci
npm run verify
npx playwright install chromium
npm run test:browser
node examples/node.mjs /tmp/example.3mf
npm run cli -- inspect /tmp/example.3mf
```

Node.js 22+ is required. The XML schema check uses `xmllint` (`libxml2-utils` on Ubuntu); CI installs it explicitly. Generated builds and package archives are ignored by Git.

See [Contributing](CONTRIBUTING.md), [Architecture](docs/architecture.md), [Release instructions](docs/releasing.md), and the [Changelog](CHANGELOG.md).

## License

3mfiy is licensed under the [MIT License](LICENSE). Third-party test fixtures retain their own notices in [tests/fixtures](tests/fixtures/README.md).
