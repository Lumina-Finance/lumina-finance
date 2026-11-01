"""What a row carries once its tag name, which already matches a tag, is answered another way"""

from app.models.tag import Tag
from app.schemas.import_run import TransactionImportTagMapping
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.tags import create_missing_import_tags, get_import_row_tags, load_import_tags
from tests.conftest import TestSession
from tests.services.importers._helpers import _seed_user


async def _carried_names(answer):
    """Resolve the file name TRAVEL, which matches the tag Travel, with an answer, and name what a row carries

    Args:
        answer: Builds the mapping for the name from the id of the tag Holiday, or None to leave it alone

    Returns:
        The names of the tags a row carrying the name is given, and the id of the tag Travel
    """
    async with TestSession() as session:
        user_id = (await _seed_user(session)).id
        travel = Tag(owner_id=user_id, group_id=None, name="Travel")
        holiday = Tag(owner_id=user_id, group_id=None, name="Holiday")
        session.add_all([travel, holiday])
        await session.flush()
        mappings = [answer(holiday.id)] if answer else []
        tags = await load_import_tags(session, user_id)
        stats = ImportStats()

        await create_missing_import_tags(session, user_id, ["TRAVEL"], mappings, tags, stats)

        return [tag.name for tag in get_import_row_tags(["TRAVEL"], tags, stats)]


async def test_a_name_matching_a_tag_and_left_unanswered_carries_the_match():
    """Without an answer the name files its rows under the tag it matches."""
    assert await _carried_names(None) == ["Travel"]


async def test_a_name_matching_a_tag_and_answered_with_another_tag_carries_that_tag():
    """The match is only the default, so pointing the name at Holiday leaves Travel off the row."""
    answer = lambda holiday_id: TransactionImportTagMapping(source="TRAVEL", tag_id=holiday_id)  # noqa: E731

    assert await _carried_names(answer) == ["Holiday"]


async def test_a_name_matching_a_tag_and_answered_with_a_corrected_name_carries_that_name():
    """A correction creates the tag under the new name rather than filing the row under the match."""
    answer = lambda _: TransactionImportTagMapping(source="TRAVEL", create={"name": "Getaway"})  # noqa: E731

    assert await _carried_names(answer) == ["Getaway"]


async def test_a_name_matching_a_tag_and_answered_skip_carries_no_tag():
    """Skip drops the tag from the row even though the name matches one."""
    answer = lambda _: TransactionImportTagMapping(source="TRAVEL", skip=True)  # noqa: E731

    assert await _carried_names(answer) == []
