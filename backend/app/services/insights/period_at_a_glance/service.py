"""Period At A Glance service for the insights page"""

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.insights import InsightsComparisonPeriod, InsightsPeriodAtAGlanceResponse
from app.services.dashboard import get_accessible_accounts
from app.services.fx import FxConverter
from app.services.insights.common import comparison_period_bounds
from app.services.insights.period_at_a_glance.category_highlights import (
    get_period_at_a_glance_biggest_category_change,
    get_period_at_a_glance_top_category,
)
from app.services.insights.period_at_a_glance.category_totals import get_period_at_a_glance_category_net_totals
from app.services.insights.period_at_a_glance.conversion import (
    get_period_at_a_glance_currency_exponents,
)
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
    top_category_converter = FxConverter(
        currency_exponents=await get_period_at_a_glance_currency_exponents(
            db,
            {user.base_currency, *(account.currency for account in all_accounts)},
        ),
    )
    current_top_category_net_totals = await get_period_at_a_glance_category_net_totals(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
        top_category_converter,
    )
    biggest_change_converter = FxConverter(
        currency_exponents=await get_period_at_a_glance_currency_exponents(
            db,
            {user.base_currency, *(account.currency for account in all_accounts)},
        ),
    )
    current_category_net_totals = await get_period_at_a_glance_category_net_totals(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
        biggest_change_converter,
    )
    previous_category_net_totals = await get_period_at_a_glance_category_net_totals(
        db,
        all_accounts,
        user.base_currency,
        previous_from_date,
        previous_to_date,
        biggest_change_converter,
    )
    net_worth_change, net_worth_change_fx_status = await get_period_at_a_glance_net_worth_change(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
    )
    top_category = get_period_at_a_glance_top_category(current_top_category_net_totals)
    top_category_fx_status = top_category_converter.get_status()
    biggest_change = get_period_at_a_glance_biggest_category_change(current_category_net_totals, previous_category_net_totals)
    biggest_change_fx_status = biggest_change_converter.get_status()

    return InsightsPeriodAtAGlanceResponse(
        income=income,
        expenses=expenses,
        income_expense_fx_status=income_expense_fx_status,
        net_worth_change=net_worth_change,
        net_worth_change_fx_status=net_worth_change_fx_status,
        top_category_name=top_category[0] if top_category else None,
        top_category_share_pct=top_category[1] if top_category else None,
        top_category_fx_status=top_category_fx_status,
        biggest_change_name=biggest_change[0] if biggest_change else None,
        biggest_change_amount=biggest_change[1] if biggest_change else None,
        biggest_change_pct=biggest_change[2] if biggest_change else None,
        biggest_change_fx_status=biggest_change_fx_status,
    )
