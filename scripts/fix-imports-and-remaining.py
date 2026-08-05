#!/usr/bin/env python3
"""
Fix pass:
1. Replace remaining e.message leaks (knowledge-admin uses `e` not `err`)
2. Add the serverError import to every file that calls serverError but lacks the import
"""
import re
import glob

IMPORT_STMT = 'import { serverError } from "../utils/server-error";'

# Remaining variable-name patterns not covered by prior passes
EXTRA_PATTERNS = [
    # e.message || "fallback"
    (re.compile(r'res\.status\(500\)\.json\(\{[^}]*\be\.message\b[^}]*\}\)'), 'serverError(res, e)'),
]

def ensure_import(content: str) -> str:
    """Insert import after last existing import line, only if not already present."""
    if IMPORT_STMT in content:
        return content  # already there
    lines = content.split('\n')
    last_import_idx = -1
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('import ') or stripped.startswith('import{'):
            last_import_idx = i
    if last_import_idx == -1:
        return IMPORT_STMT + '\n' + content
    lines.insert(last_import_idx + 1, IMPORT_STMT)
    return '\n'.join(lines)

files = glob.glob('server/routes/*.ts') + glob.glob('server/services/*.ts')
total_replaced = 0
total_imports_added = 0

for filepath in sorted(files):
    with open(filepath, 'r') as f:
        original = f.read()

    content = original
    replaced = 0

    # Apply extra patterns (e.message etc.)
    for pattern, replacement in EXTRA_PATTERNS:
        new_content, count = pattern.subn(replacement, content)
        if count:
            content = new_content
            replaced += count

    # Add import if this file calls serverError but lacks the import
    needs_import = ('serverError(res,' in content or 'serverError(res,' in content)
    if needs_import:
        new_content = ensure_import(content)
        if new_content != content:
            content = new_content
            total_imports_added += 1

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        if replaced:
            print(f"  {filepath}: {replaced} e.message replacements")
        total_replaced += replaced

print(f"\nDone: {total_replaced} extra replacements, {total_imports_added} imports added")
