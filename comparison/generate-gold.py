"""Overwrite the single synthetic gold. Always resets review to pending. No detector calls.
Run with the poc-spacy Python environment (phonenumbers is used only for independent metadata checks).
"""
from pathlib import Path
import json
import phonenumbers

ROOT = Path(__file__).resolve().parent
PHONE_METADATA_VERSION = '9.0.41'
if phonenumbers.__version__ != PHONE_METADATA_VERSION:
    raise RuntimeError('GOLD_PHONE_METADATA_VERSION_MISMATCH')
CATEGORIES = ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD']
POLICY = {
    'PERSON': 'Full given name and surname, isolated or contextual; single given name or surname requires clear personal context. Bare ambiguous words, organizations and places are negative.',
    'EMAIL_ADDRESS': 'Syntactically valid email addresses, including generic/business mailboxes and single-label domains; no DNS or delivery check. Annotate overlaps even inside excluded-category distractors.',
    'PHONE_NUMBER': 'Any country with explicit + or 00 prefix; national numbers default to IT; metadata-valid whole envelope only, no valid substring salvaged from malformed, long or Unicode-adjacent envelopes.',
    'IT_FISCAL_CODE': 'Canonical 16-character Italian fiscal code with checksum and whole-token boundaries; lowercase accepted; omocodia out of scope, not asserted administratively invalid.',
    'IT_VAT_CODE': '11 digits with checksum, compact optional IT prefix; all-zero is negative; whole-token boundaries.',
    'IBAN_CODE': 'Italian 27-character IBAN, mod97 valid; ASCII spaces allowed; whole-token boundaries; domestic CIN and assignment not verified.',
    'CREDIT_CARD': '13–19 ASCII digits passing Luhn, ASCII spaces/hyphens allowed; whole envelope; no issuer or assignment claim.',
}
FIELDS = ['description', 'contactName', 'serverUrls[].description', 'eserviceName',
          'eserviceDescription', 'intendedTarget', 'purposeDescription',
          'freeOfChargeReason', 'riskAnalysisAnswer', 'consumerNotes', 'rejectAgreementReason']
rows = []

def add(key, text, category, expected=None, scenario='positive', checksum='not_checked', family=None, rationale='Authored synthetic; assignment not checked.'):
    expected = [category] if expected is None else expected
    row = dict(id=key, familyId=family or key, split='development', scenario=scenario,
        focusCategory=category, focusPolarity='positive' if category in expected else 'negative',
        fieldId=FIELDS[len(rows) % len(FIELDS)], text=text, allowedEntityTypes=[],
        expectedEntities=expected, expectedVerdict='rejected' if expected else 'accepted',
        provenanceId='authored-synthetic', annotationStatus='pending',
        annotation=dict(target='declared-category-presence', form='plausible' if category in expected else 'absent-or-malformed',
            checksum=checksum, assignment='not_checked', rationale=rationale))
    rows.append(row)
    return row

def variant(row, allowed, suffix, scenario='allowlisted'):
    clone = json.loads(json.dumps(row))
    clone.update(id=row['id']+'-'+suffix, scenario=scenario, allowedEntityTypes=allowed,
        fieldId=FIELDS[len(rows) % len(FIELDS)], expectedVerdict='rejected' if set(row['expectedEntities'])-set(allowed) else 'accepted')
    rows.append(clone)

# Generator algorithms and independent JS validation deliberately use different implementations.
odd = dict(zip('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', [1,0,5,7,9,13,15,17,19,21,1,0,5,7,9,13,15,17,19,21,2,4,18,20,11,3,6,8,12,14,16,10,22,25,24,23]))
def fiscal(prefix):
    return prefix + chr(65 + sum(odd[c] if i%2==0 else int(c) if c.isdigit() else ord(c)-65 for i,c in enumerate(prefix))%26)
def luhn_check(prefix):
    for n in '0123456789':
        s=prefix+n
        total=sum((int(c)*2-9 if int(c)*2>9 else int(c)*2) if i%2 else int(c) for i,c in enumerate(s[::-1]))
        if total%10==0: return s
    raise AssertionError('No Luhn check digit')

def vat(prefix):
    even=sum((int(c)*2-9 if int(c)*2>9 else int(c)*2) for c in prefix[1::2])
    return prefix+str((-sum(map(int,prefix[::2]))-even)%10)
def iban(bban):
    expanded=''.join(str(ord(c)-55) if c.isalpha() else c for c in bban+'IT00')
    return 'IT'+str(98-int(expanded)%97).zfill(2)+bban

