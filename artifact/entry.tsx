import { createRoot } from "react-dom/client";
import { RouterProvider, useRouterCtx } from "./router-context";
import TabBar from "../components/TabBar";
import OnboardingFlow from "../components/onboarding/OnboardingFlow";
import PendingApprovalScreen from "../components/onboarding/PendingApprovalScreen";
import { useStore } from "../lib/store";

import HomePage from "../app/(tabs)/page";
import MyPage from "../app/(tabs)/mypage/page";
import ContactsPage from "../app/(tabs)/contacts/page";
import RoomPage from "../app/room/page";
import NewAgendaPage from "../app/room/new-agenda/page";
import FloorplanPinPage from "../app/room/new-agenda-pin/page";
import AgendaListPage from "../app/room/agenda-list/page";
import FloorplanViewPage from "../app/room/floorplan/page";
import AgendaRoomPage from "../app/agenda/page";
import TracePage from "../app/agenda/trace/page";
import ProfilePage from "../app/profile/page";
import MyProfilePage from "../app/profile/me/page";
import SiteListPage from "../app/(tabs)/site/page";
import SiteDetailPage from "../app/site-detail/page";
import TradeRequestsPage from "../app/site-detail/requests/page";
import TradeRequestDetailPage from "../app/site-detail/requests/detail/page";
import RateInputPage from "../app/site-detail/rate-input/page";
import ZoneDrawPage from "../app/site-detail/zone-draw/page";

const TAB_ROUTES = new Set(["/", "/mypage", "/contacts", "/site"]);

function TabsShell({ children }: { children: React.ReactNode }) {
  const registration = useStore((s) => s.registration);

  if (!registration) {
    return <OnboardingFlow />;
  }

  if (registration.status === "pending") {
    return <PendingApprovalScreen registration={registration} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <TabBar />
    </div>
  );
}

function Screen() {
  const { state } = useRouterCtx();

  let body: React.ReactNode;
  switch (state.pathname) {
    case "/":
      body = <HomePage />;
      break;
    case "/mypage":
      body = <MyPage />;
      break;
    case "/contacts":
      body = <ContactsPage />;
      break;
    case "/room":
      body = <RoomPage />;
      break;
    case "/room/new-agenda":
      body = <NewAgendaPage />;
      break;
    case "/room/new-agenda-pin":
      body = <FloorplanPinPage />;
      break;
    case "/room/agenda-list":
      body = <AgendaListPage />;
      break;
    case "/room/floorplan":
      body = <FloorplanViewPage />;
      break;
    case "/agenda":
      body = <AgendaRoomPage />;
      break;
    case "/agenda/trace":
      body = <TracePage />;
      break;
    case "/profile":
      body = <ProfilePage />;
      break;
    case "/profile/me":
      body = <MyProfilePage />;
      break;
    case "/site":
      body = <SiteListPage />;
      break;
    case "/site-detail":
      body = <SiteDetailPage />;
      break;
    case "/site-detail/requests":
      body = <TradeRequestsPage />;
      break;
    case "/site-detail/requests/detail":
      body = <TradeRequestDetailPage />;
      break;
    case "/site-detail/rate-input":
      body = <RateInputPage />;
      break;
    case "/site-detail/zone-draw":
      body = <ZoneDrawPage />;
      break;
    default:
      body = (
        <div className="flex h-full items-center justify-center text-text-2">
          페이지를 찾을 수 없습니다.
        </div>
      );
  }

  return TAB_ROUTES.has(state.pathname) ? <TabsShell>{body}</TabsShell> : body;
}

function App() {
  return (
    <RouterProvider initialPath="/">
      <div className="mx-auto flex h-dvh max-w-[480px] flex-col bg-bg text-text">
        <Screen />
      </div>
    </RouterProvider>
  );
}

const container = document.getElementById("root")!;
createRoot(container).render(<App />);
