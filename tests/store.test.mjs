import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';

test('a merged drag of many steps undoes to the exact pre-drag value', () => {
  const s = new Store({ level: { player: { x: 0 }, resources: [], structures: [] } });
  for (let i = 1; i <= 40; i++) s.update('Drag', d => { d.level.player.x = i; }, 'drag');
  assert.equal(s.past.length, 1);
  s.undo(); assert.equal(s.project.level.player.x, 0);
  s.redo(); assert.equal(s.project.level.player.x, 40);
});
