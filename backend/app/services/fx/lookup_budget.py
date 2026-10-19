"""Time budget for exchange rate provider calls within one request"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

# Total provider time one request may spend on exchange rates, across every attempt and retry
# pause. Past it a lookup fails as unavailable, which the panel shows as its exchange-rate
# status, so a slow or unreachable provider never holds a page anywhere near a gateway timeout
FX_LOOKUP_BUDGET_SECONDS = 5.0


class FxLookupBudget:
    """Provider time a request has spent on exchange rate lookups

    Only time inside provider attempts and the pauses between them is charged, so database work
    and cache writes between lookups never use it up
    """

    def __init__(self, seconds: float = FX_LOOKUP_BUDGET_SECONDS) -> None:
        """Start an unspent budget

        Args:
            seconds: Total provider time allowed
        """
        self.seconds = seconds
        self.spent = 0.0

    @property
    def remaining(self) -> float:
        """Provider time still available, never below zero"""
        return max(self.seconds - self.spent, 0.0)

    def charge(self, seconds: float) -> None:
        """Record provider time spent

        Args:
            seconds: Time spent in one attempt or pause
        """
        self.spent += seconds


# None outside a request, such as in a script, where only the provider's attempt count and
# per-attempt timeout bound a lookup
_current_budget: ContextVar[FxLookupBudget | None] = ContextVar("fx_lookup_budget", default=None)


def get_current_lookup_budget() -> FxLookupBudget | None:
    """Return the running request's budget, or None outside a request"""
    return _current_budget.get()


@contextmanager
def use_lookup_budget(budget: FxLookupBudget) -> Iterator[None]:
    """Charge provider lookups made inside the block to a budget

    Args:
        budget: Budget the lookups draw on
    """
    token = _current_budget.set(budget)
    try:
        yield
    finally:
        _current_budget.reset(token)


class FxLookupBudgetMiddleware:
    """Give every HTTP request a fresh exchange rate lookup budget

    Set and reset around each request rather than created on first use, because a server or
    test client can run several requests in one execution context, and a budget left over from
    one request would otherwise cut short the next
    """

    def __init__(self, app) -> None:
        """Wrap an ASGI app

        Args:
            app: ASGI application this wraps
        """
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        """Run the app with a fresh budget for an HTTP request"""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        with use_lookup_budget(FxLookupBudget()):
            await self.app(scope, receive, send)
