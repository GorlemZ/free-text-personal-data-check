#!/usr/bin/env python3
"""Verify expanded-gold literals against pinned source Parquet files."""

import argparse
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def source_url(metadata: dict) -> str:
    return (
        'https://huggingface.co/datasets/'
        + metadata['repo']
        + '/resolve/'
        + metadata['revision']
        + '/'
        + metadata['path']
    )


def ensure_source(cache_dir: Path, source: str, metadata: dict) -> Path:
    target = cache_dir / (source + '.parquet')
    if target.exists() and sha256_file(target) == metadata['sha256']:
        return target
    temporary = target.with_suffix('.download')
    request = urllib.request.Request(source_url(metadata), headers={'User-Agent': 'gold-source-verifier/1'})
    with urllib.request.urlopen(request, timeout=120) as response, temporary.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    actual = sha256_file(temporary)
    if actual != metadata['sha256']:
        temporary.unlink(missing_ok=True)
        raise ValueError(f'{source}: source SHA-256 mismatch')
    temporary.replace(target)
    return target


def expected_spans(row: dict, source: str) -> list[dict]:
    if source == 'gretel':
        return json.loads(row['pii_spans'])
    return [
        {'start': start, 'end': start + length, 'label': label}
        for start, length, label in zip(row['ent_start'], row['ent_len'], row['ent_label'], strict=True)
    ]


def verify_case(case: dict, row: dict) -> None:
    source = case['source']
    provenance = case['provenance']
    text = row['generated_text'] if source == 'gretel' else row['text']
    if case['fields'][0]['text'] != text:
        raise ValueError(f"{case['id']}: text differs from pinned source row")
    if provenance['textSha256'] != hashlib.sha256(text.encode()).hexdigest():
        raise ValueError(f"{case['id']}: text hash mismatch")
    if provenance['upstreamSpans'] != expected_spans(row, source):
        raise ValueError(f"{case['id']}: upstream spans differ from pinned source row")
    if source == 'gretel':
        if provenance['originalIndex'] != row['__index_level_0__']:
            raise ValueError(f"{case['id']}: Gretel original index mismatch")
        return
    expected = {
        'sourceCaseId': row['id'],
        'upstreamRepo': row['prov_repo_id'],
        'upstreamRevision': row['prov_revision'],
        'upstreamOriginalId': row['prov_original_id'],
        'upstreamSplit': row['prov_split'],
        'upstreamSource': row['prov_dataset'],
        'upstreamTextReconstruction': row['prov_text_reconstruction'],
        'license': row['prov_license'],
        'syntheticDeclared': row['prov_synthetic'],
    }
    for key, value in expected.items():
        if provenance[key] != value:
            raise ValueError(f"{case['id']}: {key} differs from pinned source row")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache-dir', type=Path, required=True)
    args = parser.parse_args()
    try:
        import pyarrow.parquet as parquet  # pyright: ignore[reportMissingImports]
    except ImportError:
        print('pyarrow is required; run with: uv run --with pyarrow python tests/evaluation/verify_sources.py --cache-dir <scratch-dir>', file=sys.stderr)
        return 2

    gold = json.loads((ROOT / 'gold.json').read_text())
    added = [case for case in gold['cases'] if case['provenance'].get('cohort') == 'external-expansion-1']
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    verified = {}
    for source in ('gretel', 'aliasit'):
        metadata = gold['sourceFiles'][source]
        path = ensure_source(args.cache_dir, source, metadata)
        table = parquet.read_table(path)
        if table.num_rows != metadata['rows']:
            raise ValueError(f'{source}: row-count mismatch')
        cases = [case for case in added if case['source'] == source]
        for case in cases:
            verify_case(case, table.slice(case['provenance']['row'], 1).to_pylist()[0])
        verified[source] = {
            'artifactSha256': sha256_file(path),
            'rows': table.num_rows,
            'selectedCases': len(cases),
        }
    print(json.dumps({'verified': verified, 'totalSelectedCases': len(added)}, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
