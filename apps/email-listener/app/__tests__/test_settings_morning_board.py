"""Settings gate for the self-assembling morning board (Phase 74, MORN-06).

MORN-06 (ship-dark): ``MORNING_BOARD_ENABLED`` MUST default False so the feature
merges into the LIVE mail receiver fully dark — the composition provider passes
this default straight into the use case's ``enabled`` param, and a False value
makes the assemble route a 200 no-op that composes/writes nothing. Sits with the
settings-shape assertions (sibling to how ANTICIPATORY_PROMPTING_ENABLED is the
one global off switch that ships dark by default).
"""

from __future__ import annotations

from app.settings import BaseAppSettings, DevSettings, ProdSettings, StagingSettings


def test_morning_board_disabled_by_default_across_environments() -> None:
    for settings_cls in (BaseAppSettings, DevSettings, StagingSettings, ProdSettings):
        settings = settings_cls()
        assert settings.MORNING_BOARD_ENABLED is False, (
            f"{settings_cls.__name__}.MORNING_BOARD_ENABLED must default False (ship-dark, MORN-06)"
        )


def test_morning_board_flag_is_a_plain_bool_field() -> None:
    """Mirrors ANTICIPATORY_PROMPTING_ENABLED — a plain bool field, no @property wrapper."""
    assert "MORNING_BOARD_ENABLED" in BaseAppSettings.model_fields
    assert BaseAppSettings.model_fields["MORNING_BOARD_ENABLED"].annotation is bool
