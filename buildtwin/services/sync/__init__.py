"""services/sync — 2D↔3D 매핑(서버). 담당: sync-2d3d.

계약: (drawing_id, entities, objects, DrawingAlignment?) → EntityObjectMapping[]{confidence, evidence, needs_review}.
"""
from .config import SyncConfig, load_sync_config
from .errors import DrawingNotFoundError, MalformedReviewDataError, MappingTargetNotFoundError
from .matcher import build_mappings, entity_bbox_model, entity_geometry, typical_member_width
from .persistence import (
    RebuildResult,
    load_alignment,
    load_mappings,
    open_mapping_reviews,
    rebuild_mappings,
    save_alignment,
    save_mappings,
)
from .plan_section import level_elevation, plan_section_from_objects
from .review_queue import (
    confirm_mapping,
    confirm_mapping_row,
    mappings_needing_review,
    resolve_mapping_reviews,
    review_request_for,
)
from .rules import LayerMappingRules, RuleMatch, layer_rule_match, layer_rule_score, load_layer_rules
from .transform import (
    DrawingAlignment,
    GridAlignResult,
    alignment_from_similarity,
    alignment_to_transform,
    auto_align_by_grid,
    auto_align_by_grid_detailed,
    grid_from_ifc_objects,
    kabsch_2d,
)

__all__ = [
    "SyncConfig", "load_sync_config",
    "DrawingNotFoundError", "MalformedReviewDataError", "MappingTargetNotFoundError",
    "build_mappings", "entity_bbox_model", "entity_geometry", "typical_member_width",
    "RebuildResult", "load_alignment", "load_mappings", "open_mapping_reviews", "rebuild_mappings", "save_alignment", "save_mappings",
    "level_elevation", "plan_section_from_objects",
    "confirm_mapping", "confirm_mapping_row", "mappings_needing_review", "resolve_mapping_reviews", "review_request_for",
    "LayerMappingRules", "RuleMatch", "layer_rule_match", "layer_rule_score", "load_layer_rules",
    "DrawingAlignment", "GridAlignResult", "alignment_from_similarity", "alignment_to_transform",
    "auto_align_by_grid", "auto_align_by_grid_detailed", "grid_from_ifc_objects", "kabsch_2d",
]
