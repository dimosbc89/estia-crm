#!/usr/bin/env python3
"""Bundle index.html + css + js into one file for publishing as a Claude artifact.

The artifact host adds its own <!doctype>/<head>/<body> skeleton, so the output
starts with <title> and <style> and inlines everything else.
Usage: python3 scripts/build-artifact.py  ->  dist/estia-crm.html
"""
import pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
index = (root / 'index.html').read_text(encoding='utf-8')

title = re.search(r'<title>.*?</title>', index, re.S).group(0)
fonts = '\n'.join(re.findall(r'<link rel="(?:preconnect|stylesheet)" href="https://fonts[^>]*>', index))
css = (root / 'css/styles.css').read_text(encoding='utf-8')
body = re.search(r'<body>(.*?)\s*<script', index, re.S).group(1)
scripts = ''.join(f'<script>\n{(root / src).read_text(encoding="utf-8")}\n</script>\n'
                  for src in re.findall(r'<script src="([^"]+)"></script>', index))

out = f'{title}\n{fonts}\n<style>\n{css}\n</style>\n{body.strip()}\n{scripts}'
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist/estia-crm.html').write_text(out, encoding='utf-8')
print('wrote dist/estia-crm.html', len(out), 'bytes')
