"""services/scan — 포인트클라우드 정합·객체 판정(담당: reality-capture). 출력은 ScanVerdict 뿐이며 CONFIRMED 는 내지 않는다."""
from .config import ScanConfig, load_scan_config
from .pipeline import run_scan_pipeline
from .verdict import judge_objects

__all__ = ["ScanConfig", "judge_objects", "load_scan_config", "run_scan_pipeline"]
