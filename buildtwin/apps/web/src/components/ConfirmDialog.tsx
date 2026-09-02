import { useState } from "react";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "확인",
  requireNote = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  requireNote?: boolean;
  busy?: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h3 id="confirm-title">{title}</h3>
        {message && <p>{message}</p>}
        <label className="field">
          <span>사유 / 메모{requireNote ? " (필수)" : ""}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </label>
        <div className="row gap">
          <button type="button" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || (requireNote && !note.trim())}
            onClick={() => onConfirm(note.trim())}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
