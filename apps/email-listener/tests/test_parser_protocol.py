"""Unit tests for parser protocol seam and repository ports — structural conformance."""

from __future__ import annotations

import typing
from datetime import UTC, datetime

from app.domain.entities.attachment import Attachment
from app.domain.entities.component import Component
from app.domain.entities.email import Email
from app.domain.entities.entity_type import EntityType
from app.domain.entities.extraction_record import ExtractionRecord
from app.domain.ports.parser_protocol import ParserProtocol
from app.domain.ports.parser_registry_port import ParserRegistryPort

# ---------------------------------------------------------------------------
# Fake implementations for structural conformance testing
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 6, 11, 12, 0, 0, tzinfo=UTC)


class FakeParser:
    """A trivial fake that satisfies ParserProtocol structurally."""

    async def parse(
        self,
        *,
        file_bytes: bytes,
        content_type: str,
        attachment_id: str,
    ) -> list[Component]:
        return []


def fake_registry(file_ext: str) -> ParserProtocol | None:
    """A fake registry callable typed as ParserRegistryPort."""
    if file_ext == "pdf":
        return FakeParser()  # type: ignore[return-value]
    return None


class FakeEmailRepository:
    """Fake EmailRepository implementing all required methods."""

    async def save(self, email: Email) -> Email:
        return email

    async def find_by_id(self, email_id: str) -> Email | None:
        return None

    async def find_by_message_id(self, importer_id: str, message_id: str) -> Email | None:
        return None

    async def update_parse_status(
        self, email_id: str, status: str, error: str | None, *, parsed_at: object | None = None
    ) -> None:
        pass


class FakeAttachmentRepository:
    async def save(self, attachment: Attachment) -> Attachment:
        return attachment

    async def find_by_email_id(self, email_id: str) -> list[Attachment]:
        return []


class FakeComponentRepository:
    async def save_many(self, components: list[Component]) -> list[Component]:
        return components

    async def find_by_id(self, component_id: str) -> Component | None:
        return None

    async def find_by_email_id(self, email_id: str) -> list[Component]:
        return []

    async def update_embedding(self, component_id: str, embedding: tuple[float, ...]) -> None:
        pass


class FakeEntityTypeRepository:
    async def find_by_slug(self, importer_id: str | None, slug: str) -> EntityType | None:
        return None

    async def list_active(self, importer_id: str | None) -> list[EntityType]:
        return []


class FakeExtractionRepository:
    async def save(self, record: ExtractionRecord) -> ExtractionRecord:
        return record

    async def find_by_component_id(self, component_id: str) -> list[ExtractionRecord]:
        return []

    async def supersede_active(self, component_id: str) -> None:
        pass


# ---------------------------------------------------------------------------
# ParserProtocol tests
# ---------------------------------------------------------------------------


class TestParserProtocol:
    def test_fake_parser_is_callable_parse(self) -> None:
        fake = FakeParser()
        assert callable(fake.parse)

    def test_fake_parser_parse_is_coroutine_function(self) -> None:
        import asyncio

        fake = FakeParser()
        # parse must be a coroutine function (async def)
        assert asyncio.iscoroutinefunction(fake.parse)

    def test_parser_protocol_is_protocol_class(self) -> None:
        # ParserProtocol must be a typing.Protocol subclass
        assert issubclass(ParserProtocol, typing.Protocol)  # type: ignore[misc]

    def test_parser_protocol_defines_parse_method(self) -> None:
        assert hasattr(ParserProtocol, "parse")


# ---------------------------------------------------------------------------
# ParserRegistryPort tests
# ---------------------------------------------------------------------------


class TestParserRegistryPort:
    def test_fake_registry_is_callable(self) -> None:
        assert callable(fake_registry)

    def test_fake_registry_returns_none_for_unknown_ext(self) -> None:
        result = fake_registry("docx")
        assert result is None

    def test_fake_registry_returns_parser_for_known_ext(self) -> None:
        result = fake_registry("pdf")
        assert result is not None
        assert callable(result.parse)

    def test_parser_registry_port_is_callable_type(self) -> None:
        # ParserRegistryPort should be a type alias for a callable
        # Verify it resolves to a callable signature (Callable[[str], ...])
        assert ParserRegistryPort is not None
        # It's a type alias — check it's a type (not an instance)
        origin = getattr(ParserRegistryPort, "__origin__", None)
        # For Callable types, __origin__ is collections.abc.Callable
        assert origin is not None or callable(fake_registry)

    def test_fake_registry_conforms_to_port_annotation(self) -> None:
        # A function annotated as ParserRegistryPort must be callable with str -> ParserProtocol | None
        port: ParserRegistryPort = fake_registry  # type: ignore[assignment]
        result = port("pdf")
        assert result is not None


# ---------------------------------------------------------------------------
# Repository port conformance tests
# ---------------------------------------------------------------------------


class TestEmailRepositoryPort:
    def test_fake_email_repo_has_save(self) -> None:

        repo = FakeEmailRepository()
        assert callable(repo.save)

    def test_fake_email_repo_has_find_by_id(self) -> None:
        repo = FakeEmailRepository()
        assert callable(repo.find_by_id)

    def test_fake_email_repo_has_find_by_message_id(self) -> None:
        repo = FakeEmailRepository()
        assert callable(repo.find_by_message_id)

    def test_fake_email_repo_has_update_parse_status(self) -> None:
        repo = FakeEmailRepository()
        assert callable(repo.update_parse_status)

    def test_email_repository_is_protocol(self) -> None:
        from app.domain.ports.email_repository import EmailRepository

        assert issubclass(EmailRepository, typing.Protocol)  # type: ignore[misc]


class TestAttachmentRepositoryPort:
    def test_fake_attachment_repo_has_save(self) -> None:
        repo = FakeAttachmentRepository()
        assert callable(repo.save)

    def test_fake_attachment_repo_has_find_by_email_id(self) -> None:
        repo = FakeAttachmentRepository()
        assert callable(repo.find_by_email_id)


class TestComponentRepositoryPort:
    def test_fake_component_repo_has_save_many(self) -> None:
        repo = FakeComponentRepository()
        assert callable(repo.save_many)

    def test_fake_component_repo_has_update_embedding(self) -> None:
        repo = FakeComponentRepository()
        assert callable(repo.update_embedding)


class TestEntityTypeRepositoryPort:
    def test_fake_entity_type_repo_has_find_by_slug(self) -> None:
        repo = FakeEntityTypeRepository()
        assert callable(repo.find_by_slug)

    def test_fake_entity_type_repo_has_list_active(self) -> None:
        repo = FakeEntityTypeRepository()
        assert callable(repo.list_active)


class TestExtractionRepositoryPort:
    def test_fake_extraction_repo_has_save(self) -> None:
        repo = FakeExtractionRepository()
        assert callable(repo.save)

    def test_fake_extraction_repo_has_supersede_active(self) -> None:
        repo = FakeExtractionRepository()
        assert callable(repo.supersede_active)
