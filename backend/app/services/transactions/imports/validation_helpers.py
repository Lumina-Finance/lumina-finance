"""Transaction import validation helpers"""

from fastapi import HTTPException, status


def strip_import_text_or_raise(value: str, label: str) -> str:
    """Strip whitespace from an import text field and raise 422 if it is blank

    Args:
        value: Raw text from the import payload
        label: Human-readable field label used in validation errors

    Returns:
        Stripped text

    Raises:
        HTTPException: Raised with 422 when the stripped text is empty
    """
    cleaned_value = value.strip()
    if not cleaned_value:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{label} cannot be blank")
    return cleaned_value
