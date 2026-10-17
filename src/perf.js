// Performance tools. Add ?perf to the URL for a live overlay, ?stress for a
// much larger map used to measure how the renderer copes with big scenes.
export const params = new URLSearchParams(location.search);

export function setupPerf(renderer) {
  const info = renderer.info;
  const stats = { fps: 0, ms: 0, calls: 0, triangles: 0 };
  let frames = 0;
  let acc = 0;
  let last = performance.now();
  let el = null;
  if (params.has('perf')) {
    el = document.createElement('div');
    el.style.cssText =
      'position:fixed;right:10px;bottom:10px;z-index:9;padding:6px 10px;border-radius:10px;' +
      'background:rgba(20,30,40,.72);color:#e8f4ff;font:12px/1.5 ui-monospace,monospace;pointer-events:none;white-space:pre';
    document.body.appendChild(el);
  }

  const gl = renderer.getContext();
  // Render `frames` frames back to back and report the average cost.
  const bench = (render, frames = 30) => {
    render();
    gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) render();
    gl.finish();
    const ms = (performance.now() - t0) / frames;
    return { ms: +ms.toFixed(2), calls: info.render.calls, triangles: info.render.triangles };
  };

  return {
    stats,
    bench,
    // Call once per frame, right after renderer.render().
    frame() {
      const now = performance.now();
      acc += now - last;
      last = now;
      frames++;
      stats.calls = info.render.calls;
      stats.triangles = info.render.triangles;
      if (acc >= 500) {
        stats.fps = Math.round((frames * 1000) / acc);
        stats.ms = +(acc / frames).toFixed(1);
        frames = 0;
        acc = 0;
        if (el) {
          el.textContent =
            `${stats.fps} fps  ${stats.ms} ms\n` +
            `draw calls ${stats.calls}\n` +
            `triangles  ${(stats.triangles / 1000).toFixed(0)}k\n` +
            `geometries ${info.memory.geometries}`;
        }
      }
    },
  };
}
