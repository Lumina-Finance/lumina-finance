"""The archive streams every row of a long file, and a failure part way leaves nothing that opens as a complete archive"""

import csv
import io
import uuid
import zipfile
from datetime import UTC, date, datetime

import pytest

from app.models.account import Account
from app.models.base import AccountKind, AccountType, CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.services.csv_export import EXPORT_CHUNK_SIZE
from app.services.data_export import archive
from app.services.data_export.files import DataExportFile
from tests.conftest import TestSession
from tests.routes.support.identity_helpers import _act_as, _seed_users


async def _read_all(chunks) -> bytes:
    return b"".join([chunk async for chunk in chunks])


async def test_transactions_file_holds_every_row_across_chunks():
    """One row more than a chunk holds still arrives whole, each with its own number."""
    [user] = await _seed_users("long@example.com")
    count = EXPORT_CHUNK_SIZE + 1
    async with TestSession() as session:
        account = Account(owner_id=user.id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Everyday", currency="CAD")
        category = Category(owner_id=user.id, name="Everything", kind=CategoryKind.EXPENSE)
        session.add_all([account, category])
        await session.flush()
        session.add_all(
            Transaction(
                created_by_user_id=user.id,
                account_id=account.id,
                category_id=category.id,
                dt=date(2026, 3, 15),
                amount=-(index + 1),
                currency="CAD",
            )
            for index in range(count)
        )
        await session.commit()

    async with _act_as(user.id) as session:
        export = await archive.start_data_export(session, user)
        content = await _read_all(export.chunks)

    text = zipfile.ZipFile(io.BytesIO(content)).read("transactions.csv").decode("utf-8")
    rows = list(csv.reader(io.StringIO(text.removeprefix("﻿"))))[1:]
    assert len(rows) == count
    assert sorted(int(row[0]) for row in rows) == list(range(1, count + 1)), "each row has its own number"
    assert {row[6] for row in rows} == {f"-{cents // 100}.{cents % 100:02d}" for cents in range(1, count + 1)}, "each row has its own amount"


async def test_entries_are_dated_with_the_moment_of_the_export_on_the_users_clock(freeze_now):
    """Each entry carries the export's moment on the user's clock, not the 1980 a ZIP entry defaults to, and stays compressed."""
    [user] = await _seed_users("dated@example.com")

    # Half past nine at night in Toronto is already the next day in UTC, so a clock read in UTC dates the entries wrongly
    freeze_now(archive, datetime(2026, 3, 15, 1, 30, tzinfo=UTC))
    async with _act_as(user.id) as session:
        export = await archive.start_data_export(session, user)
        content = await _read_all(export.chunks)

    entries = zipfile.ZipFile(io.BytesIO(content)).infolist()
    assert entries
    assert export.filename == "lumina-finance-export-2026-03-14.zip"
    for entry in entries:
        assert entry.date_time == (2026, 3, 14, 21, 30, 0), f"{entry.filename} is dated at the export's moment in Toronto"
        assert entry.compress_type == zipfile.ZIP_DEFLATED


async def test_failure_part_way_leaves_bytes_that_do_not_open_as_an_archive(monkeypatch):
    """The error reaches the response, so the download breaks instead of saving an archive that looks complete."""

    async def long_file(db, user_id, references):
        for _ in range(100):
            yield [[uuid.uuid4().hex] for _ in range(100)]

    async def failing_file(db, user_id, references):
        yield [["first"]]
        raise RuntimeError("the database dropped")

    monkeypatch.setattr(
        archive, "DATA_EXPORT_FILES", (DataExportFile("long.csv", ("Id",), long_file), DataExportFile("failing.csv", ("Value",), failing_file))
    )
    [user] = await _seed_users("failing@example.com")

    received = []
    async with _act_as(user.id) as session:
        export = await archive.start_data_export(session, user)
        with pytest.raises(RuntimeError, match="the database dropped"):
            async for chunk in export.chunks:
                received.append(chunk)

    assert received, "bytes were already sent when it failed"
    with pytest.raises(zipfile.BadZipFile):
        zipfile.ZipFile(io.BytesIO(b"".join(received)))
