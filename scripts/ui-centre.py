#!/usr/bin/env python3
"""Reads a uiautomator dump and answers where to tap.

The launcher and the app's sheets expose labels as separate nodes and sometimes as one
concatenated node, so a plain "find the text" tap lands on the wrong thing. Keep the
selection rules in one place and let the shell only ask.

    ui-centre.py centre  <dump.xml> <text>   # first node whose text/desc contains it
    ui-centre.py exact   <dump.xml> <text>   # ... whose text/desc equals it
    ui-centre.py first-input <dump.xml>      # topmost EditText, which is the first field
    ui-centre.py labels  <dump.xml>          # every distinct label, for failure messages
"""
import re
import sys

NODE = re.compile(r'<node[^>]*>')
BOUNDS = re.compile(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')


def attr(node, key):
    found = re.search(key + r'="([^"]*)"', node)
    return found.group(1) if found else ''


def centre_of(node):
    found = BOUNDS.search(node)
    if not found:
        return None
    x1, y1, x2, y2 = map(int, found.groups())
    # A hidden or clipped node reports an empty rectangle, and its centre is (0, 0) — tapping
    # there does nothing and looks like a successful match.
    if x2 <= x1 or y2 <= y1:
        return None
    return (x1 + x2) // 2, (y1 + y2) // 2


def main():
    mode, path = sys.argv[1], sys.argv[2]
    want = sys.argv[3].lower() if len(sys.argv) > 3 else ''
    xml = open(path, encoding='utf-8', errors='replace').read()
    nodes = NODE.findall(xml)

    if mode == 'labels':
        seen = []
        for node in nodes:
            for key in ('text', 'content-desc'):
                value = attr(node, key).strip()
                if value and value not in seen:
                    seen.append(value)
        print(' | '.join(seen[:40]))
        return

    if mode == 'first-input':
        fields = []
        for node in nodes:
            if 'EditText' not in node:
                continue
            point = centre_of(node)
            if point:
                fields.append(point)
        if fields:
            x, y = min(fields, key=lambda point: point[1])
            print(x, y)
        return

    for node in nodes:
        values = [attr(node, key).lower() for key in ('text', 'content-desc')]
        hit = want in ' '.join(values) if mode == 'centre' else want in values
        if hit:
            point = centre_of(node)
            if point:
                print(*point)
                return


if __name__ == '__main__':
    main()
