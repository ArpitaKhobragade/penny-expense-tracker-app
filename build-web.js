// Builds the folder the Android app shows (www/) from the website files, without touching the originals.
//   - today.html becomes the app's start page (index.html); the original dashboard becomes dashboard.html
//   - fonts are copied from npm packages so the app looks the same with no internet
//   - only the files the pages use are copied, so none of the server or test files end up in the app
// Run with: node build-web.js   (or npm run build:web)
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const out = path.join(root, 'www');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true }); fs.writeFileSync(path.join(out, file), text); };

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// ---- fonts ----
const FONTS = [
  { pkg: 'dm-sans', weights: [400, 500, 600, 700] },
  { pkg: 'manrope', weights: [600, 700, 800] },
];
let fontCss = '';
for (const { pkg, weights } of FONTS) {
  const dir = path.join(root, 'node_modules', '@fontsource', pkg);
  for (const weight of weights) {
    const css = fs.readFileSync(path.join(dir, `${weight}.css`), 'utf8');
    for (const block of css.match(/\/\*[^*]*\*\/\s*@font-face\s*\{[^}]*\}/g) || []) {
      const name = /^\/\*\s*([\w-]+)\s*\*\//.exec(block)[1];
      // latin covers letters and digits; latin-ext covers the rupee sign. Other scripts are not needed.
      if (!/-latin(-ext)?-\d+-normal$/.test(name)) continue;
      const file = `${name}.woff2`;
      fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
      fs.copyFileSync(path.join(dir, 'files', file), path.join(out, 'fonts', file));
      fontCss += block
        .replace(/src:[^;]*;/, `src: url(fonts/${file}) format('woff2');`)
        .replace(/^\/\*.*?\*\/\s*/, '') + '\n';
    }
  }
}
write('fonts.css', fontCss);

// ---- pages and scripts ----
const withFonts = html => html.replace('</head>', '  <link rel="stylesheet" href="fonts.css" />\n</head>');
const noWebFonts = css => css.replace(/@import url\('https:\/\/fonts\.googleapis\.com[^)]*\);?/g, '');

// The start page is the new Today screen. Pages that linked to the old index.html now link to dashboard.html.
write('index.html', withFonts(read('today.html')).replace(/href="index\.html"/g, 'href="dashboard.html"'));
const oldPages = { 'index.html': 'dashboard.html', 'period.html': 'period.html', 'transactions.html': 'transactions.html', 'future-plans.html': 'future-plans.html', 'other-money.html': 'other-money.html' };
for (const [from, to] of Object.entries(oldPages)) {
  // On a phone the old pages hide their sidebar, so the logo becomes the way back to Today.
  write(to, withFonts(read(from)).replace(/href="index\.html"/g, 'href="dashboard.html"').replace('href="#top" aria-label="Pocket home"', 'href="index.html" aria-label="Back to Today"'));
}
for (const css of ['today.css', 'styles.css']) write(css, noWebFonts(read(css)));
for (const js of ['expense-utils.js', 'sms-parser.js', 'budget-math.js', 'goals.js', 'cycle.js', 'bills.js', 'owed.js', 'accounts.js', 'pots.js', 'trash.js', 'statement.js', 'pace.js', 'recap.js', 'recurring.js', 'cash.js', 'upi.js', 'salary.js', 'extras-bridge.js', 'sweep.js', 'afford.js', 'expenses.js', 'insights.js', 'backup.js', 'inbox.js', 'sms-bridge.js', 'store.js', 'applock.js', 'lock.js', 'lockui.js', 'selfcheck.js', 'today.js', 'app.js', 'page-router.js']) write(js, read(js));

const files = fs.readdirSync(out, { recursive: true }).filter(f => fs.statSync(path.join(out, f)).isFile());
console.log(`Built www/ with ${files.length} files (${(files.reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0) / 1024).toFixed(0)} KB).`);
