// Draws the mascot on the page, pinned to the viewport where the user dropped
// it, with its settings in a speech bubble, and reports scrolling. The mood
// comes from the service worker through chrome.storage. mascot.html runs this
// same script as the toolbar popup on pages that cannot host the mascot.

(async () => {
  if (window.top !== window || !(document.documentElement instanceof HTMLHtmlElement)) return;
  // A mascot left by a copy of the extension that has since been reloaded.
  for (const stale of document.querySelectorAll('[data-browser-mascot]')) stale.remove();

  const MARGIN = 8;
  const DRAG_START_PX = 5;
  /** Dropped this close to an edge, the mascot goes all the way to it. */
  const SNAP_PX = 14;
  const SCROLL_REPORT_MS = 5000;
  const HOME = { side: 'right', x: 0, vertical: 'bottom', y: 0 };
  /** In the toolbar popup the mascot stays small, to leave room for its panel. */
  const POPUP_SIZE = 96;
  const STORED = ['settings', 'mood', 'lastDecision', 'lastError', 'stats'];
  const standalone = location.origin === new URL(chrome.runtime.getURL('')).origin;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const asset = (path) => chrome.runtime.getURL(`avatars/${path}`);
  const percent = (probability) => `${Math.round(probability * 100)}%`;
  const viewport = () => ({ width: document.documentElement.clientWidth, height: innerHeight });

  const host = document.createElement('div');
  host.dataset.browserMascot = '';
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    [hidden] { display: none !important; }
    .mascot { position: relative; margin: ${MARGIN}px; font: 13px/1.4 system-ui, sans-serif; }
    .figure { width: 100%; height: 100%; transition: transform .35s ease; }
    img { display: block; width: 100%; height: 100%; }
    .figure img { transform-origin: 50% 100%; cursor: grab; touch-action: none; -webkit-user-drag: none; }
    .figure img.still { animation: breathe 3.2s ease-in-out infinite; }
    .figure img.pop { animation: pop .35s ease-out; }
    .dragging .figure { transition: none; }
    .dragging img { cursor: grabbing; rotate: -8deg; }
    .flip img { scale: -1 1; }

    .label {
      position: absolute; left: 50%; translate: -50% 0; white-space: nowrap; pointer-events: none;
      padding: 4px 9px; border-radius: 10px; background: #1f2937; color: #fff; font-weight: 500;
      opacity: 0; transition: opacity .15s;
    }
    .figure:hover .label { opacity: 1; }
    .open .label, .dragging .label { opacity: 0 !important; }
    [data-vertical="bottom"] .label { bottom: 100%; }
    [data-vertical="top"] .label { top: 100%; }

    /* The panel is a speech bubble: its tail points at the mascot. */
    .panel {
      position: absolute; width: 272px; max-width: calc(100vw - ${4 * MARGIN}px);
      border-radius: 16px; background: #fff; color: #17202e;
      box-shadow: 0 10px 34px rgb(15 23 42 / .22), 0 0 0 1px rgb(15 23 42 / .06);
      animation: unfold .18s ease-out;
    }
    .panel::after {
      content: ''; position: absolute; width: 14px; height: 14px; border-radius: 3px;
      background: inherit; rotate: 45deg;
    }
    .content { box-sizing: border-box; padding: 14px; overflow-y: auto; max-height: min(520px, var(--room)); }
    [data-vertical="bottom"] .panel { bottom: calc(100% + 8px); transform-origin: bottom; }
    [data-vertical="bottom"] .panel::after { bottom: -6px; }
    [data-vertical="top"] .panel { top: calc(100% + 8px); transform-origin: top; }
    [data-vertical="top"] .panel::after { top: -6px; }
    [data-side="right"] .panel { right: 0; }
    [data-side="right"] .panel::after { right: calc(var(--size) / 2 - 7px); }
    [data-side="left"] .panel { left: 0; }
    [data-side="left"] .panel::after { left: calc(var(--size) / 2 - 7px); }
    .panel header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .panel strong { font-size: 15px; }
    .panel h2 { margin: 14px 0 6px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #667085; }
    .panel p { margin: 6px 0 0; color: #667085; }
    .panel p.error { color: #dc2626; }
    .panel button { font: inherit; color: inherit; cursor: pointer; }
    .close { border: 0; background: none; font-size: 18px; line-height: 1; color: #667085; }
    .bar { display: grid; grid-template-columns: 96px 1fr 36px; align-items: center; gap: 8px; margin-top: 4px; }
    .bar div { border-radius: 3px; background: #e8edf4; }
    .bar i { display: block; height: 6px; border-radius: 3px; background: #3b82f6; }
    .bar span:last-child { text-align: right; font-variant-numeric: tabular-nums; }
    .tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
    .tiles button { padding: 2px; border: 2px solid transparent; border-radius: 8px; background: #f1f5f9; font-size: 11px; }
    .tiles button[aria-pressed="true"] { border-color: #3b82f6; }
    .tiles img { height: auto; aspect-ratio: 1; }
    input[type="range"] { width: 100%; margin: 0; accent-color: #3b82f6; }
    .hide { width: 100%; margin-top: 12px; padding: 7px; border: 1px solid #d0d7e2; border-radius: 9px; background: none; }

    @media (prefers-color-scheme: dark) {
      .panel { background: #18202b; color: #e8edf4; }
      .panel h2, .panel p, .close { color: #93a0b4; }
      .tiles button, .bar div { background: #232e3d; }
      .hide { border-color: #344256; }
    }
    @keyframes breathe { 50% { transform: scale(1.02, .97); } }
    @keyframes pop { 0% { transform: scale(.8, 1.15); } 60% { transform: scale(1.08, .94); } }
    @keyframes unfold { from { opacity: 0; scale: .9; } }
    @media (prefers-reduced-motion: reduce) { .figure img, .panel { animation: none !important; } }
    @media print { .mascot { display: none; } }
  `);
  root.adoptedStyleSheets = [sheet];

  const image = h('img', { alt: '' });
  const label = h('span', { className: 'label' });
  const figure = h('div', { className: 'figure' }, image, label);
  const title = h('strong');
  const close = h('button', { className: 'close', type: 'button', ariaLabel: 'Close', textContent: '×', hidden: standalone });
  const thinking = h('div');
  const avatars = h('div', { className: 'tiles avatars' });
  const size = h('input', { type: 'range', min: '72', max: '220', step: '4', ariaLabel: 'Size' });
  const poses = h('div', { className: 'tiles' });
  const spend = h('p', { className: 'spend' });
  const hide = h('button', { className: 'hide', type: 'button', textContent: 'Hide me' });
  const hint = standalone
    ? 'Chrome does not let me onto this page. I am on every ordinary web page.'
    : 'Drag me anywhere. The toolbar button brings me back.';
  const panel = h(
    'div',
    { className: 'panel', hidden: true },
    h(
      'div',
      { className: 'content' },
      h('header', {}, title, close),
      thinking,
      h('h2', { textContent: 'Avatar' }),
      avatars,
      h('h2', { textContent: 'Size' }),
      size,
      h('h2', { textContent: 'Try a pose' }),
      poses,
      spend,
      hide,
      h('p', { textContent: hint }),
    ),
  );
  const mascot = h('div', { className: 'mascot' }, figure, panel);
  root.append(mascot);

  const stored = {};
  let avatar = null;
  let avatarList = null;

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type !== 'open-panel') return;
    openPanel();
    respond(true);
  });
  image.addEventListener('animationend', () => image.classList.remove('pop'));
  image.addEventListener('pointerdown', dragOrClick);
  close.addEventListener('click', closePanel);
  size.addEventListener('input', () => change({ size: Number(size.value) }));
  hide.addEventListener('click', () => change({ enabled: false }));
  if (!standalone) {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePanel();
    });
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!event.composedPath().includes(host)) closePanel();
      },
      true,
    );
  }

  Object.assign(stored, await chrome.storage.local.get(STORED));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.mood && changes.mood.newValue?.id !== stored.mood?.id) image.classList.add('pop');
    for (const key of STORED) {
      if (changes[key]) stored[key] = changes[key].newValue;
    }
    render();
  });
  addEventListener('resize', render);
  await render();
  if (standalone) openPanel();
  reportScrolling();

  function shownSize() {
    return standalone ? POPUP_SIZE : stored.settings.size;
  }

  /** Where the mascot's box sits, pulled back inside the window if the window shrank. */
  function place() {
    const { side, x, vertical, y } = (!standalone && stored.settings.position) || HOME;
    const box = shownSize() + 2 * MARGIN;
    const { width, height } = viewport();
    return {
      side,
      vertical,
      x: Math.max(0, Math.min(x, width - box)),
      y: Math.max(0, Math.min(y, height - box)),
    };
  }

  async function render() {
    const { settings, mood } = stored;
    if (!settings?.enabled) {
      host.remove();
      if (standalone) window.close();
      return;
    }
    if (avatar?.id !== settings.avatar) {
      avatar = await (await fetch(asset(`${settings.avatar}/avatar.json`))).json();
      poses.replaceChildren(
        ...Object.entries(avatar.poses).map(([id, pose]) => {
          const tile = h('button', { type: 'button', title: id }, h('img', { alt: id, src: asset(`${avatar.id}/${pose.file}`) }));
          tile.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'preview', id }));
          return tile;
        }),
      );
    }

    const pose = avatar.poses[mood?.id] ?? avatar.poses.idle;
    const animated = pose.anim && !reducedMotion;
    const source = asset(`${avatar.id}/${animated ? pose.anim : pose.file}`);
    if (image.src !== source) image.src = source;
    image.classList.toggle('still', !animated);

    const { side, vertical, x, y } = place();
    const shown = shownSize();
    if (!mascot.classList.contains('dragging')) {
      Object.assign(host.style, {
        left: side === 'left' ? `${x}px` : 'auto',
        right: side === 'right' ? `${x}px` : 'auto',
        top: vertical === 'top' ? `${y}px` : 'auto',
        bottom: vertical === 'bottom' ? `${y}px` : 'auto',
      });
    }
    Object.assign(mascot.dataset, { side, vertical });
    mascot.style.width = mascot.style.height = `${shown}px`;
    mascot.style.setProperty('--size', `${shown}px`);
    mascot.style.setProperty('--room', `${viewport().height - y - shown - 5 * MARGIN}px`);

    // A pose drawn against an edge, such as peeking, scurries to the nearest side of the window.
    const toEdge = pose.edge ? ((avatar.size - pose.box[2]) / avatar.size) * shown + MARGIN + x : 0;
    figure.style.transform = `translateX(${side === 'right' ? toEdge : -toEdge}px)`;
    figure.classList.toggle('flip', Boolean(pose.edge) && pose.edge !== side);

    const feeling = mood?.label ?? 'waking up';
    label.textContent = mood?.probability == null ? feeling : `${feeling} · ${percent(mood.probability)}`;
    title.textContent = `${avatar.name} is ${feeling}`;
    if (!panel.hidden) renderPanel();
    if (!host.isConnected) document.documentElement.append(host);
  }

  function renderPanel() {
    const { settings, lastDecision, lastError, stats } = stored;
    if (lastError) {
      thinking.replaceChildren(h('p', { className: 'error', textContent: lastError.message }));
    } else if (lastDecision) {
      thinking.replaceChildren(
        ...lastDecision.ranked.map(({ label: name, probability }) => {
          const fill = h('i');
          fill.style.width = percent(probability);
          return h('div', { className: 'bar' }, h('span', { textContent: name }), h('div', {}, fill), h('span', { textContent: percent(probability) }));
        }),
      );
    } else {
      thinking.replaceChildren(h('p', { textContent: 'No decision yet.' }));
    }

    avatars.replaceChildren(
      ...(avatarList ?? []).map(({ id, name }) => {
        const tile = h(
          'button',
          { type: 'button', ariaPressed: String(id === settings.avatar) },
          h('img', { alt: '', src: asset(`${id}/poses/idle.png`) }),
          name,
        );
        tile.addEventListener('click', () => change({ avatar: id }));
        return tile;
      }),
    );
    if (root.activeElement !== size) size.value = settings.size;
    spend.textContent = stats ? `${stats.calls} decisions today · $${stats.cost.toFixed(4)}` : '';
  }

  async function openPanel() {
    // The toolbar button may have just switched the mascot back on.
    Object.assign(stored, await chrome.storage.local.get('settings'));
    avatarList ??= await (await fetch(asset('index.json'))).json();
    panel.hidden = false;
    mascot.classList.add('open');
    image.classList.add('pop');
    await render();
  }

  function closePanel() {
    panel.hidden = true;
    mascot.classList.remove('open');
  }

  function change(patch) {
    stored.settings = { ...stored.settings, ...patch };
    chrome.storage.local.set({ settings: stored.settings });
    render();
  }

  /** A press that moves drags the mascot to a new spot; one that does not opens the panel. */
  function dragOrClick(down) {
    if (down.button !== 0 || standalone) return;
    down.preventDefault();
    image.setPointerCapture(down.pointerId);
    const start = host.getBoundingClientRect();
    let dragging = false;

    const move = (event) => {
      const dx = event.clientX - down.clientX;
      const dy = event.clientY - down.clientY;
      if (!dragging && Math.hypot(dx, dy) < DRAG_START_PX) return;
      dragging = true;
      closePanel();
      mascot.classList.add('dragging');
      figure.style.transform = '';
      Object.assign(host.style, { left: `${start.left + dx}px`, top: `${start.top + dy}px`, right: 'auto', bottom: 'auto' });
    };
    const drop = () => {
      image.removeEventListener('pointermove', move);
      image.removeEventListener('pointerup', drop);
      image.removeEventListener('pointercancel', drop);
      mascot.classList.remove('dragging');
      if (!dragging) {
        if (panel.hidden) openPanel();
        else closePanel();
        return;
      }
      image.classList.add('pop');
      // The spot is kept as a distance from the nearest edges, so it holds when the window resizes.
      const box = host.getBoundingClientRect();
      const { width, height } = viewport();
      const side = box.left + box.width / 2 < width / 2 ? 'left' : 'right';
      const vertical = box.top + box.height / 2 < height / 2 ? 'top' : 'bottom';
      const fromEdge = (distance) => (distance < SNAP_PX ? 0 : Math.round(distance));
      change({
        position: {
          side,
          x: fromEdge(side === 'left' ? box.left : width - box.right),
          vertical,
          y: fromEdge(vertical === 'top' ? box.top : height - box.bottom),
        },
      });
    };
    image.addEventListener('pointermove', move);
    image.addEventListener('pointerup', drop);
    image.addEventListener('pointercancel', drop);
  }

  function reportScrolling() {
    let screens = 0;
    const lastTop = new WeakMap();
    document.addEventListener(
      'scroll',
      (event) => {
        const scroller = event.target === document ? document.scrollingElement : event.target;
        if (!scroller) return;
        const top = scroller.scrollTop;
        screens += Math.abs(top - (lastTop.get(scroller) ?? top)) / innerHeight;
        lastTop.set(scroller, top);
      },
      { capture: true, passive: true },
    );
    const interval = setInterval(() => {
      // After the extension reloads, this orphaned script can no longer reach it.
      if (!chrome.runtime?.id) {
        clearInterval(interval);
        host.remove();
        return;
      }
      if (screens < 0.25) return;
      chrome.runtime.sendMessage({ type: 'scrolled', screens }).catch(() => {});
      screens = 0;
    }, SCROLL_REPORT_MS);
  }

  function h(tag, properties = {}, ...children) {
    const element = Object.assign(document.createElement(tag), properties);
    element.append(...children);
    return element;
  }
})();
