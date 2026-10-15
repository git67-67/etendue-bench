"""Rebuild index.html from src/ (single self-contained file for GitHub Pages)."""
src = open('src/index.template.html').read()
html = src.replace('/*ENGINE*/', open('src/engine.js').read()).replace('/*APP*/', open('src/app.js').read())
html = html.replace('<div class="wrap">', '</head>\n<body>\n<div class="wrap">', 1)
html = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<style>:root{color-scheme:light}body{margin:0}</style>\n' + html + '\n</body>\n</html>\n')
open('index.html', 'w').write(html)
print('wrote index.html', len(html), 'bytes')
