"""Deterministic identity for attachment-page components (REG-1 root fix).

Re-ingesting the same email must UPSERT the same attachment_page rows instead
of inserting fresh duplicates: ComponentRepository.save_many upserts on the
`id` column, so a page row is only stable across re-ingests when its id is a
pure function of WHAT the page is, not of when it was parsed.

Attachment ids are already deterministic — uuid5 over (email id, part index,
filename), and the email id itself is reused on redelivery/reprocess (see
IngestInboundEmailUseCase). A page's identity is therefore fully determined
by (attachment_id, page_index); minting uuid4 per parse (the pre-REG-1
behavior) made every reprocess insert a fresh duplicate page row, which
ProposeRegionsUseCase then re-segmented into duplicate pending regions.

Domain-layer module so both the infrastructure parser (which mints the ids)
and the application layer (which can recognize the canonical id when
de-duplicating historical rows) may share it without violating the
import-linter contracts.
"""

from __future__ import annotations

import uuid


def attachment_page_component_id(attachment_id: str, page_index: int) -> str:
    """Return the canonical, deterministic component id for one attachment page.

    Stable across re-ingests of the same email: same attachment + same page
    number -> same uuid5, so save_many (upsert on id) overwrites in place.
    """
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"nauta-attachment-page/{attachment_id}/{page_index}"))
