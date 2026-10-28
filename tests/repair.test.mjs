import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {RepairArchive} from '../dist/repair.js';
const core='http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const prod='http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const relationship='http://schemas.openxmlformats.org/package/2006/relationships';
const modelRelationship='http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const vertices='<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices>';
const triangles='<triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles>';
function packageBytes(child,metadata='{"layer_height":0.12,"filament_colour":["#ff9900"]}'){
  const files={
    '[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels':strToU8(`<Relationships xmlns="${relationship}"><Relationship Id="root" Type="${modelRelationship}" Target="/3D/3dmodel.model"/></Relationships>`),
    '3D/3dmodel.model':strToU8(`<model xmlns="${core}" xmlns:p="${prod}" unit="centimeter" requiredextensions="p"><resources><object id="9"><components><component objectid="2" p:path="/3D/Objects/child.model" transform="1 0 0 0 1 0 0 0 1 2 0 0"/></components></object></resources><build><item objectid="9" transform="1 0 0 0 1 0 0 0 1 0 3 0"/></build></model>`),
    '3D/Objects/child.model':strToU8(child),
    'Metadata/project_settings.config':strToU8(metadata),
    'Metadata/thumbnail.png':new Uint8Array([0,15,222,81]),
    '3D/_rels/3dmodel.model.rels':strToU8(`<Relationships xmlns="${relationship}"><Relationship Id="part" Type="${modelRelationship}" Target="/3D/Objects/child.model"/></Relationships>`),
  };return zipSync(files);
}
function model(faces=triangles,extra=''){return `\uFEFF<?xml version="1.0"?><model xmlns="${core}" xmlns:v="urn:vendor" unit="centimeter"><metadata name="vendor">keep me</metadata><resources><object id="2" name="Part A" v:owner="custom"><mesh>${vertices}${faces}</mesh>${extra}</object></resources><build/></model>`;}

test('mesh-only patch retains other entries and surrounding XML while preserving units, identities and nested instances',()=>{
  const original=packageBytes(model()),archive=RepairArchive.read(original),mesh=archive.meshes[0];
  assert.equal(mesh.objectId,2);assert.equal(mesh.name,'Part A');assert.equal(mesh.unit,'centimeter');assert.equal(mesh.protectedTopology,false);
  assert.deepEqual(archive.instances,[{meshId:mesh.id,transform:[10,0,0,0,10,0,0,0,10,20,30,0]}]);
  assert.deepEqual(archive.patch([]),original,'no-op is byte identical');
  const replacement={id:mesh.id,positions:mesh.positions,indices:mesh.indices.slice(0,-3)};
  archive.assertPatch([replacement]);const repaired=archive.patch([replacement]);
  const before=unzipSync(original),after=unzipSync(repaired);
  assert.deepEqual(Object.keys(after).sort(),Object.keys(before).sort());
  for(const path of Object.keys(before))if(path!=='3D/Objects/child.model')assert.deepEqual(after[path],before[path],path);
  const oldXml=strFromU8(before['3D/Objects/child.model']),newXml=strFromU8(after['3D/Objects/child.model']);
  assert.equal(newXml.replace(/<triangles>[\s\S]*?<\/triangles>/,'TRIANGLES'),oldXml.replace(/<triangles>[\s\S]*?<\/triangles>/,'TRIANGLES'));
  assert.deepEqual(RepairArchive.read(repaired).meshes[0].indices,replacement.indices);
  const snapshot=archive.meshes;snapshot[0].positions[0]=999;assert.equal(archive.meshes[0].positions[0],0,'returned data cannot mutate archive');
});

