#!/usr/bin/env python3
"""Copy the app into public/ for the Cloudflare Worker, switching it to server mode (window.ESTIA_API)."""
import pathlib, shutil
root = pathlib.Path(__file__).resolve().parent.parent
pub = root / 'public'
shutil.rmtree(pub, ignore_errors=True)
(pub / 'css').mkdir(parents=True); (pub / 'js').mkdir()
html = (root / 'index.html').read_text(encoding='utf-8')
html = html.replace('<script src="js/store.js"></script>', '<script>window.ESTIA_API = "/api";</script>\n  <script src="js/store.js"></script>', 1)
(pub / 'index.html').write_text(html, encoding='utf-8')
for f in ['css/styles.css', 'js/store.js', 'js/app.js']:
    shutil.copy(root / f, pub / f)
shutil.copytree(root / 'assets', pub / 'assets')   # logo + icons (served without login, used on the sign-in page)
print('wrote public/')
