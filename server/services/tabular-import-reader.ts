import path from "node:path";
import { parse } from "csv-parse/sync";
import unzipper from "unzipper";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export type ImportSourceRow = Record<string, string>;
export interface ImportSourceCoordinate {
  format: "csv" | "xlsx";
  recordNumber: number;
  sheetName: string | null;
  worksheetPart: string | null;
  worksheetRow: number | null;
  csvEndingLine: number | null;
}
export interface TabularImport {
  rows: ImportSourceRow[];
  coordinates: ImportSourceCoordinate[];
}
const MAX_XML_BYTES = 96 * 1024 * 1024;
const MAX_ROWS = 250_000;
const MAX_COLUMNS = 2048;
const asArray = (value: any): any[] => value == null ? [] : Array.isArray(value) ? value : [value];
const text = (value: any): string => value == null ? "" : typeof value === "object"
  ? text(value["#text"]) : String(value);
const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false,
  parseAttributeValue: false, trimValues: false, processEntities: true,
});

function columnIndex(reference: string): number {
  const match = /^([A-Z]+)[1-9][0-9]*$/.exec(reference);
  if (!match) throw new Error("Invalid spreadsheet cell reference");
  let value = 0;
  for (const letter of match[1]) value = value * 26 + letter.charCodeAt(0) - 64;
  if (value > MAX_COLUMNS) throw new Error("Spreadsheet has too many columns");
  return value - 1;
}
function richText(value: any): string {
  if (value?.t !== undefined) return text(value.t);
  return asArray(value?.r).map(run => text(run.t)).join("");
}
function validateHeaders(headers: string[]) {
  if (!headers.length || headers.length > MAX_COLUMNS || headers.some(header => !header.trim())) {
    throw new Error("Every import column must have a nonblank header");
  }
  const normalized = headers.map(header => header.trim().toLowerCase());
  if (new Set(normalized).size !== headers.length) throw new Error("Duplicate import column headers");
  if (normalized.some(header => ["__proto__", "constructor", "prototype"].includes(header))) {
    throw new Error("Unsupported import column header");
  }
}

/** Reads raw OOXML values, never evaluates formulas or promotes vendor status
 * into a validation result. No archive extraction, external relationships or
 * entity definitions are allowed. Every original column survives unchanged. */
export async function readTabularImport(buffer: Buffer, filename: string): Promise<ImportSourceRow[]> {
  return (await readTabularImportWithCoordinates(buffer, filename)).rows;
}

