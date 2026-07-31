#!/usr/bin/env python3
"""
Build the next prompt log from the Claude Code transcripts.

    python3 session-logs/build.py

Each run writes **one new numbered log** covering only what has happened since the last one, so the
folder accumulates a record rather than one file being rewritten. Run it whenever you want a new
instalment; run it twice in a row and the second run will tell you there is nothing new.

## How "since the last one" is decided

Every log ends with a machine-readable cursor:

    <!-- hexnome-log cursor: 2026-07-31T09:41:27.700Z -->

The next run reads the newest cursor in the folder and takes messages strictly after it. The cursor
lives in the log rather than in a separate index so that a log and its own end-point cannot drift
apart — delete a log and the folder simply resumes from the one before it.

## What counts as a message

Not everything the transcript files as a user turn was typed by a human:

- **tool results** are stored as user messages — excluded;
- **IDE notices** (`<ide_opened_file>`, `<ide_selection>`) and `<system-reminder>` blocks are wrappers
  around a turn, not content — stripped, and a turn left empty is dropped;
- **auto-compaction hand-offs** ("This session is being continued…") are written by the harness. One
  of them ran to 4,419 words, which is more than every real message in this project combined, so
  leaving them in makes every statistic meaningless.

## Why the transcripts are merged rather than concatenated

A resumed session **replays the session it resumed**, so the same messages and the same assistant
responses appear in more than one file. Everything is deduplicated — API usage by response id, and
messages by **timestamp and text together**.

Both halves of that key matter. A replay preserves the original timestamp, so timestamp-and-text
collapses it correctly; text alone would additionally collapse messages that merely *say* the same
thing, and "let's commit the code" has been sent many times. That undercounted the total and, worse,
attached the wrong reply to the wrong message — the last occurrence's answer overwrote the first's.
"""
from __future__ import annotations

import datetime
import json
import re
import subprocess
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
LOGS = Path(__file__).resolve().parent

# Claude Code names a project's transcript folder after its working directory, with every separator
# replaced by a dash. Derived rather than hardcoded so a clone somewhere else still finds its own
# history instead of silently reporting none.
TRANSCRIPTS = Path.home() / '.claude' / 'projects' / str(PROJECT).replace('/', '-')

CURSOR_RE = re.compile(r'<!--\s*hexnome-log cursor:\s*(\S+)\s*-->')
LOG_RE = re.compile(r'^session-log-(\d+)\.md$')

STRIP = [re.compile(p, re.S) for p in (
    r'<system-reminder>.*?</system-reminder>',
    r'<ide_opened_file>.*?</ide_opened_file>',
    r'<ide_selection>.*?</ide_selection>',
    r'<local-command-[^>]*>.*?</local-command-[^>]*>',
)]
NOISE = {'[Request interrupted by user]', '[Request interrupted by user for tool use]'}
SYNTHETIC = ('This session is being continued from a previous conversation that ran out of context',)


def clean(text: str) -> str:
    for pattern in STRIP:
        text = pattern.sub('', text)
    text = text.strip()
    if text in NOISE or text.startswith(SYNTHETIC):
        return ''
    return text


