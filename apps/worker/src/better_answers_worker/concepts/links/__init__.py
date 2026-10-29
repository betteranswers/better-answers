from ..concept_file import Scalar
from .edges import (
    CONCEPT_DEPRECATED_STATUS,
    CONCEPT_NODE_LABEL,
    DERIVED_FROM_LABEL,
    LINKS_TO_LABEL,
    SUPERSEDES_LABEL,
    BodyLink,
    CitationMark,
    OutgoingEdge,
    OutgoingReference,
    ResolvedTarget,
    UnresolvedReference,
    links_and_marks_of,
    outgoing_edges,
    references_of,
    unresolved_references,
)
from .fences import prose_of

PORT_OF = (
    "packages/schema/src/knowledge/concept-file.ts",
    "packages/core/src/store/map/write.ts",
)
AGREEMENT = "links"


__all__ = [
    "CONCEPT_DEPRECATED_STATUS",
    "CONCEPT_NODE_LABEL",
    "DERIVED_FROM_LABEL",
    "LINKS_TO_LABEL",
    "SUPERSEDES_LABEL",
    "BodyLink",
    "CitationMark",
    "OutgoingEdge",
    "OutgoingReference",
    "ResolvedTarget",
    "Scalar",
    "UnresolvedReference",
    "links_and_marks_of",
    "outgoing_edges",
    "prose_of",
    "references_of",
    "unresolved_references",
]
