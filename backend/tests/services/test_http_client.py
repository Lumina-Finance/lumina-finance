import gzip
from collections.abc import AsyncIterator

import httpx
import pytest

from app.http_client import MAX_RESPONSE_BYTES, ResponseTooLargeError, _CappedResponseClient, build_http_client

_URL = "https://provider.example/data"

# Small enough to exercise the boundary without building megabytes of test data
_SMALL_CAP_BYTES = 64


def _client_returning(response: httpx.Response) -> httpx.AsyncClient:
    """Return a capped client whose transport always answers with the given response

    Built directly rather than through build_http_client, which takes no transport because
    nothing in the application needs to substitute one

    Args:
        response: Response the transport hands back for every request

    Returns:
        A capped client wired to that transport
    """
    return _CappedResponseClient(timeout=1.0, transport=httpx.MockTransport(lambda request: response))


async def _oversized_chunks() -> AsyncIterator[bytes]:
    """Yield a body past the cap in chunks, so the response declares no length"""
    chunk = b"x" * (1024 * 1024)
    for _ in range(MAX_RESPONSE_BYTES // len(chunk) + 1):
        yield chunk


async def test_response_within_the_cap_is_returned_whole():
    """A normal response is read and handed back with its body and request intact"""
    client = _client_returning(httpx.Response(200, json={"rate": "1.35"}))

    async with client:
        response = await client.get(_URL)

    assert response.json() == {"rate": "1.35"}
    assert response.status_code == 200

    # raise_for_status needs the request, which is lost if the rebuilt response omits it
    response.raise_for_status()


async def test_declared_oversized_response_is_refused():
    """A response body past the cap raises rather than being read into memory"""
    client = _client_returning(httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 1)))

    async with client, pytest.raises(ResponseTooLargeError):
        await client.get(_URL)


async def test_undeclared_oversized_response_is_refused():
    """A streamed response with no declared length is counted as it arrives"""
    client = _client_returning(httpx.Response(200, content=_oversized_chunks()))

    async with client, pytest.raises(ResponseTooLargeError):
        await client.get(_URL)


async def test_oversized_response_is_caught_as_a_transport_failure():
    """The error reaches callers that only handle httpx transport failures"""
    client = _client_returning(httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 1)))

    async with client, pytest.raises(httpx.RequestError):
        await client.get(_URL)


async def test_compressed_response_decodes_once():
    """A gzipped body is decoded as it is counted, and the rebuilt response does not decode it again"""
    payload = b'{"rate": "1.35"}'
    client = _client_returning(httpx.Response(
        200,
        content=gzip.compress(payload),
        headers={"content-encoding": "gzip", "content-type": "application/json"},
    ))

    async with client:
        response = await client.get(_URL)

    assert response.json() == {"rate": "1.35"}


async def test_response_exactly_at_the_cap_is_returned():
    """A body the same size as the cap is accepted, so the limit is not off by one"""
    payload = b"x" * _SMALL_CAP_BYTES
    client = _CappedResponseClient(
        timeout=1.0,
        max_response_bytes=_SMALL_CAP_BYTES,
        transport=httpx.MockTransport(lambda request: httpx.Response(200, content=payload)),
    )

    async with client:
        response = await client.get(_URL)

    assert response.content == payload


async def test_response_one_byte_over_the_cap_is_refused():
    """One byte more than the cap is refused, so the limit is not off by one the other way"""
    client = _CappedResponseClient(
        timeout=1.0,
        max_response_bytes=_SMALL_CAP_BYTES,
        transport=httpx.MockTransport(lambda request: httpx.Response(200, content=b"x" * (_SMALL_CAP_BYTES + 1))),
    )

    async with client, pytest.raises(ResponseTooLargeError):
        await client.get(_URL)


def test_the_application_factory_carries_the_cap():
    """The builder the application calls returns a client holding the cap"""
    assert build_http_client(timeout=1.0).max_response_bytes == MAX_RESPONSE_BYTES


async def test_streaming_is_refused():
    """Asking this client to stream raises, since a caller-read body would go uncounted"""
    client = _client_returning(httpx.Response(200, json={"rate": "1.35"}))

    async with client, pytest.raises(RuntimeError):
        async with client.stream("GET", _URL):
            pass
