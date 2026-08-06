export type RoomType = "trade" | "partner" | "dm";

export interface Room {
  id: string;
  type: RoomType;
  name: string;
  icon: string;
  memberCount?: number;
  unread?: number;
  time: string;
  favorite?: boolean;
  pinned?: boolean;
  muted?: boolean;
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
  assigneeId?: string;
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

export type UserRole = "owner" | "hanmi" | "contractor" | "subcontractor";

export const CONTRACTOR_TRADES = ["건축", "전기", "통신", "소방"] as const;
export type ContractorTrade = (typeof CONTRACTOR_TRADES)[number];

export type RegistrationStatus = "instant" | "pending" | "approved" | "rejected";

export interface Site {
  id: string;
  name: string;
  location: string;
  startDate?: string;
  endDatePlanned?: string;
  asOfDate?: string;
  dDay?: number;
  timelinePct?: number;
  overallPlanPct?: number;
  overallActualPct?: number;
  progressLabel?: string;
  todayUpdateCount?: number;
}

export type ZoneLayer = "stack" | "work";

export interface Zone {
  id: string;
  siteId: string;
  layer: ZoneLayer;
  x: number;
  y: number;
  width: number;
  height: number;
  date: string;
  registeredAt: string;
  registeredBy: string;
  materialType?: string;
  quantity?: string;
  broughtInDate?: string;
  workContent?: string;
  equipment?: string;
  workerCount?: string;
}

export interface ContractorCompany {
  id: string;
  siteId: string;
  trade: ContractorTrade;
  companyName: string;
  status: RegistrationStatus;
}

export interface UserRegistration {
  role: UserRole;
  siteId: string;
  siteName: string;
  trade?: ContractorTrade;
  process?: string;
  companyName?: string;
  parentContractorId?: string;
  approvalTarget: string;
  status: RegistrationStatus;
}

export const TRADE_COLORS: Record<string, string> = {
  건축: "#3b82f6",
  전기: "#f59e0b",
  통신: "#14b8a6",
  소방: "#ef4444",
  철근콘크리트: "#8b5cf6",
  철골: "#ec4899",
  외장판넬: "#84cc16",
  토목: "#06b6d4",
};

export interface Trade {
  id: string;
  siteId: string;
  name: string;
  fixed: boolean;
  isNew?: boolean;
  prevCumPlan: number;
  prevCumActual: number;
  weekPlan: number;
  weekActual: number;
  cumPlan: number;
  cumActual: number;
  note?: string;
}

export interface WeeklyTotalRow {
  prevCumPlan: number;
  prevCumActual: number;
  weekPlan: number;
  weekActual: number;
  cumPlan: number;
  cumActual: number;
}

export interface TradeRequest {
  id: string;
  siteId: string;
  tradeName: string;
  companyName: string;
  applicantName: string;
  applicantRank: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
}
