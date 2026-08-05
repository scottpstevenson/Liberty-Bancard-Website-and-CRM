#!/usr/bin/env python3
"""
Step 1: Remove any 'import { serverError }...' lines that were inserted
        INSIDE an existing multi-line import block (i.e., not at a top-level
        statement boundary), leaving a clean file for Step 2.

A serverError import is "inside a block" if on that line the cumulative
open-brace count from all previous top-level imports is > 0.
"""
import glob, re

IMPORT_STMT = 'import { serverError } from "../utils/server-error";'
IMPORT_LINE_RE = re.compile(r'^import \{ serverError \} from "\.\./utils/server-error";$')

def remove_bad_imports(content):
    lines = content.split('\n')
    # Track brace depth as we walk through the file's top section
    # We only care about the import section at the top of the file.
    depth = 0
    result = []
    removed = 0
    for line in lines:
        stripped = line.strip()
        if IMPORT_LINE_RE.match(stripped):
            if depth > 0:
                # Inside a multi-line block — bad insertion, drop it
                removed += 1
                continue
        # Update depth
        depth += stripped.count('{') - stripped.count('}')
        depth = max(0, depth)
        result.append(line)
    return '\n'.join(result), removed

files = glob.glob('server/routes/*.ts') + glob.glob('server/services/*.ts')
total = 0
for filepath in sorted(files):
    with open(filepath, 'r') as f:
        original = f.read()
    if IMPORT_STMT not in original:
        continue
    cleaned, removed = remove_bad_imports(original)
    if removed:
        with open(filepath, 'w') as f:
            f.write(cleaned)
        total += removed
        print(f"  Removed {removed} bad import(s) from: {filepath}")

print(f"\nTotal bad imports removed: {total}")
