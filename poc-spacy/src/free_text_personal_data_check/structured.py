"""Whole-span validation of structured Italian identifiers, shared by HTTP and benchmark.

All offsets remain internal. No candidate substring is returned by the public API.
"""

import re
import unicodedata

import phonenumbers

from .policy import CATEGORIES

_CF = re.compile(
    r"[A-Z]{6}[0-9]{2}[A-EHLMPRST][0-9]{2}"
    r"[A-Z][0-9]{3}[A-Z]",
    re.IGNORECASE,
)
_VAT = re.compile(r"(?:IT)?[0-9]{11}", re.IGNORECASE)
_IBAN = re.compile(r"IT[0-9]{2}[A-Z][0-9]{10}[A-Z0-9]{12}", re.IGNORECASE)
_CARD = re.compile(r"[0-9](?:[ -]?[0-9]){12,18}")
_PHONE = re.compile(r"[+0-9()][+0-9() -]*")
_ODD = dict(zip("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", (
    1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 1, 0, 5, 7, 9, 13, 15, 17, 19,
    21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
), strict=True))


def _word_character(char: str) -> bool:
    return char == "_" or char.isalnum() or unicodedata.category(char).startswith("M")


def _bounded(text: str, start: int, end: int) -> bool:
    return (start == 0 or not _word_character(text[start - 1])) and (
        end == len(text) or not _word_character(text[end])
    )


def valid_fiscal_code(value: str) -> bool:
    value = value.upper()
    if _CF.fullmatch(value) is None:
        return False
    day = value[9:11]
    if not (1 <= int(day) <= 31 or 41 <= int(day) <= 71):
        return False
    total = sum(
        _ODD[char] if position % 2 else int(char) if char.isdigit() else ord(char) - 65
        for position, char in enumerate(value[:15], start=1)
    )
    return value[-1] == chr(65 + total % 26)


def valid_vat(value: str) -> bool:
    digits = value.upper().removeprefix("IT")
    if len(digits) != 11 or not digits.isascii() or not digits.isdigit() or digits == "00000000000":
        return False
    total = 0
    for index, char in enumerate(digits[:10]):
        n = int(char) * (2 if index % 2 else 1)
        total += n - 9 if n > 9 else n
    return (10 - total % 10) % 10 == int(digits[-1])


def valid_iban(value: str) -> bool:
    compact = value.replace(" ", "").upper()
    if _IBAN.fullmatch(compact) is None:
        return False
    rearranged = compact[4:] + compact[:4]
    remainder = 0
    for char in rearranged:
        fragment = str(ord(char) - 55) if char.isalpha() else char
        for digit in fragment:
            remainder = (remainder * 10 + int(digit)) % 97
    return remainder == 1


def valid_card(value: str) -> bool:
    if _CARD.fullmatch(value) is None:
        return False
    digits = [int(char) for char in value if char.isdigit()]
    total = 0
    for index, digit in enumerate(reversed(digits)):
        doubled = digit * 2 if index % 2 else digit
        total += doubled - 9 if doubled > 9 else doubled
    return total % 10 == 0


def valid_phone(value: str) -> bool:
    """Metadata validity, not subscriber assignment or reachability."""
    if re.fullmatch(r"\+?[0-9() -]+", value) is None:
        return False
    depth = 0
    for char in value:
        if char == "(":
            depth += 1
            if depth > 1:
                return False
        elif char == ")":
            depth -= 1
            if depth < 0:
                return False
    if depth:
        return False
    compact = re.sub(r"[() -]", "", value)
    normalized = "+" + compact[2:] if compact.startswith("00") else compact
    try:
        return phonenumbers.is_valid_number(phonenumbers.parse(normalized, "IT"))
    except phonenumbers.NumberParseException:
        return False


def phone_spans(text: str) -> set[tuple[int, int]]:
    """Consume whole envelopes, never retry a malformed number's suffix."""
    spans = set()
    for match in _PHONE.finditer(text):
        value = match.group().rstrip(" ")
        start, end = match.start(), match.start() + len(value)
        if _bounded(text, start, end) and valid_phone(value):
            spans.add((start, end))
    return spans


_STRUCTURED = {
    "IT_FISCAL_CODE": (_CF, valid_fiscal_code),
    "IT_VAT_CODE": (_VAT, valid_vat),
    "IBAN_CODE": (_IBAN, valid_iban),
    "CREDIT_CARD": (_CARD, valid_card),
    "PHONE_NUMBER": (_PHONE, valid_phone),
}


def validated_categories(text: str, native_candidates: list) -> set[str]:
    """Union validated full-span native results and independent whole-token rules.

    Unknown native labels are ignored. Structured labels require a valid span even
    when another native recognizer also reports the same token.
    """
    phones = phone_spans(text)
    categories = {"PHONE_NUMBER"} if phones else set()
    for result in native_candidates:
        entity_type = result.entity_type
        if entity_type not in CATEGORIES:
            continue
        start, end = result.start, result.end
        if not isinstance(start, int) or not isinstance(end, int) or not (0 <= start < end <= len(text)):
            continue
        if entity_type in _STRUCTURED:
            _, validate = _STRUCTURED[entity_type]
            if (
                not _bounded(text, start, end)
                or (entity_type == "PHONE_NUMBER" and (start, end) not in phones)
                or not validate(text[start:end])
            ):
                continue
        categories.add(entity_type)
    for entity_type, (pattern, validate) in _STRUCTURED.items():
        if entity_type == "PHONE_NUMBER":
            continue
        for match in pattern.finditer(text):
            if (
                _bounded(text, *match.span())
                and validate(match.group())
            ):
                categories.add(entity_type)
                break
    return categories
