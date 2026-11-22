"""The ZIP archive of a user's data, streamed while the files are read"""

import io
import uuid
import zipfile
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.csv_export import UTF8_BYTE_ORDER_MARK, write_csv_rows
from app.services.data_export.files import DATA_EXPORT_FILES, DataExportFile
from app.services.data_export.references import ExportReferences, load_references
from app.utils.dates import resolve_timezone

ZIP_MEDIA_TYPE = "application/zip"


@dataclass(frozen=True)
class DataExport:
    """An archive being produced, with the name the user's download should carry"""

    filename: str
    chunks: AsyncIterator[bytes]


class _OutputBuffer(io.RawIOBase):
    """Collects what the archive writer produces so each piece can be sent as soon as it exists

    It can't seek, so the writer follows every entry with a data descriptor instead of going back to fill in
    sizes, and nothing but the piece waiting to be sent is ever held
    """

    def __init__(self) -> None:
        self._pending = bytearray()

    def writable(self) -> bool:
        return True

    def write(self, data: bytes | bytearray | memoryview) -> int:
        self._pending += data
        return len(data)

    def take(self) -> bytes:
        """Return what was written since the last call"""
        pending = bytes(self._pending)
        self._pending.clear()
        return pending


async def start_data_export(db: AsyncSession, user: User) -> DataExport:
    """Begin an archive of everything the user owns, every file read at the same moment

    The transaction authentication opened is ended, and the export opens its own as a read-only
    snapshot. The bank sync worker keeps writing while the files are produced, so without one file
    could show a transaction another is missing. The snapshot is opened by the export itself, so the
    row-level security identity is stamped on it as on any other transaction

    Args:
        db: Active database session. It must stay open and untouched while the chunks are read
        user: Authenticated user exporting their data

    Returns:
        The download's filename and the archive in chunks
    """
    # Read before the rollback, since it expires every loaded object
    user_id = user.id
    moment = datetime.now(resolve_timezone(user.tz))

    await db.rollback()
    await db.connection(execution_options={"isolation_level": "REPEATABLE READ", "postgresql_readonly": True})
    return DataExport(
        filename=f"lumina-finance-export-{moment.date().isoformat()}.zip",
        chunks=_stream_archive(db, user_id, DATA_EXPORT_FILES, moment),
    )


async def _stream_archive(db: AsyncSession, user_id: uuid.UUID, files: Sequence[DataExportFile], moment: datetime) -> AsyncIterator[bytes]:
    """Yield the archive piece by piece, a CSV chunk after it has been compressed

    Each entry carries the moment of the export on the user's own clock, the one a file manager shows

    The generator only reads. A failure part way propagates before the archive's directory is sent, so the
    connection is cut and the download fails instead of ending as an archive that looks complete
    """
    references = await load_references(db, user_id)
    buffer = _OutputBuffer()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            # An entry's size isn't known before it is written, so it is allowed to need ZIP64
            info = zipfile.ZipInfo(file.name, date_time=moment.timetuple()[:6])
            info.compress_type = zipfile.ZIP_DEFLATED
            with archive.open(info, "w", force_zip64=True) as entry:
                async for text in _csv_text(db, user_id, references, file):
                    entry.write(text.encode("utf-8"))

                    # The compressor holds back small writes, so some chunks add nothing to send yet
                    if piece := buffer.take():
                        yield piece
    yield buffer.take()


async def _csv_text(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences, file: DataExportFile) -> AsyncIterator[str]:
    """Yield a file's header and then its rows as CSV text, one chunk at a time"""
    yield UTF8_BYTE_ORDER_MARK + write_csv_rows([file.header])
    async for rows in file.rows(db, user_id, references):
        yield write_csv_rows(rows)
