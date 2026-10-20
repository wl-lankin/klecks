export type ToolId =
  | "select"
  | "hand"
  | "marquee"
  | "crop"
  | "arrow"
  | "line"
  | "rect"
  | "ellipse"
  | "shape"
  | "text"
  | "step"
  | "highlighter"
  | "blur"
  | "spotlight"
  | "brush"
  | "pencil"
  | "eraser"
  | "fill"
  | "picker";

export type Dash = "solid" | "dashed" | "dotted";
export type ArrowStyle = "taper" | "classic" | "open" | "double" | "none";
export type FillMode = "none" | "tint" | "solid";
export type ShapeKind =
  | "triangle"
  | "rtriangle"
  | "diamond"
  | "pentagon"
  | "hexagon"
  | "star"
  | "heart"
  | "bubble"
  | "blockarrow"
  | "check"
  | "cross";
export type TextBg = "none" | "pill" | "outline";
export type FontKey = "sans" | "hand" | "serif" | "mono";
export type BrushVariant = "round" | "calligraphy" | "spray" | "soft";

interface Base {
  id: string;
  shadow?: boolean;
}

export interface LineObj extends Base {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx?: number;
  cy?: number;
  color: string;
  width: number;
  dash: Dash;
  arrow: ArrowStyle;
}

export interface ShapeObj extends Base {
  type: "rect" | "ellipse" | "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  width: number;
  dash: Dash;
  fill: FillMode;
  fillColor: string;
  radius: number;
  kind: ShapeKind;
}

export interface TextObj extends Base {
  type: "text";
  x: number;
  y: number;
  text: string;
  size: number;
  font: FontKey;
  color: string;
  bg: TextBg;
}

export interface StepObj extends Base {
  type: "step";
  x: number;
  y: number;
  n: number;
  size: number;
  color: string;
}

export interface StrokeObj extends Base {
  type: "stroke";
  pts: number[];
  color: string;
  width: number;
}

export interface BlurObj extends Base {
  type: "blur";
  x: number;
  y: number;
  w: number;
  h: number;
  mode: "pixelate" | "blur";
  strength: number;
}

export interface SpotObj extends Base {
  type: "spotlight";
  x: number;
  y: number;
  w: number;
  h: number;
  ellipse: boolean;
  dim: number;
}

export interface ImageObj extends Base {
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
  flipX?: boolean;
  flipY?: boolean;
}

export type Obj = LineObj | ShapeObj | TextObj | StepObj | StrokeObj | BlurObj | SpotObj | ImageObj;
export type BoxObj = ShapeObj | BlurObj | SpotObj | ImageObj;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Frame {
  on: boolean;
  preset: number;
  padding: number;
  radius: number;
  shadow: number;
}

export interface View {
  zoom: number;
  panX: number;
  panY: number;
  /** Still showing the fitted view, so a window resize refits it. */
  fit?: boolean;
}

export type Marquee = { kind: "rect"; r: Rect } | { kind: "lasso"; pts: number[]; r: Rect };
