#!/usr/bin/env python3
"""Pass 2: catch remaining leaking patterns not covered by pass 1."""
import re
import os
import glob

IMPORT_LINE = 'import { serverError } from "../utils/server-error";\n'

def add_import(content: str, var: str) -> str:
    if 'serverError' in content:
        return content
    lines = content.split('\n')
    last_import_idx = -1
    for i, line in enumerate(lines):
        if line.startswith('import '):
            last_import_idx = i
    if last_import_idx == -1:
        return IMPORT_LINE + content
    lines.insert(last_import_idx + 1, IMPORT_LINE.rstrip())
    return '\n'.join(lines)

PATTERNS = [
    # err instanceof Error ? err.message : "fallback"
    (re.compile(r'res\.status\(500\)\.json\(\{\s*message:\s*err\s+instanceof\s+Error\s*\?\s*err\.message\s*:[^}]+\}\)'),
     'serverError(res, err)', 'err'),
    # "prefix: " + err.message
    (re.compile(r'res\.status\(500\)\.json\(\{\s*message:\s*"[^"]+"\s*\+\s*err\.message\s*\}\)'),
     'serverError(res, err)', 'err'),
    # "prefix: " + error.message
    (re.compile(r'res\.status\(500\)\.json\(\{\s*message:\s*"[^"]+"\s*\+\s*error\.message\s*\}\)'),
     'serverError(res, error)', 'error'),
]

files = glob.glob('server/routes/*.ts') + glob.glob('server/services/*.ts')
total = 0
for filepath in sorted(files):
    with open(filepath, 'r') as f:
        original = f.read()
    content = original
    count = 0
    for pattern, replacement, var in PATTERNS:
        new_content, n = pattern.subn(replacement, content)
        if n:
            content = new_content
            count += n
    if count:
        content = add_import(content, var)
        with open(filepath, 'w') as f:
            f.write(content)
        total += count
        print(f"  {filepath}: {count} replacements")

print(f"\nTotal pass 2: {total} replacements")
