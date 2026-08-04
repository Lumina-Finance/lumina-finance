import gzip
from collections.abc import AsyncIterator

import httpx
import pytest

from app.http_client import MAX_RESPONSE_BYTES, ResponseTooLargeError, _CappedResponseClient, build_http_client

_URL = "https://provider.example/data"

# Small enough to exercise the boundary without building megabytes of test data
_SMALL_CAP_BYTES = 64


def _streamed(content: bytes, chunk_size: int = 1024 * 1024, **kwargs) -> httpx.Response:
    """Return a response delivering its body in chunks, the way a real transport does

    A response built from plain bytes arrives already read, which is not what the client
    meets in production and would hide whether the counting path works at all

    Args:
        content: Body the response delivers
        chunk_size: Bytes per chunk
        **kwargs: Remaining httpx.Response arguments, such as headers

    Returns:
        A streaming response
    """
    async def chunks() -> AsyncIterator[bytes]:
        """Yield the body one chunk at a time"""
        for start in range(0, len(content), chunk_size):
            yield content[start:start + chunk_size]

    return httpx.Response(200, content=chunks(), **kwargs)


def _client_returning(build_response, max_response_bytes: int = MAX_RESPONSE_BYTES) -> httpx.AsyncClient:
    """Return a capped client whose transport answers with a freshly built response

    Built directly rather than through build_http_client, which takes no transport because
    nothing in the application needs to substitute one

    Args:
        build_response: Callable returning the response for a request
        max_response_bytes: Cap the client enforces

    Returns:
        A capped client wired to that transport
    """
    return _CappedResponseClient(
        timeout=1.0,
        max_response_bytes=max_response_bytes,
        transport=httpx.MockTransport(lambda request: build_response()),
    )


async def test_response_within_the_cap_is_returned_whole():
    """A normal response is read and handed back with its body and request intact"""
    client = _client_returning(lambda: _streamed(b'{"rate": "1.35"}'))

    async with client:
        response = await client.get(_URL)

    assert response.json() == {"rate": "1.35"}
    assert response.status_code == 200

    # raise_for_status needs the request, which is lost if the rebuilt response omits it
    response.raise_for_status()


async def test_oversized_response_is_refused():
    """A response body past the cap raises rather than being read into memory"""
    client = _client_returning(lambda: _streamed(b"x" * (MAX_RESPONSE_BYTES + 1)))

    async with client, pytest.raises(ResponseTooLargeError):
        await client.get(_URL)


async def test_oversized_response_is_caught_as_a_transport_failure():
    """The error reaches callers that only handle httpx transport failures"""
    client = _client_returning(lambda: _streamed(b"x" * (MAX_RESPONSE_BYTES + 1)))

    async with client, pytest.raises(httpx.RequestError):
        await client.get(_URL)


async def test_response_exactly_at_the_cap_is_returned():
    """A body the same size as the cap is accepted, so the limit is not off by one"""
    payload = b"x" * _SMALL_CAP_BYTES
    client = _client_returning(lambda: _streamed(payload, chunk_size=16), max_response_bytes=_SMALL_CAP_BYTES)

    async with client:
        response = await client.get(_URL)

    assert response.content == payload


async def test_response_one_byte_over_the_cap_is_refused():
    """One byte more than the cap is refused, so the limit is not off by one the other way"""
    client = _client_returning(
        lambda: _streamed(b"x" * (_SMALL_CAP_BYTES + 1), chunk_size=16),
        max_response_bytes=_SMALL_CAP_BYTES,
    )

    async with client, pytest.raises(ResponseTooLargeError):
        await client.get(_URL)


async def test_compression_is_declined():
    """The client asks for no compression, so the bytes it counts are the bytes that arrived

    Counting after decoding would let a few hundred compressed KB expand into gigabytes
    inside the process before the cap was ever consulted
    """
    sent_headers = {}

    def record(request: httpx.Request) -> httpx.Response:
        """Record the request headers and answer with an empty body"""
        sent_headers.update(request.headers)
        return _streamed(b"{}")

    client = _CappedResponseClient(
        timeout=1.0,
        headers={"accept-encoding": "identity"},
        transport=httpx.MockTransport(record),
    )

    async with client:
        await client.get(_URL)

    assert sent_headers["accept-encoding"] == "identity"


async def test_a_compressed_body_is_counted_compressed_and_still_decodes():
    """A provider compressing anyway is counted on its compressed size and still reads correctly

    The rebuilt response holds the bytes that arrived, so it keeps the header saying how they
    are encoded and the caller decodes them exactly once
    """
    payload = b'{"rate": "1.35"}'
    compressed = gzip.compress(payload)
    client = _client_returning(
        lambda: _streamed(compressed, headers={"content-encoding": "gzip", "content-type": "application/json"}),
        max_response_bytes=len(compressed),
    )

    async with client:
        response = await client.get(_URL)

    assert response.json() == {"rate": "1.35"}


def test_the_application_factory_carries_the_cap():
    """The builder the application calls returns a client holding the cap and declining compression"""
    client = build_http_client(timeout=1.0)

    assert client.max_response_bytes == MAX_RESPONSE_BYTES
    assert client.headers["accept-encoding"] == "identity"


async def test_streaming_is_refused():
    """Asking this client to stream raises, since a caller-read body would go uncounted"""
    client = _client_returning(lambda: _streamed(b'{"rate": "1.35"}'))

    async with client, pytest.raises(RuntimeError):
        async with client.stream("GET", _URL):
            pass
