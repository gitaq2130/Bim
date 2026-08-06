"use client";

import TabBar from "@/components/TabBar";
import OnboardingFlow from "@/components/onboarding/OnboardingFlow";
import PendingApprovalScreen from "@/components/onboarding/PendingApprovalScreen";
import { useStore } from "@/lib/store";

export default function TabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
