"""전주 스캔 대비 변화량(diff). 같은 객체의 직전 ScanVerdict와 비교한다.

담당: reality-capture. 상태 전이는 만들지 않는다 — ObjectDiff만 낸다(상태기계는 progress-engine).
"""
from __future__ import annotations

from packages.core.models.scan import ObjectDiff, ScanVerdict

VOLUME_KEY = "occupied_volume"      # evidence.extra 키: 점유 복셀 부피(m³)


def compute_diff(prev: ScanVerdict | None, curr: ScanVerdict, prev_density: float | None = None,
                 curr_density: float | None = None) -> ObjectDiff | None:
    """직전 verdict가 없으면 None. density는 인자 우선, 없으면 각 verdict의 evidence.extra['density']."""
    if prev is None:
        return None
    if prev.global_id != curr.global_id:
        raise ValueError(f"diff across different objects: {prev.global_id} vs {curr.global_id}")
    pd = prev_density if prev_density is not None else float(prev.evidence.extra.get("density", 0.0))
    cd = curr_density if curr_density is not None else float(curr.evidence.extra.get("density", 0.0))
    pv = prev.evidence.extra.get(VOLUME_KEY)
    cv = curr.evidence.extra.get(VOLUME_KEY)
    volume_delta = float(cv) - float(pv) if pv is not None and cv is not None else None
    return ObjectDiff(prev_scan_id=prev.scan_id, prev_state=prev.state, curr_state=curr.state,
                      density_delta=float(cd - pd), volume_delta=volume_delta)


__all__ = ["VOLUME_KEY", "compute_diff"]