export async function readTabularImportWithCoordinates(buffer: Buffer, filename: string): Promise<TabularImport> {
  const extension = path.extname(filename).toLowerCase();
  if (![".csv", ".xlsx"].includes(extension)) throw new Error("Only CSV and XLSX files are supported");
  if (buffer.length > 32 * 1024 * 1024) throw new Error("Import file exceeds 32 MB");
  if (extension === ".csv") {
    const matrix = parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer), {
      bom: true, skip_empty_lines: true, relax_column_count: false, max_record_size: 2 * 1024 * 1024,
      info: true,
    }) as unknown as Array<{ record: string[]; info: { records: number; lines: number } }>;
    if (!matrix.length) throw new Error("Import file is empty");
    const [header, ...data] = matrix;
    const headers = header.record;
    validateHeaders(headers);
    if (data.length > MAX_ROWS) throw new Error("Import has too many rows");
    // A delimiter-only record is still an original row. The import ledger,
    // not the parser, decides whether it has a usable identity.
    const retained = data;
    return {
      rows: retained.map(item => Object.fromEntries(headers.map((header, index) => [header, item.record[index] ?? ""]))),
      coordinates: retained.map(item => ({
        format: "csv", recordNumber: item.info.records, csvEndingLine: item.info.lines,
        sheetName: null, worksheetPart: null, worksheetRow: null,
      })),
    };
  }

  const archive = await unzipper.Open.buffer(buffer);
  if (archive.files.length > 10_000) throw new Error("Spreadsheet archive has too many entries");
  const entries = new Map<string, any>();
  for (const file of archive.files) {
    if (entries.has(file.path)) throw new Error("Duplicate spreadsheet archive entry");
    entries.set(file.path, file);
  }
  let totalBytes = 0;
  async function xml(name: string, optional = false): Promise<any> {
    const entry = entries.get(name);
    if (!entry) {
      if (optional) return null;
      throw new Error("Spreadsheet is missing a required XML part");
    }
    if (entry.uncompressedSize > MAX_XML_BYTES) throw new Error("Spreadsheet XML exceeds size limit");
    const chunks: Buffer[] = [];
    for await (const chunk of entry.stream()) {
      const part = Buffer.from(chunk);
      totalBytes += part.length;
      if (totalBytes > MAX_XML_BYTES) throw new Error("Spreadsheet expansion exceeds size limit");
      chunks.push(part);
    }
    const source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("Spreadsheet XML entities are not supported");
    if (XMLValidator.validate(source) !== true) throw new Error("Invalid spreadsheet XML");
    return parser.parse(source);
  }
  const workbook = await xml("xl/workbook.xml");
  const relationships = await xml("xl/_rels/workbook.xml.rels");
  const targets = new Map<string, string>();
  for (const relation of asArray(relationships?.Relationships?.Relationship)) {
    if (relation["@_TargetMode"] === "External") continue;
    const target = String(relation["@_Target"] ?? "");
    const resolved = target.startsWith("/") ? target.slice(1) : path.posix.normalize(`xl/${target}`);
    if (!resolved.startsWith("xl/") || resolved.includes("..")) throw new Error("Invalid spreadsheet relationship");
    targets.set(String(relation["@_Id"]), resolved);
  }
  const sharedDocument = await xml("xl/sharedStrings.xml", true);
  const sharedStrings = asArray(sharedDocument?.sst?.si).map(richText);
  let headers: string[] | null = null;
  const records: ImportSourceRow[] = [];
  const coordinates: ImportSourceCoordinate[] = [];
  for (const sheet of asArray(workbook?.workbook?.sheets?.sheet)) {
    if (sheet["@_state"] === "hidden" || sheet["@_state"] === "veryHidden") {
      throw new Error("Hidden worksheets are not supported; export each data sheet explicitly");
    }
    const target = targets.get(String(sheet["@_r:id"]));
    if (!target) throw new Error("Spreadsheet worksheet relationship is missing");
    const document = await xml(target);
    const sheetName = String(sheet["@_name"] ?? "");
    if (!sheetName) throw new Error("Spreadsheet worksheet name is missing");
    let sheetHeader: string[] | null = null;
    let previousRow = 0;
    for (const row of asArray(document?.worksheet?.sheetData?.row)) {
      const cells = asArray(row.c);
      const inferredRow = cells[0]?.["@_r"]?.match(/[0-9]+$/)?.[0];
      const worksheetRow = Number(row["@_r"] ?? inferredRow ?? previousRow + 1);
      if (!Number.isSafeInteger(worksheetRow) || worksheetRow <= previousRow || worksheetRow > 1_048_576) {
        throw new Error("Invalid or duplicate spreadsheet row coordinate");
      }
      previousRow = worksheetRow;
      const values: string[] = [];
      const seen = new Set<number>();
      for (const cell of cells) {
        const index = columnIndex(String(cell["@_r"] ?? ""));
        if (Number(String(cell["@_r"]).match(/[0-9]+$/)?.[0]) !== worksheetRow) {
          throw new Error("Spreadsheet cell and row coordinates disagree");
        }
        if (seen.has(index)) throw new Error("Duplicate spreadsheet cell");
        seen.add(index);
        if (cell.f !== undefined && cell.v === undefined) throw new Error("Spreadsheet formula has no cached value");
        if (cell["@_t"] === "e") throw new Error("Spreadsheet contains an error cell");
        let value = text(cell.v);
        if (cell["@_t"] === "s") {
          const position = Number(value);
          if (!/^[0-9]+$/.test(value) || sharedStrings[position] === undefined) {
            throw new Error("Invalid spreadsheet shared string reference");
          }
          value = sharedStrings[position];
        } else if (cell["@_t"] === "inlineStr") value = richText(cell.is);
        values[index] = value;
      }
      if (!values.some(value => value?.trim()) && (!sheetHeader || !seen.size)) continue;
      if (!sheetHeader) {
        sheetHeader = Array.from({ length: values.length }, (_, index) => values[index] ?? "");
        validateHeaders(sheetHeader);
        if (headers && JSON.stringify(headers) !== JSON.stringify(sheetHeader)) {
          throw new Error("Worksheets must have identical headers; import differing sheets separately");
        }
        headers ??= sheetHeader;
        continue;
      }
      if (values.length > sheetHeader.length) throw new Error("Spreadsheet row has data beyond its headers");
      records.push(Object.fromEntries(sheetHeader.map((header, index) => [header, values[index] ?? ""])));
      coordinates.push({
        format: "xlsx", recordNumber: records.length, sheetName, worksheetPart: target,
        worksheetRow, csvEndingLine: null,
      });
      if (records.length > MAX_ROWS) throw new Error("Import has too many rows");
    }
  }
  if (!headers || !records.length) throw new Error("Spreadsheet has no data rows");
  return { rows: records, coordinates };
}