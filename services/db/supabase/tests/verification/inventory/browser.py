"""Run actual login and inventory UI reads in a disposable Docker browser."""

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any
from uuid import uuid4

from ...e2e.local_stack import LocalSupabaseStack


def verify_browser(
    stack: LocalSupabaseStack, accounts: list[dict[str, Any]], output: Path
) -> dict[str, object]:
    frontend = Path(__file__).resolve().parents[5] / "frontend" / "user-webpage"
    docker = shutil.which("docker")
    if docker is None:
        raise RuntimeError("Docker is required for browser verification.")
    payload = {
        "apiUrl": stack.api_url.replace("127.0.0.1", "host.docker.internal").replace(
            "localhost", "host.docker.internal"
        ),
        "anonKey": stack.anon_key,
        "accounts": accounts,
    }
    # Ephemeral login credentials and the public browser key travel over stdin,
    # never command arguments, files, container environment, or diagnostics.
    name = "aselbox_inventory_browser_" + uuid4().hex[:12]
    try:
        result = subprocess.run(  # noqa: S603 - fixed Docker command and repository paths
            [
                docker,
                "run",
                "--rm",
                "--name",
                name,
                "-i",
                "--add-host=host.docker.internal:host-gateway",
                "-v",
                f"{frontend}:/app",
                "-v",
                f"{output.resolve()}:/evidence",
                "-w",
                "/app",
                "mcr.microsoft.com/playwright:v1.63.0-noble",
                "node",
                "tests/live/verify-inventory.mjs",
            ],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=240,
            check=False,
        )
    finally:
        subprocess.run(  # noqa: S603 - remove only this verifier's owned container
            [docker, "rm", "-f", name], capture_output=True, timeout=30, check=False
        )
    records = [line for line in result.stdout.splitlines() if line.startswith("{")]
    if not records:
        print(
            json.dumps(
                {
                    "browser_verified": False,
                    "stage": "browser_startup",
                    "exit_code": result.returncode,
                }
            ),
            flush=True,
        )
        raise RuntimeError("Live inventory browser did not return a verification record.")
    evidence = json.loads(records[-1])
    if result.returncode or not evidence.get("browser_verified"):
        print(json.dumps(evidence), flush=True)
        raise RuntimeError(f"Live inventory browser failed at {evidence.get('stage', 'startup')}.")
    return evidence
