export type FloorType = "image" | "pdf";

export interface AxisPoint {
  px: number;
  py: number;
}

export interface Calibration {
  X: Record<string, AxisPoint>;
  Y: Record<string, AxisPoint>;
}

export interface Floor {
  id: string;
  name: string;
  type: FloorType;
  /** real photo (HTMLImageElement) or an offscreen canvas holding a rendered PDF page */
  image: HTMLImageElement | HTMLCanvasElement | null;
  naturalW: number;
  naturalH: number;
  calibration: Calibration;
  pdfDoc: import("pdfjs-dist").PDFDocumentProxy | null;
  numPages: number;
}

export type EntrySourceType = "coord" | "manual";

export interface ManualRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Entry {
  id: string;
  floorId: string;
  date: string;
  workType: string;
  roomName: string;
  desc: string;
  sourceType: EntrySourceType;
  explicitFloor: number | null;
  x1: string | null;
  x2: string | null;
  y1: string | null;
  y2: string | null;
  manualRect?: ManualRect;
}

export interface WorkforceRecord {
  id: string;
  date: string;
  workType: string;
  headcount: number | null;
  headcountDetail: string | null;
  equipment: string[];
  equipmentCount: number;
  equipmentDetail: string | null;
}

export interface ZoneRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface CanvasZone {
  rect: ZoneRect;
  entry: Entry;
  tag: string | null;
  showLabel: boolean;
  fillAlpha: number;
  strokeAlpha: number;
  dashed: boolean;
  labelRect?: ZoneRect | null;
}

/* ---------------- Parsed task-line units ---------------- */
export interface ParsedCoordTask {
  roomName: string;
  desc: string;
  sourceType: "coord";
  floorHint: number | null;
  x1: string;
  x2: string;
  y1: string;
  y2: string;
}

export interface ParsedManualTask {
  roomName: string;
  desc: string;
  sourceType: "manual";
  floorHint: number | null;
}

export type ParsedTask = ParsedCoordTask | ParsedManualTask;

export interface ParsedBlock {
  label: string;
  headcount: number | null;
  headcountDetail: string | null;
  equipment: string[];
  equipmentCount: number;
  equipmentDetail: string | null;
  mode: "tasks" | "equipment-list" | "ignore" | null;
  tasks: ParsedTask[];
  miscLines: string[];
  _personParts: string[];
  _personTop: { name: string; count: number }[];
}
