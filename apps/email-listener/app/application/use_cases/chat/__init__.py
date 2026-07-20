"""Carved-out collaborator modules for the RunChatTurn orchestrator (999.31).

Each module here is a cohesive unit extracted verbatim from run_chat_turn.py
(the merge-magnet carve): turn-state/delta folding, prompt+provider-message
assembly, thread+cluster context, linked-context resolution, and the
source-capture web_search result lookup. run_chat_turn.py stays the facade —
it re-exports every moved module-level symbol under its old name, so no
external import path changed.

Architecture contract (lint-imports): same as the facade — imports only
domain ports/services and standard library / structlog, never infrastructure.
"""
