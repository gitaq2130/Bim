"""services/sync 가 던지는 도메인 예외들. api 가 str(exc) 접두어 매칭 대신 타입으로 원인을 구분할 수 있게 한다.

각 클래스는 지금까지 실제로 쓰이던 builtin(ValueError/LookupError)의 서브클래스다 — 기존에 builtin 을
잡던 호출자는 그대로 동작한다(breaking change 아님). 메시지 문구도 그대로 유지한다 — api 의 과도기적
문자열 접두어 매칭도 당분간 계속 통과해야 한다.
"""
from __future__ import annotations


class MalformedReviewDataError(ValueError):
    """저장된 ReviewRequest(kind=mapping)의 conflicting_sources 가 손상됨(drawing_id/entity_handle 누락 등).

    사용자 입력 문제가 아니라 서버에 저장된 데이터 자체의 손상이므로 api 는 이를 500 으로 옮긴다
    (code="mapping_review_data_corrupt"). services.sync.review_queue.resolve_mapping_review 에서 던진다.
    """


class MappingTargetNotFoundError(ValueError):
    """확정하려는 매핑 대상 (project_id, global_id) 객체가 그 프로젝트에 존재하지 않음.

    api 는 이를 404 로 옮긴다(code="mapping_target_not_found").
    services.sync.review_queue.confirm_mapping_row 에서 던진다(resolve_mapping_review 를 통해서도 전파됨).
    """


class DrawingNotFoundError(LookupError):
    """참조한 drawing_id 에 해당하는 DrawingRow 가 없음.

    api 는 이를 404 로 옮긴다(code="drawing_not_found").
    services.sync.persistence._project_id_of_drawing / save_alignment 에서 던진다.
    """
