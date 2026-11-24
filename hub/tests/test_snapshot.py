"""Vérification du contrat livré sur le référentiel versionné."""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import snapshot
from adapters.gtabase import record_id


class SnapshotTest(unittest.TestCase):
    def test_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            manifest = snapshot.build(output=output)
            self.assertEqual(manifest["schemaVersion"], 1)
            self.assertEqual(manifest["missingRelationTargets"], [])
            self.assertEqual((output / snapshot.MANIFEST).read_bytes(),
                             (snapshot.ROOT / snapshot.MANIFEST).read_bytes())
            self.assertEqual((output / snapshot.AUDIT).read_bytes(),
                             (snapshot.ROOT / snapshot.AUDIT).read_bytes())
            for path, spec in manifest["bundles"].items():
                data = (output / path).read_bytes()
                self.assertEqual(data, (snapshot.ROOT / path).read_bytes())
                self.assertEqual(snapshot.fingerprint(data)["sha256"], spec["sha256"])
                self.assertLess(len(data), 250000)

    def test_vehicle_ids(self):
        rows = snapshot.read(snapshot.ROOT / "public/data/hub/vehicles.json")
        for row in rows:
            self.assertEqual(row["id"], record_id("vehicles", row["u"]))
        self.assertEqual(len(rows), len({row["id"] for row in rows}))

    def test_previous_snapshot_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            hub = Path(directory) / "hub"
            shutil.copytree(snapshot.ROOT / "hub", hub, ignore=shutil.ignore_patterns("cache"))
            before = {p: p.read_bytes() for p in (hub / "records").glob("*.json")}
            result = subprocess.run([sys.executable, str(hub / "refresh.py"), "--offline",
                                     "--source", "gtadb"], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot.read(hub / "reports/last-attempt.json")["staleSources"], ["gtadb"])
            self.assertEqual(before, {p: p.read_bytes() for p in before})

    def test_caddy_relation(self):
        rows = {v["id"]: v for v in snapshot.read(snapshot.ROOT / "public/data/hub/vehicles.json")}
        variant = "gtabase:vehicles/celebration-caddy"
        self.assertEqual(rows[variant]["base"], "gtabase:vehicles/caddy-82")
        self.assertIn(variant, rows[rows[variant]["base"]]["vars"])

    def test_unplaced_and_coordinates(self):
        places = snapshot.read(snapshot.ROOT / "hub/records/gtadb-place.json")
        bundle = snapshot.read(snapshot.ROOT / "public/data/hub/places.json")
        self.assertEqual({item["id"] for item in bundle["unplaced"]},
                         {r["prov"][0]["ref"] for r in places if not r["fields"].get("position")})
        for item in bundle["unplaced"]:
            self.assertFalse({"position", "x", "y"} & item.keys())

    def test_aggregator(self):
        sample = snapshot.read(snapshot.ROOT / "hub/samples/vice-city-collectibles.json")
        for row in sample["records"]:
            self.assertTrue(row["prov"])
            for prov in row["prov"]:
                self.assertEqual(prov["aggregator"], "vice-city.app")
                self.assertEqual(prov["upstreamOrigin"], "powerpyx.com")

    def test_ambiguous_relations(self):
        rows = {"property": [{"id": "property-A", "rel": [
            {"kind": "located_candidates", "to": ["place-A", "absent"]},
            {"kind": "located_at", "to": "property-A"}]}],
            "place": [{"id": "place-A", "rel": []}]}
        missing, issues = snapshot.audit_relations(rows)
        self.assertEqual(missing, ["absent"])
        self.assertEqual(issues, [{"from": "property-A", "kind": "located_at",
                                   "to": "property-A", "actualType": "property"}])
