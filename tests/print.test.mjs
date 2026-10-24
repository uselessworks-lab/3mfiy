import test from 'node:test';
import assert from 'node:assert/strict';
import { PrintWriter } from '../dist/print.js';
import { ThreeMFDocument, MeshResource, Transform3D } from '../dist/index.js';
import { BambuStudioProject } from '../dist/adapters/bambu.js';
import { tetrahedron } from './fixtures.mjs';
const matrix = (x=0,y=0,z=0) => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1];
const standard = {title:'Canonical print',format:'standard'};
function source() {
  const mesh=tetrahedron(); mesh.positions[3]=1.000000000001;
  return {
    outputs:[{id:'cap',print:{name:'Cap',settings:{wall_generator:'arachne'}},representations:[{id:'main',components:[{id:'base',geometryId:'mesh',materialId:'white',print:{name:'Cap base',filamentSlot:1}}]}]}],
    geometries:[{id:'mesh',kind:'mesh',mesh,bounds:{min:[0,0,0],max:[1.000000000001,1,1]}}],
    materials:[{id:'white',color:'#123456',label:'Shared'}],
    printing:{outputIds:['cap'],plates:[{id:'plate',extent:'unspecified',origin:[100,200]}],placements:[{outputId:'cap',representationId:'main',plateId:'plate',transform:matrix(2,3,0)}]},
    assembly:{placements:[{outputId:'cap',representationId:'main',transform:matrix(0,0,20)}]},
  };
}
function document(value,options=standard){return ThreeMFDocument.read(new PrintWriter().write(value,options));}
test('canonical selection keeps exact mesh precision and deduplicates shared geometry/material resources',()=>{
  const value=source(),before=structuredClone(value);
  value.printing.placements.push({...value.printing.placements[0],instanceId:'copy',transform:matrix(5,6,0)});
  const doc=document(value),meshes=doc.rootModel.objects.filter(value=>value instanceof MeshResource);
  assert.equal(meshes.length,1);
  assert.equal(meshes[0].geometry.toData().positions[3],1.000000000001);
  assert.deepEqual(doc.rootModel.buildItems.map(item=>item.transform.slice(9)),[[102,203,0],[105,206,0]]);
  assert.deepEqual(value.geometries,before.geometries);
  assert.equal(doc.rootModel.buildItems.length,2);
});
test('full baking includes mirrored part and explicit scene pose, fixes winding and leaves identity build',()=>{
  const value=source(),part=value.outputs[0].representations[0].components[0];
  part.transform=[-1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  value.printing.placements[0].sceneTransform=matrix(7.000000000001,8,0);
  const doc=document(value,{...standard,bakeTransforms:true,assembly:'omit'});
  const mesh=doc.rootModel.objects.find(value=>value instanceof MeshResource).geometry.toData();
  assert.equal(mesh.positions[3],-1.000000000001+7.000000000001);
  assert.deepEqual(mesh.indices.slice(0,3),[0,1,2]);
  assert.deepEqual(doc.rootModel.buildItems[0].transform,Transform3D.identity().toData());
});
test('Bambu preserves profile, settings, explicit plates, production IDs and selected assembly semantics',()=>{
  const value=source();
  value.printing.plates[0].name='Plate One'; value.printing.plates[0].locked=true;
  value.printing.placements[0].sceneTransform=matrix(11.000000000001,12,0);
  value.assembly.placements[0].representationId='formed';
  const options={title:'Project',format:'bambu-project',assembly:'print',project:{applicationVersion:'2.0.0',meshPath:'/3D/Objects/object_1.model',profile:{filament_colour:['#123456'],filament_settings_id:['Caller PLA'],future_vendor:['retain']}}};
  const doc=document(value,options),inspection=BambuStudioProject.inspect(doc);
  assert.deepEqual(inspection.profile.toData(),options.project.profile);
  assert.equal(inspection.plates[0].toData().locked,true);
  assert.equal(inspection.plates[0].toData().name,'Plate One');
  assert.equal(doc.rootModel.buildItems[0].objectId,2);
  const config=new TextDecoder().decode(doc.toData().attachments.find(a=>a.path==='/Metadata/model_settings.config').data);
  assert.match(config,/wall_generator/); assert.match(config,/arachne/); assert.match(config,/11.000000000001/);
  assert.throws(()=>document(value,{...options,assembly:'physical'}),/different output representation/);
});
test('writer rejects invalid canonical references, duplicates and ineligible output before writing',()=>{
  for(const [mutate,pattern] of [
    [v=>v.printing.placements[0].outputId='unknown',/Invalid print occurrence/],
    [v=>v.printing.placements.push(v.printing.placements[0]),/Invalid print occurrence/],
    [v=>v.outputs[0].representations[0].components[0].geometryId='unknown',/Unknown output geometry/],
    [v=>v.outputs[0].representations[0].components[0].materialId='unknown',/Unknown output material/],
    [v=>v.geometries.push(v.geometries[0]),/duplicate geometry/],
    [v=>v.outputs[0].representations.push(v.outputs[0].representations[0]),/duplicate representation/],
    [v=>v.materials.push(v.materials[0]),/duplicate material/],
    [v=>v.manufacturing={eligible:false,reason:'Preview only'},/Preview only/],
  ]){const value=source();mutate(value);assert.throws(()=>document(value),pattern);}
  const controller=new AbortController();controller.abort();
  assert.throws(()=>new PrintWriter().write(source(),standard,controller.signal),{name:'AbortError'});
});

test('Bambu parts layout splits component XML while preserving occurrence paths, wrapper IDs and settings',()=>{
  const value=source(),parts=value.outputs[0].representations[0].components;
  parts.push({...parts[0],id:'detail',print:{name:'Cap detail',filamentSlot:1}});
  value.printing.placements.push({...value.printing.placements[0],instanceId:'copy',transform:matrix(10,20,0)});
  const options={title:'Split parts',format:'bambu-project',assembly:'print',project:{applicationVersion:'2.0.0',meshPath:'/3D/Objects/fallback.model',meshPaths:{cap:'/3D/Objects/first.model',copy:'/3D/Objects/second.model'},profile:{filament_colour:['#123456'],filament_settings_id:['Caller PLA']}}};
  const shared=document(value,options),split=document(value,{...options,project:{...options.project,meshLayout:'parts'}});
  const meshModels=doc=>doc.toData().models.filter(model=>model.resources.some(resource=>resource.kind==='object'&&resource.mesh));
  assert.deepEqual(meshModels(shared).map(model=>model.path),['/3D/Objects/first.model','/3D/Objects/second.model']);
  assert.deepEqual(meshModels(split).map(model=>model.path),['/3D/Objects/first_1_1.model','/3D/Objects/first_1_2.model','/3D/Objects/second_2_1.model','/3D/Objects/second_2_2.model']);
  for(const model of meshModels(split))assert.equal(model.resources.filter(resource=>resource.kind==='object'&&resource.mesh).length,1);
  assert.deepEqual(split.rootModel.buildItems.map(({uuid,...item})=>item),shared.rootModel.buildItems.map(({uuid,...item})=>item));
  const config=doc=>new TextDecoder().decode(doc.getAttachment('/Metadata/model_settings.config').data);
  assert.equal(config(split),config(shared));
  const meshes=doc=>meshModels(doc).flatMap(model=>model.resources.flatMap(resource=>resource.kind==='object'&&resource.mesh?[[resource.name,resource.mesh.positions,resource.mesh.indices]]:[]));
  assert.deepEqual(meshes(split),meshes(shared));
  const defaultParts=document(value,{...options,project:{...options.project,meshPaths:undefined,meshLayout:'parts'}});
  assert.deepEqual(meshModels(defaultParts).map(model=>model.path),['/3D/Objects/fallback_1_1.model','/3D/Objects/fallback_1_2.model','/3D/Objects/fallback_2_1.model','/3D/Objects/fallback_2_2.model']);
  assert.throws(()=>document(value,{...options,project:{...options.project,meshLayout:'invalid'}}),/Invalid child mesh layout/);
});
