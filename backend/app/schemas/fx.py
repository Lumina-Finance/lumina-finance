"""Foreign exchange schemas"""

from typing import Literal

from pydantic import BaseModel, Field

FxState = Literal["none", "complete", "incomplete", "unavailable"]
FxIssueReason = Literal["rate_not_found", "provider_unavailable"]


class FxRateIssue(BaseModel):
    """Details for a currency pair that could not be converted."""

    base: str
    quote: str


class FxStatus(BaseModel):
    """FX conversion status for a backend calculation."""

    state: FxState = "none"
    missing_pairs: list[FxRateIssue] = Field(default_factory=list)

    # The installed check's sentence when amounts in another currency were left out of the total rather than converted
    withheld_reason: str | None = None
