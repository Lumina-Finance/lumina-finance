from pydantic import BaseModel


class InsightsPeriodGlanceResponse(BaseModel):
    """Compact payload for the insights period-glance card."""

    income: int
    expenses: int
    net_worth_change: int
    top_category_name: str | None = None
    top_category_share_pct: int | None = None
    biggest_change_name: str | None = None
    biggest_change_amount: int | None = None
    biggest_change_pct: int | None = None