def wrong(value): return value[:-1]+('0' if value[-1]!='0' else '1')

for i,name in enumerate(['Ada Verdi','Luca Bianchi','Giulia Neri']):
    row=add('person-'+str(i), 'La referente si chiama '+name+'.', 'PERSON', family='contact-mixture' if i==0 else 'person-name-'+str(i)); variant(row,['PERSON'],'allow')
for i,text in enumerate(['Il servizio aggiorna il registro.', 'La società Delta S.r.l. gestisce il portale.', 'La sede è a Torino.', 'Il colore richiesto è rosa.']):
    add('person-negative-'+str(i),text,'PERSON',[], 'context-negative')
for i,email in enumerate(['collaudo@example.com','test+richiesta@example.org','a.b@example.net']):
    row=add('email-'+str(i),'Scrivere a '+email+'.','EMAIL_ADDRESS', family='contact-mixture' if i==0 else 'email-address-'+str(i)); variant(row,['EMAIL_ADDRESS'],'allow')
for i,text in enumerate(['contatto [at] example.com','contatto@','@example.com','contatto@@example.com']):
    add('email-negative-'+str(i),text,'EMAIL_ADDRESS',[], 'malformed')
row=add('email-single-label','test@example','EMAIL_ADDRESS',scenario='syntax-positive',family='email-single-label',
    rationale='RFC 5322 dot-atom permits a single-label domain; DNS, MX and delivery are not checked.')
variant(row,['EMAIL_ADDRESS'],'allow')
phones=['+12025550123','0012025550123','+442079460958','00442079460958','+33612345678','+61412345678','+81312345678','+5511987654321','3471234567','0212345678','+39 347 123 4567','0039 02 1234 5678']
phone_families=['structured-mixture','structured-mixture','phone-uk-example','phone-uk-example',
                'phone-fr-example','phone-au-example','phone-jp-example','phone-br-example',
                'phone-it-mobile','phone-it-fixed','phone-it-mobile','phone-it-fixed']
for i,number in enumerate(phones):
    assert phonenumbers.is_valid_number(phonenumbers.parse(number,'IT')), 'phone-'+str(i)
    row=add('phone-'+str(i),'Telefono: '+number+'.','PHONE_NUMBER', family=phone_families[i], rationale='Metadata-valid using phonenumbers '+phonenumbers.__version__+'; not proof of assignment.')
    variant(row,['PHONE_NUMBER'],'allow')
for i,number in enumerate(['+999123456789','+1202555','12345','2025550123','+120255501234567890','é+12025550123','+12025550123é','003934712345670000','+39 347 123 4567 0000000000']):
    family='phone-it-mobile' if i in (7,8) else 'structured-mixture' if i in (1,3,4,5,6) else 'phone-malformed-'+str(i)
    add('phone-negative-'+str(i),'Telefono: '+number+'.','PHONE_NUMBER',[], 'whole-envelope-negative',family=family)
cf=fiscal('VRDDAA80A01H501')
for i,value in enumerate([cf,cf.lower()]):
    row=add('cf-'+str(i),'Codice fiscale: '+value+'.','IT_FISCAL_CODE',checksum='cf_checksum_pass',family='structured-mixture'); variant(row,['IT_FISCAL_CODE'],'allow')
for i,value in enumerate([cf[:-1]+('A' if cf[-1]!='A' else 'B'), 'é'+cf, cf+'é']):
    add('cf-negative-'+str(i),'Codice fiscale: '+value+'.','IT_FISCAL_CODE',[], 'checksum-or-boundary-negative',family='structured-mixture')
add('cf-negative-3','Codice fiscale: '+fiscal(cf[:6]+'U'+cf[7:15])+'.','IT_FISCAL_CODE',[],
    'out-of-scope-omocodia',family='structured-mixture',
    rationale='Omocodia with a recomputed valid checksum is out of scope, not asserted administratively invalid.')
vat_value=vat('1234567890')
for i,value in enumerate([vat_value,'IT'+vat_value]):
    row=add('vat-'+str(i),'Partita IVA: '+value+'.','IT_VAT_CODE',checksum='vat_check_digit_pass',family='structured-mixture'); variant(row,['IT_VAT_CODE'],'allow')
