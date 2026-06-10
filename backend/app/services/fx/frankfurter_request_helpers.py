"""Frankfurter HTTP request helpers"""
from datetime import date

import httpx

from app.services.fx.errors import FxProviderUnavailableError, FxRateNotFoundError


async def request_frankfurter_rate_response(
    client: httpx.AsyncClient,
    url: str,
    base: str,
    quote: str,
    rate_date: date,
) -> httpx.Response:
    """Request one FX rate response from Frankfurter

    Args:
        client: HTTP client used for the provider request
        url: Frankfurter API base URL
        base: Source currency code
        quote: Target currency code
        rate_date: Date for the requested rate

    Returns:
        Raw HTTP response from the provider
    """
    try:
        response = await client.get(
            f"{url}/rate/{base}/{quote}",
            params={"date": rate_date.isoformat()},
        )
    except httpx.RequestError as exc:
        raise FxProviderUnavailableError("FX provider request failed") from exc

    _raise_for_rate_response_error(response, base, quote, rate_date)
    return response


async def request_frankfurter_rates_response(
    client: httpx.AsyncClient,
    url: str,
    base: str,
    quote: str,
    start_date: date,
    end_date: date,
) -> httpx.Response:
    """Request FX rate responses over a date range from Frankfurter

    Args:
        client: HTTP client used for the provider request
        url: Frankfurter API base URL
        base: Source currency code
        quote: Target currency code
        start_date: First date in the requested range
        end_date: Last date in the requested range

    Returns:
        Raw HTTP response from the provider
    """
    try:
        response = await client.get(
            f"{url}/rates",
            params={
                "base": base,
                "quotes": quote,
                "from": start_date.isoformat(),
                "to": end_date.isoformat(),
            },
        )
    except httpx.RequestError as exc:
        raise FxProviderUnavailableError("FX provider request failed") from exc

    _raise_for_rates_response_error(response, base, quote)
    return response


def _raise_for_rate_response_error(
    response: httpx.Response,
    base: str,
    quote: str,
    rate_date: date,
) -> None:
    """Raise the matching FX error for a single-rate response failure

    Args:
        response: Raw HTTP response from the provider
        base: Source currency code
        quote: Target currency code
        rate_date: Date for the requested rate

    Raises:
        FxProviderUnavailableError: Provider returned a server error
        FxRateNotFoundError: Provider returned a missing or invalid rate response
    """
    if response.status_code == httpx.codes.NOT_FOUND:
        raise FxRateNotFoundError(f"No FX rate found for {base}/{quote} on {rate_date.isoformat()}")
    if response.status_code >= 500:
        raise FxProviderUnavailableError("FX provider endpoint failed")

    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise FxRateNotFoundError(f"No FX rate found for {base}/{quote} on {rate_date.isoformat()}") from exc


def _raise_for_rates_response_error(
    response: httpx.Response,
    base: str,
    quote: str,
) -> None:
    """Raise the matching FX error for a date-range response failure

    Args:
        response: Raw HTTP response from the provider
        base: Source currency code
        quote: Target currency code

    Raises:
        FxProviderUnavailableError: Provider returned a server error
        FxRateNotFoundError: Provider returned a missing or invalid rate response
    """
    if response.status_code == httpx.codes.NOT_FOUND:
        raise FxRateNotFoundError(f"No FX rates found for {base}/{quote}")
    if response.status_code >= 500:
        raise FxProviderUnavailableError("FX provider endpoint failed")

    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise FxRateNotFoundError(f"No FX rates found for {base}/{quote}") from exc
