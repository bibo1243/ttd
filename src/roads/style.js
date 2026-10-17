// Styles for the road and vehicle panels, kept with the module.
const CSS = `
.rd-list { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; margin: 2px 0 6px; }
.rd-row { display: flex; align-items: center; gap: 6px; padding: 3px 4px 3px 6px; border-radius: 10px; background: rgba(238, 242, 245, 0.7); }
.rd-icon { font-size: 18px; width: 24px; text-align: center; }
.rd-name { flex: 1; font-size: 13px; color: #3b3f4a; display: flex; align-items: center; gap: 6px; min-width: 0; }
.rd-price { font-size: 11px; color: #e08a1e; font-weight: 700; }
.rd-dot { width: 11px; height: 11px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); flex: 0 0 auto; }
.rd-count { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 13px; min-width: 30px; text-align: right; color: #3b3f4a; }
#buildCard button.mini { flex: 0 0 auto; width: 28px; height: 26px; padding: 0; font-size: 14px; border-radius: 8px; background: #fff; }
#buildCard button.mini.ghosty { background: transparent; color: #8a8f9c; }
#buildCard button.mini.on { background: #4a90c8; color: #fff; }
.rd-form { display: grid; grid-template-columns: auto 1fr; gap: 8px 10px; align-items: center; margin: 4px 0 6px; }
.rd-form label { font-size: 12px; color: #8a8f9c; }
.rd-bases, .rd-swatches { display: flex; flex-wrap: wrap; gap: 5px; }
#buildCard button.rd-base { width: 34px; height: 30px; font-size: 18px; }
#buildCard button.rd-swatch { flex: 0 0 auto; width: 22px; height: 22px; padding: 0; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0,0,0,.18); }
#buildCard button.rd-swatch.on { box-shadow: 0 0 0 2px #fff, 0 0 0 4px #4a90c8; }
.rd-input { font: inherit; font-size: 13px; padding: 6px 8px; border-radius: 8px; border: 1px solid #d6dde4; background: #fff; min-width: 0; }
.rd-hint { line-height: 1.5; }
.rd-types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 2px 0 6px; }
#buildCard button.rd-type { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 6px 4px 5px; border-radius: 12px; background: rgba(238, 242, 245, 0.8); color: #3b3f4a; line-height: 1.25; }
#buildCard button.rd-type.on { background: #4a90c8; color: #fff; box-shadow: 0 2px 8px rgba(74, 144, 200, 0.35); }
.rd-type-icon { font-size: 20px; }
.rd-type-name { font-size: 13px; font-weight: 700; }
.rd-type-meta { font-size: 10.5px; opacity: 0.75; font-variant-numeric: tabular-nums; }
.rd-type-note { margin: 0 0 6px; line-height: 1.45; }
`;

export function injectStyle() {
  if (document.getElementById('roads-style')) return;
  const s = document.createElement('style');
  s.id = 'roads-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}
