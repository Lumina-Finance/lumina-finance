"""Foreign exchange service errors"""


class FxRateError(RuntimeError):
    """Base error for FX rate lookups"""


class FxRateNotFoundError(FxRateError):
    """Raised when the provider has no rate for a currency pair"""


class FxProviderUnavailableError(FxRateError):
    """Raised when the provider endpoint cannot serve rates"""


class FxRateResponseError(FxProviderUnavailableError):
    """Raised when the provider returns an invalid payload"""