test('face painting follows exact ordered source faces through removal and vertex reindexing',()=>{
  const painted=model(triangles.replace('<triangle v1="0" v2="2" v3="1"/>','<triangle v1="0" v2="2" v3="1" v:paint_color="12345" pid="7" p1="0" p2="1" p3="2"/>'));
  const original=packageBytes(painted),archive=RepairArchive.read(original),mesh=archive.meshes[0];assert.equal(mesh.protectedTopology,true);
  const positions=[...mesh.positions.slice(3),...mesh.positions.slice(0,3)];
  const indices=mesh.indices.slice(0,-3).map(i=>(i+3)%4);
  const repaired=archive.patch([{id:mesh.id,positions,indices}]),xml=strFromU8(unzipSync(repaired)['3D/Objects/child.model']);
  assert(xml.includes('<triangle v1="3" v2="1" v3="0" v:paint_color="12345" pid="7" p1="0" p2="1" p3="2"/>'),'only vertex indices in retained face XML change');
  for(const path of Object.keys(unzipSync(original)))if(path!=='3D/Objects/child.model')assert.deepEqual(unzipSync(repaired)[path],unzipSync(original)[path]);
  const flipped=[...mesh.indices];[flipped[0],flipped[1]]=[flipped[1],flipped[0]];
  assert.throws(()=>archive.assertPatch([{id:mesh.id,positions:mesh.positions,indices:flipped}]),/ordered source vertices/,'paint barycentric order cannot be inferred for flipped faces');
  const fresh=[...mesh.indices,0,1,2];assert.throws(()=>archive.patch([{id:mesh.id,positions:mesh.positions,indices:fresh}]),/ordered source vertices/,'new faces cannot acquire invented paint');
  assert.deepEqual(archive.patch([]),original,'failed patch leaves owned package unchanged');
  const firstFace=painted.match(/<triangle\s[^>]*>/)[0],duplicate=RepairArchive.read(packageBytes(painted.replace('</triangles>',firstFace+'</triangles>'))),duplicatedMesh=duplicate.meshes[0];
  assert.equal(RepairArchive.read(duplicate.patch([{id:duplicatedMesh.id,positions:duplicatedMesh.positions,indices:duplicatedMesh.indices.slice(0,-3)}])).meshes[0].indices.length,12,'same-painted duplicate removal retains surviving face data');
  const ambiguous=RepairArchive.read(packageBytes(painted.replace('</triangles>',firstFace.replace('12345','abcde')+'</triangles>'))),ambiguousMesh=ambiguous.meshes[0];
  assert.throws(()=>ambiguous.patch([{id:ambiguousMesh.id,positions:ambiguousMesh.positions,indices:ambiguousMesh.indices.slice(0,-3)}]),/Ambiguous painted duplicate/);
});

test('known Bambu mesh statistics do not block repair, while actual and unknown face bindings remain protected',()=>{
  const originalFiles=unzipSync(packageBytes(model()));
  originalFiles['Metadata/model_settings.config']=strToU8('<config><object id="9"><metadata face_count="4"/><part id="2"><metadata key="extruder" value="2"/><mesh_stat face_count="4" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/></part></object></config>');
  const original=zipSync(originalFiles),archive=RepairArchive.read(original),mesh=archive.meshes[0];assert.equal(mesh.protectedTopology,false);
  const repaired=archive.patch([{id:mesh.id,positions:mesh.positions,indices:mesh.indices.slice(0,-3)}]);
  assert.deepEqual(unzipSync(repaired)['Metadata/model_settings.config'],originalFiles['Metadata/model_settings.config'],'original diagnostic stats remain byte-identical even when count becomes stale');
  for(const config of ['<config><metadata key="face_count" value="4"/></config>','<config><object id="9"><metadata face_count="4" face_index="1"/></object></config>','<config><plate><metadata face_count="4"/></plate></config>','<config><volume firstid="0" lastid="3"/></config>']){
    const files={...originalFiles,'Metadata/model_settings.config':strToU8(config)},protectedArchive=RepairArchive.read(zipSync(files)),protectedMesh=protectedArchive.meshes[0];
    assert.equal(protectedMesh.protectedTopology,true);
    assert.throws(()=>protectedArchive.assertPatch([{id:protectedMesh.id,positions:protectedMesh.positions,indices:protectedMesh.indices.slice(0,-3)}]),/safely preserve/);
  }
});

test('unsafe geometry, XML entities, mixed units and sliced packages fail explicitly',()=>{
  assert.throws(()=>RepairArchive.read(packageBytes(model().replace('<?xml version="1.0"?>','<!DOCTYPE model [<!ENTITY unsafe "value">]>'))),/DTDs/);
  assert.throws(()=>RepairArchive.read(packageBytes(model().replace('unit="centimeter"','unit="inch"'))),/Mixed-unit/);
  assert.throws(()=>RepairArchive.read(packageBytes(model().replace('v3="1"','v3="999"'))),/outside vertex/);
  const files=unzipSync(packageBytes(model()));files['Metadata/plate_1.gcode']=strToU8('G0 X10');assert.throws(()=>RepairArchive.read(zipSync(files)),/Sliced toolpaths/);
});
