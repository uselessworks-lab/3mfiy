export const NS = Object.freeze({
  core: "http://schemas.microsoft.com/3dmanufacturing/core/2015/02",
  materials: "http://schemas.microsoft.com/3dmanufacturing/material/2015/02",
  production: "http://schemas.microsoft.com/3dmanufacturing/production/2015/06",
  relationships: "http://schemas.openxmlformats.org/package/2006/relationships",
  contentTypes: "http://schemas.openxmlformats.org/package/2006/content-types",
  xml: "http://www.w3.org/XML/1998/namespace",
});
export const REL = Object.freeze({
  model: "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel",
  texture: "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dtexture",
  thumbnail:
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail",
  mustPreserve:
    "http://schemas.openxmlformats.org/package/2006/relationships/mustpreserve",
});
export const CONTENT_TYPE = Object.freeze({
  model: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
  relationships: "application/vnd.openxmlformats-package.relationships+xml",
});
export const DEFAULT_MODEL_PATH = "/3D/3dmodel.model";
