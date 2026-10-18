# Contributing to 3mfiy

3mfiy helps 3D-printing model generators create, inspect, edit, and save 3MF documents. Contributions to file-format support, the object-oriented API, interoperability, and documentation are welcome.

## Local setup

Use Node.js 22+ and npm. No sibling repositories or credentials are needed.

```sh
npm ci
npm run verify
npx playwright install chromium
npm run test:browser
```

`npm ci` builds the core through `prepare`. `verify` type-checks the workspaces, builds the apps, and runs the existing correctness, conformance, and package-consumer checks. Install `xmllint` (`libxml2-utils` on Ubuntu) to run the schema check; that check is skipped locally when the tool is absent. CI installs it explicitly.

## Design and changes

Keep format behavior in `package`, with the public OOP contracts described in [Architecture](docs/architecture.md). Applications consume the public package API. Bambu-specific configuration stays in the `@uselessworks/3mfiy/bambu` entrypoint. Printer settings, filament profiles, placement, and geometry generation belong to the caller.

For a bug, provide the smallest reproducer and a meaningful regression check. Tests should protect user-visible behavior or an invariant; test counts and class/method existence are not goals. For a format extension, include its specification reference and update [3MF support](docs/spec-support.md) and, where relevant, [Bambu support](docs/bambu-support.md). Unsupported data must not disappear silently.

Generated `dist/`, package archives, downloads, and artifacts are ignored. Keep `package-lock.json` in source control. For packaging changes, check the root package archive and its Git-install entrypoints.

Describe the problem, the final behavior, relevant checks, and compatibility effects in pull requests. Write README files in English.

## License

Contributions are provided under this project's [MIT license](LICENSE). Keep the original notices for third-party fixtures; their origin and license are recorded in [tests/fixtures/README.md](tests/fixtures/README.md).
