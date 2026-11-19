"""Every field a request body or path can carry has an upper bound, so no request stores or hashes more than a column or a hash can take"""

from app.main import app

# String formats whose values the parser bounds itself
BOUNDED_STRING_FORMATS = {"uuid", "date", "date-time", "time", "duration"}

# Where a request carries a value the user chooses and the API stores or looks up. Query values, headers
# and cookies are left to their own checks, since each is cut short by the server's header and URL limits
SWEPT_PLACES = {"path"}


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


def _unbounded_request_fields() -> list[str]:
    """List every body field and path value of the API that has no upper bound"""
    document = app.openapi()
    components = document["components"]["schemas"]
    found = []
    for path, operations in document["paths"].items():
        for method, operation in operations.items():
            where = f"{method.upper()} {path}"
            for parameter in operation.get("parameters", []):
                if parameter["in"] in SWEPT_PLACES:
                    found += _unbounded_fields(parameter["schema"], components, f"{where} path {parameter['name']}")
            for media in operation.get("requestBody", {}).get("content", {}).values():
                found += _unbounded_fields(media["schema"], components, f"{where} body")
    return sorted(set(found))


def test_no_request_field_is_unbounded():
    """A text field is capped in length and a number at its largest storable value, wherever a body or path carries it"""
    unbounded = _unbounded_request_fields()

    assert not unbounded, "\n" + "\n".join(unbounded)


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
