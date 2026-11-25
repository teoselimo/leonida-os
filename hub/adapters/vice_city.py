"""Import facultatif des collections de la démo publique. Sortie hors client."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

URL = "https://vice-city.app/api/v1/collectibles?lang=fr&limit=5"


def normalize(payload):
    rows = []
    for item in payload["data"]:
        provenance = []
        for source in item["sources"]:
            host = urlsplit(source["url"]).hostname
            if not host:
                raise ValueError("Source amont sans domaine")
            origin = host.removeprefix("www.")
            if origin.endswith(".gtadb.org") or (origin == "github.com" and urlsplit(source["url"]).path.startswith("/rolux/gtadb.org/")):
                origin = "gtadb.org"
            provenance.append({"aggregator": "vice-city.app", "upstreamOrigin": origin,
                               "url": source["url"], "via": item["href"], "license": item["license"]})
        rows.append({"id": "vice-city:" + item["id"], "type": item["type"], "name": item["name"],
                     "fields": {"category": item["attributes"]["category"]}, "prov": provenance,
                     "modified": item["updated_at"], "rel": []})
    return {"schemaVersion": 1, "source": URL, "revision": payload["meta"]["data_version"],
            "totalAvailable": payload["meta"]["total"], "attribution": payload["meta"]["attribution"],
            "records": sorted(rows, key=lambda r: r["id"])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="rejouer une réponse JSON locale")
    args = parser.parse_args()
    if args.input:
        payload = json.loads(args.input.read_bytes())
    else:
        with urlopen(Request(URL, headers={"x-api-key": "vc_demo"}), timeout=20) as response:
            payload = json.load(response)
    print(json.dumps(normalize(payload), ensure_ascii=False, indent=2))
