# GitHub and npm releases

The repository root is the `@uselessworks/3mfiy` library package. TypeScript source lives in `package/`; `prepare` compiles JavaScript and declarations into the ignored root `dist/`. Git installation and the root npm archive use the same `.` and `./bambu` exports. `app/cli` and `app/web` are development workspaces and are excluded from the library archive.

The root manifest remains private while registry publication is unapproved. Git installation is supported; npm publication is a separate director-approved release action.

## Git installation

```sh
npm install git+https://github.com/uselessworks-lab/3mfiy.git#main
```

Pin a release tag or commit SHA for reproducible builds. Git installation runs `prepare`, so Node.js 22+ and npm lifecycle scripts are required. After changing this lifecycle or the workspace layout, verify a Git dependency installation from a clean revision; an existing local build alone does not prove it.

## Prepare a release

1. Update the root version and the app versions and dependencies. Update `CHANGELOG.md` with the release scope and support limits.
2. Refresh and commit `package-lock.json` with `npm install --package-lock-only --ignore-scripts`.
3. From a clean checkout, run the required release checks: `npm ci`, `npm run verify`, and `npm run test:browser` with Chromium installed. CI also checks Node.js 22 and 24 and installs `xmllint` for XML schema validation.
4. Inspect the root archive with `npm pack --workspaces=false --dry-run`. Confirm it includes `dist/`, `package/`, README, license, and both entrypoints, while excluding apps and tests. The package-consumer test installs the archive and checks runtime imports, TypeScript resolution, and browser bundling.
5. Commit the release, create a matching tag, push both, and check CI.

No release or publication is performed by this document.

## Publish to npm

With the director's explicit approval and an authorized npm account, remove `private: true` from the root manifest as part of the reviewed release commit, then run `npm publish --access public` from the repository root. The `prepare` lifecycle builds `dist/` before packing. Verify the registry version and install it in a separate consumer after publication.

The CLI package has its own manifest; publishing it, if desired, is a separate decision. No token, registry login, or automatic publishing workflow is stored here.