for i,value in enumerate([wrong(vat_value),'00000000000','IT '+vat_value,'é'+vat_value,vat_value+'é']):
    if i==2:
        # The prefix is not compact, but the standalone 11-digit value is still a valid VAT.
        row=add('vat-spaced-prefix','Partita IVA: '+value+'.','IT_VAT_CODE',scenario='target-overlap',
            family='structured-mixture', rationale='Separated IT is not the optional compact prefix; the bare checksum-valid VAT remains present.')
        variant(row,['IT_VAT_CODE'],'allow')
    else:
        add('vat-negative-'+str(i),'Partita IVA: '+value+'.','IT_VAT_CODE',[], 'checksum-or-boundary-negative',family='structured-mixture')
add('vat-separated-digits','Partita IVA: '+vat_value[:5]+' '+vat_value[5:]+'.','IT_VAT_CODE',[],
    'format-negative',family='structured-mixture',rationale='Internal digit grouping is outside the compact 11-digit VAT contract.')
ib=iban('X0542811101000000123456')
for i,value in enumerate([ib,' '.join(ib[j:j+4] for j in range(0,len(ib),4))]):
    row=add('iban-'+str(i),'Conto: '+value+'.','IBAN_CODE',checksum='iban_mod97_pass',family='structured-mixture'); variant(row,['IBAN_CODE'],'allow')
for i,value in enumerate([wrong(ib),ib.replace('IT','DE'),ib[:4]+'\t'+ib[4:],ib[:4]+'\u00a0'+ib[4:],'é'+ib,ib+'é']):
    add('iban-negative-'+str(i),'Conto: '+value+'.','IBAN_CODE',[], 'checksum-or-boundary-negative',family='structured-mixture')
for length in range(13,20):
    value=luhn_check('4'+'2'*(length-2))
    for suffix,formatted in [('compact',value),('spaces',' '.join(value[j:j+4] for j in range(0,len(value),4))),('hyphens','-'.join(value[j:j+4] for j in range(0,len(value),4)))]:
        row=add('card-'+str(length)+'-'+suffix,'Carta: '+formatted+'.','CREDIT_CARD',checksum='luhn_pass',family='structured-mixture'); variant(row,['CREDIT_CARD'],'allow')
    add('card-fail-'+str(length),'Carta: '+wrong(value)+'.','CREDIT_CARD',[], 'checksum-negative',checksum='luhn_fail',family='structured-mixture')
card=luhn_check('4'+'2'*14)
for i,value in enumerate([luhn_check('4'+'2'*10),luhn_check('4'+'2'*18),'é'+card,card+'é',card[:4]+'\t'+card[4:],card[:4]+'\u00a0'+card[4:]]):
    add('card-negative-'+str(i),'Carta: '+value+'.','CREDIT_CARD',[], 'whole-envelope-negative',family='structured-mixture')
# Every formerly excluded axis is represented as a distractor; target overlaps are explicit.
distractors=['Organizzazione: Delta S.r.l.', 'Luogo: Torino.', 'IP: 192.0.2.19.', 'MAC: 02:00:00:00:00:01.',
 'URL: https://example.org/servizio.', 'Patente: AB1234567.', 'Documento: CA12345AA.', 'Passaporto: YA1234567.',
 'Wallet: bc1qtestsynthetic.', 'Data: 2026-11-10.', 'Licenza medica: MED-12345.']
for i,text in enumerate(distractors): add('distractor-'+str(i),text,CATEGORIES[i%len(CATEGORIES)],[], 'excluded-category-distractor')
row=add('url-email-overlap','URL: https://example.org/?email=collaudo@example.com','EMAIL_ADDRESS',scenario='target-overlap',family='contact-mixture'); variant(row,['EMAIL_ADDRESS'],'allow')
row=add('mixed-person-email','La referente Ada Verdi risponde a collaudo@example.com.','PERSON',['PERSON','EMAIL_ADDRESS'],'mixture',family='contact-mixture'); variant(row,['PERSON'],'partial'); variant(row,['PERSON','EMAIL_ADDRESS'],'all')
row=add('mixed-structured','CF: '+cf+'; IVA: '+vat_value+'; IBAN: '+ib+'; carta: '+card+'; telefono: +12025550123.','IT_FISCAL_CODE',['PHONE_NUMBER','IT_FISCAL_CODE','IT_VAT_CODE','IBAN_CODE','CREDIT_CARD'],'mixture',family='structured-mixture'); variant(row,['IT_FISCAL_CODE','IT_VAT_CODE'],'partial'); variant(row,row['expectedEntities'],'all')
row=add('mixed-valid-invalid','IVA valida: '+vat_value+'; carta con checksum errato: '+wrong(card)+'.','CREDIT_CARD',['IT_VAT_CODE'],'mixture',family='structured-mixture'); variant(row,['IT_VAT_CODE'],'allow')
# One numeric envelope satisfies two independent categories; either partial exception still rejects.
phone_vat=vat('0612345678')
assert phonenumbers.is_valid_number(phonenumbers.parse(phone_vat,'IT')), 'phone-vat-overlap'
row=add('phone-vat-overlap','Recapito: '+phone_vat+'.','PHONE_NUMBER',['PHONE_NUMBER','IT_VAT_CODE'],
    'target-overlap',family='phone-vat-overlap',
    rationale='Synthetic 11-digit value is both metadata-valid IT phone and checksum-valid VAT; neither assignment is asserted.')
