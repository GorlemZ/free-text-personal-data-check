from types import SimpleNamespace

import pytest

from free_text_personal_data_check.structured import valid_phone, validated_categories


@pytest.mark.parametrize('value', ['+44 20 8366 1177', '0044 20 8366 1177', '+1 (213) 373-4253', '02 1234 5678'])
def test_international_metadata_valid_phone(value):
    # UK python-phonenumbers README / US libphonenumber-js README fixtures.
    assert valid_phone(value)
    assert 'PHONE_NUMBER' in validated_categories(f'🙂Chiama: {value}!', [])


@pytest.mark.parametrize('text', ['+999 02 1234 5678', '00999 02 1234 5678',
    '+44 02 1234 5678', '+1 200 555 0101', '+44 20 8366 1177 000000',
    'é+44 20 8366 1177', '+44 20 8366 1177́', '𝟙+44 20 8366 1177',
    '+1 (213 373-4253'])
def test_invalid_envelopes_and_unicode_boundaries(text):
    assert 'PHONE_NUMBER' not in validated_categories(text, [])


def test_native_domestic_suffix_cannot_rescue_bad_international_envelope():
    text = '🙂+999 02 1234 5678'
    result = SimpleNamespace(entity_type='PHONE_NUMBER', start=text.index('02'), end=len(text))
    assert 'PHONE_NUMBER' not in validated_categories(text, [result])

