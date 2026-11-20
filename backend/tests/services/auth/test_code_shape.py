"""Authenticator code shapes: which typed texts can be a code at all"""

import pytest

from app.services.auth.code_shape import normalize_authenticator_code, normalize_recovery_code


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


@pytest.mark.parametrize(
    ("typed", "issued_form"),
    [
        ("able-acid-also-army-042", "able-acid-also-army-042"),
        ("  able-acid-also-army-042\n", "able-acid-also-army-042"),
        ("able acid also army 042", "able-acid-also-army-042"),
        ("able-acid also-army 042", "able-acid-also-army-042"),
    ],
)
def test_recovery_code_typed_with_spaces_or_hyphens_is_read_in_the_form_it_was_issued(typed, issued_form):
    """Spaces between the parts are the same code, since people copy codes without their hyphens"""
    assert normalize_recovery_code(typed) == issued_form


@pytest.mark.parametrize(
    "typed",
    [
        "able-acid-also-042",
        "able-acid-also-army-bean-042",
        "able-acid-also-army-42",
        "able-acid-also-army-0421",
        "Able-acid-also-army-042",
        "able-acid-also-army-04a",
        "able--acid-also-army-042",
        "able-acid-also-army042",
        "able\N{NON-BREAKING HYPHEN}acid-also-army-042",
        "123456",
        "",
    ],
)
def test_text_that_is_not_four_words_and_three_digits_is_not_a_recovery_code(typed):
    """Three or five words, two or four digits, capitals, doubled or odd separators and authenticator codes are refused"""
    assert normalize_recovery_code(typed) is None
