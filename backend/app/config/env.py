"""Environment variable readers shared across the configuration modules"""

import os


def require(key: str) -> str:
    """Return the value of an environment variable or raise if missing

    Args:
        key: The environment variable name

    Returns:
        The environment variable value

    Raises:
        RuntimeError: If the environment variable is not set
    """
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return value


def optional_csv_env(key: str) -> list[str]:
    """Return a comma-separated environment variable as a list."""
    return [value.strip() for value in os.getenv(key, "").split(",") if value.strip()]


def optional_bool_env(key: str, default: bool) -> bool:
    """Return an optional boolean environment variable value

    Args:
        key: The environment variable name
        default: The fallback value when the variable is not set or blank

    Returns:
        The parsed boolean value

    Raises:
        RuntimeError: If the environment variable is not a supported boolean value
    """
    value = os.getenv(key)
    if value is None or not value.strip():
        return default

    normalized_value = value.strip().lower()
    if normalized_value == "true":
        return True
    if normalized_value == "false":
        return False

    raise RuntimeError(f"Invalid {key}={value!r}. Must be true or false")


def unique_values(values: list[str]) -> list[str]:
    """Return values with duplicates removed while preserving order."""
    return list(dict.fromkeys(values))