def text_of(content) -> str | None:
    """The typed text of a user turn, or None if the turn is not one."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        if any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in content):
            return None
        return ''.join(b.get('text', '') for b in content
                       if isinstance(b, dict) and b.get('type') == 'text')
    return None


def read_transcripts():
    """Every distinct human message and the deduplicated API usage, across all transcript files."""
    messages: dict[str, dict] = {}
    order: list[str] = []
    usage_by_id: dict[str, dict] = {}
    tool_ids: set[str] = set()

    for path in transcripts_in_order():
        # Reset per file. A reply is only ever the answer to a message *earlier in the same file*;
        # letting this carry over attached the last file's opening answer to the previous file's
        # closing message, which is how a three-day-old reply ended up under the newest prompt.
        last_key: str | None = None
        for line in path.open():
            try:
                row = json.loads(line)
            except Exception:
                continue

            kind = row.get('type')
            if kind == 'user' and not row.get('isMeta') and not row.get('isSidechain'):
                raw = text_of(row.get('message', {}).get('content'))
                if raw is None:
                    continue
                body = clean(raw)
                if not body:
                    continue
                key = f'{row.get("timestamp")}|{body}'
                if key not in messages:
                    messages[key] = {'ts': row.get('timestamp'), 'text': body, 'reply': ''}
                    order.append(key)
                last_key = key

            elif kind == 'assistant':
                message = row.get('message', {})
                mid, use = message.get('id'), message.get('usage')
                if use and mid and mid not in usage_by_id:
                    usage_by_id[mid] = use
                content = message.get('content')
                for block in content if isinstance(content, list) else []:
                    if not isinstance(block, dict):
                        continue
                    if block.get('type') == 'tool_use' and block.get('id'):
                        tool_ids.add(block['id'])
                    # The closing paragraph of a turn is the one that summarises it.
                    if block.get('type') == 'text' and block.get('text', '').strip() and last_key:
                        messages[last_key]['reply'] = block['text'].strip()

    records = [messages[key] for key in order]
    records.sort(key=lambda r: r['ts'] or '')
    return records, usage_by_id, tool_ids


def transcripts_in_order() -> list[Path]:
    """Transcript files oldest first.

    By first timestamp, not by filename — session ids are random, so alphabetical order is not
    chronological, and this project already has a file that sorts last while holding older history.
    """
    dated = []
    for path in TRANSCRIPTS.glob('*.jsonl'):
        stamp = ''
        with path.open() as handle:
            for line in handle:
                try:
                    stamp = json.loads(line).get('timestamp') or ''
                except Exception:
                    continue
                if stamp:
                    break
        dated.append((stamp, path))
    return [path for _, path in sorted(dated)]


def existing_logs():
    found = []
    for path in LOGS.glob('session-log-*.md'):
        match = LOG_RE.match(path.name)
        if match:
            found.append((int(match.group(1)), path))
    return sorted(found)


def newest_cursor(logs) -> str | None:
    cursors = []
    for _, path in logs:
        match = CURSOR_RE.search(path.read_text())
        if match:
            cursors.append(match.group(1))
    return max(cursors) if cursors else None


def when(ts: str) -> datetime.datetime:
    return datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))


def short(text: str, limit: int = 260) -> str:
    flat = re.sub(r'\s+', ' ', text).strip()
    return flat if len(flat) <= limit else flat[:limit].rsplit(' ', 1)[0] + ' …'


def commits_since(after: datetime.datetime | None) -> list[str]:
    out = subprocess.run(
        ['git', '-C', str(PROJECT), 'log', '--reverse', '--date=iso-strict',
         '--pretty=format:%h|%ad|%s'],
        capture_output=True, text=True).stdout.strip()
    rows = [line.split('|', 2) for line in out.splitlines() if line]
    if after is None:
        return rows
    return [row for row in rows if to_utc(row[1]) > after]


def to_utc(stamp: str) -> datetime.datetime:
    """Git reports the author's local offset; messages are in UTC. Compare and print one of them."""
    return datetime.datetime.fromisoformat(stamp).astimezone(datetime.timezone.utc)


