// 채팅방 생성 시 고를 수 있는 아이콘 프리셋. 업로드/커스텀 아이콘은 이번 범위 밖이라
// 코드 내 고정 배열로 관리한다. 값은 lib/icon-map.ts의 키와 1:1로 대응한다.
export const ROOM_ICON_PRESETS = [
  "hard-hat",
  "wrench",
  "building-2",
  "users",
  "star",
  "truck",
  "hammer",
  "alert-triangle",
  "mountain",
  "zap",
  "flame",
  "clipboard-list",
] as const;

export type RoomIconPreset = (typeof ROOM_ICON_PRESETS)[number];
