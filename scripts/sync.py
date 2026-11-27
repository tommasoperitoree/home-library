#!/usr/bin/env python3
"""Sync the family library spreadsheet into data/books.json and data/loans.json.

Downloads the Google Sheets file (exported as .xlsx) from Google Drive using a
service account, parses the "Books" and "Loans" sheets, and writes the compact
JSON formats consumed by the PWA.

Requirements:
    pip install openpyxl requests google-auth google-api-python-client

Authentication:
    Set GOOGLE_SERVICE_ACCOUNT_JSON to the path of a service account key file
    (or GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT to the raw JSON content, used by
    the GitHub Action where the key is stored as a secret). The service
    account must have at least read access to the spreadsheet.

Usage:
    python3 scripts/sync.py [--file-id FILE_ID] [--out-dir data]
"""

import argparse
import io
import json
import os
import re
import sys
import tempfile

import openpyxl

DEFAULT_FILE_ID = '1HoeEFx_-alYJg6KtL9UUmmDZQZsMwSTY_biIoeSZoUw'
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

LANGUAGE_MAP = {
    'italiano': None, 'italian': None, 'it': None, 'ita': None,  # Italian is the default, omit it
    'inglese': 'English', 'english': 'English', 'en': 'English', 'eng': 'English',
    'spagnolo': 'Spanish', 'spanish': 'Spanish', 'es': 'Spanish', 'spa': 'Spanish',
    'tedesco': 'German', 'german': 'German', 'de': 'German', 'ger': 'German', 'deu': 'German',
    'francese': 'French', 'french': 'French', 'fr': 'French', 'fre': 'French', 'fra': 'French',
}


def get_credentials():
    from google.oauth2 import service_account

    key_path = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    key_content = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT')

    if key_content:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write(key_content)
            key_path = f.name

    if not key_path:
        sys.exit(
            'Missing credentials: set GOOGLE_SERVICE_ACCOUNT_JSON (path) or '
            'GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT (raw JSON) in the environment.'
        )

    return service_account.Credentials.from_service_account_file(key_path, scopes=SCOPES)


def download_xlsx(file_id):
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload

    creds = get_credentials()
    service = build('drive', 'v3', credentials=creds)

    request = service.files().export_media(
        fileId=file_id,
        mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    buffer.seek(0)
    return buffer


def normalize_language(raw):
    if not raw:
        return None
    return LANGUAGE_MAP.get(raw.strip().lower(), raw.strip())


def normalize_header_key(cell):
    # Strips spaces/punctuation so header variants like "Library/Shelf",
    # "Library" or "Lent By (family member)" all normalize predictably.
    return re.sub(r'[^a-z0-9]', '', str(cell).strip().lower())


def header_index(header_row):
    return {normalize_header_key(cell): i for i, cell in enumerate(header_row) if cell}


def parse_books(workbook):
    if 'Books' not in workbook.sheetnames:
        return []
    sheet = workbook['Books']
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return []
    idx = header_index(rows[0])

    books = []
    for row in rows[1:]:
        def cell(name):
            i = idx.get(name)
            return str(row[i]).strip() if i is not None and row[i] is not None else ''

        title = cell('title')
        if not title:
            continue

        book = {'t': title, 'a': cell('author')}

        shelf = cell('library')
        if shelf:
            book['l'] = shelf

        lang = normalize_language(cell('language'))
        if lang:
            book['lang'] = lang

        held_by = cell('heldby')
        if held_by:
            book['h'] = held_by

        books.append(book)
    return books


def parse_loans(workbook):
    if 'Loans' not in workbook.sheetnames:
        return []
    sheet = workbook['Loans']
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return []
    idx = header_index(rows[0])

    loans = []
    for row in rows[1:]:
        def cell(name):
            i = idx.get(name)
            return row[i] if i is not None else None

        book = cell('booktitle')
        if not book:
            continue

        date_returned = cell('datereturned')
        if date_returned:
            continue  # only active (unreturned) loans

        date_lent = cell('datelent')
        if hasattr(date_lent, 'strftime'):
            date_lent = date_lent.strftime('%d/%m/%Y')
        elif date_lent:
            date_lent = str(date_lent).strip()
        else:
            date_lent = ''

        loans.append({
            'id': str(cell('loanid') or '').strip(),
            'book': str(book).strip(),
            'lentBy': str(cell('lentbyfamilymember') or '').strip(),
            'borrowedBy': str(cell('borrowedbyexternal') or '').strip(),
            'dateLent': date_lent,
        })
    return loans


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file-id', default=os.environ.get('LIBRARY_FILE_ID', DEFAULT_FILE_ID))
    parser.add_argument('--out-dir', default='data')
    args = parser.parse_args()

    print(f'Downloading spreadsheet {args.file_id}…')
    xlsx_bytes = download_xlsx(args.file_id)
    workbook = openpyxl.load_workbook(xlsx_bytes, data_only=True)

    books = parse_books(workbook)
    loans = parse_loans(workbook)

    os.makedirs(args.out_dir, exist_ok=True)
    books_path = os.path.join(args.out_dir, 'books.json')
    loans_path = os.path.join(args.out_dir, 'loans.json')

    with open(books_path, 'w', encoding='utf-8') as f:
        json.dump(books, f, ensure_ascii=False, indent=2)
    with open(loans_path, 'w', encoding='utf-8') as f:
        json.dump(loans, f, ensure_ascii=False, indent=2)

    print(f'Wrote {len(books)} books to {books_path}')
    print(f'Wrote {len(loans)} loans to {loans_path}')


if __name__ == '__main__':
    main()
