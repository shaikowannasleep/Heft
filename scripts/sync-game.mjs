// Copies the game (repo-app) into public/game/ so the Playtest panel can embed it.
// HEFT_APP_DIR overrides the default sibling checkout.
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(process.env.HEFT_APP_DIR || '../repo-app');
const src = path.join(dir, 'index.html');
if (!fs.existsSync(src)) { console.warn(`sync-game: ${src} not found, Playtest panel will be empty (set HEFT_APP_DIR)`); process.exit(0); }
fs.mkdirSync('public/game', { recursive: true });
fs.copyFileSync(src, 'public/game/index.html');
console.log('sync-game: copied', src);
