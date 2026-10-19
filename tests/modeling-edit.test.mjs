import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { newProject } from '../src/core/heft-data.js';
import { DEFAULTS } from '../src/modeling/defaults.js';
import { createModels } from '../src/modeling/bag.js';
import { modelsEnvelope } from '../src/modeling/preview.js';

const setup = () => { const store = new Store(newProject(1)); return { store, models: createModels(store) }; };

test('unedited models serve the game default, with a stable rev and cached geometry', () => {
  const { models } = setup();
  assert.equal(models.recipe('tree.1'), DEFAULTS['tree.1']);
  assert.equal(models.edited('tree.1'), false);
  assert.equal(models.rev('tree.1'), models.rev('tree.1'));
  assert.equal(models.geometry('tree.1'), models.geometry('tree.1'));
});

test('an edit bumps rev, changes the geometry, and undo restores the default', () => {
  const { store, models } = setup();
  const rev0 = models.rev('tree.1'), g0 = models.geometry('tree.1');
  models.edit('Tint', 'tree.1', rec => { rec.forEach(p => { p.color = 0xff00ff; }); });
  assert.equal(models.edited('tree.1'), true);
  assert.ok(models.rev('tree.1') > rev0);
  assert.notEqual(models.geometry('tree.1'), g0);
  store.undo();
  assert.equal(models.edited('tree.1'), false);
  assert.equal(models.recipe('tree.1'), DEFAULTS['tree.1']);
});

test('a vertex offset moves only the targeted weld and its members', () => {
  const { models } = setup();
  const base = models.geometry('tree.0').attributes.position.array.slice();
  models.edit('Nudge', 'tree.0', rec => { rec[0].vx = { 0: [0.25, 0, 0] }; });
  const now = models.geometry('tree.0').attributes.position.array;
  let moved = 0;
  for (let i = 0; i < now.length; i += 3) if (Math.abs(now[i] - base[i]) > 1e-6) moved++;
  assert.ok(moved >= 1 && moved <= 3, `moved ${moved} vertices, expected the vertex and its duplicates in the same spot`);
});

test('out-of-range edits throw and leave the project untouched', () => {
  const { store, models } = setup();
  const before = store.project;
  assert.throws(() => models.edit('Bad', 'rock.0', rec => { rec[0].args[0] = 99; }), /out of range/);
  assert.equal(store.project, before);
  assert.equal(models.edited('rock.0'), false);
});

test('reset returns a model to the game default in one undoable step', () => {
  const { store, models } = setup();
  models.edit('Tint', 'wall', rec => { rec[0].color = 0x123456; });
  models.reset('wall');
  assert.equal(models.edited('wall'), false);
  store.undo();
  assert.equal(models.edited('wall'), true);
});

test('export envelope carries every model with a matching mesh', () => {
  const { models } = setup();
  const env = modelsEnvelope(models);
  assert.equal(env.format, 'heft-models');
  assert.equal(env.models.length, 9);
  for (const m of env.models) {
    assert.equal(m.mesh.position.length % 9, 0, m.key);
    assert.equal(m.mesh.normal.length, m.mesh.position.length, m.key);
    assert.equal(m.mesh.color.length, m.mesh.position.length, m.key);
  }
});
