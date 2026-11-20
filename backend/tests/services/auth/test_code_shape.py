"""Authenticator code shapes: which typed texts can be a code at all"""

import pytest

from app.services.auth.code_shape import normalize_authenticator_code


@pytest.mark.parametrize(
    ("typed", "digits"),
    [
        ("123456", "123456"),
        (" 123456\n", "123456"),
        ("123 456", "123456"),
        ("123-456", "123456"),
        (" 123 456 ", "123456"),
    ],
)
def test_authenticator_code_in_a_form_an_app_shows_is_read_as_its_six_digits(typed, digits):
    """A code pasted with surrounding space, or split in two as the app displays it, checks as typed"""
    assert normalize_authenticator_code(typed) == digits


@pytest.mark.parametrize(
    "typed",
    [
        "12345",
        "1234567",
        "12 3456",
        "123  456",
        "123 - 456",
        "12345é",
        "é12345",
        "\N{ARABIC-INDIC DIGIT ONE}\N{ARABIC-INDIC DIGIT TWO}\N{ARABIC-INDIC DIGIT THREE}456",
        "12345\N{ARABIC-INDIC DIGIT SEVEN}",
        "123\N{NON-BREAKING HYPHEN}456",
        "",
        "abcdef",
        "same-same-same-same-123",
    ],
)
def test_text_that_is_not_six_ascii_digits_is_not_an_authenticator_code(typed):
    """Five and seven digits, digits of other scripts, odd separators and recovery codes are all refused"""
    assert normalize_authenticator_code(typed) is None
