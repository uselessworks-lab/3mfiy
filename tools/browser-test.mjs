import { build } from "esbuild";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
const cache = homedir() + "/Library/Caches/ms-playwright";
const cached = existsSync(cache)
  ? readdirSync(cache)
      .filter((n) => n.startsWith("chromium-"))
      .map(
        (n) =>
          `${cache}/${n}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
      )
      .find(existsSync)
  : undefined;
const { outputFiles } = await build({
  stdin: {
    contents: `import {ThreeMFDocument,ThreeMFBuilder,MeshGeometry,ThreeMFUnit} from './dist/index.js';
import {BambuStudioProject,BambuProfile,BambuPlate} from './dist/adapters/bambu.js';
export function exercise(){
 if(typeof process!=='undefined'||typeof Buffer!=='undefined')throw Error('Unexpected Node globals');
 const geometry=new MeshGeometry([0,0,0,1,0,0,0,1,0,0,0,1],[0,2,1,0,1,3,0,3,2,1,2,3]);
 const {document,objects}=new ThreeMFBuilder({meshPath:'/3D/mesh.model',unit:ThreeMFUnit.Millimeter}).addObject({parts:[{mesh:geometry,color:'#123456'}]}).build();
 const profile=BambuProfile.fromFilaments([{settingsId:'Browser PLA',color:'#123456'}]);
 const project=new BambuStudioProject(document,{applicationVersion:'2.0.0',profile});
 project.setObjectSettings({objectId:objects[0].objectId,parts:[{objectId:objects[0].partIds[0],extruder:1}]});
 project.addPlate(new BambuPlate(1).addInstance({objectId:objects[0].objectId,instanceId:0,identifyId:1}));
 const bytes=project.write(); const parsed=ThreeMFDocument.read(bytes);
 const inspection=BambuStudioProject.inspect(parsed);
 if(inspection.profile.toData().filament_settings_id[0]!=='Browser PLA'||inspection.plates.length!==1)throw Error('Bambu browser roundtrip');
 const restored=ThreeMFDocument.fromData(structuredClone(parsed.toData()));
 restored.assertValid();
 return {models:restored.models.length,bytes:bytes.length,blob:new Blob([bytes]).size};
}`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "iife",
  globalName: "ThreeMFTest",
  platform: "browser",
  write: false,
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : cached
      ? { executablePath: cached }
      : {}),
});
try {
  const page = await browser.newPage();
  await page.route("https://3mfiy.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>3mfiy test</title>",
    }),
  );
  await page.goto("https://3mfiy.test/");
  await page.addScriptTag({ content: outputFiles[0].text });
  const result = await page.evaluate(() => ThreeMFTest.exercise());
  assert.equal(result.models, 2);
  assert.equal(result.bytes, result.blob);
  const worker = await page.evaluate(
    (code) =>
      new Promise((resolve, reject) => {
        const url = URL.createObjectURL(
          new Blob(
            [
              code +
                ";self.onmessage=()=>{try{postMessage(ThreeMFTest.exercise())}catch(e){postMessage({error:String(e)})}}",
            ],
            { type: "text/javascript" },
          ),
        );
        const worker = new Worker(url);
        worker.onmessage = (e) => {
          resolve(e.data);
          worker.terminate();
          URL.revokeObjectURL(url);
        };
        worker.onerror = reject;
        worker.postMessage(null);
      }),
    outputFiles[0].text,
  );
  assert.equal(worker.models, 2, worker.error);
  console.log(
    "Chromium browser and Web Worker read/write passed",
    result,
    worker,
  );
} finally {
  await browser.close();
}
