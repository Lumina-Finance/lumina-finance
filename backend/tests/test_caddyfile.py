"""The bundled proxy's trust settings, read from its file since the test environment has no Caddy to run"""

import re
from pathlib import Path

_CADDYFILE = Path(__file__).parents[2] / "docker" / "Caddyfile"


def test_private_addresses_are_trusted_by_default_and_read_from_the_trusted_end():
    """A proxy on a private network works with no setting, and a client's forged value never wins"""
    servers = re.search(r"servers \{(.*?)\n\t\}", _CADDYFILE.read_text(), re.DOTALL).group(1).split("\n")

    assert "\t\ttrusted_proxies static {$TRUSTED_PROXIES:private_ranges}" in servers
    assert "\t\ttrusted_proxies_strict" in servers
