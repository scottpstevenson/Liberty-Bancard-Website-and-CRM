import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readTabularImport, readTabularImportWithCoordinates } from "../../server/services/tabular-import-reader";

const directory = process.argv[2] ?? "/tmp/canonical-enrichment-workbooks";
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
let rows = 0;
let checks = 0;
for (const fixture of manifest.files) {
  const expected = JSON.parse(fs.readFileSync(fixture.json, "utf8"));
  const workbook = await readTabularImport(fs.readFileSync(path.join("attached_assets", fixture.name)), fixture.name);
  const workbookWithCoordinates = await readTabularImportWithCoordinates(fs.readFileSync(path.join("attached_assets", fixture.name)), fixture.name);
  const csv = await readTabularImport(fs.readFileSync(fixture.csv), "equivalent.csv");
  assert.deepEqual(workbook, expected, "Every original XLSX cell must survive");
  assert.deepEqual(csv, expected, "Every original CSV cell must survive");
  assert.deepEqual(csv, workbook);
  assert.equal(workbook.length, fixture.rows);
  assert.equal(Object.keys(workbook[0]).length, 93);
  assert.deepEqual(workbookWithCoordinates.rows, workbook);
  assert.equal(workbookWithCoordinates.coordinates.length, workbook.length);
  workbookWithCoordinates.coordinates.forEach((coordinate, index) => {
    assert.equal(coordinate.format, "xlsx");
    assert(coordinate.sheetName);
    assert.equal(coordinate.worksheetRow, index + 2);
    assert(coordinate.worksheetPart?.startsWith("xl/worksheets/"));
  });
  rows += workbook.length;
  checks += 8;
}
for (const source of ["a,a\n1,2", "a,b\n1,2,3", "a,,b\n1,2,3", "__proto__,a\n1,2", "Constructor,a\n1,2"]) {
  await assert.rejects(readTabularImport(Buffer.from(source), "unsafe.csv"));
  checks++;
}
assert.deepEqual(await readTabularImport(Buffer.from('name,email\n" Company ",a@example.invalid\n'), "safe.csv"),
  [{ name: " Company ", email: "a@example.invalid" }], "Raw source whitespace must not be overwritten");
await assert.rejects(readTabularImport(Buffer.from("anything"), "file.xls"));
await assert.rejects(readTabularImport(Buffer.from([0x61, 0x0a, 0xc3, 0x28]), "invalid-encoding.csv"));
checks += 3;
const multiline = await readTabularImportWithCoordinates(Buffer.from('name,note\nA,"line one\nline two"\n\nB,plain\n'), "coordinates.csv");
assert.deepEqual(multiline.coordinates.map(row => [row.recordNumber, row.csvEndingLine]), [[2, 3], [3, 5]]);
assert.deepEqual(multiline.rows, [{ name: "A", note: "line one\nline two" }, { name: "B", note: "plain" }]);
checks += 2;
const blankRecord = await readTabularImportWithCoordinates(Buffer.from("name,email\n,\nA,a@example.invalid\n"), "blank-record.csv");
assert.deepEqual(blankRecord.rows, [{ name: "", email: "" }, { name: "A", email: "a@example.invalid" }]);
assert.deepEqual(blankRecord.coordinates.map(row => [row.recordNumber, row.csvEndingLine]), [[2, 2], [3, 3]]);
checks += 2;
fs.writeFileSync("docs/certification/canonical-enrichment-upload-reader-test.json",
  JSON.stringify({ observedAt: new Date().toISOString(), checks, files: manifest.files.length, rows,
    scope: "Actual application CSV/XLSX reader: exact raw-cell parity and malformed-input rejection",
    productionExecution: false, taskComplete: false }, null, 2) + "\n");
console.log(`PASS: ${checks} upload-reader checks; ${rows} rows across all five actual workbooks`);