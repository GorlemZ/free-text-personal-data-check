"""Closed application category catalog shared by HTTP and offline evaluation."""

CATEGORIES = frozenset({
    "PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "IT_FISCAL_CODE",
    "IT_VAT_CODE", "IBAN_CODE", "CREDIT_CARD",
})


def forbidden_categories(detected: set[str], allowed: set[str]) -> set[str]:
    """Filter native extras before the trusted field-category allowlist."""
    return (detected & CATEGORIES) - allowed
