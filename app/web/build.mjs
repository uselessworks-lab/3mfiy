import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir(new URL("./dist/", import.meta.url), { recursive: true });
await build({
  entryPoints: [new URL("./main.ts", import.meta.url).pathname],
  outfile: new URL("./dist/main.js", import.meta.url).pathname,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
await copyFile(
  new URL("./index.html", import.meta.url),
  new URL("./dist/index.html", import.meta.url),
);
