import { createStudio } from './shell/app.js';
import { hierarchyPanel } from './panels/hierarchy.js';
import { inspectorPanel } from './panels/inspector.js';
import { playtestPanel } from './panels/playtest.js';
import * as viewport from './viewport/index.js';
import * as bench from './bench/index.js';
import * as modeling from './modeling/index.js';
import * as db from './db/index.js';

const studio = createStudio(document.getElementById('app'));
const { ctx } = studio;
ctx.registerPanel({ id: 'hierarchy', title: 'Hierarchy', area: 'left', create: hierarchyPanel });
ctx.registerPanel({ id: 'inspector', title: 'Inspector', area: 'right', create: inspectorPanel });
ctx.registerPanel({ id: 'playtest', title: 'Game', area: 'center', noScroll: true, create: playtestPanel });
ctx.registerCommand({ id: 'play', label: 'Play level in game', keys: 'Mod+P', menu: 'File', toolbar: '▶ Play', primary: true, run: () => ctx.bag.playtest?.() });

// Each pillar installs its panels, commands and services. Order matters only for ctx.persist (db last wins).
for (const m of [viewport, bench, modeling, db]) m.install(ctx);
await studio.start();
