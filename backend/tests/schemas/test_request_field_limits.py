"""Every field a request body, path or query string can carry has an upper bound, so no request stores more than a column can take"""

import pytest
from pydantic import ValidationError

from app.main import app
from app.schemas.auth import RequestEmailChangeRequest
from app.schemas.limits import MAX_EMAIL_LENGTH

# String formats whose values the parser bounds itself
BOUNDED_STRING_FORMATS = {"uuid", "date", "date-time", "time", "duration"}

# Where a request carries a value the user chooses and the API stores or looks up. Headers and cookies
# are left to their own checks, since each is cut short by the server's header size limit
SWEPT_PLACES = {"path", "query"}


def _unbounded_fields(schema: dict, components: dict, place: str, seen: frozenset[str] = frozenset()) -> list[str]:
    """List the places under a schema where a string has no maximum length or a number no maximum

    Args:
        schema: The schema to walk, following references into the components
        components: Every named schema of the document
        place: How the schema is named in the listing
        seen: The named schemas already being walked, so a schema holding itself ends the walk

    Returns:
        One line for each field with no bound
    """
    if "$ref" in schema:
        name = schema["$ref"].rsplit("/", 1)[-1]
        if name in seen:
            return []
        return _unbounded_fields(components[name], components, place, seen | {name})
    found = []
    if "enum" in schema or "const" in schema:
        return found
    kind = schema.get("type")
    if kind == "string" and "maxLength" not in schema and schema.get("format") not in BOUNDED_STRING_FORMATS:
        found.append(f"{place} is a string with no maxLength")
    if kind in {"integer", "number"} and "maximum" not in schema and "exclusiveMaximum" not in schema:
        found.append(f"{place} is a number with no maximum")
    for key in ("anyOf", "oneOf", "allOf"):
        for branch in schema.get(key, []):
            found += _unbounded_fields(branch, components, place, seen)
    for name, prop in schema.get("properties", {}).items():
        found += _unbounded_fields(prop, components, f"{place}.{name}", seen)
    if isinstance(schema.get("items"), dict):
        found += _unbounded_fields(schema["items"], components, f"{place}[]", seen)
    if isinstance(schema.get("additionalProperties"), dict):
        found += _unbounded_fields(schema["additionalProperties"], components, f"{place}{{}}", seen)
    return found


def _unbounded_request_fields(document: dict) -> list[str]:
    """List every body field, path value and query value of an API description that has no upper bound"""
    components = document.get("components", {}).get("schemas", {})
    found = []
    for path, operations in document["paths"].items():
        for method, operation in operations.items():
            where = f"{method.upper()} {path}"
            for parameter in operation.get("parameters", []):
                if parameter["in"] in SWEPT_PLACES:
                    found += _unbounded_fields(parameter["schema"], components, f"{where} {parameter['in']} {parameter['name']}")
            for media in operation.get("requestBody", {}).get("content", {}).values():
                found += _unbounded_fields(media["schema"], components, f"{where} body")
    return sorted(set(found))


def test_no_request_field_is_unbounded():
    """A text field is capped in length and a number at its largest storable value, wherever a body, path or query string carries it"""
    unbounded = _unbounded_request_fields(app.openapi())

    assert not unbounded, "\n" + "\n".join(unbounded)


def test_the_sweep_reads_body_path_and_query_values_and_leaves_headers_alone():
    """Each swept place is walked, so dropping one from the sweep fails here, while a header is left to the server's size limit"""
    unbounded_text = {"type": "string"}
    document = {
        "paths": {
            "/things/{name}": {
                "get": {
                    "parameters": [
                        {"name": "name", "in": "path", "schema": unbounded_text},
                        {"name": "page", "in": "query", "schema": {"type": "integer"}},
                        {"name": "tags", "in": "query", "schema": {"type": "array", "items": unbounded_text}},
                        {"name": "origin", "in": "header", "schema": unbounded_text},
                    ],
                    "requestBody": {"content": {"application/json": {"schema": {"type": "object", "properties": {"note": unbounded_text}}}}},
                },
            },
        },
    }

    assert _unbounded_request_fields(document) == [
        "GET /things/{name} body.note is a string with no maxLength",
        "GET /things/{name} path name is a string with no maxLength",
        "GET /things/{name} query page is a number with no maximum",
        "GET /things/{name} query tags[] is a string with no maxLength",
    ]


def test_the_walk_flags_what_it_is_meant_to_and_nothing_bounded():
    """The sweep would pass on an empty document, so it is shown to find an unbounded text, number, and one nested in a union or a list"""
    components = {
        "Inner": {"type": "object", "properties": {"note": {"type": "string"}}},
        "Fine": {"type": "object", "properties": {"note": {"type": "string", "maxLength": 5}, "n": {"type": "integer", "maximum": 9}}},
    }
    schema = {
        "type": "object",
        "properties": {
            "amount": {"type": "integer"},
            "choice": {"anyOf": [{"$ref": "#/components/schemas/Inner"}, {"type": "null"}]},
            "rows": {"type": "array", "items": {"type": "string"}},
            "fine": {"$ref": "#/components/schemas/Fine"},
        },
    }

    found = _unbounded_fields(schema, components, "body")

    assert found == [
        "body.amount is a number with no maximum",
        "body.choice.note is a string with no maxLength",
        "body.rows[] is a string with no maxLength",
    ]


def _address_of_length(length: int) -> str:
    """Return a well-formed address of exactly this many characters, with a full local part and labels no longer than allowed"""
    local = "a" * 64
    labels = ["b" * 63, "c" * 63]
    last = "d" * (length - len(local) - len("@") - sum(len(label) + 1 for label in labels) - len(".com"))
    return f"{local}@{'.'.join([*labels, last])}.com"


def test_request_email_change_address_at_the_column_length_accepted():
    """The longest address the column stores is a valid new address"""
    address = _address_of_length(MAX_EMAIL_LENGTH)

    assert RequestEmailChangeRequest(new_email=address).new_email == address


@pytest.mark.parametrize("new_email", ["not-an-address", _address_of_length(MAX_EMAIL_LENGTH + 1)], ids=["malformed", "over the column"])
def test_request_email_change_bad_new_email_refused(new_email):
    """A new address that is not an address, or longer than the column, is refused before anything is looked up or stored"""
    with pytest.raises(ValidationError, match="new_email"):
        RequestEmailChangeRequest(new_email=new_email)
