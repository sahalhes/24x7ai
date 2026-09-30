#!/usr/bin/env python3
"""Select next agent-codable row from a CSV with common heading names."""
import csv
import json
import sys

csv_path, state_path = sys.argv[1:3]
with open(state_path, encoding='utf-8') as stream:
    state = json.load(stream)
with open(csv_path, newline='', encoding='utf-8-sig') as stream:
    reader = csv.DictReader(stream)
    headers = [header.strip().lower().replace(' ', '_') for header in (reader.fieldnames or [])]
    rows = list(reader)

if not headers or headers[0].startswith('<!doctype') or headers[0].startswith('<html'):
    raise SystemExit('CSV source is empty or returned HTML. Use a direct CSV/export URL and ensure it is accessible.')
if not any(header in headers for header in ('sl_no', 'sl', 'serial_no', 'serial_number', 's_no', 'no')):
    raise SystemExit(f"CSV is missing a serial-number column. Found headers: {', '.join(headers)}")
if not any(header in headers for header in ('idea', 'project', 'project_idea', 'name', 'title')):
    raise SystemExit(f"CSV is missing an idea/project column. Found headers: {', '.join(headers)}")

def get(row, *names, default=''):
    normalized = {key.strip().lower().replace(' ', '_'): (value or '').strip()
                  for key, value in row.items() if key}
    for name in names:
        if normalized.get(name):
            return normalized[name]
    return default

start = int(state.get('active_mvp') or state.get('current_sl_no') or 1)
for row in rows:
    raw_number = get(row, 'sl_no', 'sl', 'serial_no', 'serial_number', 's_no', 'no')
    try:
        number = int(raw_number)
    except ValueError:
        continue
    if number < start:
        continue
    idea = get(row, 'idea', 'project', 'project_idea', 'name', 'title')
    if not idea:
        continue
    automatable = get(row, 'agent_automatable', 'automatable', 'automation', default='YES')
    if automatable.upper() in {'NO', 'FALSE', 'N', 'NOT AUTOMATABLE'}:
        continue
    print(json.dumps({'sl_no': number, 'idea': idea, 'automatable': automatable, 'source_row': row}, ensure_ascii=False))
    raise SystemExit
print('NO_PROJECT')
