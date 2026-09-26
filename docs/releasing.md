# GitHub and npm releases

The target repository is `https://github.com/uselessworks-lab/3mfiy`, matching svgify's organization. The npm package name is `@uselessworks/3mfiy`. Repository metadata is configured for that destination; creating/pushing the GitHub repository and publishing to npm are separate maintainer actions.

## Package boundaries

| Location             | Purpose                                           | Registry publication    |
| -------------------- | ------------------------------------------------- | ----------------------- |
| repository root      | Git-install package, exposing `package/core/dist` | private; do not publish |
| `package/core`       | library, exposing `dist`                          | public MIT package      |
| `app/cli`, `app/web` | local examples/tools                              | private                 |

Both library manifests expose `.` and `./bambu`, ship TypeScript declarations/source maps and their source files, and declare `fflate`/`saxes` as runtime dependencies. Git installation needs the root `prepare` build. The npm-core archive already contains built JavaScript; consumers do not need TypeScript to use it.

The [`files` allowlist](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#files) controls archive contents. The [`prepare` lifecycle](https://docs.npmjs.com/cli/v11/using-npm/scripts/#prepare-and-prepublish) builds Git dependencies before installation. Keep the root and core names, versions, runtime dependencies, and export targets aligned.

## First GitHub upload

Create an empty public GitHub repository named `uselessworks-lab/3mfiy` without generating another README or license. In this checkout, `main` and `origin` are initialized. Review the source files before the first commit:

```sh
git status --short
git add .
git commit -m "Initial 3mfiy library"
git push -u origin main
```

CI runs on `main` pushes and pull requests. It checks Node.js 22 and 24, installs `xmllint`, and runs Chromium/Worker verification. The workflow does not publish packages or deploy the web example.

After upload, consumers can install:

```sh
npm install git+https://github.com/uselessworks-lab/3mfiy.git#main
```

Use a release tag or commit SHA in applications that need reproducible dependencies. After changing `prepare` or workspace layout, repeat a real Git dependency installation from a clean source revision; packing from a checkout with existing builds alone does not verify that path.

## Prepare a release

1. Update the version together in the root and core manifests, both app manifests, and their core dependency versions. Update `CHANGELOG.md` with the release scope and remaining support limits.
2. Refresh and commit `package-lock.json` using `npm install --package-lock-only --ignore-scripts`.
3. From a clean checkout, run:

   ```sh
   npm ci
   npm run verify
   npx playwright install chromium
   npm run test:browser
   npm run pack:core
   npm run pack:git
   ```

   `pack:core` writes the registry archive to `artifacts/npm/`; `pack:git` writes the Git-root archive to `artifacts/git/`. The existing package-consumer test packs them into separate temporary directories and checks runtime imports, both export paths, TypeScript NodeNext/Bundler resolution, and browser bundling.

4. Review the npm archive file list with `npm pack --workspace=package/core --dry-run`. Confirm the repository URL, MIT license, declarations, and current support documentation. Keep fixture/license attribution in the Git repository; test fixtures are not shipped as runtime library files.
5. Commit the release and create a matching tag such as `v0.1.0`. Push the commit/tag and check CI.

## Publish the core package

Use an npm account authorized to publish to `@uselessworks`. Authenticate according to your account's current npm requirements, then run from the repository root:

```sh
npm publish --workspace=package/core --access public
```

This is the actual publication step. Do not publish the private root or the apps. The core's `prepack` builds it before the archive is uploaded.

After publication, verify the registry version and install it in a separate consumer:

```sh
npm view @uselessworks/3mfiy version
npm install @uselessworks/3mfiy
```

Create GitHub release notes from the changelog and update the README's publication status. Publishing is manual; no token, registry login, or automatic publishing workflow is stored in this repository.
