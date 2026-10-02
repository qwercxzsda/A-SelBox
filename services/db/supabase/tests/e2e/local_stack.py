"""Disposable local Supabase services for real HTTP workflow tests.

The CLI starts a separate Docker project from the repository migrations. No
production configuration, dotenv file, linked project, or existing DB is used.
"""

import json
import logging
import os
import re
import shutil
import signal
import socket
import subprocess
import tomllib
from collections.abc import Generator
from contextlib import ExitStack, contextmanager, suppress
from pathlib import Path
from tempfile import TemporaryDirectory
from types import TracebackType
from typing import Self, cast
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
import psycopg

_PROJECT_PATTERN = re.compile(r"aselbox_e2e_[0-9a-f]{12}")
_EXCLUDED_SERVICES = (
    "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"
)


def require_local_endpoint(url: str, *, port: int, database: bool = False) -> None:
    """Require the exact loopback listener allocated for this disposable stack."""
    try:
        parsed = urlsplit(url)
        valid = (
            parsed.hostname in {"127.0.0.1", "localhost", "::1"}
            and parsed.port == port
            and not parsed.query
            and not parsed.fragment
            and url == url.strip()
        )
        if database:
            valid = valid and (
                parsed.scheme == "postgresql"
                and parsed.username == "postgres"
                and parsed.path == "/postgres"
            )
        else:
            valid = valid and (
                parsed.scheme == "http"
                and parsed.username is None
                and parsed.password is None
                and parsed.path in {"", "/"}
            )
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("End-to-end tests require their disposable local Supabase endpoint.")


def _command(arguments: list[str], *, env: dict[str, str], timeout: int = 60) -> str:
    """Capture CLI output because status/start can include local credentials."""
    try:
        with subprocess.Popen(  # noqa: S603 - fixed local CLI commands, never shell input
            arguments,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        ) as process:
            try:
                stdout, stderr = process.communicate(timeout=timeout)
            except BaseException as error:
                # The new session makes this group ours, including CLI helpers.
                with suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                _, stderr = process.communicate()
                if isinstance(error, subprocess.TimeoutExpired):
                    diagnostics = _safe_diagnostics(stderr or error.stderr)
                    raise RuntimeError(
                        f"Local test command {arguments[0]} {arguments[1]} timed out.\n"
                        + diagnostics
                    ) from None
                raise
    except OSError:
        raise RuntimeError(f"Local test command {arguments[0]} {arguments[1]} failed.") from None
    if process.returncode:
        raise RuntimeError(
            f"Local test command {arguments[0]} {arguments[1]} exited {process.returncode}.\n"
            + _safe_diagnostics(stderr)
        )
    return stdout


def _safe_diagnostics(output: str | bytes | None) -> str:
    """Retain startup errors without printing CLI credentials or connection strings."""
    if isinstance(output, bytes):
        output = output.decode(errors="replace")
    lines = (output or "").splitlines()
    sensitive = re.compile(
        r"key|token|secret|password|authorization|postgres(?:ql)?://|eyJ[\w-]+\."
        r"|[a-z][a-z0-9+.-]*://[^\s/@]+@",
        re.I,
    )
    return "\n".join(
        "[credential-bearing line omitted]" if sensitive.search(line) else line
        for line in lines[-15:]
    )


