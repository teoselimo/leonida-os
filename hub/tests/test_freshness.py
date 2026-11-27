import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetchlib


class FreshnessTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.cache = Path(tmp.name) / "page.html"
        self.url = "https://www.gtabase.com/gta-6/vehicles/exemple"
        self.st = {}
        for name, value in (("cache_path", lambda *_: str(self.cache)),
                            ("get", None)):
            mock = patch.object(fetchlib, name, value) if value else patch.object(fetchlib, name)
            target = mock.start()
            self.addCleanup(mock.stop)
            if name == "get":
                self.get = target
                self.get.return_value = (200, "page neuve", None)

    def read(self, **kwargs):
        return fetchlib.fetch_cached("gtabase", self.url, st=self.st, **kwargs)

    def seed(self, days=1, lastmod=None):
        self.cache.write_text("ancienne page")
        stamp = datetime.now(timezone.utc) - timedelta(days=days)
        self.st[self.url] = {"fetchedAt": stamp.isoformat(), "lastmod": lastmod}

    def test_internal_url_first_fetch_then_fresh(self):
        self.assertEqual(self.read()[1]["cacheState"], "missing")
        self.assertEqual(self.read()[1]["status"], "cached")
        self.get.assert_called_once()

    def test_ttl_expired(self):
        self.seed(days=7)
        data, info = self.read()
        self.assertEqual((data, info["cacheState"], info["status"]), ("page neuve", "expired", "fetched"))

    def test_lastmod_has_priority(self):
        self.seed(days=90, lastmod="rev1")
        self.assertEqual(self.read(lastmod="rev1")[1]["status"], "cached")
        self.assertEqual(self.read(lastmod="rev2")[1]["status"], "fetched")

    def test_missing_timestamp(self):
        self.cache.write_text("ancienne page")
        self.assertEqual(self.read()[1]["cacheState"], "expired")

    def test_network_error_keeps_cached_data_and_age(self):
        self.seed(days=9)
        old = self.st[self.url]["fetchedAt"]
        self.get.return_value = (403, None, "HTTP 403")
        data, info = self.read()
        self.assertEqual((info["status"], data), ("failed", "ancienne page"))
        self.assertEqual(self.cache.read_text(), data)
        self.assertEqual(self.st[self.url]["fetchedAt"], old)
        self.get.return_value = (200, "reprise", None)
        self.assertEqual(self.read()[0], "reprise")
        self.assertNotIn("lastError", self.st[self.url])

    def test_force_refresh(self):
        self.seed(lastmod="rev")
        self.assertEqual(self.read(lastmod="rev", force=True)[1]["status"], "fetched")
        self.get.assert_called_once()

    def test_offline_never_fetches_expired_page(self):
        self.seed(days=8)
        self.assertEqual(self.read(offline=True, force=True)[1]["status"], "cached-stale")
        self.get.assert_not_called()
