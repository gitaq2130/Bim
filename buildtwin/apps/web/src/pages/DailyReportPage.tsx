/**
 * 작업일보 입력 (contractor). 작업구역은 층·구역 선택 또는 3D 선택 객체.
 */
import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useCreateDailyReport, useModels } from "../api/hooks";
import type { ClaimedState, DailyReportItem } from "../api/types";
import { ErrorBox } from "../components/ErrorBox";
import { CLAIMED_STATE_LABELS } from "../domain/labels";
import { todayISO } from "../lib/format";
import { useStore } from "../store";

interface ItemDraft extends DailyReportItem {
  key: number;
}
let itemSeq = 0;
const newItem = (): ItemDraft => ({ key: ++itemSeq, claimed_state: "in_progress", quantity: null, quantity_unit: "", work_type: "" });

export function DailyReportPage() {
  const { id: projectId = "" } = useParams();
  const models = useModels(projectId);
  const selection = useStore((s) => s.selection);
  const create = useCreateDailyReport(projectId);

  const [reportDate, setReportDate] = useState(todayISO());
  const [level, setLevel] = useState("");
  const [zone, setZone] = useState("");
  const [crew, setCrew] = useState(0);
  const [equipment, setEquipment] = useState<{ key: string; count: number }[]>([]);
  const [items, setItems] = useState<ItemDraft[]>([newItem()]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const levels = models.data?.[0]?.levels ?? [];

  const updateItem = (key: number, patch: Partial<DailyReportItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setDone(null);
    const eq: Record<string, number> = {};
    for (const { key, count } of equipment) if (key.trim()) eq[key.trim()] = count;
    create.mutate(
      {
        report: {
          report_date: reportDate,
          crew_count: crew,
          equipment: eq,
          note: note || null,
          items: items.map((it) => ({
            global_id: it.global_id || null,
            activity_id: it.activity_id || null,
            level: it.global_id ? null : level || null,
            zone: it.global_id ? null : zone || null,
            work_type: it.work_type || null,
            quantity: it.quantity ?? null,
            quantity_unit: it.quantity_unit || null,
            claimed_state: it.claimed_state,
          })),
        },
        photos,
      },
      {
        onSuccess: (r) => {
          setDone(`작업일보 제출 완료 (${r.report_id})`);
          setItems([newItem()]);
          setPhotos([]);
        },
      },
    );
  };

  return (
    <div className="page">
      <h1>작업일보</h1>
      <form className="col gap" onSubmit={submit}>
        <fieldset className="card">
          <legend>작업구역</legend>
          <div className="row gap wrap">
            <label className="field">
              <span>일자</span>
              <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} required />
            </label>
            <label className="field">
              <span>층</span>
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">(선택)</option>
                {levels.map((l) => (
                  <option key={l.name} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>구역</span>
              <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="예: A구역" />
            </label>
          </div>
          <p className="muted small">
            3D에서 선택한 객체: {selection.globalIds.length ? selection.globalIds.join(", ") : "없음"} — 항목의 "3D 선택 객체 사용" 버튼으로 붙일 수 있습니다.
          </p>
        </fieldset>

        <fieldset className="card">
          <legend>인원·장비</legend>
          <label className="field">
            <span>투입 인원</span>
            <input type="number" min={0} value={crew} onChange={(e) => setCrew(Number(e.target.value))} />
          </label>
          <div className="col gap">
            {equipment.map((eq, i) => (
              <div className="row gap" key={i}>
                <input
                  placeholder="장비명 (예: crane)"
                  value={eq.key}
                  onChange={(e) => setEquipment((xs) => xs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                />
                <input
                  type="number"
                  min={0}
                  value={eq.count}
                  onChange={(e) => setEquipment((xs) => xs.map((x, j) => (j === i ? { ...x, count: Number(e.target.value) } : x)))}
                />
                <button type="button" onClick={() => setEquipment((xs) => xs.filter((_, j) => j !== i))}>
                  삭제
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setEquipment((xs) => [...xs, { key: "", count: 1 }])}>
              + 장비 추가
            </button>
          </div>
        </fieldset>

        <fieldset className="card">
          <legend>작업 항목</legend>
          <table className="table">
            <thead>
              <tr>
                <th>객체 GlobalId</th>
                <th>Activity</th>
                <th>작업 종류</th>
                <th>수량</th>
                <th>단위</th>
                <th>신고 상태</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key}>
                  <td>
                    <div className="row gap">
                      <input value={it.global_id ?? ""} onChange={(e) => updateItem(it.key, { global_id: e.target.value })} placeholder="(층·구역 사용 시 비움)" />
                      <button
                        type="button"
                        className="small"
                        disabled={!selection.globalIds.length}
                        onClick={() => updateItem(it.key, { global_id: selection.globalIds[0] })}
                      >
                        3D 선택 객체 사용
                      </button>
                    </div>
                  </td>
                  <td>
                    <input value={it.activity_id ?? ""} onChange={(e) => updateItem(it.key, { activity_id: e.target.value })} />
                  </td>
                  <td>
                    <input value={it.work_type ?? ""} onChange={(e) => updateItem(it.key, { work_type: e.target.value })} />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      value={it.quantity ?? ""}
                      onChange={(e) => updateItem(it.key, { quantity: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input value={it.quantity_unit ?? ""} onChange={(e) => updateItem(it.key, { quantity_unit: e.target.value })} placeholder="m3" />
                  </td>
                  <td>
                    <select value={it.claimed_state} onChange={(e) => updateItem(it.key, { claimed_state: e.target.value as ClaimedState })}>
                      {(Object.keys(CLAIMED_STATE_LABELS) as ClaimedState[]).map((k) => (
                        <option key={k} value={k}>
                          {CLAIMED_STATE_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button type="button" disabled={items.length === 1} onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => setItems((xs) => [...xs, newItem()])}>
            + 항목 추가
          </button>
          <p className="muted small">"완료 신고"는 시공사 신고일 뿐이며, 스캔·논리 검증과 CM 확정을 거쳐야 "확정"이 됩니다.</p>
        </fieldset>

        <fieldset className="card">
          <legend>사진</legend>
          <input type="file" accept="image/*" multiple onChange={(e) => setPhotos(Array.from(e.target.files ?? []))} />
          {photos.length > 0 && <p className="muted small">{photos.map((p) => p.name).join(", ")}</p>}
          <label className="field">
            <span>메모</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </label>
        </fieldset>

        <ErrorBox error={create.error} />
        {done && (
          <p className="ok" role="status">
            {done}
          </p>
        )}
        <button type="submit" className="primary" disabled={create.isPending}>
          {create.isPending ? "제출 중…" : "작업일보 제출"}
        </button>
      </form>
    </div>
  );
}
