"""Route table helpers"""

from collections.abc import Iterable, Iterator

from fastapi.routing import APIRoute

from app.main import app


def served_routes(routes: Iterable | None = None, prefix: str = "") -> Iterator[tuple[str, APIRoute]]:
    """Yield the full path and route of every route the app serves, through however many routers it is nested in

    The schema is no help here, since a route can be left out of it, as the app handoff is. A route a test
    module adds to the app is served too, so a caller that wants the app's own routes skips those

    Args:
        routes: The routes to walk, or None for the app's own
        prefix: The path the routes are nested under

    Yields:
        The route's path with every router prefix in front, and the route
    """
    for route in app.routes if routes is None else routes:
        if hasattr(route, "original_router"):
            yield from served_routes(route.original_router.routes, prefix + route.include_context.prefix)
        elif isinstance(route, APIRoute):
            yield prefix + route.path, route
