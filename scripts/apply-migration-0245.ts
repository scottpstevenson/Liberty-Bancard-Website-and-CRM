#!/usr/bin/env tsx
import { pool } from "../server/db";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(join(import.meta.dirname, "../migrations/0245_source_registry_csv_store.sql"), "utf8");
pool.query(sql)
  .then(() => { console.log("Migration 0245 applied OK"); return pool.end(); })
  .catch((e: Error) => { console.error("FAIL:", e.message); process.exit(1); });
