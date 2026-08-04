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
    """The error reaches callers that only handle httpx transport failures

    The FX helpers catch httpx.RequestError and the OIDC client catches httpx.HTTPError, so
    an error outside that hierarchy would reach a route as a 500 rather than the provider
    failure each of them already reports
    """
    client = _client_returning(lambda: _streamed(b"x" * (_SMALL_CAP_BYTES + 1), chunk_size=16),
                               max_response_bytes=_SMALL_CAP_BYTES)

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


def _gzipped(payload: bytes) -> httpx.Response:
    """Return a streaming gzip response carrying the given payload"""
    return _streamed(
        gzip.compress(payload),
        headers={"content-encoding": "gzip", "content-type": "application/json"},
    )


async def test_a_compressed_body_is_counted_after_it_expands():
    """The cap measures the memory a body takes, not the bytes that carried it

    A payload that compresses well is small on the wire and large in memory, and the memory
    is what the cap exists to bound, so this one is refused despite arriving under the cap
    """
    payload = b"x" * (_SMALL_CAP_BYTES * 100)
    assert len(gzip.compress(payload)) < _SMALL_CAP_BYTES

    client = _client_returning(lambda: _gzipped(payload), max_response_bytes=_SMALL_CAP_BYTES)

    async with client, pytest.raises(ResponseTooLargeError):
        await client.get(_URL)


async def test_a_compressed_body_within_the_cap_decodes_once():
    """A compressed body under the cap is decoded as it is counted and not decoded again

    The rebuilt response holds decoded bytes, so keeping the header saying they were gzipped
    would have the caller try to decode them a second time
    """
    client = _client_returning(lambda: _gzipped(b'{"rate": "1.35"}'))

    async with client:
        response = await client.get(_URL)

    assert response.json() == {"rate": "1.35"}
    assert "content-encoding" not in response.headers


def test_the_application_factory_carries_the_cap():
    """The builder the application calls returns a client holding the cap"""
    assert build_http_client(timeout=1.0).max_response_bytes == MAX_RESPONSE_BYTES


async def test_streaming_is_refused():
    """Asking this client to stream raises, since a caller-read body would go uncounted"""
    client = _client_returning(lambda: _streamed(b'{"rate": "1.35"}'))

    # Matched on the message, since httpx's own streaming errors are RuntimeError too
    async with client, pytest.raises(RuntimeError, match="cannot stream"):
        async with client.stream("GET", _URL):
            pass
