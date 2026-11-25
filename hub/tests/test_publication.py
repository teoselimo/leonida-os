"""Échec réel du sous-processus de collecte avec un transport HTTP simulé."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class PublicationTest(unittest.TestCase):
    def test_failed_gtabase_refresh_preserves_accepted_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ROOT / "hub", root / "hub", ignore=shutil.ignore_patterns("cache", "__pycache__"))
            shutil.copytree(ROOT / "src/data/hub", root / "src/data/hub")
            public = root / "public/data/hub"
            public.mkdir(parents=True)
            for name in ("manifest", "vehicles", "places", "catalog"):
                shutil.copy(ROOT / f"public/data/hub/{name}.json", public)
            files = list((root / "hub/records").glob("*.json")) + list(public.glob("*.json"))
            files += list((root / "src/data/hub").glob("*.json"))
            files += [root / "hub/reports" / n for n in ("latest.json", "latest.md", "snapshot-v1.json")]
            before = {path: path.read_bytes() for path in files}
            curl = root / "curl"
            curl.write_text("#!/bin/sh\nprintf '\\n__HTTP_CODE__403'\n")
            curl.chmod(0o755)
            result = subprocess.run([sys.executable, "hub/refresh.py", "--source", "gtabase", "--force"],
                                    cwd=root, env={**os.environ, "PATH": f"{root}:{os.environ['PATH']}"},
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            attempt = json.loads((root / "hub/reports/last-attempt.json").read_bytes())
            self.assertEqual(attempt["staleSources"], ["gtabase"])
            self.assertIn("403", attempt["sources"]["gtabase"]["metrics"]["error"])
            self.assertEqual(before, {path: path.read_bytes() for path in files})
