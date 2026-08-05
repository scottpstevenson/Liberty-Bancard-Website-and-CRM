#!/usr/bin/env python3
"""
Replace res.status(500).json({ message: err.message }) patterns with serverError(res, err)
and add the import to each modified file.
"""
import re
import os
import glob

IMPORT_LINE = 'import { serverError } from "../utils/server-error";\n'

# Patterns to replace (order matters — more specific first)
PATTERNS = [
    # err.message || "fallback"
    (re.compile(r'res\.status\(500\)\.json\(\{\s*message:\s*err\.message\s*\|\|[^}]+\}\)'), 'serverError(res, err)'),
    # error.message || "fallback"
    (re.compile(r'res\.status\(500\)\.json\(\{\s*message:\s*error\.message\s*\|\|[^}]+\}\)'), 'serverError(res, error)'),
    # plain err.message
    (re.compile(r'res\.status\(500\)\.json\(\{\s*message:\s*err\.message\s*\}\)'), 'serverError(res, err)'),
    # plain error.message
    (re.compile(r'res\.status\(500\)\.json\(\{\s*message:\s*error\.message\s*\}\)'), 'serverError(res, error)'),
]

def add_import(content: str) -> str:
    """Insert the serverError import after the last existing import line."""
    if 'serverError' in content:
        return content  # already imported
    lines = content.split('\n')
    last_import_idx = -1
    for i, line in enumerate(lines):
        if line.startswith('import '):
            last_import_idx = i
    if last_import_idx == -1:
        # No imports found, prepend
        return IMPORT_LINE + content
    lines.insert(last_import_idx + 1, IMPORT_LINE.rstrip())
    return '\n'.join(lines)

files = glob.glob('server/routes/*.ts') + glob.glob('server/services/*.ts')
total_replacements = 0
modified_files = []

for filepath in sorted(files):
    with open(filepath, 'r') as f:
        original = f.read()
    
    content = original
    file_replacements = 0
    for pattern, replacement in PATTERNS:
        new_content, count = pattern.subn(replacement, content)
        if count:
            content = new_content
            file_replacements += count
    
    if file_replacements > 0:
        content = add_import(content)
        with open(filepath, 'w') as f:
            f.write(content)
        total_replacements += file_replacements
        modified_files.append((filepath, file_replacements))
        print(f"  {filepath}: {file_replacements} replacements")

print(f"\nTotal: {total_replacements} replacements across {len(modified_files)} files")
