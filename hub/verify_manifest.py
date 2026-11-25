"""Vérifie le contrat avant publication, sans réseau ni code dans le client."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "public/data/hub/manifest.json"
ROWS = {
    "public/data/hub/vehicles.json": ("id", "n", "t", "u"),
    "public/data/hub/catalog.json": ("id", "n", "t", "u"),
    "src/data/hub/missions.json": ("id", "name", "kind", "url"),
}
OBJECTS = {
    "public/data/hub/places.json": {"enrich": dict, "unplaced": list, "photosInGame": int},
    "src/data/hub/meta.json": {"runAt": str, "counts": dict, "gtabase": dict,
                               "gtadb": dict, "missionIndex": int},
}


def verify(root=ROOT, export=None):
    manifest = json.loads((root / MANIFEST).read_bytes())
    expected = ROWS.keys() | OBJECTS.keys()
    if type(manifest.get("schemaVersion")) is not int or manifest["schemaVersion"] != 1 or set(manifest["bundles"]) != expected:
        raise ValueError("Version ou inventaire des projections incompatible")
    if export and (export / "data/hub/manifest.json").read_bytes() != (root / MANIFEST).read_bytes():
        raise ValueError("Manifeste exporté différent")
    for path, spec in manifest["bundles"].items():
        file = export / path.removeprefix("public/") if export and path.startswith("public/") else root / path
        data = file.read_bytes()
        if (type(spec.get("schemaVersion")) is not int or spec["schemaVersion"] != 1 or spec.get("format") != "json"
                or len(data) != spec["bytes"] or hashlib.sha256(data).hexdigest() != spec["sha256"]):
            raise ValueError(f"Contrat v1 ou intégrité invalide : {path}")
        obj = json.loads(data)
        if path in ROWS:
            valid = isinstance(obj, list) and all(isinstance(row, dict) and all(
                isinstance(row.get(k), str) and row[k] for k in ROWS[path]) for row in obj)
            valid = valid and len(obj) == len({row["id"] for row in obj})
        else:
            valid = isinstance(obj, dict) and all(type(obj.get(k)) is t for k, t in OBJECTS[path].items())
        if not valid:
            raise ValueError(f"Structure incompatible avec la projection v1 : {path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path)
    verify(export=parser.parse_args().export)
    print("Contrat v1 vérifié pour les cinq projections")
