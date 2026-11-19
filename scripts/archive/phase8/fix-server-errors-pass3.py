#!/usr/bin/env python3
"""Pass 3: catch all remaining res.status(500) patterns that embed err.message/error.message in any key."""
import re
import glob

IMPORT_LINE = 'import { serverError } from "../utils/server-error";\n'

def add_import(content: str) -> str:
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

# Match any res.status(500).json({...}) that contains err.message or error.message anywhere inside
# We process line by line since these are always single-line catch-block returns
ERR_LEAK = re.compile(r'(res\.status\(500\)\.json\([^)]*\berr\.message\b[^)]*\))')
ERROR_LEAK = re.compile(r'(res\.status\(500\)\.json\([^)]*\berror\.message\b[^)]*\))')

files = glob.glob('server/routes/*.ts') + glob.glob('server/services/*.ts')
total = 0
for filepath in sorted(files):
    with open(filepath, 'r') as f:
        original = f.read()
    lines = original.split('\n')
    changed = 0
    for i, line in enumerate(lines):
        new_line = ERR_LEAK.sub('serverError(res, err)', line)
        if new_line != line:
            lines[i] = new_line
            changed += 1
            continue
        new_line2 = ERROR_LEAK.sub('serverError(res, error)', new_line)
        if new_line2 != new_line:
            lines[i] = new_line2
            changed += 1
    if changed:
        content = '\n'.join(lines)
        content = add_import(content)
        with open(filepath, 'w') as f:
            f.write(content)
        total += changed
        print(f"  {filepath}: {changed} replacements")

print(f"\nTotal pass 3: {total} replacements")
