import { SaxesParser, type SaxesTagNS } from "saxes";
import { NS, REL } from "./constants.js";
import { Transform3D } from "./domain/geometry.js";
import { fail, ThreeMFError } from "./errors.js";
import type { ReadLimits, Transform, Unit } from "./model/types.js";
import { pathKey, resolveTarget } from "./opc/paths.js";
import { DEFAULT_READ_LIMITS, readZip, writeZip } from "./opc/zip.js";
import { attr, numbers, parseNumber, parseXml } from "./xml/primitives.js";

export interface RepairArchiveRegistration {
  readonly objects: number;
  readonly parts: number;
}
export interface RepairArchiveMesh {
  readonly id: string;
  readonly path: string;
  readonly objectId: number;
  readonly name?: string;
  readonly unit: Unit;
  readonly positions: readonly number[];
  readonly indices: readonly number[];
  /** Face properties require exact source-face mapping; opaque references can prohibit topology replacement. */
  protectedTopology: boolean;
}
export interface RepairMeshReplacement {
  readonly id: string;
  readonly positions: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
}
export interface RepairArchiveInstance {
  readonly meshId: string;
  /** Maps the mesh's original coordinates to millimetres, including build/component transforms. */
  readonly transform: Transform;
}
interface Span { start: number; end: number; name: string }
interface StoredTriangle { span: Span; vertices: readonly [number,number,number] }
interface StoredMesh extends RepairArchiveMesh {
  triangles: StoredTriangle[];
  faceProperties: boolean;
  protectedReferences: boolean;
  verticesSpan: Span;
  trianglesSpan: Span;
  opaqueVertices: boolean;
  opaqueMesh: boolean;
}
interface Reference { path: string; objectId: number; transform: Transform3D }
interface ObjectNode { path: string; id: number; components: Reference[]; mesh?: StoredMesh }
interface ModelPart { path: string; xml: string; unit: Unit; objects: Map<number,ObjectNode>; build: Reference[] }
const unitMm: Record<Unit,number> = { micron:0.001,millimeter:1,centimeter:10,inch:25.4,foot:304.8,meter:1000 };
const decoder = new TextDecoder("utf-8", {fatal:true,ignoreBOM:true});
const encoder = new TextEncoder();
const integer = (value:string|undefined, label:string):number => {
  const n=value===undefined?NaN:Number(value);
  if(!Number.isSafeInteger(n)||n<0)fail("REPAIR_NUMBER",`Invalid ${label}`);
  return n;
};
const value = (tag:SaxesTagNS,name:string,uri=""):string|undefined => Object.values(tag.attributes).find(a=>a.local===name&&a.uri===uri)?.value;
function xmlText(bytes:Uint8Array):string {
  try{return decoder.decode(bytes);}catch{return fail("XML_ENCODING","Expected UTF-8 XML");}
}
/** Ignore only Bambu diagnostic counts while scanning for external face bindings. */
function withoutBambuDiagnosticCounts(xml:string,limits:ReadLimits):string {
  const spans:{start:number;end:number}[]=[],stack:SaxesTagNS[]=[],parser=new SaxesParser({xmlns:true});
  let nodes=0;
  parser.on("doctype",()=>fail("XML_DTD","DTDs and entity declarations are unsupported"));
  parser.on("opentag",tag=>{
    if(++nodes>(limits.maxXmlNodes??DEFAULT_READ_LIMITS.maxXmlNodes)||stack.length>=(limits.maxXmlDepth??DEFAULT_READ_LIMITS.maxXmlDepth))fail("XML_LIMIT","XML complexity limit exceeded");
    const attributes=Object.values(tag.attributes);
    // Bambu stores the object's facets_count() as a sole-attribute metadata child.
    if(stack.length===2&&stack[0]!.name==="config"&&stack[0]!.uri===""&&stack[1]!.name==="object"&&stack[1]!.uri===""&&tag.name==="metadata"&&tag.uri===""&&tag.isSelfClosing&&attributes.length===1&&attributes[0]!.name==="face_count"&&attributes[0]!.uri===""&&/^\d+$/.test(attributes[0]!.value))spans.push({start:xml.lastIndexOf("<",parser.position-1),end:parser.position});
    stack.push(tag);
  });
  parser.on("closetag",()=>{stack.pop();});
  try{parser.write(xml).close();}catch(error){if(error instanceof ThreeMFError)throw error;return fail("XML_PARSE",String(error));}
  for(const span of spans.reverse())xml=xml.slice(0,span.start)+xml.slice(span.end);
  // Part-level mesh_stat uses the same diagnostic counter; retain other attributes for scanning.
  return xml.replace(/<mesh_stat\b[^<>]*\/?>/g,tag=>tag.replace(/\sface_count\s*=\s*(?:"[^"]*"|'[^']*')/g,""));
}
function same(a:ArrayLike<number>,b:ArrayLike<number>):boolean {
  return a.length===b.length&&Array.from(a).every((n,i)=>n===b[i]);
}
function checkedGeometry(positions:ArrayLike<number>,indices:ArrayLike<number>):void {
  if(!positions.length||positions.length%3||!indices.length||indices.length%3)fail("REPAIR_GEOMETRY","Mesh requires complete vertex and triangle triples");
  for(let i=0;i<positions.length;i++)if(!Number.isFinite(positions[i]))fail("REPAIR_GEOMETRY","Non-finite vertex");
  for(let i=0;i<indices.length;i++)if(!Number.isSafeInteger(indices[i])||indices[i]!<0||indices[i]!>=positions.length/3)fail("REPAIR_GEOMETRY","Triangle index outside vertex buffer");
}
function parsePart(path:string,bytes:Uint8Array,limits:ReadLimits,packageProtected:boolean):ModelPart {
  const xml=xmlText(bytes),parser=new SaxesParser({xmlns:true}),stack:SaxesTagNS[]=[];
  const result:ModelPart={path,xml,unit:"millimeter",objects:new Map(),build:[]};
  let object:ObjectNode|undefined,mesh:StoredMesh|undefined,nodes=0,modelProtected=packageProtected;
  const starts=new Map<string,Span>();
  const reference=(tag:SaxesTagNS):Reference=>{
    const target=value(tag,"path",NS.production),transform=value(tag,"transform");
    return {path:target?resolveTarget(path,target):path,objectId:integer(value(tag,"objectid"),"object reference"),transform:new Transform3D(transform?numbers(transform) as unknown as Transform:undefined)};
  };
  parser.on("doctype",()=>fail("XML_DTD","DTDs and entity declarations are unsupported"));
  parser.on("opentag",tag=>{
    if(++nodes>(limits.maxXmlNodes??DEFAULT_READ_LIMITS.maxXmlNodes)||stack.length>=(limits.maxXmlDepth??DEFAULT_READ_LIMITS.maxXmlDepth))fail("XML_LIMIT","XML complexity limit exceeded");
    const parent=stack.at(-1),start=xml.lastIndexOf("<",parser.position-1);
    if(!stack.length){
      if(tag.local!=="model"||tag.uri!==NS.core)fail("REPAIR_MODEL","Expected 3MF model root");
      const unit=value(tag,"unit")??"millimeter";
      if(!(unit in unitMm))fail("REPAIR_UNIT",`Unsupported unit ${unit}`);
      result.unit=unit as Unit;
      const required=value(tag,"requiredextensions")?.split(/\s+/).filter(Boolean)??[];
      modelProtected ||= required.some(prefix=>!([NS.production,NS.materials] as readonly string[]).includes(tag.ns[prefix]!));
    }
    if(tag.uri===NS.core&&tag.local==="object"&&parent?.local==="resources"&&parent.uri===NS.core){
      const id=integer(value(tag,"id"),"object id");if(!id||result.objects.has(id))fail("REPAIR_OBJECT","Duplicate or zero object ID");
      object={path,id,components:[]};result.objects.set(id,object);
    }else if(tag.uri===NS.core&&tag.local==="mesh"&&parent?.local==="object"&&object){
      if(object.mesh)fail("REPAIR_MESH","Multiple meshes in one object");
      mesh={id:`${path}#${object.id}`,path,objectId:object.id,name:value(parent,"name"),unit:result.unit,positions:[],indices:[],protectedTopology:modelProtected,verticesSpan:{start:0,end:0,name:""},trianglesSpan:{start:0,end:0,name:""},opaqueVertices:false,opaqueMesh:false,triangles:[],faceProperties:false,protectedReferences:modelProtected};object.mesh=mesh;
      if(Object.keys(tag.attributes).some(k=>k!=="xmlns"&&!k.startsWith("xmlns:")))mesh.opaqueMesh=true;
    }else if(mesh&&tag.uri===NS.core&&(tag.local==="vertices"||tag.local==="triangles")&&parent?.local==="mesh"){
      if(starts.has(tag.local))fail("REPAIR_MESH","Duplicate mesh container");starts.set(tag.local,{start,end:0,name:tag.name});
      if(Object.keys(tag.attributes).length)mesh.opaqueMesh=true;
    }else if(mesh&&tag.uri===NS.core&&tag.local==="vertex"&&parent?.local==="vertices"){
      (mesh.positions as number[]).push(...["x","y","z"].map(k=>parseNumber(value(tag,k)??fail("REPAIR_VERTEX",`Missing ${k}`))));
      if(Object.values(tag.attributes).some(a=>a.uri!==""||!["x","y","z"].includes(a.local)))mesh.opaqueVertices=true;
    }else if(mesh&&tag.uri===NS.core&&tag.local==="triangle"&&parent?.local==="triangles"){
      const vertices=["v1","v2","v3"].map(k=>integer(value(tag,k),k)) as [number,number,number];
      (mesh.indices as number[]).push(...vertices);
      mesh.triangles.push({span:{start,end:0,name:tag.name},vertices});
      if(Object.values(tag.attributes).some(a=>a.uri!==""||!["v1","v2","v3"].includes(a.local))){mesh.protectedTopology=true;mesh.faceProperties=true;}
    }else if(mesh){mesh.opaqueMesh=true;mesh.protectedTopology=true;}
    if(tag.uri===NS.core&&tag.local==="component"&&parent?.local==="components"&&object)object.components.push(reference(tag));
    if(tag.uri===NS.core&&tag.local==="item"&&parent?.local==="build")result.build.push(reference(tag));
    stack.push(tag);
  });
  parser.on("closetag",tag=>{
    if(mesh&&tag.uri===NS.core&&tag.local==="triangle")mesh.triangles.at(-1)!.span.end=parser.position;
    if(mesh&&tag.uri===NS.core&&(tag.local==="vertices"||tag.local==="triangles")){
      const span=starts.get(tag.local)??fail("REPAIR_MESH","Missing mesh container");span.end=parser.position;
      if(tag.local==="vertices")mesh.verticesSpan=span;else mesh.trianglesSpan=span;
    }
    if(tag.uri===NS.core&&tag.local==="mesh"&&mesh){
      if(!mesh.verticesSpan.end||!mesh.trianglesSpan.end)fail("REPAIR_MESH","Missing vertices or triangles");
      checkedGeometry(mesh.positions,mesh.indices);mesh.protectedTopology ||= mesh.opaqueMesh||mesh.opaqueVertices;mesh=undefined;starts.clear();
    }
    if(tag.uri===NS.core&&tag.local==="object")object=undefined;
    stack.pop();
  });
  try{parser.write(xml).close();}catch(error){if(error instanceof ThreeMFError)throw error;return fail("XML_PARSE",String(error));}
  for(const item of result.objects.values())if((!item.mesh&&!item.components.length)||(item.mesh&&item.components.length))fail("REPAIR_OBJECT","Each object requires either a mesh or components");
  return result;
}

/** Lossless non-mesh package editing. Geometry repair itself belongs to the caller. */
export class RepairArchive {
  readonly #files: Map<string,Uint8Array>;
  readonly #parts: ModelPart[];
  readonly #meshes: StoredMesh[];
  readonly #instances: RepairArchiveInstance[];
  readonly #original: Uint8Array;
  readonly #registration: RepairArchiveRegistration;
  private constructor(bytes:Uint8Array,limits:ReadLimits){
    this.#original=bytes.slice();this.#files=readZip(this.#original,limits);
    for(const path of this.#files.keys()){
      if(/\/_xmlsignatures\/|\.psdsxs$/i.test(path))fail("REPAIR_SIGNED","Signed packages cannot be modified without invalidating signatures");
      if(/\.(?:gcode|bgcode)(?:\.|$)/i.test(path))fail("REPAIR_SLICED","Sliced toolpaths cannot be preserved after geometry repair; use the unsliced project");
    }
    for(const [path,data] of this.#files)if(/\.rels$/i.test(path)&&/digital-signature/i.test(xmlText(data)))fail("REPAIR_SIGNED","Signed packages cannot be modified without invalidating signatures");
    if(!this.#files.has("/[Content_Types].xml"))fail("CONTENT_TYPES","Missing [Content_Types].xml");
    parseXml(xmlText(this.#files.get("/[Content_Types].xml")!),limits);
    const relationships=this.#files.get("/_rels/.rels")??fail("ROOT_RELATIONSHIP","Missing root relationships");
    const root=parseXml(xmlText(relationships),limits);
    if(root.uri!==NS.relationships||root.local!=="Relationships")fail("ROOT_RELATIONSHIP","Invalid root relationships");
    const targets=root.children.filter(n=>attr(n,"Type")===REL.model);
    if(targets.length!==1||attr(targets[0]!,"TargetMode")==="External")fail("ROOT_RELATIONSHIP","Exactly one internal root model required");
    const rootPath=resolveTarget(undefined,attr(targets[0]!,"Target")??fail("ROOT_RELATIONSHIP","Missing root target"));
    // External metadata can address triangle indices/ranges. Preserve that binding by disallowing reindexing.
    let packageProtected=false;
    for(const [path,data] of this.#files)if(!/\.model$/i.test(path)&&/\.(?:xml|config)$/i.test(path)){
      let text=xmlText(data);
      // Bambu's object and part counts are diagnostics, not face bindings.
      // The scan ignores only known forms; original bytes (possibly stale counts) remain untouched.
      if(/^\/Metadata\/model_settings\.config$/i.test(path)&&/^\uFEFF?\s*</.test(text))text=withoutBambuDiagnosticCounts(text,limits);
      if(/(?:\b(?:firstid|lastid)\s*=|face[_ -]?(?:id|idx|index|count|range)|triangle[_ -]?(?:id|idx|index|count|range)|paint_color|support_paint|seam_paint|segmentation)/i.test(text))packageProtected=true;
    }
    this.#parts=[...this.#files].filter(([path])=>/\.model$/i.test(path)).map(([path,data])=>parsePart(path,data,limits,packageProtected));
    const parts=new Map(this.#parts.map(part=>[pathKey(part.path),part]));
    const main=parts.get(pathKey(rootPath))??fail("ROOT_MODEL","Missing root model");
    this.#meshes=this.#parts.flatMap(part=>[...part.objects.values()].flatMap(o=>o.mesh?[o.mesh]:[]));
    if(!this.#meshes.length)fail("REPAIR_MESH","No mesh objects found");
    this.#instances=[];
    const visit=(reference:Reference,parent:Transform3D,seen:Set<string>):void=>{
      const part=parts.get(pathKey(reference.path))??fail("REPAIR_REFERENCE",`Missing model ${reference.path}`);
      if(part.unit!==main.unit)fail("REPAIR_UNIT","Mixed-unit component references are unsupported");
      const object=part.objects.get(reference.objectId)??fail("REPAIR_REFERENCE",`Missing object ${reference.objectId}`),key=`${pathKey(part.path)}#${object.id}`;
      if(seen.has(key))fail("REPAIR_REFERENCE","Cyclic component reference");
      if(seen.size>=64)fail("REPAIR_LIMIT","Component reference depth limit exceeded");
      const transform=reference.transform.then(parent);
      if(object.mesh){this.#instances.push({meshId:object.mesh.id,transform:transform.toData()});if(this.#instances.length>100_000)fail("REPAIR_LIMIT","Too many build instances");}
      else{const next=new Set(seen);next.add(key);for(const child of object.components)visit(child,transform,next);}
    };
    const factor=unitMm[main.unit],scale=new Transform3D([factor,0,0,0,factor,0,0,0,factor,0,0,0]);
    for(const build of main.build)visit(build,scale,new Set());
    // Bambu registers product objects/parts separately from 3MF resource nodes.
    const settings=[...this.#files].find(([path])=>/^\/Metadata\/model_settings\.config$/i.test(path));
    const settingsText=settings?xmlText(settings[1]):undefined;
    const config=settingsText&&/^\uFEFF?\s*</.test(settingsText)?parseXml(settingsText,limits):undefined;
    const objects=config?.local==='config'&&config.uri===''?config.children.filter(node=>node.local==='object'&&node.uri===''):[];
    this.#registration=objects.length
      ? {objects:objects.length,parts:objects.reduce((total,object)=>total+object.children.filter(node=>node.local==='part'&&node.uri==='').length,0)}
      : {objects:main.build.length,parts:this.#instances.length};
    // Also validate references in unused resources without inventing visible placements.
    for(const part of this.#parts)for(const object of part.objects.values())for(const child of object.components){
      const target=parts.get(pathKey(child.path));if(!target?.objects.has(child.objectId))fail("REPAIR_REFERENCE","Unresolved component reference");
    }
  }
  static read(bytes:Uint8Array|ArrayBuffer,options:{limits?:ReadLimits}={}):RepairArchive {
    return new RepairArchive(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),options.limits??{});
  }
  get meshes(): readonly RepairArchiveMesh[]{return this.#meshes.map(({id,path,objectId,name,unit,positions,indices,protectedTopology})=>({id,path,objectId,name,unit,positions:[...positions],indices:[...indices],protectedTopology}));}
  get registration():RepairArchiveRegistration{return {...this.#registration};}
  get instances():readonly RepairArchiveInstance[]{return this.#instances.map(i=>({meshId:i.meshId,transform:[...i.transform]}));}
  /** Atomically substitutes vertex/triangle containers; unknown surrounding XML and attachments remain exact. */
  assertPatch(replacements:readonly RepairMeshReplacement[]):void { this.changes(replacements); }
  private changes(replacements:readonly RepairMeshReplacement[]):Map<string,{start:number;end:number;text:string}[]> {
    const byId=new Map(this.#meshes.map(mesh=>[mesh.id,mesh])),seen=new Set<string>(),edits=new Map<string,{start:number;end:number;text:string}[]>();
    for(const replacement of replacements){
      const mesh=byId.get(replacement.id)??fail("REPAIR_MESH",`Unknown mesh ${replacement.id}`);
      if(seen.has(mesh.id))fail("REPAIR_MESH","Duplicate replacement");seen.add(mesh.id);
      const {positions,indices}=replacement;checkedGeometry(positions,indices);
      const moved=!same(positions,mesh.positions),reindexed=!same(indices,mesh.indices);
      if(!moved&&!reindexed)continue;
      if(mesh.opaqueMesh||(moved&&mesh.opaqueVertices)||(reindexed&&mesh.protectedReferences))fail("REPAIR_PROTECTED",`Cannot safely preserve face painting or opaque mesh metadata for ${mesh.id} after topology changes`);
      const changes=edits.get(mesh.path)??[];edits.set(mesh.path,changes);
      if(moved){const {start,end,name}=mesh.verticesSpan,prefix=name.includes(":")?name.slice(0,name.indexOf(":")+1):"";
        let text=`<${name}>`;for(let i=0;i<positions.length;i+=3)text+=`<${prefix}vertex x="${positions[i]}" y="${positions[i+1]}" z="${positions[i+2]}"/>`;text+=`</${name}>`;changes.push({start,end,text});}
      if(reindexed){const {start,end,name}=mesh.trianglesSpan,prefix=name.includes(":")?name.slice(0,name.indexOf(":")+1):"";
        let text=`<${name}>`;
        if(mesh.faceProperties){
          const original=this.#parts.find(p=>p.path===mesh.path)!.xml;
          const key=(points:ArrayLike<number>,vertices:readonly number[]):string=>vertices.map(v=>[points[v*3],points[v*3+1],points[v*3+2]].join(",")).join("|");
          const source=new Map<string,{raw:string;identity:string;remaining:number}>();
          const indicesOnly=(raw:string,values:readonly number[]|undefined):string=>raw.replace(/(\s+v([123])\s*=\s*)(["'])[^"']*\3/g,(_match,prefix:string,corner:string,quote:string)=>`${prefix}${quote}${values?values[Number(corner)-1]:"INDEX"}${quote}`);
          for(const triangle of mesh.triangles){
            const coordinateKey=key(mesh.positions,triangle.vertices),raw=original.slice(triangle.span.start,triangle.span.end),identity=indicesOnly(raw,undefined),previous=source.get(coordinateKey);
            if(previous){if(previous.identity!==identity)fail("REPAIR_PROTECTED",`Ambiguous painted duplicate faces in ${mesh.id}; cannot choose which face properties to retain`);previous.remaining++;}
            else source.set(coordinateKey,{raw,identity,remaining:1});
          }
          for(let i=0;i<indices.length;i+=3){
            const vertices=[indices[i]!,indices[i+1]!,indices[i+2]!],match=source.get(key(positions,vertices));
            if(!match||match.remaining<=0)fail("REPAIR_PROTECTED",`Cannot safely preserve face painting for ${mesh.id}: repaired faces must match existing ordered source vertices`);
            match.remaining--;text+=indicesOnly(match.raw,vertices);
          }
        }else for(let i=0;i<indices.length;i+=3)text+=`<${prefix}triangle v1="${indices[i]}" v2="${indices[i+1]}" v3="${indices[i+2]}"/>`;
        text+=`</${name}>`;changes.push({start,end,text});}
    }
    return edits;
  }
  patch(replacements:readonly RepairMeshReplacement[]):Uint8Array {
    const edits=this.changes(replacements);
    if(!edits.size)return this.#original.slice();
    const files=new Map(this.#files);
    for(const [path,changes]of edits){let xml=this.#parts.find(p=>p.path===path)!.xml;for(const edit of changes.sort((a,b)=>b.start-a.start))xml=xml.slice(0,edit.start)+edit.text+xml.slice(edit.end);files.set(path,encoder.encode(xml));}
    return writeZip(files);
  }
}
