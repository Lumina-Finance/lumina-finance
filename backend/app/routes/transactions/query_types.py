"""Query value types shared by the transaction list, its CSV export and the refund-link candidates"""

from typing import Annotated

from fastapi import Query

from app.utils.date_window import WindowDate

# An inclusive end of the date range, held to the window every other date in the API sits in
DateFilter = Annotated[WindowDate | None, Query()]
