"""Period At A Glance service for the insights page"""

from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.routes.users.date_helpers import get_current_user_date
from app.schemas.insights import InsightsComparisonPeriod, InsightsPeriodAtAGlanceResponse
from app.services.accounts.access import get_accessible_accounts
from app.services.insights.common import comparison_period_bounds
from app.services.insights.period_at_a_glance.category_highlight_helpers import get_period_at_a_glance_category_highlights
from app.services.insights.period_at_a_glance.net_worth_change_helpers import get_period_at_a_glance_net_worth_change
from app.services.insights.period_at_a_glance.period_total_helpers import get_period_at_a_glance_income_expense_totals
from app.services.insights.period_at_a_glance.response_helpers import build_period_at_a_glance_response


async def get_period_at_a_glance(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
    comparison_period: InsightsComparisonPeriod = "same_length",
) -> InsightsPeriodAtAGlanceResponse:
    """Return compact insight totals for the Period At A Glance card"""
    previous_from_date, previous_to_date = comparison_period_bounds(from_date, to_date, comparison_period)
    today = get_current_user_date(user)
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
        min(to_date, today),
    )
    category_highlights = await get_period_at_a_glance_category_highlights(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        min(to_date, today),
        previous_from_date,
        min(previous_to_date, today),
    )
    net_worth_change, net_worth_change_fx_status = await get_period_at_a_glance_net_worth_change(
        db,
        all_accounts,
        user.base_currency,
        min(from_date, today + timedelta(days=1)),
        min(to_date, today),
    )

    return build_period_at_a_glance_response(
        income=income,
        expenses=expenses,
        income_expense_fx_status=income_expense_fx_status,
        net_worth_change=net_worth_change,
        net_worth_change_fx_status=net_worth_change_fx_status,
        category_highlights=category_highlights,
    )
