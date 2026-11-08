# Heft Studio — mô tả dự án và cây phát triển tính năng

## 1. Mục tiêu dự án

Heft Studio là công cụ tạo và chỉnh sửa màn chơi cho game Heft. Người dùng sắp xếp
thế giới trong Scene 2D/3D, chỉnh mô hình, kiểm tra cân bằng và chạy thử màn chơi
trong cùng một workspace. Ứng dụng chạy trên web và có bản desktop qua Electron.

Workspace gồm hai repository:

| Repository | Vai trò |
|---|---|
| `../repo-app` | Game Heft; mã game chính trong `index.html` |
| `.` (`repo-editor`) | Heft Studio; công cụ biên tập, benchmark, modeling và lưu trữ |

Level xuất ra dùng trực tiếp định dạng save của Heft: `game: 'Heft'`, `resources[]`,
`structures[]`, `player`, `stock`, `upgrades`, `seed`, `dayTime`. Người dùng có thể
xuất JSON qua File > Export hoặc chạy thử qua Game panel bằng `postMessage`.
Project của Studio còn chứa model và metadata; định dạng `.heftb` dùng để lưu project.

## 2. Cây tính năng

Cây dưới đây mô tả các chức năng đã có trong mã nguồn. Các node nhóm dùng để tổ chức;
mỗi tính năng mới phải được thêm thành một node riêng dưới nhóm phù hợp.

```text
Heft Studio
├── shell — Nền tảng workspace
│   ├── shell.layout — Bố trí panel, menu, phím tắt và thanh trạng thái
│   ├── shell.history — Undo/redo và trạng thái chỉnh sửa
│   ├── shell.selection — Hierarchy, Inspector và chọn đối tượng
│   └── shell.playtest — Mở, xuất level và chạy thử trong Game panel
├── viewport — Biên tập thế giới
│   ├── viewport.scene2d — Quan sát và chỉnh sửa cảnh 2D
│   ├── viewport.scene3d — Quan sát và chỉnh sửa cảnh 3D
│   ├── viewport.transform — Di chuyển, xoay, scale và snap
│   └── viewport.overlays — Hiển thị lớp phủ do các module cung cấp
├── bench — Kiểm tra màn chơi
│   ├── bench.capacity — Benchmark sức chứa và mô phỏng
│   └── bench.solvability — Phân tích khả năng hoàn thành màn chơi
├── modeling — Biên tập mô hình
│   ├── modeling.recipes — Công thức mô hình trong project.models
│   ├── modeling.edit — Chỉnh trực tiếp các phần của mô hình
│   └── modeling.export — Xuất model JSON và trang preview
├── db — Dữ liệu project
│   ├── db.binary — Import/export định dạng .heftb
│   ├── db.revisions — Lưu phiên bản, autosave và Data panel
│   └── db.storage — Adapter lưu trữ và kiểm soát dung lượng
└── desktop — Ứng dụng desktop
    └── desktop.files — Mở và lưu file qua Electron
```

**Quy tắc: một tính năng mới = một node tính năng = một branch = một worktree khi triển khai.**
Node nhóm không cần worktree. Một tính năng có thể chạm nhiều module nhưng vẫn có
một node chính; ghi các module liên quan và phụ thuộc trong hồ sơ của node.
Cây này là cây phạm vi sản phẩm, không phải lịch sử Git hay cây thư mục vật lý.

## 3. Gắn node với worktree

Mỗi node có ID ổn định dạng `<nhóm>.<tên-tính-năng>`. Branch dùng tiền tố `codex/`;
worktree nằm cạnh repository để các thay đổi được tách riêng.

| Thuộc tính | Quy ước |
|---|---|
| ID node | Ví dụ `viewport.multi-select` |
| Node cha | Ví dụ `viewport` |
| Branch | `codex/viewport-multi-select` |
| Worktree | `../worktrees/viewport-multi-select` |
| Base | `main`, hoặc branch tính năng phụ thuộc được ghi rõ |
| Phạm vi | Thư mục chính, file dùng chung cần đổi, test liên quan |
| Phụ thuộc | ID node cần có trước; để trống nếu độc lập |
| Trạng thái | `planned`, `in-progress`, `review`, `merged`, `blocked` |
| Nghiệm thu | Hành vi quan sát được, kiểm tra cần chạy và kết quả |
| Tích hợp | Commit hoặc PR sau khi hoàn thành |

Ví dụ **minh họa một tính năng đề xuất**, chưa triển khai và chưa có worktree:

