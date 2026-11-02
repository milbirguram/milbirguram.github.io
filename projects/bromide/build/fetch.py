#!/usr/bin/env python3
"""Fetch Bromide's public-domain books from a Project Gutenberg mirror.

    python -I projects/bromide/build/fetch.py <corpus-dir> [--mirror=https://mirror.csclub.uwaterloo.ca/gutenberg]

Follows https://www.gutenberg.org/policy/robot_access.html: it uses a mirror,
never www.gutenberg.org, makes one request at a time with a pause of at least
two seconds between requests, and stops at the first refusal or rate limit.
<corpus-dir> must be new or empty. The raw texts stay there and are never
copied into the repository; build_model.py reads them from there.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

PAUSE = 2.5
MAX_BYTES = 22_000_000
MAX_BOOKS = 42
UA = 'BromideCorpusFetch/1.0 (personal site build; polite, one request at a time)'

# (Gutenberg id, word expected in the Title: line, title, author)
BOOKS = [
    (1342, 'pride', 'Pride and Prejudice', 'Jane Austen'),
    (84, 'frankenstein', 'Frankenstein', 'Mary Wollstonecraft Shelley'),
    (98, 'two cities', 'A Tale of Two Cities', 'Charles Dickens'),
    (11, 'alice', "Alice's Adventures in Wonderland", 'Lewis Carroll'),
    (2701, 'moby', 'Moby-Dick', 'Herman Melville'),
    (1952, 'wallpaper', 'The Yellow Wallpaper', 'Charlotte Perkins Gilman'),
    (1260, 'jane eyre', 'Jane Eyre', 'Charlotte Bronte'),
    (205, 'walden', 'Walden', 'Henry David Thoreau'),
    (174, 'dorian', 'The Picture of Dorian Gray', 'Oscar Wilde'),
    (1661, 'sherlock', 'The Adventures of Sherlock Holmes', 'Arthur Conan Doyle'),
    (768, 'wuthering', 'Wuthering Heights', 'Emily Bronte'),
    (34901, 'liberty', 'On Liberty', 'John Stuart Mill'),
    (345, 'dracula', 'Dracula', 'Bram Stoker'),
    (43, 'jekyll', 'The Strange Case of Dr. Jekyll and Mr. Hyde', 'Robert Louis Stevenson'),
    (145, 'middlemarch', 'Middlemarch', 'George Eliot'),
    (35, 'time machine', 'The Time Machine', 'H. G. Wells'),
    (76, 'huckleberry', 'Adventures of Huckleberry Finn', 'Mark Twain'),
    (2944, 'essays', 'Essays, First Series', 'Ralph Waldo Emerson'),
    (1400, 'expectations', 'Great Expectations', 'Charles Dickens'),
    (219, 'darkness', 'Heart of Darkness', 'Joseph Conrad'),
    (110, 'tess', "Tess of the d'Urbervilles", 'Thomas Hardy'),
    (5827, 'philosophy', 'The Problems of Philosophy', 'Bertrand Russell'),
    (158, 'emma', 'Emma', 'Jane Austen'),
    (2814, 'dubliners', 'Dubliners', 'James Joyce'),
    (120, 'treasure', 'Treasure Island', 'Robert Louis Stevenson'),
    (408, 'souls', 'The Souls of Black Folk', 'W. E. B. Du Bois'),
    (541, 'innocence', 'The Age of Innocence', 'Edith Wharton'),
    (36, 'worlds', 'The War of the Worlds', 'H. G. Wells'),
    (160, 'awakening', 'The Awakening', 'Kate Chopin'),
    (2641, 'room with a view', 'A Room with a View', 'E. M. Forster'),
    (550, 'silas', 'Silas Marner', 'George Eliot'),
    (209, 'screw', 'The Turn of the Screw', 'Henry James'),
    (74, 'tom sawyer', 'The Adventures of Tom Sawyer', 'Mark Twain'),
    (4217, 'portrait', 'A Portrait of the Artist as a Young Man', 'James Joyce'),
    (215, 'call of the wild', 'The Call of the Wild', 'Jack London'),
    (105, 'persuasion', 'Persuasion', 'Jane Austen'),
    (1695, 'thursday', 'The Man Who Was Thursday', 'G. K. Chesterton'),
    (33, 'scarlet', 'The Scarlet Letter', 'Nathaniel Hawthorne'),
    (113, 'secret garden', 'The Secret Garden', 'Frances Hodgson Burnett'),
    (46, 'christmas', 'A Christmas Carol', 'Charles Dickens'),
    (45, 'green gables', 'Anne of Green Gables', 'L. M. Montgomery'),
    (2097, 'four', 'The Sign of the Four', 'Arthur Conan Doyle'),
    (514, 'little women', 'Little Women', 'Louisa May Alcott'),
    (55, 'oz', 'The Wonderful Wizard of Oz', 'L. Frank Baum'),
]


class Refused(Exception):
    pass


def book_dir(gid):
    s = str(gid)
    parts = list(s[:-1]) if len(s) > 1 else ['0']
    return '/'.join(parts + [s])


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise Refused('%s -> HTTP %d' % (url, e.code))
    except urllib.error.URLError as e:
        raise Refused('%s -> %s' % (url, e.reason))


def main(argv):
    args = [a for a in argv[1:] if not a.startswith('--')]
    opts = dict(a[2:].split('=', 1) for a in argv[1:] if a.startswith('--') and '=' in a)
    if len(args) != 1:
        sys.stderr.write(__doc__)
        return 2
    out = args[0]
    mirror = opts.get('mirror', 'https://mirror.csclub.uwaterloo.ca/gutenberg').rstrip('/')
    if 'www.gutenberg.org' in mirror:
        print('use a mirror, not www.gutenberg.org', file=sys.stderr)
        return 2
    if os.path.exists(out) and os.listdir(out):
        print('%s is not empty' % out, file=sys.stderr)
        return 2
    os.makedirs(out, exist_ok=True)

    got, total = [], 0
    first = True
    try:
        for gid, key, title, author in BOOKS:
            if len(got) >= MAX_BOOKS or total >= MAX_BYTES:
                break
            data = None
            for name in ('%d-0.txt' % gid, '%d.txt' % gid, '%d-8.txt' % gid):
                if not first:
                    time.sleep(PAUSE)
                first = False
                url = '%s/%s/%s' % (mirror, book_dir(gid), name)
                print('GET', url, flush=True)
                data = get(url)
                if data is not None:
                    enc = 'latin-1' if name.endswith('-8.txt') else 'utf-8'
                    break
            if data is None:
                print('  not found, skipping', flush=True)
                continue
            text = data.decode(enc, errors='replace')
            # Older files carry a "Title:" header; some mirrors' newer files start at the
            # START marker instead, with the title in the first lines after it.
            m = re.search(r'^Title:[ \t]*(.+)$', text[:20000], re.M)
            start = re.search(r'\*\*\*[ \t]*START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*', text[:20000], re.I)
            opening = text[start.end():start.end() + 3000].lower() if start else ''
            if not ((m and key in m.group(1).lower()) or key in opening):
                print('  title check failed (%r), skipping' % (m.group(1) if m else None), flush=True)
                continue
            fname = '%d.txt' % gid
            with open(os.path.join(out, fname), 'w', encoding='utf-8') as f:
                f.write(text)
            total += len(data)
            got.append({'id': gid, 'title': title, 'author': author, 'file': fname, 'bytes': len(data)})
            print('  ok, %d bytes (total %.1f MB, %d books)' % (len(data), total / 1e6, len(got)), flush=True)
    except Refused as e:
        print('stopping: %s' % e, flush=True)
    with open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump({'mirror': mirror, 'books': got}, f, indent=1)
    print('%d books, %.1f MB' % (len(got), total / 1e6))
    return 0 if len(got) >= 25 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
