// dockview-core's ESM build ships without CSS; the UMD build injects it. Extract it once into src/shell/dockview.css.
import fs from 'node:fs';
const src = fs.readFileSync('node_modules/dockview-core/dist/dockview-core.js', 'utf8');
const marker = 's.textContent = "';
const i = src.indexOf(marker);
if (i < 0) throw new Error('css not found');
let j = i + marker.length, out = '';
for (; j < src.length; j++) {
  const c = src[j];
  if (c === '\\') { out += src.slice(j, j + 2); j++; continue; }
  if (c === '"') break;
  out += c;
}
fs.writeFileSync('src/shell/dockview.css', JSON.parse('"' + out + '"'));
console.log('dockview.css', fs.statSync('src/shell/dockview.css').size, 'bytes');
