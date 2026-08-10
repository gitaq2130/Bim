"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import StartScreen from "./StartScreen";
import RoleSelectScreen from "./RoleSelectScreen";
import SiteSelectScreen from "./SiteSelectScreen";
import SignupCompleteScreen from "./SignupCompleteScreen";
import TradeSelectScreen from "./TradeSelectScreen";
import ContractorSubmitScreen from "./ContractorSubmitScreen";
import ParentContractorSelectScreen from "./ParentContractorSelectScreen";
import SubcontractorSubmitScreen from "./SubcontractorSubmitScreen";
import ProfileScreen from "./ProfileScreen";

type Step =
  | "start"
  | "role"
  | "site"
  | "complete"
  | "trade"
  | "contractorSubmit"
  | "parentContractor"
  | "subSubmit"
  | "profile";

export default function OnboardingFlow() {
  const [step, setStep] = useState<Step>("start");
  const draft = useStore((s) => s.onboardingDraft);
  const updateDraft = useStore((s) => s.updateOnboardingDraft);

  const goBack = () => {
    if (step === "role") setStep("start");
    else if (step === "site") setStep("role");
    else if (step === "trade") setStep("site");
    else if (step === "contractorSubmit") setStep("trade");
    else if (step === "parentContractor") setStep("site");
    else if (step === "subSubmit") setStep("parentContractor");
    else if (step === "profile") {
      if (draft.role === "owner" || draft.role === "hanmi") setStep("site");
      else if (draft.role === "contractor") setStep("contractorSubmit");
      else setStep("subSubmit");
    }
  };

  if (step === "start") {
    return <StartScreen onStart={() => setStep("role")} />;
  }

  if (step === "role") {
    return (
      <RoleSelectScreen
        selected={draft.role}
        onBack={goBack}
        onSelect={(role) => {
          updateDraft({ role });
          setStep("site");
        }}
      />
    );
  }

  if (step === "site") {
    return (
      <SiteSelectScreen
        onBack={goBack}
        onSelect={(siteId) => {
          updateDraft({ siteId });
          if (draft.role === "owner" || draft.role === "hanmi") setStep("profile");
          else if (draft.role === "contractor") setStep("trade");
          else setStep("parentContractor");
        }}
      />
    );
  }

  if (step === "complete") {
    return <SignupCompleteScreen />;
  }

  if (step === "trade") {
    return (
      <TradeSelectScreen
        onBack={goBack}
        onSelect={(trade) => {
          updateDraft({ trade });
          setStep("contractorSubmit");
        }}
      />
    );
  }

  if (step === "contractorSubmit") {
    return <ContractorSubmitScreen onBack={goBack} onNext={() => setStep("profile")} />;
  }

  if (step === "parentContractor") {
    return (
      <ParentContractorSelectScreen
        onBack={goBack}
        onSelect={(contractorId) => {
          updateDraft({ parentContractorId: contractorId });
          setStep("subSubmit");
        }}
      />
    );
  }

  if (step === "subSubmit") {
    return <SubcontractorSubmitScreen onBack={goBack} onNext={() => setStep("profile")} />;
  }

  return <ProfileScreen onBack={goBack} onNext={() => setStep("complete")} />;
}
