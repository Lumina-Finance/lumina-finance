"""Upper bounds shared by the request schemas

A request field with no upper bound lets one request store or hash as much as the body limit
allows, or reach the database with a number its column cannot hold. The sweep in
`tests/schemas/test_request_field_limits.py` fails for any body, path or query field that has none
"""

from typing import Annotated

from pydantic import Field

from app.schemas.web_addresses import MAX_WEB_ADDRESS_LENGTH
from app.utils.money import MAX_MINOR_UNITS, MIN_MINOR_UNITS

# The longest address an email can have. The users table's column holds it
MAX_EMAIL_LENGTH = 254

# Width of the first name, last name and every other name column on a person
MAX_PERSON_NAME_LENGTH = 256

# Characters of a profile picture's address, the same as an institution's
MAX_PROFILE_PICTURE_LENGTH = MAX_WEB_ADDRESS_LENGTH

# IANA timezone names run to about 30 characters, and the column holds 40
MAX_TIMEZONE_LENGTH = 40

# The most a password may hold, as the password policy states. Hashing time grows with the length,
# so a sign-in password is cut off at the same figure
MAX_PASSWORD_LENGTH = 128

# A current TOTP code is six digits and a recovery code a short group of characters
MAX_SECOND_FACTOR_CODE_LENGTH = 64

# Signed tokens, one-time codes and provider states. The longest is an onboarding token carrying a
# provider's claims, and an authorization code from a provider is of the same order
MAX_TOKEN_LENGTH = 4096

# A PKCE verifier is 43 to 128 characters by its specification
MAX_PKCE_VERIFIER_LENGTH = 128

# Width of the slug column on an OIDC provider
MAX_OIDC_SLUG_LENGTH = 50

# Characters of a bank connection's nickname the request may carry. The connection stores 64, and a
# longer nickname is refused in a sentence that names that figure. The sentence only answers a
# nickname within this limit
MAX_BANK_NICKNAME_INPUT_LENGTH = 256

# The widest identifier a bank provider hands out for one of its accounts
MAX_EXTERNAL_ACCOUNT_ID_LENGTH = 256

# Room for the longest value of any enum such as an account type, with margin
MAX_ENUM_TEXT_LENGTH = 32

# The largest figure a request may carry for a count, an index or a version. Far past any real one
# and the largest the 32-bit column that holds it can store
MAX_COUNTER = 2**31 - 1

# A signed token, a one-time code or a provider's state, sent in a body
Token = Annotated[str, Field(max_length=MAX_TOKEN_LENGTH)]

# A password typed to sign in or to prove who is asking, held to what a password can be
PasswordText = Annotated[str, Field(max_length=MAX_PASSWORD_LENGTH)]

# A TOTP or recovery code typed as a second factor
SecondFactorCode = Annotated[str, Field(max_length=MAX_SECOND_FACTOR_CODE_LENGTH)]

# Signed minor units, as the ledger stores them in a 64-bit column
SignedMinorUnits = Annotated[int, Field(ge=MIN_MINOR_UNITS, le=MAX_MINOR_UNITS)]

# An amount a person types for a transaction or a balance. The ceiling sits far past the column's, so
# a figure the ledger cannot hold still reaches the service. The service refuses it in a sentence
# naming the account that cannot take it, and only a figure beyond this ceiling is refused as malformed
MAX_ENTERED_AMOUNT = 10**30
EnteredAmount = Annotated[int, Field(ge=-MAX_ENTERED_AMOUNT, le=MAX_ENTERED_AMOUNT)]

# Minor units that cannot be negative, such as a limit or a contribution
NonNegativeMinorUnits = Annotated[int, Field(ge=0, le=MAX_MINOR_UNITS)]

# Minor units above zero, such as the cap on a budget
PositiveMinorUnits = Annotated[int, Field(gt=0, le=MAX_MINOR_UNITS)]

# A count, an index or a version a request names
Counter = Annotated[int, Field(ge=0, le=MAX_COUNTER)]

# The ceiling on an exchange rate a request may state. It equals the largest rate a provider's
# published series is accepted at, in `app.services.fx.rate_parser_helpers`
MAX_FX_RATE = 1_000_000_000.0
