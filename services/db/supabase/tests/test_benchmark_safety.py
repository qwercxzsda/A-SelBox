"""Benchmark clone and REST operations stay on one local Docker connection."""

import os
import subprocess
import unittest
from unittest.mock import patch

from services.db.supabase.benchmarks import common


class BenchmarkDockerSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        common.local_docker_environment.cache_clear()
        self.addCleanup(common.local_docker_environment.cache_clear)

    def test_remote_host_or_selected_context_is_rejected_before_container_access(self) -> None:
        for environment in (
            {"DOCKER_HOST": "tcp://remote.example.test:2376"},
            {"DOCKER_HOST": "unix:///local.sock", "DOCKER_CONTEXT": "remote"},
        ):
            with (
                self.subTest(environment=environment),
                patch.dict(os.environ, environment, clear=True),
                patch.object(common.subprocess, "run") as execute,
            ):
                execute.return_value = subprocess.CompletedProcess([], 0, b"ssh://remote.test\n")
                with self.assertRaises(ValueError):
                    common.docker("inspect", common.CONTAINER)
                self.assertTrue(
                    all(
                        call.args[0][1:3] == ["context", "inspect"]
                        for call in execute.call_args_list
                    )
                )

    def test_local_socket_stays_pinned_and_unrelated_credentials_are_not_inherited(self) -> None:
        environment = {
            "PATH": "/usr/bin",
            "DOCKER_CONTEXT": "local",
            "PGPASSWORD": "unused-test-password",
            "SUPABASE_ACCESS_TOKEN": "unused-test-token",
            "HTTPS_PROXY": "https://remote.example.test",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(common.subprocess, "run") as execute,
        ):
            execute.side_effect = (
                subprocess.CompletedProcess([], 0, b"unix:///local.sock\n"),
                subprocess.CompletedProcess([], 0, b"first"),
                subprocess.CompletedProcess([], 0, b"second"),
            )
            self.assertEqual(common.docker("inspect", common.CONTAINER), b"first")
            os.environ["DOCKER_CONTEXT"] = "remote"
            self.assertEqual(common.docker("inspect", common.REST_CONTAINER), b"second")
        self.assertEqual(execute.call_count, 3)
        for call in execute.call_args_list[1:]:
            self.assertEqual(
                call.kwargs["env"], {"PATH": "/usr/bin", "DOCKER_HOST": "unix:///local.sock"}
            )


class BenchmarkSchemaSafetyTests(unittest.TestCase):
    def test_obsolete_seed_is_rejected_before_clone_work(self) -> None:
        from unittest.mock import MagicMock

        from services.db.supabase.benchmarks.fixtures import require_current_schema

        connection = MagicMock()
        connection.execute.return_value.fetchone.return_value = (False,)
        with self.assertRaisesRegex(ValueError, "current Finance"):
            require_current_schema(connection)
        self.assertEqual(connection.execute.call_count, 1)
        self.assertTrue(connection.execute.call_args.args[0].startswith("select "))

    def test_current_seed_passes_read_only_preflight(self) -> None:
        from unittest.mock import MagicMock

        from services.db.supabase.benchmarks.fixtures import require_current_schema

        connection = MagicMock()
        connection.execute.return_value.fetchone.return_value = (True,)
        require_current_schema(connection)
        self.assertEqual(connection.execute.call_count, 1)

    def test_only_current_seed_workload_is_accepted(self) -> None:
        from argparse import ArgumentTypeError

        from services.db.supabase.benchmarks.runner import parse_fixtures

        self.assertEqual(parse_fixtures("seed"), ("seed",))
        for value in ("", "density", "history", "seed,seed", "unrecognized"):
            with self.subTest(value=value), self.assertRaises(ArgumentTypeError):
                parse_fixtures(value)
