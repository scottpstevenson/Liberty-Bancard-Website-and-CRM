#!/usr/bin/env python3
"""
Fix: insert 'import { serverError } from "../utils/server-error";'
after the last COMPLETE top-level import statement in each route file
that calls serverError but lacks the import.

Handles multi-line import blocks like:
  import {
    foo,
    bar,
  } from "...";
"""
import glob

IMPORT_STMT = 'import { serverError } from "../utils/server-error";'

def find_last_import_end(lines):
    """Return the index of the last line that closes a top-level import block."""
    last_end = -1
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        # Single-line import: import ... from "...";
        if (stripped.startswith('import ') or stripped.startswith("import'") or stripped.startswith('import"')) and 'from' in stripped and stripped.endswith(';'):
            last_end = i
            i += 1
            continue
        # Start of multi-line import block: import { or import type {
        if (stripped.startswith('import {') or stripped.startswith('import type {') or stripped.startswith('import type{')) and not stripped.endswith(';'):
            # Scan forward to find the closing line
            depth = stripped.count('{') - stripped.count('}')
            j = i
            while j < len(lines) and depth > 0:
                j += 1
                if j < len(lines):
                    depth += lines[j].count('{') - lines[j].count('}')
            # j is the line with the closing brace; the actual import ends on the same line or
            # a following "} from '...';" line
            # Find the from-clause line
            k = j
            while k < len(lines) and 'from' not in lines[k]:
                k += 1
            if k < len(lines):
                last_end = k
                i = k + 1
                continue
        i += 1
    return last_end

def ensure_import(content):
    if IMPORT_STMT in content:
        return content
    lines = content.split('\n')
    last_end = find_last_import_end(lines)
    if last_end == -1:
        lines.insert(0, IMPORT_STMT)
    else:
        lines.insert(last_end + 1, IMPORT_STMT)
    return '\n'.join(lines)

files = glob.glob('server/routes/*.ts') + glob.glob('server/services/*.ts')
added = 0
for filepath in sorted(files):
    with open(filepath, 'r') as f:
        original = f.read()
    if 'serverError(res,' not in original:
        continue  # doesn't use serverError, skip
    if IMPORT_STMT in original:
        continue  # already has the import
    new_content = ensure_import(original)
    if new_content != original:
        with open(filepath, 'w') as f:
            f.write(new_content)
        added += 1
        print(f"  Added import: {filepath}")

print(f"\nTotal: {added} imports added")
