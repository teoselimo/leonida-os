"""Reconstruit le contrat v1 depuis le dernier import normalisé, sans réseau."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

import bundles

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path("public/data/hub/manifest.json")


def read(path):
    return json.loads(path.read_bytes())


def fingerprint(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def build(root=ROOT, output=None, import_report=None):
    root = Path(root)
    output = Path(output or root)
    report_path = root / "hub/reports/latest.json"
    report = import_report if import_report is not None else read(report_path)
    records = root / "hub/records"
    groups = {}
    collected = {}
    files = {}
    ids = set()
    targets = set()
    for path in sorted(records.glob("*.json")):
        source, kind = path.stem.split("-", 1)
        data = path.read_bytes()
        rows = json.loads(data)
        files[path.name] = {**fingerprint(data), "count": len(rows)}
        if kind == "mission-index":
            continue
        for row in rows:
            if row["id"] in ids or row["type"] != kind or not row["prov"]:
                raise ValueError(f"Fiche incohérente : {row['id']}")
            ids.add(row["id"])
            for provenance in row["prov"]:
                if provenance["source"] != source or not provenance["url"]:
                    raise ValueError(f"Provenance incohérente : {row['id']}")
                if provenance.get("collectedAt"):
                    collected[source] = max(collected.get(source, ""), provenance["collectedAt"])
            targets.update(rel["to"] for rel in row["rel"] if rel.get("to"))
        groups[kind] = rows
    expected = {"place": report["counts"]["gtadb"]["place"], **report["counts"]["gtabase"]}
    if {kind: len(rows) for kind, rows in groups.items()} != expected:
        raise ValueError("Le référentiel et les comptes du dernier import divergent")
    places = groups.pop("place")
    index = read(records / "gtabase-mission-index.json")
    sources = {}
    for name, state in report["sources"].items():
        sources[name] = {key: state[key] for key in
                         ("status", "revision", "revisionDate", "discoveredAt", "license", "note")
                         if key in state}
        sources[name].update(upstreamOrigin=name, aggregator=None,
                             lastCollectedAt=collected.get(name))
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output) as directory:
        stage = Path(directory)
        paths = bundles.build(stage, places, groups, index, report)
        if import_report is not None:
            report["bundles"] = paths
            staged_report = stage / "hub/reports/latest.json"
            staged_report.parent.mkdir(parents=True)
            staged_report.write_text(json.dumps(report, ensure_ascii=False, indent=0, sort_keys=True),
                                     encoding="utf-8")
            report_path = staged_report
        manifest = {"schemaVersion": 1, "snapshotAt": report["runAt"], "sources": sources,
                    "importReport": fingerprint(report_path.read_bytes()),
                    "records": files, "missingRelationTargets": sorted(targets - ids),
                    "bundles": {key: {"format": "json", **fingerprint((stage / key).read_bytes())}
                                for key in sorted(paths)}}
        (stage / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True,
                                                 separators=(",", ":")), encoding="utf-8")
        report_files = ["hub/reports/latest.json"] if import_report is not None else []
        for key in [*paths, *report_files, MANIFEST]:
            target = output / key
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(stage / key, target)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="racine de destination")
    print(json.dumps(build(output=parser.parse_args().output)["bundles"], indent=2))
