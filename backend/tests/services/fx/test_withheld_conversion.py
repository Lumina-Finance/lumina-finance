"""What a converter does with amounts in another currency while the installed check refuses converting them

An amount in another currency is left out, not converted and not reported as a missing rate, and the
status says why only when an amount was left out. An amount from a group-owned record converts as it
does with no check, and a user's requests share one ask of the check
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.allowance_hook import AllowanceKind
from app.database import current_user_id_ctx
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter, build_user_fx_converter
from tests.conftest import TestSession
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check
from tests.services.fx.fakes import FakeProvider

_RATE_DATE = date(2026, 5, 30)
_EXPONENTS = {"USD": 2, "CAD": 2}


def _provider() -> FakeProvider:
    """Return a provider publishing 1.5 Canadian dollars to the US dollar on the rate date"""
    return FakeProvider({("USD", "CAD"): {_RATE_DATE: Decimal("1.5")}})


def _withholding(provider: FakeProvider) -> FxConverter:
    """Return a US to Canadian dollar converter the check refused conversion for"""
    return FxConverter(provider=provider, currency_exponents=_EXPONENTS, withheld_reason=ALLOWANCE_REASON)


@pytest.fixture
def signed_in_user():
    """Make a user the signed-in one for a test, as a request's dependency does"""
    user_id = uuid.uuid4()
    token = current_user_id_ctx.set(user_id)
    yield user_id
    current_user_id_ctx.reset(token)


async def test_withheld_conversion_leaves_the_amount_out_and_says_why():
    """An amount in another currency comes back as none, asks for no rate, records no pair and reads as withheld"""
    provider = _provider()
    converter = _withholding(provider)

    converted = await converter.convert_minor_units(10_00, base="USD", quote="CAD", rate_date=_RATE_DATE)
    await converter.prefetch_rates(base="USD", quote="CAD", start_date=_RATE_DATE, end_date=_RATE_DATE)

    assert converted is None
    assert provider.calls == []
    assert converter.recorded_pairs == set()
    assert converter.get_status() == FxStatus(state="none", withheld_reason=ALLOWANCE_REASON)
    assert converter.clone().withheld_reason == ALLOWANCE_REASON


async def test_withheld_conversion_gives_no_reason_when_nothing_needed_converting():
    """An amount in the total's own currency, and an empty one, need no conversion so the status has no reason"""
    converter = _withholding(_provider())

    same_currency = await converter.convert_minor_units(10_00, base="CAD", quote="CAD", rate_date=_RATE_DATE)
    empty = await converter.convert_minor_units(0, base="USD", quote="CAD", rate_date=_RATE_DATE)

    assert (same_currency, empty) == (10_00, 0)
    assert converter.get_status() == FxStatus(state="none", withheld_reason=None)


async def test_withheld_conversion_still_converts_an_amount_from_a_group_owned_record():
    """A group-owned amount converts at the rate, and a total with only such amounts reads as complete without a reason"""
    converter = _withholding(_provider())

    group_owned = await converter.convert_minor_units(10_00, base="USD", quote="CAD", rate_date=_RATE_DATE, group_id=uuid.uuid4())

    assert group_owned == 15_00
    assert converter.get_status() == FxStatus(state="complete")

    own = await converter.convert_minor_units(10_00, base="USD", quote="CAD", rate_date=_RATE_DATE)

    assert own is None
    assert converter.get_status() == FxStatus(state="none", withheld_reason=ALLOWANCE_REASON)


async def test_converter_with_no_check_converts_every_amount():
    """With no refusal an amount converts whoever owns its record, and the status never carries a reason"""
    converter = FxConverter(provider=_provider(), currency_exponents=_EXPONENTS)

    own = await converter.convert_minor_units(10_00, base="USD", quote="CAD", rate_date=_RATE_DATE)

    assert own == 15_00
    assert converter.get_status() == FxStatus(state="complete")


@pytest.mark.parametrize(
    ("refused", "signed_in", "converts", "amounts", "asks"),
    [
        pytest.param({AllowanceKind.FOREIGN_CURRENCIES}, True, True, (None, None), 1, id="refused"),
        pytest.param(set(), True, True, (15_00, 15_00), 1, id="allowed"),
        pytest.param({AllowanceKind.FOREIGN_CURRENCIES}, False, True, (15_00, 15_00), 0, id="outside-a-signed-in-request"),
        pytest.param({AllowanceKind.FOREIGN_CURRENCIES}, True, False, (10_00, 10_00), 0, id="nothing-to-convert"),
    ],
)
async def test_user_converter_asks_the_check_once_for_every_converter_a_request_builds_and_only_to_convert(
    refused, signed_in, converts, amounts, asks, signed_in_user
):
    """Converters built on one session share one ask, made when one first converts, and nothing is asked when nothing converts"""
    asked = install_check(refused=refused)
    if not signed_in:
        current_user_id_ctx.set(None)
    quote = "CAD" if converts else "USD"

    async with TestSession() as session:
        converters = [build_user_fx_converter(session, _EXPONENTS, provider=_provider()) for _ in range(2)]
        results = [await converter.convert_minor_units(10_00, base="USD", quote=quote, rate_date=_RATE_DATE) for converter in converters]

    assert tuple(results) == amounts
    assert [request.kind for request in asked] == [AllowanceKind.FOREIGN_CURRENCIES] * asks
