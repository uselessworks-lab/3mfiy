import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildSync } from "esbuild";
test("root package exposes the typed API and CLI consumes library bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "3mfiy-package-"));
  try {
    {
      const packDir = join(dir, "package");
      mkdirSync(packDir);
      const [pack] = JSON.parse(
        execFileSync(
          "npm",
          [
            "pack",
            "--cache",
            join(dir, "cache"),
            "--workspaces=false",
            "--pack-destination",
            packDir,
            "--json",
          ],
          { encoding: "utf8" },
        ),
      );
      const names = pack.files.map((f) => f.path);
      for (const path of [
        "dist/index.js",
        "dist/index.d.ts",
        "dist/adapters/bambu.js",
        "dist/adapters/bambu.d.ts",
        "README.md",
        "LICENSE",
      ])
        assert.ok(names.includes(path), `package: ${path}`);
      assert.ok(
        !names.some(
          (path) =>
            path.startsWith("node_modules/") ||
            path.startsWith("app/") ||
            path.startsWith("tests/"),
        ),
      );
      const consumer = join(packDir, "consumer");
      mkdirSync(consumer);
      writeFileSync(
        join(consumer, "package.json"),
        JSON.stringify({
          name: "3mfiy-consumer",
          private: true,
          type: "module",
        }),
      );
      // Install the actual packed library and offline copies of its exact runtime dependencies.
      execFileSync(
        "npm",
        [
          "install",
          "--prefix",
          consumer,
          "--cache",
          join(dir, "cache"),
          "--offline",
          "--ignore-scripts",
          "--install-links",
          "--no-audit",
          "--no-fund",
          join(packDir, pack.filename),
          ...["fflate", "saxes", "xmlchars"].map((name) =>
            join(process.cwd(), "node_modules", name),
          ),
        ],
        { encoding: "utf8" },
      );
      const code = `import {ThreeMFDocument,ThreeMFBuilder,ThreeMFUnit,MeshGeometry,MeshResource} from '@uselessworks/3mfiy';
import {BambuStudioProject,BambuProfile,BambuPlate,BambuPresetKind} from '@uselessworks/3mfiy/bambu';
const geometry=new MeshGeometry([0,0,0,1,0,0,0,1,0,0,0,1],[0,2,1,0,1,3,0,3,2,1,2,3]);
const object={parts:[{mesh:geometry}]};
const builder=new ThreeMFBuilder({unit:ThreeMFUnit.Millimeter}).addObject(object);
const first=builder.build();
const second=builder.addObject(object).build();
first.document.assertValid({topology:true});second.document.assertValid({topology:true});
if(first.objects.length!==1||first.document.rootModel.buildItems.length!==1||second.objects.length!==2)throw Error('Reusing builder changed earlier output');
const mesh=first.document.rootModel.requireResource(first.objects[0].partIds[0]);
if(!(mesh instanceof MeshResource))throw Error('Mesh not restored as domain object');
mesh.setName('Owned mesh');
const snapshot=first.document.toData();const snapshotResource=snapshot.models[0].resources[0];if(snapshotResource.kind==='object')snapshotResource.name='Outside edit';
if(mesh.name!=='Owned mesh')throw Error('Snapshot aliases state');
const project=new BambuStudioProject(first.document,{applicationVersion:'2.0.0',profile:BambuProfile.fromFilaments([{settingsId:'PLA',color:'#FFFFFF'}])});
project.addPlate(new BambuPlate(1).addInstance({objectId:first.objects[0].objectId,instanceId:0,identifyId:1}));
project.setObjectSettings({objectId:first.objects[0].objectId,extruder:1});
const reread=ThreeMFDocument.read(project.write());
if(BambuStudioProject.inspect(reread).plates.length!==1||BambuPresetKind.Filament!=='filament')throw Error('Packed Bambu objects failed');
if(ThreeMFDocument.read(second.document.write()).rootModel.buildItems.length!==2)throw Error('Packed core objects failed');`;

      writeFileSync(join(consumer, "consumer.mjs"), code);
      execFileSync(process.execPath, [join(consumer, "consumer.mjs")], {
        cwd: consumer,
        encoding: "utf8",
      });
      writeFileSync(
        join(consumer, "consumer.ts"),
        code +
          `\nimport type {ObjectResourceData, TransformData} from '@uselessworks/3mfiy';
// @ts-expect-error A transform needs exactly twelve numbers.
const badTransform: TransformData = [1, 2, 3];
// @ts-expect-error Mesh and components are mutually exclusive.
const invalidObject: ObjectResourceData = {kind:'object',id:1,mesh:{positions:[],indices:[]},components:[]};
// @ts-expect-error Unit must be a 3MF wire value, even with string interoperability.
new ThreeMFBuilder({unit:'kilometer'});
// @ts-expect-error Authoring takes an owned geometry object, not a plain DTO.
new ThreeMFBuilder().addObject({parts:[{mesh:{positions:[],indices:[]}}]});
// @ts-expect-error Resource identity cannot be reassigned through the public API.
mesh.id=100;
class TaggedMesh extends MeshResource { tag(): string { return 'tag'; } }
const cloned=first.document.rootModel.addResource(new TaggedMesh(first.document.rootModel.nextResourceId(), geometry));
// @ts-expect-error Inherited clone returns MeshResource, not arbitrary TaggedMesh.
cloned.tag();
void badTransform;void invalidObject;`,
      );
      const tsc = join(process.cwd(), "node_modules/typescript/bin/tsc");
      for (const resolution of ["NodeNext", "Bundler"])
        execFileSync(
          process.execPath,
          [
            tsc,
            "--noEmit",
            "--strict",
            "--target",
            "ES2022",
            "--lib",
            "ES2022",
            "--skipLibCheck",
            "--module",
            resolution === "NodeNext" ? "NodeNext" : "ESNext",
            "--moduleResolution",
            resolution,
            "consumer.ts",
          ],
          { cwd: consumer, encoding: "utf8" },
        );
      const bundled = buildSync({
        entryPoints: [join(consumer, "consumer.mjs")],
        platform: "browser",
        bundle: true,
        write: false,
        format: "esm",
      });
      assert.ok(bundled.outputFiles[0].contents.length > 0);
    }
    const out = join(dir, "example.3mf");
    execFileSync(process.execPath, ["examples/node.mjs", out]);
    assert.ok(readFileSync(out).length > 0);
    const inspection = JSON.parse(
      execFileSync(
        process.execPath,
        ["app/cli/dist/main.js", "validate", out, "--topology"],
        { encoding: "utf8" },
      ),
    );
    assert.equal(inspection.models.length, 1);
    assert.deepEqual(inspection.diagnostics, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
