"""Period At A Glance service for the insights page"""

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.insights import InsightsComparisonPeriod, InsightsPeriodAtAGlanceResponse
from app.services.dashboard import get_accessible_accounts
from app.services.insights.common import comparison_period_bounds
from app.services.insights.period_at_a_glance.category_highlights import get_period_at_a_glance_category_highlights
from app.services.insights.period_at_a_glance.net_worth_change import get_period_at_a_glance_net_worth_change
from app.services.insights.period_at_a_glance.period_totals import get_period_at_a_glance_income_expense_totals


async def get_period_at_a_glance(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
    comparison_period: InsightsComparisonPeriod = "same_length",
) -> InsightsPeriodAtAGlanceResponse:
    """Return compact insight totals for the Period At A Glance card"""
    previous_from_date, previous_to_date = comparison_period_bounds(from_date, to_date, comparison_period)
    all_accounts = await get_accessible_accounts(db, user)

    if not all_accounts:
        return InsightsPeriodAtAGlanceResponse(
            income=0,
            expenses=0,
            net_worth_change=0,
        )

    income, expenses, income_expense_fx_status = await get_period_at_a_glance_income_expense_totals(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
    )
    category_highlights = await get_period_at_a_glance_category_highlights(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
        previous_from_date,
        previous_to_date,
    )
    net_worth_change, net_worth_change_fx_status = await get_period_at_a_glance_net_worth_change(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
    )

    return InsightsPeriodAtAGlanceResponse(
        income=income,
        expenses=expenses,
        income_expense_fx_status=income_expense_fx_status,
        net_worth_change=net_worth_change,
        net_worth_change_fx_status=net_worth_change_fx_status,
        top_category_name=category_highlights.top_category[0] if category_highlights.top_category else None,
        top_category_share_pct=category_highlights.top_category[1] if category_highlights.top_category else None,
        top_category_fx_status=category_highlights.top_category_fx_status,
        biggest_change_name=category_highlights.biggest_change[0] if category_highlights.biggest_change else None,
        biggest_change_amount=category_highlights.biggest_change[1] if category_highlights.biggest_change else None,
        biggest_change_pct=category_highlights.biggest_change[2] if category_highlights.biggest_change else None,
        biggest_change_fx_status=category_highlights.biggest_change_fx_status,
    )
