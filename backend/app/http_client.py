"""Outbound HTTP client that bounds how much of a response it will read"""

import httpx

# 5 MB. The largest body any caller legitimately reads is a multi-year FX series at a few
# hundred KB, so this bounds a hostile or compromised endpoint without constraining real use
MAX_RESPONSE_BYTES = 5 * 1024 * 1024

# The capped read decodes as it counts, so the rebuilt response must not keep the headers
# describing the encoding and length of the original transfer
_STALE_TRANSFER_HEADERS = (b"content-encoding", b"content-length")


class ResponseTooLargeError(httpx.RequestError):
    """A response body went past the cap and was abandoned part-read

    Subclasses httpx's base error for a failed request so callers already handling a
    timeout or an unreachable provider treat an oversized one the same way, rather than
    letting it raise through to a 500
    """


class _CappedResponseClient(httpx.AsyncClient):
    """Async client that stops reading a response body once it passes the cap"""

    def __init__(self, *args, max_response_bytes: int = MAX_RESPONSE_BYTES, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.max_response_bytes = max_response_bytes

    async def send(self, request: httpx.Request, *, stream: bool = False, **kwargs) -> httpx.Response:
        """Read a response through a byte counter and return it with its body loaded

        Args:
            request: Request to send
            stream: Unsupported, since a caller reading the stream itself would not be counted
            **kwargs: Remaining httpx send arguments

        Returns:
            The response, already read, with the headers describing the raw transfer removed

        Raises:
            ResponseTooLargeError: The body went past the cap
            RuntimeError: A streaming read was asked for
        """
        if stream:
            raise RuntimeError("This client reads responses itself, so it cannot stream one")

        response = await super().send(request, stream=True, **kwargs)
        body = bytearray()
        try:
            async for chunk in response.aiter_bytes():
                body += chunk
                if len(body) > self.max_response_bytes:
                    raise ResponseTooLargeError(
                        f"Response body exceeded {self.max_response_bytes} bytes", request=request
                    )
        finally:
            await response.aclose()

        return httpx.Response(
            status_code=response.status_code,
            headers=[(name, value) for name, value in response.headers.raw
                     if name.lower() not in _STALE_TRANSFER_HEADERS],
            content=bytes(body),
            request=request,
            extensions=response.extensions,
        )


def build_http_client(timeout: float) -> httpx.AsyncClient:
    """Return an async HTTP client that refuses a response body past the cap

    Args:
        timeout: Per-request timeout in seconds

    Returns:
        An async client enforcing the response size cap
    """
    return _CappedResponseClient(timeout=timeout)
