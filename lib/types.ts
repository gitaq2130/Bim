export type RoomType = "trade" | "partner" | "dm";

export interface Room {
  id: string;
  type: RoomType;
  name: string;
  icon: string;
  memberCount?: number;
  unread?: number;
  time: string;
}

export type MessageKind =
  | "text"
  | "photo"
  | "file"
  | "agenda-card"
  | "system"
  | "tech-case";

export interface Message {
  id: string;
  roomId: string;
  sender?: string;
  kind: MessageKind;
  text?: string;
  fileName?: string;
  fileSize?: string;
  photoLabel?: string;
  photoCount?: number;
  agendaNo?: number;
  isDecisionBasis?: boolean;
  time: string;
  outgoing?: boolean;
}

export type AgendaStatus =
  | "사전검토"
  | "검토중"
  | "조치중"
  | "완료"
  | "완료·관찰중"
  | "완료·검증됨";

export interface AiSummary {
  body: string;
  openItems: string[];
  sourcesCases: number;
  sourcesStandard: string;
}

export interface CompleteForm {
  reactionCount: number;
  highValue: boolean;
  hasDisagreement: boolean | null;
  disagreeParties: string[];
  priorities: string[];
}

export interface TechCase {
  caseNo: string;
  problem: string;
  cause: string;
  alternatives: string;
  decision: string;
  rationale: string;
  result: string;
  prevention: string;
  approval: "pending" | "approved" | "rejected";
}

export interface Trace {
  dueLabel: string;
  state: "관찰중" | "검증됨";
  response?: "이상없음" | "재발" | "확인어려움";
}

export interface Agenda {
  no: number;
  parentRoomId: string;
  title: string;
  status: AgendaStatus;
  photoLabel?: string;
  photoCount?: number;
  participants: number;
  participantNames?: string[];
  createdLabel: string;
  isAfterHours?: boolean;
  ageLabel?: string;
  isDormant?: boolean;
  floorplanLabel?: string;
  floorplanRev?: string;
  pin?: { x: number; y: number };
  revLinked?: { from: string; to: string } | null;
  aiSummary?: AiSummary;
  completeForm?: CompleteForm;
  techCase?: TechCase;
  trace?: Trace;
  linkedPreReviewNo?: number;
  updatedLabel?: string;
}

export interface BizCard {
  nameEn: string;
  address: string;
  phone: string;
  fax: string;
  email: string;
  mobile: string;
}

export interface Me {
  name: string;
  rank: string;
  company: string;
  site: string;
  trade: string;
  bizCardRegistered: boolean;
  bizCard?: BizCard;
  activityPublic: boolean;
}

export interface ActivityItem {
  agendaNo: number;
  title: string;
  status: AgendaStatus;
}

export interface Contact {
  id: string;
  name: string;
  rank: string;
  trade: string;
  tradeGroup: string;
  company: string;
  bizCardRegistered: boolean;
  bizCard?: BizCard;
  lastTalkedLabel: string;
  activityPublic: boolean;
  activity: ActivityItem[];
  note?: string;
  favorite?: boolean;
  blocked?: boolean;
}
