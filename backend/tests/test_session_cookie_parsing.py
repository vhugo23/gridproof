"""extract_session_token: pure parsing, no database."""

import pytest

from app.services.sessions import COOKIE_NAME, extract_session_token

TOKEN = "A" * 43
OTHER = "B" * 43


def test_accepts_one_well_formed_cookie():
    assert extract_session_token([f"{COOKIE_NAME}={TOKEN}"]) == TOKEN


def test_finds_the_cookie_among_others():
    assert extract_session_token([f"a=1; {COOKIE_NAME}={TOKEN}; b=2"]) == TOKEN


def test_url_safe_alphabet_is_accepted():
    token = ("-_aZ09" * 8)[:43]
    assert len(token) == 43
    assert extract_session_token([f"{COOKIE_NAME}={token}"]) == token


@pytest.mark.parametrize(
    "header",
    [
        "",
        "other=1",
        f"{COOKIE_NAME}=",
        f"{COOKIE_NAME}={'A' * 42}",
        f"{COOKIE_NAME}={'A' * 44}",
        f"{COOKIE_NAME}={'A' * 4000}",
        f"{COOKIE_NAME}={'A' * 42}!",
        f"{COOKIE_NAME}={'A' * 42}=",
        f"{COOKIE_NAME}={'A' * 42}é",
        f'{COOKIE_NAME}="{"A" * 41}"',
        f"x{COOKIE_NAME}={TOKEN}",
        f"{COOKIE_NAME}x={TOKEN}",
        COOKIE_NAME,
    ],
)
def test_malformed_or_absent_is_none(header):
    assert extract_session_token([header]) is None


def test_no_headers_is_none():
    assert extract_session_token([]) is None


def test_duplicate_cookie_is_invalid_even_with_identical_values():
    assert (
        extract_session_token([f"{COOKIE_NAME}={TOKEN}; {COOKIE_NAME}={OTHER}"]) is None
    )
    assert (
        extract_session_token([f"{COOKIE_NAME}={TOKEN}; {COOKIE_NAME}={TOKEN}"]) is None
    )


def test_duplicate_across_header_lines_is_invalid():
    assert (
        extract_session_token([f"{COOKIE_NAME}={TOKEN}", f"{COOKIE_NAME}={OTHER}"])
        is None
    )
