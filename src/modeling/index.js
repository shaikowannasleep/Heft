// Pillar module: modeling. Recipes live in project.models; this installs ctx.bag.models, the Model Editor panel and the export command.
import './modeling.css';
import { createModels } from './bag.js';
import { modelingPanel } from './editor.js';
import { exportModels } from './preview.js';

export function install(ctx) {
  const models = ctx.bag.models = createModels(ctx.store);
  ctx.registerPanel({ id: 'modeling', title: 'Model Editor', area: 'center', noScroll: true, create: c => modelingPanel(c, models, () => exportModels(models)) });
  ctx.registerCommand({ id: 'file.exportModels', label: 'Export models (JSON + preview.html)', menu: 'File', run: () => exportModels(models) });
}
