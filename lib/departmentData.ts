import { normalizeFreeText, toFreeTextValue, type FreeTextValue } from "./freeText";

// 목업 단계 자동완성/정규화용 부서 표기 사전. 완벽한 정규화가 아니라
// 흔한 사례(공무·품질·안전·공사·설계)에 대해서만 정확히 동작하면 충분하다.
export const DEPARTMENT_ALIASES: Record<string, string[]> = {
  공무: ["공무부", "공무팀", "공무", "공무부서"],
  품질: ["품질부", "품질팀", "품질관리팀", "품질경영팀"],
  안전: ["안전관리부", "안전팀", "안전보건팀", "안전환경팀"],
  공사: ["공사부", "공사팀", "공사관리팀", "공무공사팀"],
  설계: ["설계부", "설계팀", "설계실", "설계센터"],
};

export const DEPARTMENT_SUGGESTIONS: string[] = [
  ...new Set(Object.values(DEPARTMENT_ALIASES).flat()),
];

export function searchDepartmentSuggestions(query: string, limit = 5): string[] {
  const q = query.trim();
  if (!q) return [];
  return DEPARTMENT_SUGGESTIONS.filter((c) => c.includes(q)).slice(0, limit);
}

export function normalizeDepartment(display: string): string {
  return normalizeFreeText(display, { aliases: DEPARTMENT_ALIASES });
}

export function toDepartmentValue(display: string): FreeTextValue {
  return toFreeTextValue(display, { aliases: DEPARTMENT_ALIASES });
}
