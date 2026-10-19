// Playtest: embeds the real game (public/game/index.html, copied from repo-app) and posts the current level into it.
export function playtestPanel(ctx) {
  const { h, store, data } = ctx;
  const frame = h('iframe', { title: 'Heft playtest', allow: 'autoplay' });
  const info = h('span', { style: { color: 'var(--fg2)' } }, 'Press ▶ Play (Ctrl+P) to run this level in the game');
  const el = h('div', { class: 'playtest' }, h('div', { class: 'bar' },
    h('button', { class: 'btn primary', onclick: () => play() }, '▶ Play'),
    h('button', { class: 'btn', onclick: () => { frame.src = 'about:blank'; info.textContent = 'Stopped'; } }, '■ Stop'), info), frame);
  let pending = null;
  addEventListener('message', e => {
    if (e.source !== frame.contentWindow) return;
    if (e.data?.type === 'heft:boot' && pending) frame.contentWindow.postMessage(pending, '*');
    if (e.data?.type === 'heft:ready') { info.textContent = `Running · ${store.project.name}`; pending = null; }
  });
  function play() {
    pending = { type: 'heft:playtest', state: data.toGameState(store.project) };
    frame.src = 'game/index.html?studio=' + Date.now();
    info.textContent = 'Loading game…';
  }
  ctx.bag.playtest = () => { ctx.bag.dock.getPanel('playtest')?.api.setActive(); play(); };
  return { element: el };
}
