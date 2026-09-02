# services/scan

- 담당 에이전트: `reality-capture`
- 입출력 계약: `(scan_file, AlignmentInput{control_points|markers})` → `Registration{transform, rmse}` → `ScanVerdict[]{global_id, state(NOT_BUILT|IN_PROGRESS|ESTIMATED_DONE|MISMATCH|UNVERIFIABLE), confidence, evidence, diff}`
