"""Offline guards ensuring the HTTP workflow tests cannot target production."""

import os
import signal
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from services.db.supabase.tests.e2e import local_stack
from services.db.supabase.tests.e2e.local_stack import (
    LocalSupabaseStack,
    _command,  # pyright: ignore[reportPrivateUsage]
    _local_docker_environment,  # pyright: ignore[reportPrivateUsage]
    require_local_endpoint,
)

_API_PORT = 43121
_DATABASE_PORT = 43122
_API_URL = f"http://127.0.0.1:{_API_PORT}"


class LocalCommandDiagnosticsTests(unittest.TestCase):
    def test_failure_and_timeout_preserve_errors_without_credentials(self) -> None:
        sensitive_lines = (
            "eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0Ijp0cnVlfQ.test-signature",
            "API_KEY=unused-api-credential",
            "password=unused-db-credential",
            "postgresql://postgres:unused-dsn-credential@127.0.0.1:43122/postgres",
            "https://user:unused-http-credential@registry.example.test",
        )
        diagnostic = "Docker image registry refused connection"
        stderr = "\n".join((*sensitive_lines, diagnostic))
        arguments = ["supabase", "start"]
        for timed_out in (False, True):
            with (
                self.subTest(timed_out=timed_out),
                patch.object(local_stack.subprocess, "Popen") as command,
                patch.object(local_stack.os, "killpg") as kill_group,
            ):
                process = command.return_value.__enter__.return_value
                process.pid = 123456
                process.returncode = 1
                if timed_out:
                    process.communicate.side_effect = (
                        subprocess.TimeoutExpired(arguments, 1, stderr=stderr.encode() + b"\n\xff"),
                        ("", ""),
                    )
                else:
                    process.communicate.return_value = ("unused-stdout-credential", stderr)
                with self.assertRaises(RuntimeError) as caught:
                    _command(arguments, env={})
                if timed_out:
                    kill_group.assert_called_once_with(process.pid, signal.SIGKILL)
                    self.assertEqual(process.communicate.call_count, 2)
                else:
                    kill_group.assert_not_called()
            message = str(caught.exception)
            self.assertIn(diagnostic, message)
            self.assertIn("supabase start", message)
            self.assertNotIn("unused-stdout-credential", message)
            for line in sensitive_lines:
                self.assertNotIn(line, message)
            for value in (
                "unused-api-credential",
                "unused-db-credential",
                "unused-dsn-credential",
                "unused-http-credential",
            ):
                self.assertNotIn(value, message)

    def test_interruption_kills_only_owned_process_group_and_drains_output(self) -> None:
        with (
            patch.object(local_stack.subprocess, "Popen") as command,
            patch.object(local_stack.os, "killpg") as kill_group,
        ):
            process = command.return_value.__enter__.return_value
            process.pid = 123456
            process.communicate.side_effect = (KeyboardInterrupt(), ("", ""))
            with self.assertRaises(KeyboardInterrupt):
                _command(["supabase", "start"], env={})
            self.assertTrue(command.call_args.kwargs["start_new_session"])
            self.assertEqual(command.call_args.kwargs["stdin"], subprocess.DEVNULL)
            kill_group.assert_called_once_with(process.pid, signal.SIGKILL)
            self.assertEqual(process.communicate.call_count, 2)


