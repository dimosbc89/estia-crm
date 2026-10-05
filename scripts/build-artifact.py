#!/usr/bin/env python3
"""Bundle index.html + css + js into one file for publishing as a Claude artifact.

The artifact host adds its own <!doctype>/<head>/<body> skeleton, so the output
starts with <title> and <style> and inlines everything else.
Usage: python3 scripts/build-artifact.py  ->  dist/estia-crm.html
"""
import base64, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
index = (root / 'index.html').read_text(encoding='utf-8')

title = re.search(r'<title>.*?</title>', index, re.S).group(0)
css = (root / 'css/styles.css').read_text(encoding='utf-8')
# Inline the brand fonts as data URIs (the artifact host only serves this one file).
css = re.sub(r'url\("\.\./assets/fonts/([^"]+)"\)',
             lambda m: 'url("data:font/woff2;base64,' + base64.b64encode((root / 'assets/fonts' / m.group(1)).read_bytes()).decode() + '")', css)
body = re.search(r'<body>(.*?)\s*<script', index, re.S).group(1)
scripts = ''.join(f'<script>\n{(root / src).read_text(encoding="utf-8")}\n</script>\n'
                  for src in re.findall(r'<script src="([^"]+)"></script>', index))

# Inline the logo: the artifact can't load files from relative paths.
logo = 'data:image/webp;base64,' + base64.b64encode((root / 'assets/estia-lockup-dark.webp').read_bytes()).decode()
body = body.replace('src="assets/estia-lockup-dark.webp"', f'src="{logo}"')
# The red house-and-key mark (dark-theme logo and footer).
icon = 'data:image/png;base64,' + base64.b64encode((root / 'assets/apple-touch-icon.png').read_bytes()).decode()
body = body.replace('src="assets/apple-touch-icon.png"', f'src="{icon}"')

out = f'{title}\n<style>\n{css}\n</style>\n{body.strip()}\n{scripts}'
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist/estia-crm.html').write_text(out, encoding='utf-8')
print('wrote dist/estia-crm.html', len(out), 'bytes')