def _local_docker_environment() -> dict[str, str]:
    """Do not inherit cloud Supabase credentials, dotenv, or endpoint overrides."""
    allowed = ("PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG")
    env = {name: os.environ[name] for name in allowed if name in os.environ}
    host = env.get("DOCKER_HOST", "")
    if env.get("DOCKER_CONTEXT") or not host:
        host = _command(
            ["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], env=env
        ).strip()
    if not host.startswith("unix://"):
        raise ValueError("End-to-end tests require a local Docker Unix socket.")
    # Pin later commands even if the selected context changes during the tests.
    env.pop("DOCKER_CONTEXT", None)
    env["DOCKER_HOST"] = host
    return env


def _available_ports() -> tuple[int, int, int]:
    with ExitStack() as stack:
        sockets = [stack.enter_context(socket.socket()) for _ in range(3)]
        for listener in sockets:
            listener.bind(("127.0.0.1", 0))
        return cast(tuple[int, int, int], tuple(listener.getsockname()[1] for listener in sockets))


@contextmanager
def _isolated_libpq_environment() -> Generator[None]:
    """Prevent ambient libpq settings from overriding the verified local DSN."""
    original = {name: value for name, value in os.environ.items() if name.startswith("PG")}
    for name in original:
        os.environ.pop(name)
    try:
        yield
    finally:
        for name in tuple(os.environ):
            if name.startswith("PG"):
                os.environ.pop(name)
        os.environ.update(original)


class LocalSupabaseStack:
    """Own and clean up one isolated stack; no configurable remote target exists."""

    def __init__(self) -> None:
        self.project_id = "aselbox_e2e_" + uuid4().hex[:12]
        self.api_url = ""
        self.database_url = ""
        self.anon_key = ""
        self.service_key = ""
        self._cleanup = ExitStack()

    def __enter__(self) -> Self:
        try:
            self._cleanup.enter_context(_isolated_libpq_environment())
            self._start()
        except BaseException:
            self._cleanup.close()
            raise
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self._cleanup.close()

    def _start(self) -> None:
        env = _local_docker_environment()
        root = Path(self._cleanup.enter_context(TemporaryDirectory(prefix=self.project_id + "_")))
        # Public Supabase images need no saved registry credentials or keychain
        # helper. The already validated Unix socket keeps this client local.
        docker_config = root / "docker"
        docker_config.mkdir()
        (docker_config / "config.json").write_text('{"auths": {}}', encoding="utf-8")
        env["DOCKER_CONFIG"] = str(docker_config)
        supabase = root / "supabase"
        supabase.mkdir()
        api_port, database_port, shadow_port = _available_ports()
        self._api_port = api_port
        # Keep application API and DB configuration from the repository, changing
        # only the project identity and listener ports. Optional services are excluded.
        source = Path(__file__).parents[2]
        config = (source / "config.toml").read_text(encoding="utf-8")
        config = re.sub(
            r"^project_id = .*$", f'project_id = "{self.project_id}"', config, flags=re.M
        )
        for original, replacement in (
            (54321, api_port),
            (54322, database_port),
            (54320, shadow_port),
        ):
            config = re.sub(rf"\b{original}\b", str(replacement), config)
        configured = tomllib.loads(config)
        if (
            configured.get("project_id") != self.project_id
            or configured.get("api", {}).get("port") != api_port
            or configured.get("db", {}).get("port") != database_port
            or configured.get("db", {}).get("shadow_port") != shadow_port
        ):
            raise ValueError("Could not isolate the Supabase project identity and ports.")
        (supabase / "config.toml").write_text(config, encoding="utf-8")
        shutil.copytree(source / "migrations", supabase / "migrations")
        network = self.project_id + "_network"
        _command(
            [
                "docker",
                "network",
                "create",
                "-o",
                "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
                network,
            ],
            env=env,
        )
        self._cleanup.callback(_command, ["docker", "network", "rm", network], env=env)
        self._cleanup.callback(self._stop, root, env)
        _command(
            [
                "supabase",
                "start",
                "--workdir",
                str(root),
                "--network-id",
                network,
                "--exclude",
                _EXCLUDED_SERVICES,
            ],
            env=env,
            timeout=600,
        )
        status = cast(
            dict[str, object],
            json.loads(
                _command(["supabase", "status", "--workdir", str(root), "-o", "json"], env=env)
            ),
        )
        api_url = _status_text(status, "API_URL")
        database_url = _status_text(status, "DB_URL")
        require_local_endpoint(api_url, port=api_port)
        require_local_endpoint(database_url, port=database_port, database=True)
        self.api_url = api_url
        self.database_url = database_url
        self.anon_key = _status_text(status, "ANON_KEY")
        self.service_key = _status_text(status, "SERVICE_ROLE_KEY")
        # Fixture setup must not race the production scheduler. This stack is
        # owned by this test; normal installations retain the active cron job.
        with psycopg.connect(self.database_url) as connection:
            jobs = connection.execute(
                "select jobid from cron.job where jobname='company-payout-reports'"
            ).fetchall()
            if len(jobs) != 1:
                raise RuntimeError("The application payout scheduler was not installed.")
            connection.execute("select cron.alter_job(%s,active:=false)", (jobs[0][0],))
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)

    def _stop(self, root: Path, env: dict[str, str]) -> None:
        if not _PROJECT_PATTERN.fullmatch(self.project_id):
            raise ValueError("Refusing to stop a project not owned by the end-to-end tests.")
        _command(
            [
                "supabase",
                "stop",
                "--workdir",
                str(root),
                "--project-id",
                self.project_id,
                "--no-backup",
            ],
            env=env,
            timeout=120,
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        admin: bool = False,
        json: object = None,
        params: dict[str, str] | None = None,
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        require_local_endpoint(self.api_url, port=self._api_port)
        if not path.startswith("/") or path.startswith("//") or "\\" in path:
            raise ValueError("End-to-end HTTP requests require a local relative API path.")
        key = self.service_key if admin else self.anon_key
        with httpx.Client(timeout=30, trust_env=False, follow_redirects=False) as client:
            return client.request(
                method,
                self.api_url + path,
                headers={
                    "apikey": key,
                    "Authorization": "Bearer " + (token or key),
                    **(headers or {}),
                },
                json=json,
                params=params,
                content=content,
            )


def _status_text(status: dict[str, object], key: str) -> str:
    value = status.get(key)
    if not isinstance(value, str) or not value:
        raise RuntimeError(f"Local Supabase status omitted {key}.")
    return value
