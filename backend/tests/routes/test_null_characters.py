"""A NUL character is refused wherever a request carries one, before any route or database call"""

import pytest

from app.null_characters import NULL_CHARACTER_REFUSAL

_REFUSAL = {"type": "value_error", "msg": NULL_CHARACTER_REFUSAL}


def _detail(location: list) -> dict:
    """Return the one error a refusal answers with, at a location"""
    return {"detail": [{**_REFUSAL, "loc": location}]}


async def test_a_nul_in_a_query_value_is_refused_on_that_parameter(client):
    """A NUL in a query string is refused by the parameter's name"""
    resp = await client.get("/currencies?search=%00")

    assert resp.status_code == 422
    assert resp.json() == _detail(["query", "search"])


async def test_a_nul_in_a_json_text_is_refused_at_its_place_in_the_body(client):
    """A NUL deep in a body is named by the keys and positions leading to it"""
    body = {"email": "a@example.com", "password": "x", "extra": [{"note": "a\u0000b"}]}

    resp = await client.post("/auth/login", json=body)

    assert resp.status_code == 422
    assert resp.json() == _detail(["body", "extra", 0, "note"])


async def test_a_nul_in_a_json_key_is_refused_at_the_object_holding_it(client):
    """A NUL in a key names the object that holds the key, since the key itself is the request's own"""
    resp = await client.post("/auth/login", json={"email": "a@example.com", "password": "x", "bad\u0000key": 1})

    assert resp.status_code == 422
    assert resp.json() == _detail(["body"])


async def test_the_refusal_never_repeats_the_text_it_refused(client):
    """What the request sent, apart from the place it sat, is not in the answer"""
    secret = "hunter2-" + "s" * 40

    resp = await client.post("/auth/login", json={"email": "a@example.com", "password": f"{secret}\u0000"})

    assert resp.status_code == 422
    assert secret not in resp.text


async def test_a_long_key_is_cut_short_in_the_answer(client):
    """A key as long as the body is not repeated whole"""
    key = "k" * 5_000

    resp = await client.post("/auth/login", json={"email": "a@example.com", "password": "x", key: "a\u0000"})

    assert resp.status_code == 422
    assert resp.json() == _detail(["body", "k" * 64])


async def test_an_escaped_backslash_before_u0000_is_text_and_not_a_nul(client):
    """The six characters backslash, u, 0, 0, 0, 0 sent as text are an ordinary string, so the login runs"""
    resp = await client.post("/auth/login", json={"email": "a@example.com", "password": "\\u0000"})

    assert resp.status_code == 401


async def test_a_body_that_is_not_json_is_left_to_the_route(client):
    """A body that does not parse as JSON is not scanned, so the route keeps the parser it already has"""
    resp = await client.post("/auth/login", content=b"a\x00b", headers={"content-type": "text/plain"})

    assert resp.status_code == 422
    assert resp.json()["detail"][0]["type"] != "value_error"


@pytest.mark.parametrize("content_type", ["application/merge-patch+json", "Application/JSON", "application/vnd.api+json"])
async def test_a_nul_is_refused_whatever_json_type_the_body_is_sent_as(client, content_type):
    """FastAPI parses any JSON type, in any case, so the check cannot depend on the exact header the browser sends"""
    body = b'{"email": "a@example.com", "password": "a\\u0000b"}'

    resp = await client.post("/auth/login", content=body, headers={"content-type": content_type})

    assert resp.status_code == 422
    assert resp.json() == _detail(["body", "password"])


async def test_a_body_nested_past_what_the_parser_can_follow_is_left_to_the_route(client):
    """A deeply nested text that is not sent as JSON must give the route's ordinary refusal and not a server error"""
    body = ("[" * 100_000 + "\\u0000").encode()

    resp = await client.post("/auth/login", content=body, headers={"content-type": "text/plain"})

    assert resp.status_code == 422
    assert resp.json()["detail"][0]["type"] != "value_error"


@pytest.mark.parametrize("encoding", ["utf-8-sig", "utf-16-le", "utf-16-be", "utf-16", "utf-32-le", "utf-32-be", "utf-32"])
async def test_a_nul_is_refused_in_a_body_sent_as_utf_16_or_utf_32(client, encoding):
    """The JSON parser reads these encodings too, and in them the escape is not in the bytes as written"""
    body = '{"email": "a@example.com", "password": "a\\u0000b"}'.encode(encoding)

    resp = await client.post("/auth/login", content=body, headers={"content-type": "application/json"})

    assert resp.status_code == 422
    assert resp.json() == _detail(["body", "password"])


async def test_a_nul_in_a_path_value_that_fits_its_pattern_is_refused_by_the_check(client):
    """A three-character code holding a NUL passes the code's length rule, so only the NUL check can refuse it"""
    resp = await client.get("/currencies/A%00B")

    assert resp.status_code == 422
    assert resp.json() == _detail(["path", "currency_id"])


async def test_a_nul_in_a_query_parameter_name_is_refused(client):
    """The name of a parameter is the request's own, so it is checked as its value is"""
    resp = await client.get("/currencies?se%00arch=x")

    assert resp.status_code == 422
    assert resp.json()["detail"][0]["loc"][0] == "query"


async def test_the_refusal_comes_before_authentication(client):
    """A request with no credentials and a NUL is refused for the NUL, so nothing behind sign-in is reached by it"""
    resp = await client.patch("/me", json={"first_name": "a\u0000b"})

    assert resp.status_code == 422
    assert resp.json() == _detail(["body", "first_name"])
