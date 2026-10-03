"""Read the five audited XLSX fixtures without installing packages.

Test-only OOXML reader, not an application upload parser. Outputs protected
temporary JSON/CSV fixtures; never prints workbook cells or contact details.
"""
import csv
import hashlib
import json
import pathlib
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
FIXTURES = [
    ("Outscraper-20261002160911s8d6b_1791037870877.xlsx", "5079ea20012d1ca5e8c0eae9c0aa8460a6ce4c91eb10784587f36026675cf833", 537),
    ("Outscraper-20261002160955s00ed_1791037870876.xlsx", "506fe8119590a0ab821167e50f15584aea29da441a2f393ff64f9b32837940a4", 578),
    ("Outscraper-20261002161052s68e5_1791037870877.xlsx", "4c02771046abc941d7475aa40a4cfc56dc95e2dbf5ff6bb3f43013577852a581", 513),
    ("Outscraper-20261002161147s2b94_1791037870876.xlsx", "bec23f5270048a3e1cbba641b6727e9d813b14106abe456a881ed9eb7a039230", 653),
    ("Outscraper-20261002161239s8aab_1791037870874.xlsx", "c3fd1dd8da6eb4bf504c91b3342d59ebd5fb5b12d46c767c178b5b4c5bd4baca", 633),
]


def read_rows(path):
    with zipfile.ZipFile(path) as archive:
        assert len(archive.namelist()) < 100, "Unexpected archive layout"
        assert sum(x.file_size for x in archive.infolist()) < 20_000_000
        strings = [
            "".join(node.itertext())
            for node in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si", NS)
        ]
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        grid = []
        for row in sheet.findall("m:sheetData/m:row", NS):
            values = {}
            for cell in row.findall("m:c", NS):
                letters = "".join(c for c in cell.attrib["r"] if c.isalpha())
                index = 0
                for c in letters:
                    index = index * 26 + ord(c) - ord("A") + 1
                value = cell.find("m:v", NS)
                kind = cell.attrib.get("t")
                assert cell.find("m:f", NS) is None, "Formula fixture requires explicit handling"
                if kind == "s":
                    text = strings[int(value.text)]
                elif kind == "inlineStr":
                    text = "".join(cell.find("m:is", NS).itertext())
                else:
                    text = "" if value is None or value.text is None else value.text
                values[index - 1] = text
            grid.append(values)
    width = max(grid[0]) + 1
    headers = [grid[0].get(i, "") for i in range(width)]
    assert width == 93 and len(set(headers)) == 93 and all(headers)
    assert all(max(row, default=-1) < width for row in grid)
    return headers, [
        {header: row.get(i, "") for i, header in enumerate(headers)}
        for row in grid[1:] if any(row.values())
    ]


def main():
    destination = pathlib.Path(sys.argv[1]).resolve()
    assert str(destination).startswith("/tmp/"), "Fixture output must be temporary"
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    manifest = []
    businesses, emails, pairs, receiving, receiving_businesses = set(), set(), set(), set(), set()
    for name, expected_hash, count in FIXTURES:
        path = pathlib.Path("attached_assets") / name
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        assert digest == expected_hash, f"Fixture changed: {name}"
        headers, rows = read_rows(path)
        assert len(rows) == count
        assert len({r["place_id"] for r in rows}) == 250
        for row in rows:
            business = row["place_id"]
            email = row["email"].strip().lower()
            businesses.add(business)
            if email:
                emails.add(email)
                pairs.add((business, email))
                if row["email.emails_validator.status"] == "RECEIVING":
                    receiving.add(email)
                    receiving_businesses.add(business)
        stem = pathlib.Path(name).stem
        json_path = destination / (stem + ".json")
        csv_path = destination / (stem + ".csv")
        json_path.write_text(json.dumps(rows, ensure_ascii=False))
        with csv_path.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=headers)
            writer.writeheader()
            writer.writerows(rows)
        json_path.chmod(0o600)
        csv_path.chmod(0o600)
        manifest.append({"name": name, "sha256": digest, "rows": count, "columns": len(headers),
                         "json": str(json_path), "csv": str(csv_path)})
    aggregate = {"rows": sum(f["rows"] for f in manifest), "businesses": len(businesses),
                 "emails": len(emails), "pairs": len(pairs), "receiving_emails": len(receiving),
                 "receiving_businesses": len(receiving_businesses)}
    assert aggregate == {"rows": 2914, "businesses": 1245, "emails": 2754, "pairs": 2822,
                         "receiving_emails": 1890, "receiving_businesses": 1042}, aggregate
    (destination / "manifest.json").write_text(json.dumps({"files": manifest, "aggregate": aggregate}))
    print(json.dumps({"extraction": "PASS", **aggregate}))


if __name__ == "__main__":
    main()