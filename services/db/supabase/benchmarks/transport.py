"""Temporary loopback PostgREST with private files and fresh synthetic signing keys."""

# Docker argv is explicit; HTTP accepts only the generated loopback URL.
# ruff: noqa: S603, S607, S310
from __future__ import annotations

import json
import os
import secrets
import socket
import subprocess
import time
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

from .common import DATABASES, PORT, docker, local_docker_environment


def _ready(base: str) -> None:
    for _ in range(100):
        try:
            with urlopen(base, timeout=1):
                return
        except HTTPError as error:
            if error.code in (401, 403, 404):
                return  # OpenAPI can be inaccessible while the API is ready.
            raise
        except URLError, OSError, HTTPException:
            time.sleep(0.1)
    raise RuntimeError("Temporary REST server did not become ready")


@contextmanager
def rest_server(
    database: str,
    password: str,
    image: str,
    temporary: Path,
) -> Generator[tuple[str, str]]:
    if database not in DATABASES:
        raise ValueError("REST benchmark requires an allowlisted disposable clone")
    name = "aselbox-current-rpc-" + secrets.token_hex(5)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    secret = secrets.token_urlsafe(48)
    envfile = temporary / (name + ".private.env")
    uri = f"postgresql://postgres:{quote(password, safe='')}@host.docker.internal:{PORT}/{database}"
    with os.fdopen(os.open(envfile, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "w") as stream:
        stream.write(
            f"PGRST_DB_URI={uri}\nPGRST_JWT_SECRET={secret}\nPGRST_DB_SCHEMAS=public\n"
            "PGRST_DB_ANON_ROLE=anon\nPGRST_DB_POOL=10\nPGRST_LOG_LEVEL=crit\n"
            "PGRST_DB_AGGREGATES_ENABLED=false\n"
        )
    base = f"http://127.0.0.1:{port}"
    try:
        docker(
            "run",
            "--rm",
            "--pull=never",
            "-d",
            "--name",
            name,
            "-p",
            f"127.0.0.1:{port}:3000",
            "--env-file",
            str(envfile),
            image,
        )
        _ready(base)
        yield base, secret
    finally:
        # The unique name belongs to this invocation, including a partly failed start.
        try:
            removed = subprocess.run(
                ["docker", "rm", "-f", name],
                env=local_docker_environment(),
                capture_output=True,
                check=False,
            )
            if removed.returncode and b"No such container" not in removed.stderr:
                raise RuntimeError("Could not remove the temporary REST container")
        finally:
            envfile.unlink(missing_ok=True)


def request(
    base: str, endpoint: str, arguments: Mapping[str, object], bearer: str
) -> tuple[object, int]:
    target = urlsplit(base)
    if (
        target.scheme != "http"
        or target.hostname != "127.0.0.1"
        or target.port is None
        or target.username
        or target.password
        or target.path
        or target.query
        or target.fragment
        or endpoint
        not in {
            "transaction_page",
            "transaction_count",
            "source_transaction_page",
            "source_transaction_count",
            "transaction_totals",
            "sku_filter_options",
        }
    ):
        raise ValueError("Benchmark RPC target must be the temporary loopback service")
    request_value = Request(
        base + "/rpc/" + endpoint,
        json.dumps(arguments).encode(),
        {"Authorization": "Bearer " + bearer, "Content-Type": "application/json"},
    )
    with urlopen(request_value, timeout=30) as response:
        body = response.read()
        return json.loads(body), len(body)
