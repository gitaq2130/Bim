import { useCallback, useRef, type ReactNode } from "react";

/** 좌우 리사이즈 스플릿. ratio 는 왼쪽 비율(0~1), 스토어(ui.splitRatio)에서 온다. */
export function SplitPane({
  ratio,
  onRatioChange,
  left,
  right,
}: {
  ratio: number;
  onRatioChange: (r: number) => void;
  left: ReactNode;
  right: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const move = (ev: PointerEvent) => onRatioChange((ev.clientX - rect.left) / rect.width);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onRatioChange],
  );

  return (
    <div className="split" ref={ref}>
      <div className="split-pane" style={{ flexBasis: `${ratio * 100}%` }}>
        {left}
      </div>
      <div
        className="split-handle"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(ratio * 100)}
        onPointerDown={onPointerDown}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onRatioChange(ratio - 0.05);
          if (e.key === "ArrowRight") onRatioChange(ratio + 0.05);
        }}
        tabIndex={0}
      />
      <div className="split-pane" style={{ flexBasis: `${(1 - ratio) * 100}%` }}>
        {right}
      </div>
    </div>
  );
}
