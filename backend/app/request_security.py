from fastapi import Request


def request_is_https(request: Request) -> bool:
    """Return whether the original client request used HTTPS."""
    forwarded_proto = request.headers.get("x-forwarded-proto")
    if forwarded_proto:
        return forwarded_proto.split(",", 1)[0].strip().lower() == "https"
    return request.url.scheme == "https"
