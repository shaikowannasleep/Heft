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

test('a pause mid-drag does not split the gesture; separate gestures and unkeyed edits stay separate', t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const s = new Store({ level: { player: { x: 0 }, resources: [], structures: [] } });
  for (let i = 1; i <= 20; i++) { s.update('Drag', d => { d.level.player.x = i; }, 'mv1'); t.mock.timers.tick(i === 10 ? 5000 : 16); }
  assert.equal(s.past.length, 1);
  s.update('Drag', d => { d.level.player.x = 99; }, 'mv2');
  s.update('Set x', d => { d.level.player.x = 5; });
  s.update('Set x', d => { d.level.player.x = 6; });
  assert.equal(s.past.length, 4);
  s.undo(); s.undo(); s.undo(); assert.equal(s.project.level.player.x, 20);
  s.undo(); assert.equal(s.project.level.player.x, 0);
});
