"""Helpers shared by every export that streams CSV text to a download"""

import csv
import io
from collections.abc import AsyncIterator
from decimal import Decimal

from fastapi.responses import StreamingResponse

# Rows read and written per round of lookups, so memory stays bounded however long the export is
EXPORT_CHUNK_SIZE = 500

# Marks the file as UTF-8 for spreadsheet apps that would otherwise read accents as another encoding
UTF8_BYTE_ORDER_MARK = "﻿"

CSV_MEDIA_TYPE = "text/csv; charset=utf-8"

# A spreadsheet reads a cell starting with one of these as a formula, so text cells starting with one
# get a leading apostrophe. The spreadsheet hides it and treats the rest as plain text
FORMULA_TRIGGER_CHARACTERS = ("=", "+", "-", "@", "\t", "\r", "\n")


def neutralize_spreadsheet_formula(text: str) -> str:
    """Return text that a spreadsheet shows as written instead of running it as a formula

    Args:
        text: Text typed by a user or brought in by an import

    Returns:
        The text, with a leading apostrophe when its first character would start a formula
    """
    if text.startswith(FORMULA_TRIGGER_CHARACTERS):
        return "'" + text
    return text


def format_minor_units(amount: int, exponent: int) -> str:
    """Write integer minor units as a plain decimal in major units without rounding

    Args:
        amount: Signed amount in minor units
        exponent: Minor-unit exponent of the amount's currency

    Returns:
        The amount with exactly ``exponent`` decimals, such as ``-12.50``
    """
    return f"{Decimal(amount).scaleb(-exponent):.{exponent}f}"


def write_csv_rows(rows: list[list[str]] | list[tuple[str, ...]]) -> str:
    """Return rows as CSV text, quoting any cell holding a comma, quote or line break"""
    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    return buffer.getvalue()


def download_response(chunks: AsyncIterator[str] | AsyncIterator[bytes], filename: str, media_type: str) -> StreamingResponse:
    """Wrap streamed chunks as an attachment that is never cached"""
    return StreamingResponse(
        chunks,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
