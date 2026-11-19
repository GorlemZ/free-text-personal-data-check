"""Adapter semantico e policy; nessun tuning dei recognizer nativi."""

import re

CATEGORIES = frozenset(
    {
        "PERSON",
        "EMAIL_ADDRESS",
        "PHONE_NUMBER",
        "IT_FISCAL_CODE",
        "IT_VAT_CODE",
        "IBAN_CODE",
        "CREDIT_CARD",
        "IT_IDENTITY_CARD",
        "IT_DRIVER_LICENSE",
    }
)
KNOWN_EXTRAS = frozenset(
    {
        "CRYPTO",
        "DATE_TIME",
        "IP_ADDRESS",
        "IT_PASSPORT",
        "LOCATION",
        "MAC_ADDRESS",
        "MEDICAL_LICENSE",
        "ORGANIZATION",
        "URL",
    }
)


# L'involucro completo impedisce di reinterpretare il suffisso di un numero estero.
_PHONE_SPACE = r"\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000"
_PHONE_ENVELOPE = re.compile(r"(?:\+|00)?[0-9][0-9" + _PHONE_SPACE + r"().-]{4,}[0-9]")
_PHONE_SEPARATORS = re.compile("[" + _PHONE_SPACE + r"().-]")


def _italian_phone(text: str, start: int, end: int) -> bool:
    for match in _PHONE_ENVELOPE.finditer(text):
        if not match.start() <= start < end <= match.end():
            continue
        if (
            match.start() and (text[match.start() - 1].isalnum() or text[match.start() - 1] == "_")
        ) or (
            match.end() < len(text) and (text[match.end()].isalnum() or text[match.end()] == "_")
        ):
            return False
        compact = _PHONE_SEPARATORS.sub("", match.group())
        if compact.startswith("+39"):
            compact = compact[3:]
        elif compact.startswith("0039"):
            compact = compact[4:]
        elif compact.startswith(("+", "00")):
            return False
        return bool(re.fullmatch(r"(?:3[0-9]{9}|0[1-9][0-9]{4,9})", compact))
    return False


def semantic_categories(text: str, results: list) -> set[str]:
    import math

    if not isinstance(results, list):
        raise TypeError("invalid_detector_result")
    categories = set()
    for result in results:
        category = result.entity_type
        if (
            not isinstance(category, str)
            or category not in CATEGORIES | KNOWN_EXTRAS
            or type(result.start) is not int
            or type(result.end) is not int
            or not 0 <= result.start < result.end <= len(text)
            or type(result.score) not in (int, float)
            or not math.isfinite(result.score)
            or not 0 <= result.score <= 1
        ):
            raise ValueError("invalid_detector_result")
        if category == "PHONE_NUMBER" and not _italian_phone(text, result.start, result.end):
            continue
        if category in CATEGORIES:
            categories.add(category)
    return categories


def forbidden_categories(detected: set[str], allowed: set[str]) -> set[str]:
    return detected - allowed
