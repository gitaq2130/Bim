import type { FileKind } from "../api/types";

const EXT_TO_KIND: Record<string, FileKind> = {
  ifc: "ifc",
  ifczip: "ifc",
  dxf: "dxf",
  dwg: "dwg",
  rvt: "rvt",
  e57: "e57",
  las: "las",
  laz: "las",
  ply: "ply",
  csv: "csv",
  xml: "xml",
  xer: "xer",
  xlsx: "xlsx",
};

export function detectFileKind(name: string): FileKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return EXT_TO_KIND[ext] ?? "unknown";
}

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  ifc: "IFC 모델",
  dxf: "DXF 도면",
  dwg: "DWG 도면",
  rvt: "Revit(RVT)",
  e57: "포인트클라우드(E57)",
  las: "포인트클라우드(LAS)",
  ply: "포인트클라우드(PLY)",
  csv: "공정표(CSV)",
  xml: "공정표(MS Project XML)",
  xer: "공정표(P6 XER)",
  xlsx: "문서관리대장(xlsx)",
  unknown: "알 수 없는 형식",
};

/** 업로드 전 안내 (CLAUDE.md 기술 제약). xlsx의 cm 전용 제한은 프로젝트 역할이 필요해 UploadPage 가 별도로 안내한다. */
export function preUploadNotice(kind: FileKind): string | null {
  switch (kind) {
    case "dwg":
      return "DWG는 ODA/APS 변환을 거쳐 처리됩니다. 가능하면 DXF로 저장해 업로드하세요 (DXF 권장).";
    case "rvt":
      return "RVT는 서버에서 직접 열 수 없습니다. 업로드 시 APS(Autodesk Platform Services) 변환을 시도하며, 불가하면 Revit에서 IFC 내보내기가 필요합니다.";
    case "xlsx":
      return "문서관리대장 업로드는 CM만 가능합니다(ADR 0007). 대장이 정본이며 BuildTwin은 읽어서 도면승인 판단에만 반영합니다.";
    case "unknown":
      return "지원하지 않는 확장자입니다. IFC / DXF / DWG / RVT / E57 / LAS / PLY / CSV / XML / XER / XLSX(문서관리대장) 만 업로드할 수 있습니다.";
    default:
      return null;
  }
}

export const IFC_EXPORT_GUIDANCE = [
  "Revit에서 [파일] → [내보내기] → [IFC] 를 선택합니다.",
  "IFC 버전은 IFC4 (또는 IFC2x3 Coordination View 2.0) 를 권장합니다.",
  "내보내기 설정에서 '기본 수량 내보내기', '공간 경계', '층(IfcBuildingStorey) 포함' 을 켭니다.",
  "저장된 .ifc 파일을 이 화면에 다시 업로드하세요.",
];
