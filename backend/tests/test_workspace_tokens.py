"""Session token generation and hashing. These tests need no database."""

import hashlib
import re

from app.services.workspaces import NewWorkspace, generate_token, hash_token

URL_SAFE = re.compile(r"^[A-Za-z0-9_-]+$")


def test_token_is_43_url_safe_characters():
    token = generate_token()
    assert len(token) == 43  # 32 random bytes, unpadded base64url
    assert URL_SAFE.match(token)


def test_tokens_are_unique():
    assert len({generate_token() for _ in range(1000)}) == 1000


def test_hash_is_sha256_hex_and_matches_an_independent_computation():
    token = "known-token-value"
    expected = hashlib.sha256(b"known-token-value").hexdigest()
    assert hash_token(token) == expected
    assert re.fullmatch(r"[0-9a-f]{64}", hash_token(token))


def test_hash_is_deterministic_and_distinct_per_token():
    first, second = generate_token(), generate_token()
    assert hash_token(first) == hash_token(first)
    assert hash_token(first) != hash_token(second)


def test_hash_does_not_contain_the_token():
    token = generate_token()
    assert token not in hash_token(token)
    assert hash_token(token) != token


def test_hash_fits_the_token_hash_column():
    assert len(hash_token(generate_token())) <= 128


def test_new_workspace_repr_never_contains_the_token():
    import uuid
    from datetime import UTC, datetime

    secret = generate_token()
    result = NewWorkspace(
        workspace_id=uuid.uuid4(),
        configuration_id=uuid.uuid4(),
        version_id=uuid.uuid4(),
        expires_at=datetime.now(UTC),
        token=secret,
    )
    assert secret not in repr(result)
    assert secret not in str(result)
    assert result.token == secret
