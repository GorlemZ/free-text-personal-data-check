"""Exercise Docker CLI's real context packing without a Docker daemon.

Requires the Docker CLI. A loopback stub consumes the legacy builder's tar stream;
no image is built and only synthetic fixture files are sent.
"""
import http.server
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
ENGINES = ("bardsai", "horizon", "rizzo")


class _DockerStub(http.server.BaseHTTPRequestHandler):
    archive = None

    def log_message(self, format, *args):
        pass

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("API-Version", "1.41")
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("API-Version", "1.41")
        self.end_headers()
        self.wfile.write(b'{"ApiVersion":"1.41","MinAPIVersion":"1.24","Os":"linux"}')

    def do_POST(self):
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            chunks = []
            while True:
                size = int(self.rfile.readline().strip().split(b";", 1)[0], 16)
                if not size:
                    self.rfile.readline()
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.read(2)
            data = b"".join(chunks)
        else:
            data = self.rfile.read(int(self.headers["Content-Length"]))
        type(self).archive = data
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"stream":"Successfully built synthetic\\n"}\n')


class DockerContextTests(unittest.TestCase):
    def test_root_context_contains_only_build_inputs(self):
        fixtures = {
            "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml",
            "packages/detector-http/package.json", "packages/detector-http/tsconfig.json",
            "packages/detector-http/src/shared.ts",
            ".env", ".env.local", ".venv/private", "tests/secret", "README.md",
            "packages/detector-http/src/.env", "packages/detector-http/src/node_modules/x",
            "packages/other/secret", "packages/detector-http/other/secret",
            "packages/detector-http/src/private.pem", "packages/detector-http/src/.npmrc",
        }
        for engine in ENGINES:
            prefix = f"poc-{engine}"
            fixtures.update({f"{prefix}/package.json", f"{prefix}/tsconfig.json",
                             f"{prefix}/src/index.ts", f"{prefix}/src/.env.local",
                             f"{prefix}/models/model/weights.bin", f"{prefix}/models/.env",
                             f"{prefix}/models/model/file.partial", f"{prefix}/models/.downloads/incomplete",
                             f"{prefix}/models/logs/debug.log", f"{prefix}/model-manifest.json",
                             f"{prefix}/MODEL_LICENSE", f"{prefix}/.env"})
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _DockerStub)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for engine in ENGINES:
                with self.subTest(engine=engine), tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    for name in fixtures:
                        path = root / name
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_text("synthetic", encoding="utf8")
                    prefix = f"poc-{engine}"
                    for name in ("Dockerfile", "Dockerfile.dockerignore"):
                        (root / prefix / name).write_bytes((ROOT / prefix / name).read_bytes())
                    # The legacy CLI reads only root .dockerignore. Simulate BuildKit's
                    # Dockerfile-specific selection, then use Docker's actual packer.
                    (root / ".dockerignore").write_bytes((root / prefix / "Dockerfile.dockerignore").read_bytes())
                    _DockerStub.archive = None
                    env = dict(os.environ, DOCKER_BUILDKIT="0", DOCKER_API_VERSION="1.41")
                    result = subprocess.run(
                        ["docker", "--host", f"tcp://127.0.0.1:{server.server_port}",
                         "build", "-f", f"{prefix}/Dockerfile", "."],
                        cwd=root, env=env, capture_output=True, text=True, timeout=30,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIsNotNone(_DockerStub.archive)
                    with tarfile.open(fileobj=io.BytesIO(_DockerStub.archive), mode="r:*") as archive:
                        files = {member.name.removeprefix("./") for member in archive if member.isfile()}
                    required = {"package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml",
                                "packages/detector-http/package.json", "packages/detector-http/tsconfig.json",
                                "packages/detector-http/src/shared.ts", f"{prefix}/tsconfig.json",
                                f"{prefix}/src/index.ts", f"{prefix}/models/model/weights.bin",
                                f"{prefix}/model-manifest.json"}
                    required.update(f"poc-{sibling}/package.json" for sibling in ENGINES)
                    if engine == "rizzo":
                        required.add(f"{prefix}/MODEL_LICENSE")
                    self.assertTrue(required <= files, f"missing: {required - files}")
                    allowed = required | {".dockerignore", f"{prefix}/Dockerfile", f"{prefix}/Dockerfile.dockerignore"}
                    self.assertFalse(files - allowed, f"unexpected: {files - allowed}")
                    # Legacy mode must fail closed rather than leak the entire workspace.
                    (root / ".dockerignore").write_bytes((ROOT / ".dockerignore").read_bytes())
                    _DockerStub.archive = None
                    legacy = subprocess.run(
                        ["docker", "--host", f"tcp://127.0.0.1:{server.server_port}",
                         "build", "-f", f"{prefix}/Dockerfile", "."],
                        cwd=root, env=env, capture_output=True, text=True, timeout=30,
                    )
                    self.assertEqual(legacy.returncode, 0, legacy.stderr)
                    with tarfile.open(fileobj=io.BytesIO(_DockerStub.archive), mode="r:*") as archive:
                        legacy_files = {member.name.removeprefix("./") for member in archive if member.isfile()}
                    self.assertFalse(legacy_files - {".dockerignore", f"{prefix}/Dockerfile"}, legacy_files)
                    self.assertNotIn("package.json", legacy_files)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
