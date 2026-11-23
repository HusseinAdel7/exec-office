// يجمّع النسخة الأونلاين في ملف واحد: online/index.html
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const body = html.split('<body>')[1].split('</body>')[0]
  .replace('<script src="app.js"></script>', '');
const out = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>مكتب المدير</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Readex+Pro:wght@400;500;600;700&display=swap">
<style>
html { direction: rtl; }
${css}
</style>
<div id="root" dir="rtl" lang="ar">
${body.trim()}
</div>
<script>
${js}
</script>
`;
fs.mkdirSync(path.join(dir, 'online'), { recursive: true });
fs.writeFileSync(path.join(dir, 'online', 'index.html'), out);
console.log('built', out.length, 'bytes');
