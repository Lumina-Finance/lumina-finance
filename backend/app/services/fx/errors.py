"""Foreign exchange service errors"""


class FxRateError(RuntimeError):
    """Base error for FX rate lookups"""


class FxRateNotFoundError(FxRateError):
    """Raised when the provider has no rate for a currency pair"""


class FxRateRejectedError(FxRateNotFoundError):
    """Raised when the provider refuses a lookup with a client error other than 404

    A kind of missing rate, so callers treat it as one, but not the provider's answer about the
    rate: a rejected request is asked again rather than remembered as the rate not existing
    """


class FxProviderUnavailableError(FxRateError):
    """Raised when the provider endpoint cannot serve rates"""


class FxRateResponseError(FxProviderUnavailableError):
    """Raised when the provider returns an invalid payload"""
