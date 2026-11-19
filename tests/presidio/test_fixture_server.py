"""Esercita il server fixture reale, senza Docker o servizi esterni."""

import http.client
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("unavailable", [False, True])
def test_fixture_server_over_loopback(unavailable):
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    env = {**os.environ, "PORT": str(port), "CONTRACT_UNAVAILABLE": str(int(unavailable))}
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "tests/contract/serve-presidio.py")],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    def request(path, body=None, method="GET"):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        try:
            connection.request(
                method, path, body=body, headers={"Content-Type": "application/json"}
            )
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    try:
        deadline = time.monotonic() + 15
        while True:
            assert process.poll() is None, "Fixture server terminated before readiness"
            try:
                status, body = request("/health/ready")
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.05)
        assert status == (503 if unavailable else 200)
        assert body == ({"code": "detector_unavailable"} if unavailable else {"status": "ready"})
        assert request("/v1/analyze", '{"fields":[]}', "POST") == (400, {"code": "invalid_request"})
        assert request("/v1/analyze?x=1", "{}", "POST") == (404, {"code": "not_found"})
        assert request("/health/ready?") == (404, {"code": "not_found"})
        assert request("/v1/analyze?", "{}", "POST") == (404, {"code": "not_found"})
        # La stessa connessione non deve riusare il target della richiesta precedente.
        persistent = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        try:
            for path, expected_status in [
                ("/health/ready?", 404),
                ("/health/ready", status),
                ("/health/ready?", 404),
            ]:
                persistent.request("GET", path)
                response = persistent.getresponse()
                assert response.status == expected_status
                response.read()
        finally:
            persistent.close()
        for text, category in [
            ("", None),
            ("fixture:extra", None),
            ("fixture:person", "PERSON"),
            ("fixture:extra-person", "PERSON"),
            ("fixture:person-aliases", "PERSON"),
            ("fixture:phone 3331234567", "PHONE_NUMBER"),
            ("fixture:unknown", "error"),
            ("fixture:malformed", "error"),
            ("fixture:throw", "error"),
        ]:
            payload = json.dumps({"fields": [{"fieldId": "f", "text": text}]})
            result = request("/v1/analyze", payload, "POST")
            if unavailable or category == "error":
                assert result == (503, {"code": "detector_unavailable"})
            else:
                assert result == (
                    200,
                    {
                        "verdict": "rejected" if category else "accepted",
                        "findings": [{"fieldId": "f", "category": category}] if category else [],
                    },
                )
    finally:
        process.terminate()
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate(timeout=5)
