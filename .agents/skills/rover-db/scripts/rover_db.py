#!/usr/bin/env python3
"""Manage an existing Rover SQLite database using Python's standard library."""

import argparse
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import sys
import uuid

CONFIG = json.loads((Path(__file__).resolve().parent.parent / 'store/config.json').read_text())['defaults']


def encode(value):
    if isinstance(value, bytes):
        return {'blob_hex': value.hex()}
    raise TypeError(f'Unsupported value: {type(value).__name__}')


def connect(path, writable=False):
    db = sqlite3.connect(path.as_uri() + ('?mode=rw' if writable else '?mode=ro'),
                         uri=True, timeout=CONFIG['busyTimeoutMs'] / 1000)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys = ON')
    if not writable:
        db.execute('PRAGMA query_only = ON')
    return db


def snapshot(source, output):
    output = output.expanduser().resolve()
    with output.open('xb'):
        pass
    try:
        target = sqlite3.connect(str(output))
        try:
            source.backup(target)
            if target.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                raise RuntimeError('Backup integrity check failed')
        finally:
            target.close()
    except Exception:
        output.unlink(missing_ok=True)
        raise
    return str(output)


def default_backup():
    folder = Path(CONFIG['backupDirectory']).expanduser().resolve()
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    return folder / f'rover-{stamp}-{uuid.uuid4().hex}.db'


