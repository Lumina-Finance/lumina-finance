"""Currency schemas"""

from pydantic import BaseModel


class CurrencyResponse(BaseModel):
    """Read-only currency reference data."""

    id: str
    name: str
    symbol: str
    minor_unit_exponent: int

    model_config = {"from_attributes": True}
