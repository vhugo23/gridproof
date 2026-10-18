"""ConfigurationName validation. These tests need no database."""

import pytest
from pydantic import BaseModel, ValidationError

from app.domain.system_config import (
    ConfigurationName,
    RuleError,
    validate_configuration_name,
    validation_details,
)


class Body(BaseModel):
    name: ConfigurationName


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Fridley Test Configuration", "Fridley Test Configuration"),
        ("x", "x"),
        ("x" * 100, "x" * 100),
        ("  padded  ", "padded"),
        ("two  inner   spaces", "two  inner   spaces"),
        ("Résumé 配置 ⚡", "Résumé 配置 ⚡"),
        ("v2", "v2"),
        ("---", "---"),
        (" em-space padded ", "em-space padded"),
    ],
)
def test_valid_names_are_accepted_and_trimmed(name, expected):
    assert validate_configuration_name(name) == expected


@pytest.mark.parametrize(
    "name,reason",
    [
        ("", "Must be 1 to 100 characters"),
        ("   ", "Must be 1 to 100 characters"),
        ("\t\n", "Must be 1 to 100 characters"),
        ("  ", "Must be 1 to 100 characters"),
        ("x" * 101, "Must be 1 to 100 characters"),
        ("  " + "x" * 101 + "  ", "Must be 1 to 100 characters"),
        ("line\nbreak", "Must not contain control characters"),
        ("tab\tinside", "Must not contain control characters"),
        ("nul\x00byte", "Must not contain control characters"),
        ("bell\x07", "Must not contain control characters"),
        ("esc\x1b[31m", "Must not contain control characters"),
        ("del\x7f", "Must not contain control characters"),
        ("\u200b", "Must contain a visible character"),
        ("\u200b‍﻿", "Must contain a visible character"),
        ("  \u200b  ", "Must contain a visible character"),
        ("́", "Must contain a visible character"),
    ],
)
def test_invalid_names_are_rejected(name, reason):
    with pytest.raises(RuleError) as exc:
        validate_configuration_name(name)
    assert str(exc.value) == reason


@pytest.mark.parametrize("value", [None, 5, 5.5, True, b"bytes", ["x"], {"a": 1}])
def test_non_text_is_rejected(value):
    with pytest.raises(RuleError, match="Must be text"):
        validate_configuration_name(value)


def test_exactly_100_characters_after_trimming_is_the_limit():
    assert validate_configuration_name(" " + "y" * 100 + " ") == "y" * 100
    with pytest.raises(RuleError):
        validate_configuration_name("y" * 101)


def test_works_as_a_pydantic_field_type_and_trims():
    assert Body(name="  ok  ").name == "ok"


def test_pydantic_field_errors_are_translated_without_echoing_input():
    secret = "s3cret\x00-VALUE"
    with pytest.raises(ValidationError) as exc:
        Body(name=secret)
    details = validation_details(exc.value)
    assert details == [
        {"field": "name", "reason": "Must not contain control characters"}
    ]
    assert "s3cret" not in str(details)
