"""Pure category policy shared by HTTP and offline evaluation."""


def forbidden_categories(detected: set[str], allowed: set[str]) -> set[str]:
    return detected - allowed
