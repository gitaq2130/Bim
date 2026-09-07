"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ChevronLeft, EyeOff, IdCard, Plus } from "lucide-react";
import { useStore } from "@/lib/store";

export default function MyProfilePage() {
  const router = useRouter();
  const me = useStore((s) => s.me);
  const registerMyBizCard = useStore((s) => s.registerMyBizCard);
  const updateMe = useStore((s) => s.updateMe);

  const [editing, setEditing] = useState(me.bizCardRegistered);
  const [photoAdded, setPhotoAdded] = useState(me.bizCardRegistered);
  const [name, setName] = useState(me.name);
  const [rank, setRank] = useState(me.rank);
  const [company, setCompany] = useState(me.company);
  const [trade, setTrade] = useState(me.trade);
  const [mobile, setMobile] = useState(me.bizCard?.mobile ?? "");
  const [email, setEmail] = useState(me.bizCard?.email ?? "");
  const [activityPublic, setActivityPublic] = useState(me.activityPublic);

  if (!editing) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 flex-none items-center gap-1.5 px-2">
          <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
            <ChevronLeft size={24} />
          </button>
          <span className="text-[18px] font-extrabold">내 명함</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-[18px] p-8 text-center">
          <div className="flex h-[180px] w-full max-w-[280px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line-2 text-text-3">
            <IdCard size={36} />
            <span className="text-[13px] font-bold">명함이 아직 없어요</span>
          </div>
          <div className="max-w-[280px] text-[14px] font-semibold leading-relaxed text-text-2">
            명함을 등록하면 함께 일하는 동료들이 자동으로 확인할 수 있어요
          </div>
          <button
            onClick={() => setEditing(true)}
            className="flex h-[52px] items-center gap-2 rounded-2xl bg-accent px-7 text-[16px] font-extrabold text-[#231a02]"
          >
            <Plus size={20} />
            명함 등록하기
          </button>
        </div>
      </div>
    );
  }

  const save = () => {
    registerMyBizCard({
      name,
      rank: rank || me.rank,
      company: company || me.company,
      trade: trade || me.trade,
      bizCard: {
        nameEn: me.bizCard?.nameEn ?? name.toUpperCase(),
        address: me.site,
        phone: me.bizCard?.phone ?? mobile,
        fax: me.bizCard?.fax ?? "",
        email,
        mobile,
      },
    });
    updateMe({ activityPublic });
    router.back();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 flex-none items-center gap-1.5 px-2">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
        <span className="text-[18px] font-extrabold">내 명함 편집</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <button
          onClick={() => setPhotoAdded((v) => !v)}
          className="mb-[18px] flex h-[150px] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-2 bg-surface-2 text-text-3"
        >
          {photoAdded ? (
            <div
              className="h-full w-full rounded-2xl"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg,#24242c,#24242c 9px,#1c1c22 9px,#1c1c22 18px)",
              }}
            />
          ) : (
            <>
              <Camera size={30} />
              <span className="text-[14px] font-semibold">명함 촬영 또는 업로드</span>
            </>
          )}
        </button>

        <Field label="이름" value={name} onChange={setName} />
        <Field label="직급" value={rank} onChange={setRank} placeholder="예: 현장소장" />
        <Field label="회사" value={company} onChange={setCompany} placeholder="예: 한빛건설" />
        <Field label="파트" value={trade} onChange={setTrade} placeholder="예: 철근공사" />
        <Field label="휴대전화" value={mobile} onChange={setMobile} placeholder="휴대전화를 입력하세요" />
        <Field label="이메일" value={email} onChange={setEmail} placeholder="이메일을 입력하세요" />

        <div className="mb-1.5 mt-2 text-[13px] font-extrabold text-text-2">안건톡 활동 공개</div>
        <div className="my-1.5 flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-[15px]">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] bg-surface-3 text-text-2">
            <EyeOff size={20} />
          </div>
          <div className="flex-1">
            <div className="text-[14px] font-bold">활동 데이터 공개</div>
            <div className="mt-[3px] text-[12px] leading-relaxed text-text-3">
              참여 안건 수·검증 사례 수를 상대에게 표시합니다. 명함과 달리 켜야만 공개됩니다
            </div>
          </div>
          <button
            onClick={() => setActivityPublic((v) => !v)}
            className={`relative h-7 w-12 flex-none rounded-full border transition-colors ${
              activityPublic ? "border-st-done bg-st-done" : "border-line-2 bg-surface-3"
            }`}
          >
            <span
              className={`absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white transition-all ${
                activityPublic ? "left-[22px]" : "left-[2px] bg-text-3"
              }`}
            />
          </button>
        </div>
      </div>

      <button
        onClick={save}
        className="mx-4 mb-5 h-[52px] flex-none rounded-2xl bg-accent text-[17px] font-extrabold text-[#231a02]"
      >
        저장
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="mb-3.5">
      <div className="mb-1.5 text-[12px] font-bold text-text-3">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-xl border border-line-2 bg-surface-2 px-3.5 text-[15px] text-text placeholder:text-text-3 focus:outline-none"
      />
    </div>
  );
}
