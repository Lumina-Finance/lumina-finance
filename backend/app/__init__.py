"""Backend application package"""

import zoneinfo

# Resolve every named timezone from the tzdata dependency rather than the operating system's
# zone files. Python searches the system path first and falls back to the package, so the two
# would otherwise be read from different releases of the IANA database, and which release a
# given zone came from would depend on whether the base image happened to carry it.
#
# This runs here because importing any app module imports this package first, which is before
# the accepted timezone set is built in app.schemas.auth and before anything constructs a zone.
# A missing dependency now resolves nothing at all rather than silently narrowing the set
zoneinfo.reset_tzpath(to=[])
