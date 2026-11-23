"""Foreign exchange schemas"""

from typing import Any, Literal

from pydantic import BaseModel, Field, SerializerFunctionWrapHandler, model_serializer

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

    @model_serializer(mode="wrap")
    def _omit_missing_reason(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        """Leave the reason out of a response while there is none, so a total that left nothing out reads as it always has"""
        data = handler(self)
        if data.get("withheld_reason") is None:
            data.pop("withheld_reason", None)
        return data