variant(row,['PHONE_NUMBER'],'phone-only')
variant(row,['IT_VAT_CODE'],'vat-only')
variant(row,['PHONE_NUMBER','IT_VAT_CODE'],'all')
variant(row,['EMAIL_ADDRESS'],'wrong','wrong-allowlist')
for i,key in enumerate(['person-0','email-0','phone-0','cf-0','vat-0','iban-0','card-16-compact']):
    base=next(r for r in rows if r['id']==key)
    variant(base,[CATEGORIES[(i+1)%len(CATEGORIES)]],'wrong','wrong-allowlist')
# Isolated controls reuse the same values and families, not new independent identities.
for key, prefix in [('person-0', 'La referente si chiama '), ('person-1', 'La referente si chiama '),
                    ('person-2', 'La referente si chiama '), ('email-0', 'Scrivere a '),
                    ('phone-0', 'Telefono: '), ('cf-0', 'Codice fiscale: '),
                    ('vat-0', 'Partita IVA: '), ('iban-0', 'Conto: '), ('card-16-compact', 'Carta: ')]:
    base=next(r for r in rows if r['id']==key)
    add(key+'-isolated', base['text'][len(prefix):-1], base['focusCategory'], base['expectedEntities'],
        scenario='isolated', checksum=base['annotation']['checksum'], family=base['familyId'],
        rationale=base['annotation']['rationale'])
add('person-single-given-context', 'La referente si chiama Ada.', 'PERSON',
    scenario='single-name-context', family='contact-mixture', rationale='Single given name in explicit personal context; synthetic.')
add('person-single-surname-context', 'La signora Verdi è la referente.', 'PERSON',
    scenario='single-name-context', family='contact-mixture', rationale='Single surname in explicit personal context; synthetic.')
for i,word in enumerate(['Rosa', 'Verdi']):
    add('person-ambiguous-'+str(i),word,'PERSON',[], 'ambiguous-single-name',
        family='person-ambiguity', rationale='Bare ambiguous word without personal context; not a full name.')
content=json.dumps(rows,indent=2,ensure_ascii=False)+'\n'
(ROOT/'corpus.json').write_text(content,encoding='utf-8')
manifest=dict(schemaVersion=1,review=dict(status='pending',reviewer=None,reviewedAt=None),heldout=False,sourceData='synthetic',
 categories=CATEGORIES,
 counts=dict(samples=len(rows),detectionSamples=len(set(r['text'] for r in rows)),policyVariants=len(rows)-len(set(r['text'] for r in rows)),categories=len(set(r['focusCategory'] for r in rows)),fieldIds=len(set(r['fieldId'] for r in rows)),families=len(set(r['familyId'] for r in rows))),
 provenance=[dict(id='authored-synthetic',kind='authored-synthetic',description='Authored templates, algorithmically generated checksums and documented example domains; phone plausibility checked with phonenumbers '+phonenumbers.__version__+'. No production data or assignment guarantee.')],
 limitations=['Independent human gold review pending; generated checks are not review.', 'Development corpus, not held-out and not representative of deployment prevalence.', 'Families conservatively group correlated values, formatting, mutations and reused mixture controls; family counts are not independent sample sizes.', 'Gold phone checks use phonenumbers 9.0.41, also pinned by Presidio; Horizon pins libphonenumber-js 1.13.16 with separately versioned metadata. Cross-runtime metadata equivalence is not asserted.', 'No identity, ownership, card issuer, bank account assignment or domestic CIN verification.', 'Omocodia is out of scope; contextual PERSON and email interpretation require review.'],policy=POLICY)
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(json.dumps(manifest['counts']))