def render(number: int, batch: list[dict], everything: list[dict], usage, tools, since) -> str:
    words = [len(r['text'].split()) for r in batch]
    chars = [len(r['text']) for r in batch]
    first, last = when(batch[0]['ts']), when(batch[-1]['ts'])
    all_words = sum(len(r['text'].split()) for r in everything)

    out: list[str] = []
    w = out.append
    w(f'# hexnome — prompt log {number}\n')
    w(f'_Generated {datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")} '
      f'by `session-logs/build.py`._\n')
    if since:
        w(f'Covers the **{len(batch)} messages** sent since log {number - 1} left off '
          f'({when(since).strftime("%d %b %Y %H:%M")} UTC).\n')
    else:
        w(f'Covers all **{len(batch)} messages** from the beginning of the project.\n')

    w('## This instalment\n')
    w('| | |')
    w('|---|---|')
    w(f'| Messages | **{len(batch)}** |')
    w(f'| Words | **{sum(words):,}** |')
    w(f'| Characters | **{sum(chars):,}** |')
    w(f'| Estimated tokens (chars ÷ 4) | **≈{sum(chars) // 4:,}** |')
    w(f'| Median / mean | {sorted(words)[len(words) // 2]} / {sum(words) // len(words)} words |')
    w(f'| Shortest / longest | {min(words)} / {max(words)} words |')
    w(f'| Span | {first.strftime("%d %b %H:%M")} → {last.strftime("%d %b %H:%M")} UTC |')
    w('')

    w('## Project to date\n')
    w('Deduplicated across every transcript file, including sessions that replay earlier ones.\n')
    w('| | |')
    w('|---|---|')
    w(f'| Messages, all logs | **{len(everything)}** |')
    w(f'| Words, all logs | **{all_words:,}** |')
    w(f'| Assistant responses | **{len(usage):,}** |')
    w(f'| Tool calls | **{len(tools):,}** |')
    w(f'| Output tokens | **{sum(u.get("output_tokens", 0) for u in usage.values()):,}** |')
    w(f'| Cache reads | **{sum(u.get("cache_read_input_tokens", 0) for u in usage.values()):,}** |')
    w(f'| Cache writes | **{sum(u.get("cache_creation_input_tokens", 0) for u in usage.values()):,}** |')
    w('')
    w('Cache reads are the conversation being re-read on every response — re-reading, not new text.\n')

    rows = commits_since(when(since) if since else None)
    if rows:
        w('## Commits in this stretch\n')
        w('| Commit | When | Subject |')
        w('|---|---|---|')
        for sha, date, subject in rows:
            w(f'| `{sha}` | {to_utc(date).strftime("%d %b %H:%M")} | {subject} |')
        w('')

    w('## Every message, in order\n')
    w('Your text verbatim; the reply line is the closing paragraph of the response to it, truncated.\n')
    start = len(everything) - len(batch) + 1
    for offset, record in enumerate(batch):
        index = start + offset
        stamp = when(record['ts']).strftime('%d %b %H:%M')
        w(f'### {index}. {stamp} · {len(record["text"].split())} words\n')
        w('> ' + re.sub(r'\n+', '\n> ', record['text'].strip()) + '\n')
        w(f'**Reply:** {short(record["reply"])}\n' if record['reply']
          else '**Reply:** _(no closing text — the turn ended in tool calls)_\n')

    w(f'<!-- hexnome-log cursor: {batch[-1]["ts"]} -->')
    return '\n'.join(out)


def main() -> None:
    # `--until <iso>` stops the instalment early. Only needed to rebuild a log at the boundary it
    # already had; the normal run takes everything since the last cursor.
    until = None
    argv = __import__('sys').argv[1:]
    if len(argv) == 2 and argv[0] == '--until':
        until = argv[1]

    records, usage, tools = read_transcripts()
    logs = existing_logs()
    cursor = newest_cursor(logs)
    number = (logs[-1][0] + 1) if logs else 1

    batch = [r for r in records if cursor is None or (r['ts'] or '') > cursor]
    if until:
        batch = [r for r in batch if (r['ts'] or '') <= until]
    if not batch:
        print(f'Nothing new since {cursor} — {len(logs)} log(s) already cover all '
              f'{len(records)} messages.')
        return

    target = LOGS / f'session-log-{number}.md'
    target.write_text(render(number, batch, records, usage, tools, cursor))
    print(f'Wrote {target.relative_to(PROJECT)} — {len(batch)} new message(s), '
          f'{len(records)} in the project so far.')


if __name__ == '__main__':
    main()