```text
viewport
└── viewport.multi-select [planned]
    ├── Mục tiêu: chọn nhiều đối tượng và biến đổi cùng nhau
    ├── Branch dự kiến: codex/viewport-multi-select
    ├── Worktree dự kiến: ../worktrees/viewport-multi-select
    ├── Base: main
    ├── Phạm vi: src/viewport/, tests/viewport-*.test.mjs
    ├── Phụ thuộc: shell.selection, viewport.transform
    └── Nghiệm thu: chọn nhiều đối tượng, biến đổi và undo/redo đúng
```

Các dòng metadata trong ví dụ là thuộc tính của node, không phải tính năng con.
Các chức năng hiện có không cần tạo worktree hồi tố.

### Quy trình cho một tính năng mới

1. Thêm node vào cây và ghi mục tiêu, phạm vi, phụ thuộc, tiêu chí nghiệm thu.
2. Tạo branch/worktree riêng từ base đã chọn; cập nhật đường dẫn thực tế và trạng thái
   `in-progress`. Kiểm tra các thay đổi chưa commit ở checkout hiện tại trước khi chọn
   base: chúng không tự xuất hiện trong worktree mới.
3. Triển khai trong worktree của node. Nếu cần đổi giao tiếp dùng chung, ghi rõ thay đổi
   hợp đồng và cập nhật các bên sử dụng trong cùng phạm vi công việc.
4. Chạy test phù hợp với phần thay đổi; kiểm tra build và luồng giao diện khi có ảnh hưởng.
   Ghi kết quả, hạn chế còn lại và chuyển sang `review`.
5. Sau khi tích hợp vào base đích, ghi commit/PR và chuyển `merged`. Chỉ dọn worktree
   sau khi đã bảo toàn mọi thay đổi cần giữ; giữ node để tra cứu lịch sử tính năng.

Các node độc lập có thể dùng những worktree song song. Nếu node B cần mã của node A
chưa merge, ghi A là phụ thuộc và ghi chính xác base của B; sau khi A tích hợp, cập nhật
B theo base đích trước khi nghiệm thu.

### Worktree hiện tại

Tại thời điểm cập nhật tài liệu (20/10/2026), `repo-editor` chỉ có checkout
`/Users/macbook/Heft/repo-editor` trên branch `main`. Các đường dẫn worktree tính năng
ở trên là quy ước đề xuất, chưa phải worktree đã tạo.

## 4. Tổ chức mã nguồn và ranh giới thay đổi

| Đường dẫn | Nhóm phụ trách | Nội dung |
|---|---|---|
| `src/core/` | shell | Store, undo/redo, selection, UI state, dữ liệu luật game và DOM helpers |
| `src/shell/` | shell | Dockview workspace, menu, phím tắt, thanh trạng thái |
| `src/panels/` | shell | Hierarchy, Inspector, Game/playtest |
| `src/viewport/` | viewport | Scene 2D/3D, gizmo, camera |
| `src/bench/` | bench | Benchmark, mô phỏng và solvability engine |
| `src/modeling/` | modeling | Model recipes và chỉnh sửa mô hình |
| `src/db/` | db | Định dạng nhị phân, revision và lưu trữ |
| `desktop/` | desktop | Electron main/preload, API mở và lưu file |
| `tests/`, `tools/` | Theo node | Test và công cụ kiểm tra liên quan |

Bốn module viewport, bench, modeling và db cung cấp `install(ctx)` qua
`src/<module>/index.js`. `src/main.js` đăng ký panel nền tảng rồi cài lần lượt các
module; db thay thế `ctx.persist` trước khi Studio khởi động.

Mặc định, tính năng chỉ sửa thư mục module của mình cùng test/tool liên quan.
Thay đổi `src/core/`, `src/shell/`, `src/main.js`, dependency hoặc hợp đồng giữa các
module phải được liệt kê trong phạm vi node để các worktree khác biết điểm giao nhau.

## 5. Hợp đồng kỹ thuật giữa các module

Phần dưới giữ tên API để đối chiếu trực tiếp với mã nguồn. “Node” trong API selection
là đối tượng trong màn chơi, khác với node tính năng trong cây phát triển ở trên.

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
  scene, rebuilding when `rev` changes. Pillars push overlays here (bench heatmaps, reachability, claim radii).
- `bag.redraw()`: provided by the viewport. Call it after changing an overlay's `enabled`, `rev` or data so both views repaint.
- `bag.models`: provided by modeling: `{ keys(), geometry(key) => THREE.BufferGeometry (vertex colours, y-up, metres), rev(key) }`.
  Keys: `tree.0..2`, `rock.0..1`, `campfire`, `wall`, `workbench`, `player`. The viewport falls back to primitives when absent.
- `bag.inspectorExtras`: array of `(nodes, ui) => element|null` appended to the Inspector.
- `bag.playtest()`: run the level in the Game panel.

Coordinates: world x/z in metres, y up, island radius about 43-48 (`islandR`), camp at the origin.
