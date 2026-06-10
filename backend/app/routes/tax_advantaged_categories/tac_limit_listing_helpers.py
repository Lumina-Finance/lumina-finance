"""TAC limit listing helpers"""

import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedCategoryLimit
from app.routes.tax_advantaged_categories.tac_category_helpers import get_owned_tax_advantaged_category_or_404
from app.routes.tax_advantaged_categories.tac_limit_helpers import get_tac_limits_for_tax_advantaged_category


async def get_tac_limits_for_owned_tax_advantaged_category(
    db: AsyncSession,
    tax_advantaged_category_id: uuid.UUID,
    owner_id: uuid.UUID,
) -> Sequence[TaxAdvantagedCategoryLimit]:
    """Return yearly TAC limits after checking category ownership

    Args:
        db: Active database session
        tax_advantaged_category_id: Tax-advantaged category identifier whose limits should be listed
        owner_id: Authenticated owner identifier

    Returns:
        Yearly TAC limits ordered by year

    Raises:
        HTTPException: Tax-advantaged category does not exist or belongs to another user
    """
    await get_owned_tax_advantaged_category_or_404(db, tax_advantaged_category_id, owner_id)
    limit_rows = await get_tac_limits_for_tax_advantaged_category(db, tax_advantaged_category_id)
    return limit_rows
