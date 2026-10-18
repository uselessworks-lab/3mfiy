/** Stable 3MF wire values. String enums remain readable in XML and plain data. */
export enum ThreeMFUnit {
  Micron = "micron",
  Millimeter = "millimeter",
  Centimeter = "centimeter",
  Inch = "inch",
  Foot = "foot",
  Meter = "meter",
}
export enum ThreeMFObjectType {
  Model = "model",
  SolidSupport = "solidsupport",
  Support = "support",
  Surface = "surface",
  Other = "other",
}
export enum TextureTileStyle {
  Wrap = "wrap",
  Mirror = "mirror",
  Clamp = "clamp",
  None = "none",
}
export enum TextureFilter {
  Auto = "auto",
  Linear = "linear",
  Nearest = "nearest",
}
export enum BlendMethod {
  Mix = "mix",
  Multiply = "multiply",
}
