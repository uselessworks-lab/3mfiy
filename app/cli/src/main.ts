#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { ThreeMFDocument, ThreeMFError } from "@uselessworks/3mfiy";
const [command, path, ...flags] = process.argv.slice(2);
if (
  !["inspect", "validate"].includes(command ?? "") ||
  !path ||
  flags.some((f) => f !== "--topology")
) {
  console.error("Usage: 3mfiy <inspect|validate> <file.3mf> [--topology]");
  process.exitCode = 2;
} else {
  try {
    const document = ThreeMFDocument.read(await readFile(path), {
      validation: { topology: flags.includes("--topology") },
    });
    console.log(
      JSON.stringify(
        {
          root: document.rootPath,
          models: document.models.map((m) => ({
            path: m.path,
            unit: m.unit ?? "millimeter",
            resources: m.resources.length,
            buildItems: m.buildItems.length,
            requiredExtensions: m.toData().requiredExtensions ?? [],
          })),
          attachments: document.attachments?.map((a) => ({
            path: a.path,
            contentType: a.contentType,
            bytes: a.data.length,
          })),
          diagnostics: document.validate({
            topology: flags.includes("--topology"),
          }),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      error instanceof ThreeMFError
        ? JSON.stringify(
            {
              code: error.code,
              message: error.message,
              diagnostics: error.diagnostics,
            },
            null,
            2,
          )
        : String(error),
    );
    process.exitCode = 1;
  }
}
