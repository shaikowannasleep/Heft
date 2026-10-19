# Heft Studio architecture

Heft Studio edits levels for Heft (`../repo-app`, one HTML file). A level **is** a Heft save file
(`game: 'Heft'`, `resources[]`, `structures[]`, `player`, `stock`, `upgrades`, `seed`, `dayTime`), so the game loads
editor output with no conversion (`File > Export`, or the Game panel which posts it through `postMessage`).

## Layout

| path | owner | what |
|---|---|---|
| `src/core/` | shell | `store.js` (immer undo/redo, selection, ui), `heft-data.js` (game rules ported from repo-app), `dom.js` |
| `src/shell/` | shell | Dockview workspace, menus, hotkeys, status bar |
| `src/panels/` | shell | Hierarchy, Inspector, Game (playtest) |
| `src/viewport/` | pillar 1 | Scene 2D + Scene 3D, gizmos, cameras |
| `src/bench/` | pillar 2 | live capacity benchmark + solvability engine |
| `src/modeling/` | pillar 3 | model recipes + direct model editing |
| `src/db/` | pillar 4 | binary project format + storage growth control |
| `desktop/` | shell | Electron main + preload (`window.heftDesktop.saveAs/save/open`) |

Each pillar exports `install(ctx)` from `src/<pillar>/index.js`. A pillar edits only its own folder plus
`tests/<pillar>-*.test.mjs` and `tools/<pillar>-*.mjs`.

## ctx (created in src/shell/app.js)

- `store`: `project` (`{ format:'heft-studio', version, name, level, models, meta }`), `selection` (node ids), `ui`
  (`tool: select|move|rotate|scale`, `snap`, `snapMove`, `snapRotate`, `cam3d`). `store.update(label, recipe, mergeKey)`
  is the only way to change the project (one undo step; same mergeKey within 1.5 s merges, use it for drags).
  `store.on(why)` fires `'project' | 'selection' | 'ui' | 'saved'` and anything a pillar emits.
- Node ids: `'player'`, `'r:<resource id>'`, `'s:<structure id>'`. `ctx.getNode(id)` gives `{ id, kind, obj }`,
  `ctx.draftNode(draft, id)` gives the mutable object inside a recipe. `ctx.nodeIds()` lists all.
- `ctx.data`: game constants and helpers (`STRUCT`, `ITEM`, `inIsland`, `islandR`, `generateResources`, `r2`, ...).
- `ctx.registerPanel({ id, title, area: 'left'|'center'|'right'|'bottom'|'hidden', noScroll, create(ctx) => { element, update?(why), onShow?(), onResize?(), dispose?() } })`.
  Default layout: Hierarchy | `scene2d` | `scene3d` | Inspector, bottom panels tabbed under the scenes.
- `ctx.registerCommand({ id, label, keys: 'Mod+Shift+K', alt, menu, toolbar, when(ctx), run(ctx) })`: menus and
  hotkeys come from this list (Mod = Ctrl/Cmd). Unity keys taken by the shell: Q W E R, F, Del, Mod+Z/Y/D/A/S/O/N/E/P, Shift+S, Escape.
- `ctx.setStatus(key, text)`: a status bar slot.
- `ctx.persist = { save(project) => {bytes}, load() => project|null }`: persistence seam, replaced by pillar 4.

## ctx.bag services between pillars

- `bag.frame(ids)`, `bag.viewCenter() => {x,z}`: provided by the viewport.
- `bag.overlays`: array of `{ id, label, enabled, rev, draw2d?(g, view), object3d?(THREE) }`. The viewport draws every
  enabled overlay in 2D (`view.toScreen(x,z) => [sx,sy]`, `view.scale` px per metre) and adds `object3d()` to the 3D
- `bag.redraw()`: provided by the viewport. Call it after changing an overlay's `enabled`, `rev` or data so both views repaint.
  scene, rebuilding when `rev` changes. Pillars push overlays here (bench heatmaps, reachability, claim radii).
- `bag.models`: provided by modeling: `{ keys(), geometry(key) => THREE.BufferGeometry (vertex colours, y-up, metres), rev(key) }`.
  Keys: `tree.0..2`, `rock.0..1`, `campfire`, `wall`, `workbench`, `player`. The viewport falls back to primitives when absent.
- `bag.inspectorExtras`: array of `(nodes, ui) => element|null` appended to the Inspector.
- `bag.playtest()`: run the level in the Game panel.

Coordinates: world x/z in metres, y up, island radius about 43-48 (`islandR`), camp at the origin.