class LocalEndpointGuardTests(unittest.TestCase):
    def test_accepts_allocated_loopback_listeners(self) -> None:
        for host in ("127.0.0.1", "localhost", "[::1]"):
            with self.subTest(host=host):
                require_local_endpoint(f"http://{host}:{_API_PORT}", port=_API_PORT)
                require_local_endpoint(
                    f"postgresql://postgres@{host}:{_DATABASE_PORT}/postgres",
                    port=_DATABASE_PORT,
                    database=True,
                )

    def test_rejects_remote_or_reconfigured_api_endpoint(self) -> None:
        for url in (
            "https://production.supabase.co",
            f"http://remote.example.test:{_API_PORT}",
            "http://127.0.0.1:54321",
            _API_URL + "?host=remote.example.test",
            _API_URL + "#fragment",
            _API_URL.replace("http://", "http://user:password@"),
            _API_URL + "/rest/v1",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                require_local_endpoint(url, port=_API_PORT)

    def test_rejects_remote_or_reconfigured_database_endpoint(self) -> None:
        for url in (
            "postgresql://postgres@db.production.supabase.co:5432/postgres",
            f"postgresql://postgres@remote.example.test:{_DATABASE_PORT}/postgres",
            "postgresql://postgres@127.0.0.1:54322/postgres",
            f"postgresql://another_user@127.0.0.1:{_DATABASE_PORT}/postgres",
            f"postgresql://postgres@127.0.0.1:{_DATABASE_PORT}/existing_database",
            f"postgresql://postgres@127.0.0.1:{_DATABASE_PORT}/postgres?host=remote.test",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                require_local_endpoint(url, port=_DATABASE_PORT, database=True)


class LocalDockerGuardTests(unittest.TestCase):
    def test_rejects_tcp_and_ssh_docker_hosts(self) -> None:
        for host in ("tcp://remote.example.test:2376", "ssh://remote.example.test"):
            with (
                self.subTest(host=host),
                patch.dict(os.environ, {"DOCKER_HOST": host}, clear=True),
                patch.object(local_stack, "_command"),
                self.assertRaises(ValueError),
            ):
                _local_docker_environment()

    def test_rejects_remote_current_docker_context(self) -> None:
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(local_stack, "_command", return_value="ssh://remote.example.test\n"),
            self.assertRaises(ValueError),
        ):
            _local_docker_environment()

    def test_remote_selected_context_cannot_hide_behind_local_docker_host(self) -> None:
        # Docker gives DOCKER_CONTEXT precedence over DOCKER_HOST.
        with (
            patch.dict(
                os.environ,
                {"DOCKER_HOST": "unix:///var/run/docker.sock", "DOCKER_CONTEXT": "remote"},
                clear=True,
            ),
            patch.object(local_stack, "_command", return_value="ssh://remote.example.test\n"),
            self.assertRaises(ValueError),
        ):
            _local_docker_environment()

    def test_child_commands_do_not_inherit_database_or_cloud_configuration(self) -> None:
        environment = {
            "PATH": "/usr/bin",
            "DOCKER_HOST": "unix:///var/run/docker.sock",
            "SUPABASE_ACCESS_TOKEN": "unused-test-placeholder",
            "SUPABASE_URL": "https://production.supabase.co",
            "DATABASE_URL": "postgresql://remote.example.test/postgres",
            "PGHOST": "remote.example.test",
            "HTTPS_PROXY": "https://remote.example.test",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(local_stack, "_command", return_value="unix:///var/run/docker.sock\n"),
        ):
            child_environment = _local_docker_environment()
        self.assertEqual(child_environment["PATH"], environment["PATH"])
        for key in (
            "SUPABASE_ACCESS_TOKEN",
            "SUPABASE_URL",
            "DATABASE_URL",
            "PGHOST",
            "HTTPS_PROXY",
        ):
            with self.subTest(key=key):
                self.assertNotIn(key, child_environment)


class LocalStackOperationGuardTests(unittest.TestCase):
    def test_unrewritten_project_identity_fails_before_any_cli_command(self) -> None:
        # Valid TOML with changed spacing must not reuse a development project.
        config = (
            'project_id="A-SelBox"\n[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n'
        )
        with (
            patch.object(local_stack, "_local_docker_environment", return_value={}),
            patch.object(local_stack, "_available_ports", return_value=(43121, 43122, 43120)),
            patch.object(Path, "read_text", return_value=config),
            patch.object(local_stack, "_command") as command,
        ):
            with (
                self.assertRaisesRegex(ValueError, "Could not isolate"),
                LocalSupabaseStack(),
            ):
                self.fail("An unrewritten project identity must prevent startup.")
            command.assert_not_called()

    def test_stack_clears_and_restores_ambient_libpq_settings(self) -> None:
        original = {
            "PGHOSTADDR": "192.0.2.1",
            "PGSERVICE": "unused-test-service",
            "PGPASSWORD": "unused-test-credential",
            "PATH": "/usr/bin",
        }
        with (
            patch.dict(os.environ, original, clear=True),
            patch.object(LocalSupabaseStack, "_start"),
        ):
            with LocalSupabaseStack():
                self.assertFalse(any(name.startswith("PG") for name in os.environ))
                self.assertEqual(os.environ["PATH"], original["PATH"])
                os.environ["PGOPTIONS"] = "unused-test-option"
            self.assertEqual(dict(os.environ), original)

    def test_startup_failure_restores_ambient_libpq_settings(self) -> None:
        original = {"PGHOSTADDR": "192.0.2.1", "PGSERVICE": "unused-test-service"}

        def failed_start() -> None:
            self.assertFalse(any(name.startswith("PG") for name in os.environ))
            raise RuntimeError("Synthetic startup failure")

        with (
            patch.dict(os.environ, original, clear=True),
            patch.object(LocalSupabaseStack, "_start", side_effect=failed_start),
        ):
            with (
                self.assertRaisesRegex(RuntimeError, "Synthetic startup failure"),
                LocalSupabaseStack(),
            ):
                self.fail("Startup should have failed before entering the test body.")
            self.assertEqual(dict(os.environ), original)

    def test_request_rejects_remote_endpoint_before_creating_http_client(self) -> None:
        stack = LocalSupabaseStack()
        stack.api_url = "https://production.supabase.co"
        with (
            patch.object(stack, "_api_port", _API_PORT, create=True),
            patch.object(local_stack.httpx, "Client") as http_client,
        ):
            with self.assertRaises(ValueError):
                stack.request("POST", "/rest/v1/sellers", admin=True, json={"id": "test"})
            http_client.assert_not_called()

    def test_request_rejects_outbound_paths_before_creating_http_client(self) -> None:
        stack = LocalSupabaseStack()
        stack.api_url = _API_URL
        for path in (
            "https://production.supabase.co/rest/v1/sellers",
            "//production.supabase.co/rest/v1/sellers",
            "/\\production.supabase.co/rest/v1/sellers",
        ):
            with (
                self.subTest(path=path),
                patch.object(stack, "_api_port", _API_PORT, create=True),
                patch.object(local_stack.httpx, "Client") as http_client,
            ):
                with self.assertRaises(ValueError):
                    stack.request("DELETE", path, admin=True)
                http_client.assert_not_called()

    def test_cleanup_refuses_to_stop_non_test_project(self) -> None:
        stack = LocalSupabaseStack()
        for project_id in ("A-SelBox", "production", "aselbox_e2e_012345abcdef_extra"):
            stack.project_id = project_id
            with (
                self.subTest(project_id=project_id),
                patch.object(local_stack, "_command") as command,
            ):
                with self.assertRaises(ValueError):
                    stack._stop(Path("/unused-test-directory"), {})  # pyright: ignore[reportPrivateUsage]
                command.assert_not_called()
