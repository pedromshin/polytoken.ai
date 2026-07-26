"""Tests for DeleteImporterDataUseCase — account-deletion blob erasure.

The scope is DERIVED from the user_id via a fake AccountDeletionReader (tenant
safety: never from caller input). Covers: deletes the right things + counts;
`complete` is True only when every derived item deleted; idempotent/retry-safe;
per-item failures isolated (and drop `complete` to False so the web aborts the
cascade); a blank user_id is rejected.
"""

from __future__ import annotations

import pytest

from app.application.use_cases.delete_importer_data import DeleteImporterDataUseCase


class _FakeReader:
    def __init__(self, importer_ids: list[str], raw_keys: list[str]) -> None:
        self._importer_ids = importer_ids
        self._raw_keys = raw_keys

    async def importer_ids_for_user(self, user_id: str) -> list[str]:
        return list(self._importer_ids)

    async def raw_storage_keys_for_user(self, user_id: str) -> list[str]:
        return list(self._raw_keys)


class _FakeRawStore:
    def __init__(self, *, fail_keys: set[str] | None = None) -> None:
        self.deleted: list[str] = []
        self._fail_keys = fail_keys or set()

    async def delete_by_key(self, storage_key: str) -> None:
        if storage_key in self._fail_keys:
            raise RuntimeError(f"raw delete boom: {storage_key}")
        self.deleted.append(storage_key)

    # Unused here, present only to satisfy the RawEmailStore protocol.
    async def fetch(self, message_id: str) -> bytes:
        raise NotImplementedError

    def key_for(self, message_id: str) -> str:
        raise NotImplementedError


class _FakeAttachmentStore:
    def __init__(self, *, fail_ids: set[str] | None = None) -> None:
        self.deleted: list[str] = []
        self._fail_ids = fail_ids or set()

    async def delete_prefix(self, importer_id: str) -> None:
        if importer_id in self._fail_ids:
            raise RuntimeError(f"prefix delete boom: {importer_id}")
        self.deleted.append(importer_id)

    # Unused by this use case, present only to satisfy the AttachmentStorage protocol.
    async def store(self, storage_key: str, data: bytes, content_type: str) -> None:
        raise NotImplementedError

    async def fetch(self, storage_key: str) -> bytes:
        raise NotImplementedError


def _uc(reader: _FakeReader, raw: _FakeRawStore, att: _FakeAttachmentStore) -> DeleteImporterDataUseCase:
    return DeleteImporterDataUseCase(reader=reader, raw_store=raw, attachment_storage=att)


@pytest.mark.asyncio
async def test_deletes_derived_scope_and_is_complete() -> None:
    reader = _FakeReader(["imp-a", "imp-b"], ["inbound/ses-1", "backfill/bf-2"])
    raw, att = _FakeRawStore(), _FakeAttachmentStore()

    result = await _uc(reader, raw, att).execute(user_id="user-1")

    assert raw.deleted == ["inbound/ses-1", "backfill/bf-2"]
    assert att.deleted == ["imp-a", "imp-b"]
    assert result.deleted_raw == 2
    assert result.deleted_attachment_prefixes == 2
    assert result.complete is True


@pytest.mark.asyncio
async def test_user_with_no_data_is_a_complete_noop() -> None:
    reader = _FakeReader([], [])
    raw, att = _FakeRawStore(), _FakeAttachmentStore()

    result = await _uc(reader, raw, att).execute(user_id="user-1")

    assert raw.deleted == []
    assert att.deleted == []
    assert result.deleted_raw == 0
    assert result.deleted_attachment_prefixes == 0
    assert result.complete is True


@pytest.mark.asyncio
async def test_blank_user_id_rejected() -> None:
    with pytest.raises(ValueError, match="user_id"):
        await _uc(_FakeReader([], []), _FakeRawStore(), _FakeAttachmentStore()).execute(user_id="  ")


@pytest.mark.asyncio
async def test_raw_failure_isolated_and_marks_incomplete() -> None:
    reader = _FakeReader(["imp-a"], ["inbound/ses-1", "inbound/ses-bad", "backfill/bf-2"])
    raw = _FakeRawStore(fail_keys={"inbound/ses-bad"})
    att = _FakeAttachmentStore()

    result = await _uc(reader, raw, att).execute(user_id="user-1")

    assert raw.deleted == ["inbound/ses-1", "backfill/bf-2"]  # good keys still deleted
    assert result.deleted_raw == 2
    assert att.deleted == ["imp-a"]  # a raw failure never blocks the attachment sweep
    # A shortfall marks the run INCOMPLETE so the web aborts before the cascade.
    assert result.complete is False


@pytest.mark.asyncio
async def test_prefix_failure_isolated_and_marks_incomplete() -> None:
    reader = _FakeReader(["imp-a", "imp-bad", "imp-c"], ["inbound/ses-1"])
    raw = _FakeRawStore()
    att = _FakeAttachmentStore(fail_ids={"imp-bad"})

    result = await _uc(reader, raw, att).execute(user_id="user-1")

    assert att.deleted == ["imp-a", "imp-c"]
    assert result.deleted_attachment_prefixes == 2
    assert result.deleted_raw == 1
    assert result.complete is False
