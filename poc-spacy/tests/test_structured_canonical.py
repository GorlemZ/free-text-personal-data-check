from free_text_personal_data_check.structured import valid_fiscal_code, valid_vat


def test_checksum_valid_omocodia_is_outside_canonical_policy():
    assert not valid_fiscal_code("RSSMRA80A01H50MM")


def test_zero_vat_is_invalid_placeholder_not_an_assignment_check():
    assert not valid_vat("00000000000")
