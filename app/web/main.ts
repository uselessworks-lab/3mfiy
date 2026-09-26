import { ThreeMFDocument, MeshGeometry } from "@uselessworks/3mfiy";
const output = document.querySelector<HTMLPreElement>("#output")!;
document.querySelector("#create")!.addEventListener("click", () => {
  const { document: model } = ThreeMFDocument.create3mf([
    {
      name: "Browser example",
      parts: [
        {
          mesh: new MeshGeometry(
            [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10],
            [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
          ),
          color: "#F08040",
        },
      ],
    },
  ]);
  const bytes = model.write(),
    blob = new Blob([new Uint8Array(bytes)], { type: "model/3mf" }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "example.3mf";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document
  .querySelector<HTMLInputElement>("#file")!
  .addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const model = ThreeMFDocument.read(await file.arrayBuffer());
      output.textContent = JSON.stringify(
        {
          root: model.rootPath,
          models: model.models.map((m) => ({
            path: m.path,
            resources: m.resources.length,
            buildItems: m.buildItems.length,
          })),
          diagnostics: model.validate(),
        },
        null,
        2,
      );
    } catch (error) {
      output.textContent = String(error);
    }
  });
