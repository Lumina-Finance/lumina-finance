"""Query value types shared by the transaction list, its CSV export and the refund-link candidates"""

from typing import Annotated

from fastapi import Query
from pydantic import Field

from app.schemas.limits import NonNegativeMinorUnits
from app.utils.date_window import WindowDate

# The most currencies one filter takes. A person holds a handful, so a longer list is refused rather
# than sent to the database as that many placeholders. The id lists are left as they were, since a
# person can select as many accounts, categories, merchants or tags as they own
MAX_CURRENCY_FILTER_VALUES = 20

# An inclusive end of the date range, held to the window every other date in the API sits in
DateFilter = Annotated[WindowDate | None, Query()]

# An inclusive bound on the amount magnitude, up to the largest amount the ledger stores. The query
# compares it with a 64-bit column, and the database refuses a larger number outright
AmountFilter = Annotated[NonNegativeMinorUnits | None, Query()]

# Transaction currencies to keep, each a three-letter code
CurrencyFilter = Annotated[
    list[Annotated[str, Field(min_length=3, max_length=3)]] | None,
    Query(max_length=MAX_CURRENCY_FILTER_VALUES),
]