def read_result(cursor, limit):
    if cursor.description is None:
        raise ValueError('Expected a query returning rows')
    fetched = cursor.fetchmany(limit + 1)
    return {'columns': [c[0] for c in cursor.description],
            'rows': [dict(row) for row in fetched[:limit]],
            'truncated': len(fetched) > limit}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', help='Explicit existing database path')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('path')
    commands.add_parser('tables')
    schema = commands.add_parser('schema')
    schema.add_argument('--table')
    backup = commands.add_parser('backup')
    backup.add_argument('--output', type=Path)
    for name in ('query', 'export', 'write'):
        cmd = commands.add_parser(name)
        source = cmd.add_mutually_exclusive_group(required=True)
        source.add_argument('--sql')
        source.add_argument('--sql-file', type=Path)
        if name == 'write':
            source.add_argument('--batch-file', type=Path,
                                help='JSON array of sql, params, expected_changes entries')
        cmd.add_argument('--params', default='[]', help='JSON array or object of bound parameters')
        cmd.add_argument('--limit', type=int, default=CONFIG['queryLimit'])
        if name == 'export':
            cmd.add_argument('--output', type=Path, required=True)
        elif name == 'write':
            cmd.add_argument('--expected-changes', type=int,
                             help='Expected directly affected rows, excluding trigger/cascade changes')
            cmd.add_argument('--backup-output', type=Path)
    args = parser.parse_args()
    path = Path(args.db or os.environ.get(CONFIG['databasePathEnv']) or CONFIG['databasePath']).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f'Database file does not exist: {path}')
    result = {'database': str(path)}
    if args.command == 'path':
        return result
    if args.command in ('query', 'export', 'write'):
        if args.limit < 1:
            raise ValueError('--limit must be positive')
        sql = args.sql if args.sql is not None else (args.sql_file.read_text() if args.sql_file else None)
        params = json.loads(args.params)
        if not isinstance(params, (list, dict)):
            raise ValueError('--params must be a JSON array or object')
    if args.command == 'write':
        if args.batch_file:
            if args.expected_changes is not None or args.params != '[]':
                raise ValueError('Batch entries supply their own params and expected_changes')
            statements = json.loads(args.batch_file.read_text())
        else:
            statements = [{'sql': sql, 'params': params, 'expected_changes': args.expected_changes}]
        if not isinstance(statements, list) or not statements:
            raise ValueError('Expected a nonempty JSON array of statements')
        for entry in statements:
            if not isinstance(entry, dict) or not isinstance(entry.get('sql'), str):
                raise ValueError('Each statement must contain SQL text')
            if not isinstance(entry.get('params', []), (list, dict)):
                raise ValueError('Statement params must be an array or object')
            expected = entry.get('expected_changes')
            if type(expected) is not int or expected < 0:
                raise ValueError('Each statement requires nonnegative integer expected_changes')
    db = connect(path, writable=args.command == 'write')
    try:
        if args.command == 'tables':
            result['tables'] = [dict(row) for row in db.execute(
                "SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        elif args.command == 'schema':
            sql = 'SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL'
            values = []
            if args.table:
                sql += ' AND tbl_name = ?'
                values = [args.table]
            result['schema'] = [dict(row) for row in db.execute(sql + ' ORDER BY type, name', values)]
            if args.table:
                result['columns'] = [dict(row) for row in db.execute('SELECT * FROM pragma_table_info(?)', values)]
                result['foreign_keys'] = [dict(row) for row in db.execute('SELECT * FROM pragma_foreign_key_list(?)', values)]
        elif args.command == 'backup':
            result['backup'] = snapshot(db, args.output or default_backup())
            result['integrity'] = 'ok'
        elif args.command == 'query':
            result.update(read_result(db.execute(sql, params), args.limit))
        elif args.command == 'export':
            output = args.output.expanduser().resolve()
            cursor = db.execute(sql, params)
            if cursor.description is None:
                raise ValueError('Expected a query returning rows')
            # Exclusive creation: never replace an existing export or the live DB.
            stream = output.open('x', newline='', encoding='utf-8')
            try:
                with stream:
                    writer = csv.writer(stream)
                    writer.writerow([c[0] for c in cursor.description])
                    count = 0
                    for row in cursor:
                        if count == args.limit:
                            result['truncated'] = True
                            break
                        writer.writerow(row)
                        count += 1
                    else:
                        result['truncated'] = False
                    result.update(output=str(output), rows_exported=count)
            except Exception:
                output.unlink(missing_ok=True)
                raise
        else:
            result['backup'] = snapshot(db, args.backup_output or default_backup())
            # Allow data statements and their triggers, but prevent DDL, PRAGMAs,
            # attached databases, and user SQL escaping the managed transaction.
            allowed = {sqlite3.SQLITE_READ, sqlite3.SQLITE_SELECT, sqlite3.SQLITE_INSERT,
                       sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE, sqlite3.SQLITE_FUNCTION,
                       sqlite3.SQLITE_RECURSIVE}
            def authorize(action, arg1, _arg2, _database, _trigger):
                if action in (sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE):
                    if arg1 == 'schema_migrations' or (arg1 or '').startswith('sqlite_'):
                        return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK if action in allowed else sqlite3.SQLITE_DENY
            try:
                db.execute('BEGIN IMMEDIATE')
                db.set_authorizer(authorize)
                executed = []
                for index, entry in enumerate(statements):
                    cursor = db.execute(entry['sql'], entry.get('params', []))
                    outcome = {'statement': index + 1}
                    if cursor.description:
                        outcome.update(read_result(cursor, args.limit))
                        for _ in cursor:
                            pass  # Finish RETURNING before checking rowcount/committing.
                    if cursor.rowcount != entry['expected_changes']:
                        raise RuntimeError(f"Statement {index + 1}: expected {entry['expected_changes']} changed rows, got {cursor.rowcount}")
                    outcome['changes'] = cursor.rowcount
                    executed.append(outcome)
                result.update(changes=sum(item['changes'] for item in executed),
                              total_changes=db.total_changes, statements=executed)
                if len(executed) == 1:
                    result.update({key: value for key, value in executed[0].items() if key != 'statement'})
                db.set_authorizer(None)
                violations = db.execute('PRAGMA foreign_key_check').fetchall()
                if violations:
                    raise RuntimeError(f'Foreign key violations: {len(violations)}')
                db.commit()
            except Exception as error:
                db.set_authorizer(None)
                db.rollback()
                raise RuntimeError(f'Write rolled back: {error}; backup: {result["backup"]}') from error
        return result
    finally:
        db.close()


if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False, indent=2, default=encode))
    except (sqlite3.Error, OSError, ValueError, RuntimeError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
