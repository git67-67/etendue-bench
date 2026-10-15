(function () {
  'use strict';
  const E = window.Engine, SUN = E.SUN, D2R = Math.PI / 180;
  const $ = (s, r) => (r || document).querySelector(s);

  /* ---------- state ---------- */
  const lens = (on, kind, f, D) => ({ on: on, kind: kind, f: f, D: D, trim: 0, pitch: 0.5, free: false, gap: 30 });
  const DOME0 = { on: false, R: 5, hr: 1, n: 1.41 };
  const state = {
    n: 1.49, ledD: 3, flux: 1000, wall: 800, target: SUN.angDeg, dome: Object.assign({}, DOME0), colorMode: 'led', sweep: 'f',
    lenses: [lens(true, 'asphC', 35, 50), lens(false, 'asphF', 20, 34), lens(false, 'asphC', 80, 124)]
  };
  const PRESETS = [
    { name: 'Flashlight', set: { ledD: 3, flux: 1000, wall: 800, l: [[1, 'asphC', 35, 50], [0], [0]] } },
    { name: 'Sun-like beam', set: { ledD: 3, flux: 1000, wall: 1500, l: [[1, 'asphC', 322, 80], [0], [0]] } },
    { name: 'Plastic Fresnel lens', set: { ledD: 3, flux: 1000, wall: 1500, l: [[1, 'fresnelC', 100, 100, { pitch: 0.5 }], [0], [0]] } },
    { name: 'Domed 5 mm LED', set: { ledD: 0.3, flux: 20, wall: 800, dome: { on: true, R: 2.5, hr: 2.8, n: 1.53 }, l: [[0], [0], [0]] } },
    { name: 'Domed LED + lens', set: { ledD: 1, flux: 300, wall: 800, dome: { on: true, R: 3, hr: 1, n: 1.41 }, l: [[1, 'asphC', 35, 50], [0], [0]] } },
    { name: 'Lens too small', set: { ledD: 3, flux: 1000, wall: 800, l: [[1, 'asphC', 40, 10], [0], [0]] } },
    { name: 'Spherical lens', set: { ledD: 3, flux: 1000, wall: 800, l: [[1, 'sphF', 60, 50], [0], [0]] } },
    { name: 'Biconvex lens', set: { ledD: 3, flux: 1000, wall: 800, l: [[1, 'biconvex', 80, 50], [0], [0]] } },
    { name: 'Ball lens', set: { ledD: 1, flux: 300, wall: 800, l: [[1, 'ball', 1, 10], [0], [0]] } },
    { name: 'Ideal thin lens', set: { ledD: 3, flux: 1000, wall: 800, l: [[1, 'ideal', 35, 50], [0], [0]] } },
    { name: 'Collimate, then expand', set: { ledD: 3, flux: 1000, wall: 1000, l: [[1, 'asphC', 15, 30], [1, 'asphF', 20, 34], [1, 'asphC', 80, 124]] } },
    { name: 'Galilean expander', set: { ledD: 3, flux: 1000, wall: 1000, l: [[1, 'asphC', 15, 30], [1, 'biconcave', 30, 34, { free: true, gap: 10 }], [1, 'asphC', 120, 124]] } }
  ];

  /* ---------- helpers ---------- */
  const sig = (v, n) => (v === 0 || !isFinite(v)) ? 0 : Number(Number(v).toPrecision(n || 3));
  function fmt(v, d) {
    if (!isFinite(v)) return '–';
    const a = Math.abs(v);
    if (a >= 1000) return v.toFixed(0);
    if (a >= 100) return v.toFixed(d == null ? 0 : d);
    if (a >= 10) return v.toFixed(d == null ? 1 : d);
    if (a >= 1) return v.toFixed(d == null ? 2 : d);
    if (a >= 0.01) return v.toFixed(d == null ? 3 : d);
    return v.toPrecision(2);
  }
  function fmtLux(e) {
    if (!isFinite(e)) return ['–', ''];
    if (e >= 1e6) return [fmt(e / 1e6), 'Mlx'];
    if (e >= 1e3) return [fmt(e / 1e3), 'klx'];
    return [fmt(e), 'lx'];
  }
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  const css = () => {
    const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim();
    return { stage: g('--stage'), grid: g('--grid'), ink: g('--ink'), muted: g('--muted'), line: g('--line'), accent: g('--accent'),
      sun: g('--sun'), glass: g('--glass'), led: g('--led'), good: g('--good'), warn: g('--warn'), lost: g('--lost'), lost2: g('--lost2'),
      panel2: g('--panel2'), r: [g('--r0'), g('--r1'), g('--r2'), g('--r3'), g('--r4')], mono: g('--font-mono') || 'monospace' };
  };
  function prep(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, W: w, H: h };
  }

  /* ---------- controls ---------- */
  const syncers = [];
  function control(parent, o) {
    const id = 'c' + Math.random().toString(36).slice(2, 8);
    const box = document.createElement('div'); box.className = 'ctl';
    box.innerHTML = '<label for="' + id + 'n"><span>' + o.label + '</span></label><div class="ctl-row"><input type="range" id="' + id + 'r" min="0" max="1000" step="1" aria-label="' + o.label + '"><input type="number" id="' + id + 'n" step="any"><span class="unit">' + (o.unit || '') + '</span></div>';
    parent.appendChild(box);
    const r = $('input[type=range]', box), nIn = $('input[type=number]', box);
    const lmin = Math.log(o.min), lmax = Math.log(o.max);
    const toT = (v) => o.log ? 1000 * (Math.log(Math.min(o.max, Math.max(o.min, v))) - lmin) / (lmax - lmin) : 1000 * (v - o.min) / (o.max - o.min);
    const fromT = (t) => o.log ? Math.exp(lmin + (t / 1000) * (lmax - lmin)) : o.min + (t / 1000) * (o.max - o.min);
    r.addEventListener('input', () => { const v = sig(fromT(+r.value), 3); o.set(v); nIn.value = v; schedule(); });
    nIn.addEventListener('change', () => { let v = parseFloat(nIn.value); if (!isFinite(v)) v = o.get(); v = Math.min(o.hardMax || o.max * 2, Math.max(o.hardMin || o.min / 2, v)); o.set(v); sync(); schedule(); });
    function sync() { const v = o.get(); r.value = toT(v); nIn.value = sig(v, 4); }
    syncers.push(sync); sync();
    return box;
  }

  const lensUI = [];
  function lensCard(host, idx) {
    const L = state.lenses[idx];
    host.innerHTML = '<div class="lens-head"><h2>Lens ' + (idx + 1) + '</h2><label><input type="checkbox" id="lon' + idx + '"> Use this lens</label></div><div class="lens-body"></div>';
    const body = $('.lens-body', host);
    const sel = document.createElement('select'); sel.setAttribute('aria-label', 'Lens ' + (idx + 1) + ' type');
    E.KINDS.forEach((k) => { const o = document.createElement('option'); o.value = k.id; o.textContent = k.name; sel.appendChild(o); });
    body.appendChild(sel);
    const fBox = control(body, { label: 'Focal length f', unit: 'mm', min: 2, max: 600, log: true, hardMin: 0.5, hardMax: 5000, get: () => L.f, set: (v) => { L.f = v; } });
    const dBox = control(body, { label: 'Diameter Ø', unit: 'mm', min: 2, max: 250, log: true, hardMin: 0.5, hardMax: 1000, get: () => L.D, set: (v) => { L.D = v; } });
    const pBox = control(body, { label: 'Groove pitch', unit: 'mm', min: 0.1, max: 3, log: true, hardMin: 0.05, hardMax: 10, get: () => L.pitch, set: (v) => { L.pitch = v; } });
    const tBox = control(body, { label: 'Position trim', unit: 'mm', min: -100, max: 100, hardMin: -2000, hardMax: 2000, get: () => L.trim, set: (v) => { L.trim = v; } });
    const gBox = control(body, { label: idx === 0 ? 'Distance from LED chip to lens' : 'Gap behind previous lens', unit: 'mm', min: 0.2, max: 1000, log: true, hardMin: 0, hardMax: 20000, get: () => L.gap, set: (v) => { L.gap = v; } });
    const fr = document.createElement('label'); fr.className = 'chk';
    fr.innerHTML = '<input type="checkbox"> Free position (override automatic spacing)';
    body.insertBefore(fr, tBox);
    const info = document.createElement('p'); info.className = 'hint mono lens-info'; body.appendChild(info);
    const note = document.createElement('p'); note.className = 'hint';
    note.textContent = idx === 0 ? 'Automatic: the LED sits in the focal point. Trim shifts the lens from there.' : 'Automatic: spaced so this lens and the one before form an afocal pair. Trim shifts it from there.';
    body.appendChild(note);
    const cb = $('#lon' + idx, host), frCb = $('input', fr);
    sel.addEventListener('change', () => { L.kind = sel.value; refresh(); schedule(); });
    cb.addEventListener('change', () => { L.on = cb.checked; refresh(); schedule(); });
    frCb.addEventListener('change', () => {
      L.free = frCb.checked;
      if (L.free) { const inf = res && res.sys.info[idx]; L.gap = sig(inf ? inf.gap : L.gap, 4); }
      syncAll(); refresh(); schedule();
    });
    function refresh() {
      body.hidden = !L.on;
      const ball = L.kind === 'ball', fres = L.kind.indexOf('fresnel') === 0, neg = !!E.NEG[L.kind];
      fBox.hidden = ball; pBox.hidden = !fres; tBox.hidden = !!L.free; gBox.hidden = !L.free;
      $('label span', fBox).textContent = neg ? 'Focal length |f| (negative lens)' : 'Focal length f';
      $('label span', dBox).textContent = ball ? 'Ball diameter Ø' : 'Diameter Ø';
      note.hidden = !!L.free;
    }
    syncers.push(() => { sel.value = L.kind; cb.checked = L.on; frCb.checked = !!L.free; refresh(); });
    lensUI.push({ info: info, L: L });
  }
  function renderLensInfo() {
    lensUI.forEach((u, i) => {
      const inf = paths.sys.info[i];
      u.info.textContent = inf ? 'f = ' + fmt(inf.f, 3) + ' mm · centre thickness ' + fmt(inf.t, 2) + ' mm · front at ' + fmt(inf.zf, 4) + ' mm' : '';
    });
  }

  function buildControls() {
    const pr = $('#presets');
    PRESETS.forEach((p) => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = p.name;
      b.addEventListener('click', () => {
        const s = p.set; state.ledD = s.ledD; state.flux = s.flux; state.wall = s.wall; state.n = 1.49;
        state.dome = Object.assign({}, DOME0, s.dome || {});
        s.l.forEach((x, i) => {
          const L = state.lenses[i];
          Object.assign(L, { on: !!x[0], trim: 0, free: false, gap: 30, pitch: 0.5 });
          if (x[0]) { L.kind = x[1]; L.f = x[2]; L.D = x[3]; Object.assign(L, x[4] || {}); }
        });
        syncAll(); schedule(); fit('optics');
      });
      pr.appendChild(b);
    });
    control($('#ledCtl'), { label: 'Emitter diameter', unit: 'mm', min: 0.3, max: 30, log: true, hardMin: 0.05, hardMax: 100, get: () => state.ledD, set: (v) => { state.ledD = v; } });
    control($('#ledCtl'), { label: 'Light output', unit: 'lm', min: 10, max: 20000, log: true, hardMin: 1, hardMax: 200000, get: () => state.flux, set: (v) => { state.flux = v; } });
    const dome = $('#domeBox');
    $('#domeOn').addEventListener('change', (e) => { state.dome.on = e.target.checked; dome.hidden = !state.dome.on; schedule(); fit('optics'); });
    control(dome, { label: 'Dome radius', unit: 'mm', min: 0.5, max: 30, log: true, hardMin: 0.2, hardMax: 100, get: () => state.dome.R, set: (v) => { state.dome.R = v; } });
    control(dome, { label: 'Dome height ÷ radius (1 = hemisphere)', unit: '×', min: 0.2, max: 3, hardMin: 0.1, hardMax: 6, get: () => state.dome.hr, set: (v) => { state.dome.hr = v; } });
    const dsel = document.createElement('select'); dsel.setAttribute('aria-label', 'Dome material');
    E.DOME_MATERIALS.forEach((m) => { const o = document.createElement('option'); o.value = m.n; o.textContent = m.name; dsel.appendChild(o); });
    dsel.addEventListener('change', () => { state.dome.n = parseFloat(dsel.value); schedule(); });
    dome.appendChild(dsel);
    syncers.push(() => { $('#domeOn').checked = state.dome.on; dome.hidden = !state.dome.on; dsel.value = String(state.dome.n); });
    const mat = $('#material');
    E.MATERIALS.forEach((m) => { const o = document.createElement('option'); o.value = m.n; o.textContent = m.name; mat.appendChild(o); });
    mat.addEventListener('change', () => { state.n = parseFloat(mat.value); schedule(); });
    syncers.push(() => { mat.value = String(state.n); });
    lensCard($('#lens1'), 0); lensCard($('#lens2'), 1); lensCard($('#lens3'), 2);
    control($('#wallCtl'), { label: 'Distance behind the last lens', unit: 'mm', min: 50, max: 20000, log: true, hardMin: 10, hardMax: 100000, get: () => state.wall, set: (v) => { state.wall = v; } });
    control($('#assistCtl'), { label: 'Wanted beam angle (full)', unit: '°', min: 0.1, max: 30, log: true, hardMin: 0.02, hardMax: 80, get: () => state.target, set: (v) => { state.target = v; } });
    $('#setF').addEventListener('click', () => {
      const f = (state.ledD / 2) / Math.tan(state.target * D2R / 2);
      state.lenses[0].f = sig(f, 3); syncAll(); schedule(); fit('optics');
    });
    $('#setSun').addEventListener('click', () => { state.target = SUN.angDeg; syncAll(); schedule(); });
    $('#sweepVar').addEventListener('change', (e) => { state.sweep = e.target.value; runSweep(); });
    $('#cmLed').addEventListener('click', () => setColorMode('led'));
    $('#cmFate').addEventListener('click', () => setColorMode('fate'));
    $('#fitOptics').addEventListener('click', () => fit('optics'));
    $('#fitLed').addEventListener('click', () => fit('led'));
    $('#fitWall').addEventListener('click', () => fit('wall'));
  }
  function syncAll() { syncers.forEach((s) => s()); }
  function setColorMode(m) {
    state.colorMode = m;
    $('#cmLed').setAttribute('aria-pressed', m === 'led'); $('#cmFate').setAttribute('aria-pressed', m === 'fate');
    renderStage(); renderLegend();
  }
  const params = () => ({ n: state.n, ledD: state.ledD, flux: state.flux, wall: state.wall, dome: state.dome, lenses: state.lenses });

  /* ---------- run loop ---------- */
  let pending = false, res = null, paths = null, sweepTimer = 0, sweepData = null;
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(run); } }
  function run() {
    pending = false;
    const p = params();
    res = E.analyze(p, 20000);
    paths = E.rayPaths(p, 28);
    renderStage(); renderLegend(); renderWarns(); renderKpis(); renderBudget(); renderApparent(); renderProfiles(); renderAssist(); renderNotes(); renderLedInfo(); renderLensInfo();
    clearTimeout(sweepTimer); sweepTimer = setTimeout(runSweep, 160);
  }

  /* ---------- stage ---------- */
  const view = { cz: 40, cy: 0, s: 5, set: false };
  function fit(mode) {
    const cv = $('#stage'), W = cv.clientWidth, H = cv.clientHeight, sys = paths ? paths.sys : E.buildSystem(params());
    let z0, z1, yh;
    if (mode === 'led') { yh = state.ledD * 1.3; z0 = -state.ledD * 0.8; z1 = z0 + (W / H) * 2 * yh; }
    else if (mode === 'wall') { z0 = -0.03 * sys.wallZ; z1 = sys.wallZ * 1.02; yh = Math.max(sys.hLast * 1.15, 5, (sys.wallZ * 0.04)); }
    else { z0 = -6; z1 = sys.zLast + Math.max(30, sys.zLast * 0.7); yh = Math.max(sys.hLast * 1.2, state.ledD, 5); }
    const s = Math.min(W / (z1 - z0), H / (2 * yh));
    view.s = s; view.cz = (z0 + z1) / 2; view.cy = 0; view.set = true;
    renderStage();
  }
  function stageEvents() {
    const cv = $('#stage');
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const zb = view.cz + (mx - r.width / 2) / view.s, yb = view.cy - (my - r.height / 2) / view.s;
      view.s *= Math.pow(1.0015, -e.deltaY);
      view.s = Math.min(4000, Math.max(0.02, view.s));
      view.cz = zb - (mx - r.width / 2) / view.s; view.cy = yb + (my - r.height / 2) / view.s;
      renderStage();
    }, { passive: false });
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cz: view.cz, cy: view.cy }; cv.setPointerCapture(e.pointerId); cv.classList.add('drag'); });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; view.cz = drag.cz - (e.clientX - drag.x) / view.s; view.cy = drag.cy + (e.clientY - drag.y) / view.s; renderStage(); });
    const end = () => { drag = null; cv.classList.remove('drag'); };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('dblclick', () => fit('optics'));
  }
  function renderStage() {
    if (!paths) return;
    const cv = $('#stage'), { ctx, W, H } = prep(cv), C = css(), sys = paths.sys;
    if (!view.set) { fit('optics'); return; }
    const X = (z) => W / 2 + (z - view.cz) * view.s, Y = (y) => H / 2 - (y - view.cy) * view.s;
    ctx.fillStyle = C.stage; ctx.fillRect(0, 0, W, H);
    // grid
    const step = niceStep(80 / view.s);
    ctx.lineWidth = 1; ctx.strokeStyle = C.grid; ctx.fillStyle = C.muted; ctx.font = '10.5px ' + C.mono; ctx.textBaseline = 'alphabetic';
    const zA = view.cz - W / 2 / view.s, zB = view.cz + W / 2 / view.s, yA = view.cy - H / 2 / view.s, yB = view.cy + H / 2 / view.s;
    ctx.beginPath();
    for (let z = Math.ceil(zA / step) * step; z <= zB; z += step) { const x = Math.round(X(z)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = Math.ceil(yA / step) * step; y <= yB; y += step) { const yy = Math.round(Y(y)) + 0.5; ctx.moveTo(0, yy); ctx.lineTo(W, yy); }
    ctx.stroke();
    ctx.textAlign = 'left';
    for (let z = Math.ceil(zA / step) * step; z <= zB; z += step) ctx.fillText(fmt(z, 4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + (Math.abs(z) < 1e-9 ? ' mm' : ''), X(z) + 3, H - 5);
    for (let y = Math.ceil(yA / step) * step; y <= yB; y += step) if (Math.abs(y) > 1e-9) ctx.fillText(fmt(y, 4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''), 4, Y(y) - 3);
    // axis
    ctx.setLineDash([6, 5]); ctx.strokeStyle = C.muted; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    // wall
    const xw = X(sys.wallZ);
    if (xw > -5 && xw < W + 5) {
      ctx.strokeStyle = C.muted; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xw, 0); ctx.lineTo(xw, H); ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText('wall', xw - 6, 14);
    }
    // rays
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); ctx.lineWidth = 1;
    const groups = {};
    paths.rays.forEach((r) => {
      let col, al;
      if (state.colorMode === 'led') { col = C.r[r.led]; al = r.ok ? 0.55 : 0.28; }
      else { col = r.ok ? C.led : (r.fail === 2 ? C.lost2 : C.lost); al = r.ok ? 0.5 : 0.6; }
      const key = col + '|' + al;
      (groups[key] = groups[key] || { col: col, al: al, list: [] }).list.push(r);
    });
    Object.keys(groups).forEach((k) => {
      const g = groups[k]; ctx.strokeStyle = g.col; ctx.globalAlpha = g.al; ctx.beginPath();
      g.list.forEach((r) => { const p = r.path; ctx.moveTo(X(p[0]), Y(p[1])); for (let i = 2; i < p.length; i += 2) ctx.lineTo(X(p[i]), Y(p[i + 1])); });
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    paths.rays.forEach((r) => {
      if (r.ok) return; const p = r.path, x = X(p[p.length - 2]), y = Y(p[p.length - 1]);
      ctx.strokeStyle = r.fail === 2 ? C.lost2 : C.lost; ctx.beginPath(); ctx.moveTo(x - 2.5, y - 2.5); ctx.lineTo(x + 2.5, y + 2.5); ctx.moveTo(x + 2.5, y - 2.5); ctx.lineTo(x - 2.5, y + 2.5); ctx.stroke();
    });
    ctx.restore();
    // lenses and dome
    sys.polys.forEach((P) => {
      if (P.dome) {
        ctx.beginPath(); P.loop.forEach((q, j) => { const x = X(q[0]), y = Y(q[1]); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath();
        ctx.globalAlpha = 0.16; ctx.fillStyle = C.glass; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = C.glass; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
        return;
      }
      if (P.ideal) {
        const x = X(P.z); ctx.strokeStyle = C.glass; ctx.fillStyle = C.glass; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, Y(-P.h)); ctx.lineTo(x, Y(P.h)); ctx.stroke(); ctx.lineWidth = 1;
        [1, -1].forEach((sg) => {
          const yy = Y(sg * P.h), d = -sg * 9; ctx.beginPath();
          if (P.neg) { ctx.moveTo(x - 5, yy); ctx.lineTo(x + 5, yy); ctx.lineTo(x, yy - d); }
          else { ctx.moveTo(x, yy); ctx.lineTo(x - 5, yy - d); ctx.lineTo(x + 5, yy - d); }
          ctx.closePath(); ctx.fill();
        });
        ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.fillText('L' + P.num, x, Y(P.h) - 12);
        return;
      }
      ctx.beginPath();
      P.pts.forEach((q, j) => { const x = X(q[0]), y = Y(q[1]); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      for (let j = P.pts.length - 1; j >= 0; j--) ctx.lineTo(X(P.pts[j][2]), Y(P.pts[j][1]));
      ctx.closePath(); ctx.globalAlpha = 0.22; ctx.fillStyle = C.glass; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = C.glass; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.fillText('L' + P.num, X((P.zf + P.zb) / 2), Y(P.h) - 8);
    });
    // LED
    const lw = Math.max(0.5, state.ledD * 0.22), hh = state.ledD / 2;
    ctx.fillStyle = C.panel2; ctx.fillRect(X(-lw * 2.2), Y(Math.max(hh * 1.6, hh + 0.5)), X(-lw) - X(-lw * 2.2), Y(-Math.max(hh * 1.6, hh + 0.5)) - Y(Math.max(hh * 1.6, hh + 0.5)));
    ctx.shadowColor = C.led; ctx.shadowBlur = 10; ctx.fillStyle = C.led;
    ctx.fillRect(X(-lw), Y(hh), Math.max(2, X(0) - X(-lw)), Math.max(2.5, Y(-hh) - Y(hh))); ctx.shadowBlur = 0;
    ctx.fillStyle = C.ink; ctx.textAlign = 'right'; ctx.fillText('LED Ø' + fmt(state.ledD) + ' mm', X(-lw * 2.4), Y(0) - 6);
    // scale bar
    const sb = niceStep(110 / view.s), sx = W - 16 - sb * view.s;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx, H - 22); ctx.lineTo(sx + sb * view.s, H - 22); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.fillText(fmt(sb, 3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + ' mm', sx + sb * view.s / 2, H - 28);
  }
  function renderLegend() {
    const C = css(), lg = $('#legend');
    if (state.colorMode === 'led') {
      lg.innerHTML = ['LED edge (top)', '', 'LED centre', '', 'LED edge (bottom)'].map((t, i) => t ? '<span><i style="background:' + C.r[i] + '"></i>' + t + '</span>' : '').join('') + '<span>Each colour is one point on the LED. A collimator turns each point into a parallel bundle.</span>';
    } else {
      lg.innerHTML = '<span><i style="background:' + C.led + '"></i>Leaves the last lens</span><span><i style="background:' + C.lost + '"></i>Misses a lens (lost)</span><span><i style="background:' + C.lost2 + '"></i>Total internal reflection (lost)</span>';
    }
  }
  function renderWarns() {
    $('#warns').innerHTML = paths.sys.warns.map((w) => '<li>' + w + '</li>').join('');
  }
  function renderLedInfo() {
    const A = Math.PI * state.ledD * state.ledD / 4, d = state.dome.on, nn = d ? state.dome.n * state.dome.n : 1, L = state.flux / (Math.PI * A * nn) * 1e6;
    $('#ledInfo').textContent = 'Chip area ' + fmt(A) + ' mm² · ' + fmt(state.flux / A) + ' lm/mm² · ' + (d ? 'dome luminance ' : 'luminance ') + fmt(L / 1e6) + ' Mcd/m² (sun ' + fmt(SUN.lum / 1e6) + ')' + (d ? '. The dome makes the source look ' + fmt(state.dome.n, 3) + '× wider and ' + fmt(nn, 3) + '× dimmer.' : '');
  }

  /* ---------- readouts ---------- */
  function renderKpis() {
    const k = $('#kpis'), r = res;
    if (r.empty) { k.innerHTML = '<div class="kpi" style="grid-column:1/-1"><div class="k">No light</div><div class="v">0 lm</div><div class="s">No ray gets through this lens set. Check the lens diameter and focal length.</div></div>'; return; }
    const lux = fmtLux(r.Ecenter), mean = fmtLux(r.Emean), ratio = r.Ecenter / SUN.lux;
    const pos = Math.min(1, Math.max(0, (Math.log10(Math.max(ratio, 1e-6)) + 2) / 3)) * 100, sunPos = 2 / 3 * 100;
    const soft = r.appW / SUN.angDeg;
    const cards = [
      ['Light delivered', fmt(r.eta3 * 100, 1) + '<small>%</small>', fmt(state.flux * r.eta3) + ' of ' + fmt(state.flux) + ' lm · 2D slice shows ' + fmt(r.eta2 * 100, 1) + '%'],
      ['Beam centre brightness', lux[0] + '<small>' + lux[1] + '</small>', '= ' + fmt(ratio * 100, 2) + '% of full sunlight · beam average ' + mean[0] + ' ' + mean[1] +
        '<div class="bar" title="log scale, sun marked"><b style="width:' + pos.toFixed(1) + '%"></b><u style="left:' + sunPos.toFixed(1) + '%"></u></div>'],
      ['Source size seen from the beam', fmt(r.appW, 2) + '<small>°</small>', 'Sun is 0.53° · this is ' + (soft >= 1 ? fmt(soft, 2) + '× wider (softer shadows)' : fmt(1 / soft, 2) + '× narrower (harder shadows)')],
      ['Shadow edge blur', fmt(r.penumbra, 2) + '<small>mm per m</small>', 'Sun: ' + SUN.penumbraMmPerM + ' mm per metre between object and surface'],
      ['Beam size and spread', '⌀ ' + fmt(2 * r.Hw, 3) + '<small>mm</small>', 'Full angle ' + fmt(r.beamFull, 2) + '° holds 95% of the light'],
      ['Beam evenness', isFinite(r.flatCV) ? fmt(r.flatCV * 100, 1) + '<small>% ripple</small>' : '–', 'Spread of brightness across the middle 80% of the beam. Lower is flatter.']
    ];
    k.innerHTML = cards.map((c) => '<div class="kpi"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div><div class="s">' + c[2] + '</div></div>').join('');
  }
  function renderBudget() {
    const r = res, el = $('#budget'), C = css();
    if (r.empty) { el.innerHTML = '<p class="hint">No light reaches the output.</p>'; return; }
    const dl = r.eta3, fr = Math.max(0, r.geo3 - r.eta3), ms = Math.max(0, 1 - r.geo3), F = state.flux;
    const needL = SUN.lux / (Math.PI * Math.pow(Math.sin(r.th95 * D2R), 2));
    const e = (v) => fmt(v);
    el.innerHTML =
      '<div class="split" role="img" aria-label="Light budget"><span style="width:' + dl * 100 + '%;background:' + C.accent + '"></span><span style="width:' + fr * 100 + '%;background:' + C.warn + '"></span><span style="width:' + ms * 100 + '%;background:' + C.lost + '"></span></div>' +
      '<dl class="rows">' +
      '<dt><span style="color:' + C.accent + '">■</span> Delivered into the beam</dt><dd>' + e(F * dl) + ' lm</dd>' +
      '<dt><span style="color:' + C.warn + '">■</span> Lost to reflections and groove risers</dt><dd>' + e(F * fr) + ' lm</dd>' +
      '<dt><span style="color:' + C.lost + '">■</span> Never reached the lens</dt><dd>' + e(F * ms) + ' lm</dd>' +
      '</dl><dl class="rows" style="border-top:1px solid var(--line);padding-top:8px">' +
      '<dt>LED luminance</dt><dd>' + e(r.Lled / 1e6) + ' Mcd/m²</dd>' +
      '<dt>Sun luminance</dt><dd>' + e(SUN.lum / 1e6) + ' Mcd/m²</dd>' +
      '<dt>Brightest possible at this beam angle</dt><dd>' + fmtLux(r.Elimit).join(' ') + '</dd>' +
      '<dt>What the optics deliver at the centre</dt><dd>' + fmtLux(r.Ecenter).join(' ') + '</dd>' +
      '<dt>LED luminance needed for 100 klx at this angle</dt><dd>' + e(needL / 1e6) + ' Mcd/m²</dd>' +
      '<dt>Etendue captured from the LED</dt><dd>' + e(r.Gcap) + ' mm²·sr</dd>' +
      '<dt>Etendue of the beam</dt><dd>' + e(r.Gout) + ' mm²·sr</dd>' +
      '<dt>Beam etendue ÷ captured (1.0 is perfect)</dt><dd>' + fmt(r.Gratio, 2) + '</dd></dl>';
  }
  function renderApparent() {
    const cv = $('#appChart'), { ctx, W, H } = prep(cv), C = css(), r = res;
    ctx.clearRect(0, 0, W, H);
    if (r.empty) return;
    const a = r.app, R = a.range, m = { l: 10, r: 10, t: 26, b: 22 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const sunH = 1 / SUN.angDeg, maxV = Math.max(sunH, Math.max.apply(null, a.h)) * 1.1;
    const X = (d) => m.l + (d + R) / (2 * R) * pw, Y = (v) => m.t + ph - v / maxV * ph;
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(m.l, m.t + ph + 0.5); ctx.lineTo(m.l + pw, m.t + ph + 0.5); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.font = '10.5px ' + C.mono; ctx.textAlign = 'center';
    const st = niceStep(R / 2.5);
    for (let d = -Math.floor(R / st) * st; d <= R + 1e-9; d += st) { ctx.fillText(fmt(d, 3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + '°', X(d), H - 6); ctx.beginPath(); ctx.moveTo(X(d), m.t + ph); ctx.lineTo(X(d), m.t + ph + 4); ctx.stroke(); }
    // led
    ctx.beginPath(); ctx.moveTo(X(-R), Y(0));
    for (let b = 0; b < a.AB; b++) { const x0 = X(-R + b * 2 * R / a.AB), x1 = X(-R + (b + 1) * 2 * R / a.AB); ctx.lineTo(x0, Y(a.h[b])); ctx.lineTo(x1, Y(a.h[b])); }
    ctx.lineTo(X(R), Y(0)); ctx.closePath(); ctx.globalAlpha = 0.35; ctx.fillStyle = C.accent; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.stroke();
    // sun
    const hs = SUN.angDeg / 2; ctx.strokeStyle = C.sun; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(X(-hs), Y(0)); ctx.lineTo(X(-hs), Y(sunH)); ctx.lineTo(X(hs), Y(sunH)); ctx.lineTo(X(hs), Y(0)); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    ctx.textAlign = 'left'; ctx.fillStyle = C.accent; ctx.fillText('■ your LED through the lens, ' + fmt(r.appW, 2) + '° wide', m.l, 12);
    ctx.fillStyle = C.sun; ctx.fillText('┄ the sun, 0.53° wide', m.l + 230 > W ? m.l : m.l + 240, m.l + 230 > W ? 24 : 12);
    $('#appText').textContent = 'Both shapes have equal area (the same total light). A narrower shape means a smaller source in the sky, so harder shadows and a sharper glare spot. The lens cannot make the LED look smaller than D÷f.';
  }
  function renderProfiles() {
    const r = res; if (r.empty) return;
    const P = r.prof, maxV = Math.max(Math.max.apply(null, P.exit), Math.max.apply(null, P.wall)) * 1.1 || 1;
    area($('#profExit'), P.exit, P.RE, maxV, P.Hw); area($('#profWall'), P.wall, P.RW, maxV, P.HwWall);
    $('#wallTitle').textContent = 'On the wall, ' + fmt(state.wall, 3) + ' mm away';
    $('#profText').textContent = 'Height is the share of the LED’s light per millimetre, same scale on both. The beam gets wider with distance and its height drops by the same factor: the light is conserved, the irradiance is not. Dashed lines mark the edge that holds 99% of the light.';
  }
  function area(cv, vals, R, maxV, edge) {
    const { ctx, W, H } = prep(cv), C = css(), m = { l: 10, r: 10, t: 10, b: 22 }, pw = W - m.l - m.r, ph = H - m.t - m.b, B = vals.length;
    ctx.clearRect(0, 0, W, H);
    const X = (y) => m.l + (y + R) / (2 * R) * pw, Y = (v) => m.t + ph - v / maxV * ph;
    ctx.strokeStyle = C.line; ctx.fillStyle = C.muted; ctx.font = '10.5px ' + C.mono; ctx.textAlign = 'center';
    ctx.beginPath(); ctx.moveTo(m.l, m.t + ph + 0.5); ctx.lineTo(m.l + pw, m.t + ph + 0.5); ctx.stroke();
    const st = niceStep(R / 2);
    for (let y = -Math.floor(R / st) * st; y <= R + 1e-9; y += st) { ctx.fillText(fmt(y, 3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''), X(y), H - 6); ctx.beginPath(); ctx.moveTo(X(y), m.t + ph); ctx.lineTo(X(y), m.t + ph + 4); ctx.stroke(); }
    ctx.textAlign = 'right'; ctx.fillText('mm', W - 4, H - 6);
    ctx.beginPath(); ctx.moveTo(X(-R), Y(0));
    for (let b = 0; b < B; b++) { const y0 = -R + b * 2 * R / B, y1 = -R + (b + 1) * 2 * R / B; ctx.lineTo(X(y0), Y(vals[b])); ctx.lineTo(X(y1), Y(vals[b])); }
    ctx.lineTo(X(R), Y(0)); ctx.closePath(); ctx.globalAlpha = 0.35; ctx.fillStyle = C.accent; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
    ctx.strokeStyle = C.muted; ctx.setLineDash([4, 4]); [-edge, edge].forEach((e) => { ctx.beginPath(); ctx.moveTo(X(e), m.t); ctx.lineTo(X(e), m.t + ph); ctx.stroke(); }); ctx.setLineDash([]);
  }

  /* ---------- helper + notes ---------- */
  function renderAssist() {
    const t = state.target * D2R / 2, f = (state.ledD / 2) / Math.tan(t), D = state.lenses[0].D;
    const al = Math.atan((D / 2) / f), cap = Math.pow(Math.sin(al), 2);
    const d50 = 2 * f, d80 = 2 * f * Math.tan(Math.asin(Math.sqrt(0.8)));
    $('#assistOut').innerHTML = 'For a ' + fmt(state.target, 2) + '° beam from a ' + fmt(state.ledD) + ' mm LED, the ideal lens needs <b>f ≈ ' + fmt(f) + ' mm</b>. With lens 1 at Ø' + fmt(D) + ' mm it would catch about <b>' + fmt(cap * 100, 1) + '%</b> of the light. Catching 50% takes Ø ≈ ' + fmt(d50) + ' mm, and 80% takes Ø ≈ ' + fmt(d80) + ' mm.';
  }
  function renderNotes() {
    const r = res, ul = $('#notes'); if (r.empty) { ul.innerHTML = ''; return; }
    const items = [];
    const needL = SUN.lux / (Math.PI * Math.pow(Math.sin(r.th95 * D2R), 2));
    items.push('<b>Brightness is set by the LED and the beam angle, not by the lens.</b> The most the optics can do is the LED’s luminance × π × sin²(beam half angle). Here that is ' + fmtLux(r.Elimit).join(' ') + ', and you get ' + fmtLux(r.Ecenter).join(' ') + ' at the centre.');
    items.push('<b>Sunlike hardness costs brightness.</b> A ' + fmt(r.beamFull, 2) + '° beam would need an LED of ' + fmt(needL / 1e6) + ' Mcd/m² to reach 100 klx. Yours is ' + fmt(r.Lled / 1e6) + ' Mcd/m², so the ceiling is ' + fmt(r.Elimit / SUN.lux * 100, 1) + '% of the sun.');
    items.push('<b>A bigger lens gives a bigger beam with the same lux.</b> It catches more of the LED’s light, and spreads that extra light over a proportionally larger area. Use the sweep over lens diameter to see the lux stay flat while the delivered lumens climb.');
    items.push('<b>A longer focal length sharpens the beam and costs light.</b> Doubling f halves the source size seen through the lens (harder shadows) and cuts what a fixed-size lens catches to about a quarter. The lux stays about the same.');
    items.push('<b>More lenses never beat etendue.</b> Each glass surface loses about 4% to reflection, so extra lenses only pay off when one lens cannot collect and shape the light by itself. A short, wide first lens collects more, and a pair expands the beam to cut its angle. Try “Collimate, then expand”.');
    if (state.dome.on) items.push('<b>A dome is a first lens built into the LED.</b> It adds light extraction, but makes the source look ' + fmt(state.dome.n, 3) + '× wider and ' + fmt(state.dome.n * state.dome.n, 3) + '× dimmer to the lens behind it. A bigger apparent source means softer shadows for the same focal length.');
    if (state.lenses.some((L) => L.on && L.kind.indexOf('fresnel') === 0)) items.push('<b>Fresnel lenses are thin and cheap but leaky.</b> Light that hits a groove riser is lost or sent into stray angles. The tool estimates this from the groove height and ray angle, so real lenses can differ.');
    ul.innerHTML = items.map((t) => '<li>' + t + '</li>').join('');
  }

  /* ---------- sweep ---------- */
  function runSweep() {
    const p = params(), w = state.sweep, xs = [], M = 34;
    let lo, hi;
    if (w === 'f') { lo = Math.max(1, state.lenses[0].f / 5); hi = state.lenses[0].f * 5; }
    else if (w === 'D') { lo = Math.max(1, state.lenses[0].D / 5); hi = state.lenses[0].D * 3; }
    else { lo = Math.max(0.2, state.ledD / 4); hi = state.ledD * 4; }
    for (let i = 0; i < M; i++) xs.push(lo * Math.pow(hi / lo, i / (M - 1)));
    sweepData = { w: w, rows: E.sweep(p, w, xs, 3500) };
    renderSweep();
  }
  function renderSweep() {
    if (!sweepData || !res) return;
    const w = sweepData.w, rows = sweepData.rows, xs = rows.map((r) => r.x);
    const cur = w === 'f' ? state.lenses[0].f : w === 'D' ? state.lenses[0].D : state.ledD;
    const xl = w === 'f' ? 'focal length f₁ (mm)' : w === 'D' ? 'lens Ø D₁ (mm)' : 'LED Ø (mm)';
    line($('#swEta'), xs, rows.map((r) => r.eta), { title: 'Light delivered (%)', xl: xl, mark: cur, my: res.empty ? 0 : res.eta3 * 100, ylog: false });
    line($('#swAng'), xs, rows.map((r) => r.ang), { title: 'Beam full angle (°)', xl: xl, mark: cur, my: res.beamFull, ylog: true });
    line($('#swLux'), xs, rows.map((r) => r.Ec), { title: 'Centre brightness (lx)', xl: xl, mark: cur, my: res.Ecenter, ylog: true, ref: SUN.lux, refL: 'sun 100 klx' });
    line($('#swPen'), xs, rows.map((r) => r.pen), { title: 'Shadow edge blur (mm per m)', xl: xl, mark: cur, my: res.penumbra, ylog: true, ref: SUN.penumbraMmPerM, refL: 'sun 9.3' });
  }
  function line(cv, xs, ys, o) {
    const { ctx, W, H } = prep(cv), C = css(), m = { l: 8, r: 8, t: 22, b: 30 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    ctx.clearRect(0, 0, W, H);
    const good = ys.filter((v) => isFinite(v) && (!o.ylog || v > 0));
    ctx.fillStyle = C.muted; ctx.font = '10.5px ' + C.mono; ctx.textAlign = 'left'; ctx.fillText(o.title, m.l, 12);
    if (good.length < 2) { ctx.fillText('no data', m.l, H / 2); return; }
    let lo = Math.min.apply(null, good), hi = Math.max.apply(null, good);
    if (o.ref) { lo = Math.min(lo, o.ref); hi = Math.max(hi, o.ref); }
    if (isFinite(o.my) && o.my > 0) { lo = Math.min(lo, o.my); hi = Math.max(hi, o.my); }
    if (o.ylog) { lo = Math.log10(lo) - 0.08; hi = Math.log10(hi) + 0.08; } else { lo = 0; hi = hi * 1.08; }
    if (hi - lo < 1e-9) hi = lo + 1;
    const tf = (v) => o.ylog ? Math.log10(Math.max(v, 1e-12)) : v;
    const lx0 = Math.log(xs[0]), lx1 = Math.log(xs[xs.length - 1]);
    const X = (x) => m.l + (Math.log(x) - lx0) / (lx1 - lx0) * pw, Y = (v) => m.t + ph - (tf(v) - lo) / (hi - lo) * ph;
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(m.l, m.t + ph + 0.5); ctx.lineTo(m.l + pw, m.t + ph + 0.5); ctx.stroke();
    ctx.textAlign = 'center';
    [xs[0], Math.sqrt(xs[0] * xs[xs.length - 1]), xs[xs.length - 1]].forEach((x, i) => { ctx.textAlign = i === 0 ? 'left' : i === 2 ? 'right' : 'center'; ctx.fillText(fmt(x, 3), X(x) + (i === 0 ? -0 : 0), H - 16); });
    ctx.textAlign = 'center'; ctx.fillText(o.xl, W / 2, H - 4);
    if (o.ref) { ctx.strokeStyle = C.sun; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(m.l, Y(o.ref)); ctx.lineTo(m.l + pw, Y(o.ref)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = C.sun; ctx.textAlign = 'right'; ctx.fillText(o.refL, m.l + pw, Y(o.ref) - 4); }
    ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.beginPath(); let started = false;
    xs.forEach((x, i) => { const v = ys[i]; if (!isFinite(v) || (o.ylog && v <= 0)) { started = false; return; } started ? ctx.lineTo(X(x), Y(v)) : ctx.moveTo(X(x), Y(v)); started = true; });
    ctx.stroke(); ctx.lineWidth = 1;
    // value labels
    ctx.fillStyle = C.muted; ctx.textAlign = 'right';
    const topV = o.ylog ? Math.pow(10, hi) : hi, botV = o.ylog ? Math.pow(10, lo) : 0;
    ctx.fillText(fmt(topV, 2), m.l + pw, m.t + 10); ctx.fillText(fmt(botV, 2), m.l + pw, m.t + ph - 4);
    if (o.mark >= xs[0] && o.mark <= xs[xs.length - 1] && isFinite(o.my) && o.my > 0) {
      ctx.strokeStyle = C.muted; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(o.mark), m.t); ctx.lineTo(X(o.mark), m.t + ph); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.ink; ctx.strokeStyle = C.stage; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(o.mark), Y(o.my), 4.5, 0, 7); ctx.fill(); ctx.stroke(); ctx.lineWidth = 1;
    }
  }

  /* ---------- boot ---------- */
  function boot() {
    buildControls(); stageEvents(); syncAll();
    $('#sweepVar').value = state.sweep;
    schedule();
    window.addEventListener('resize', () => { renderStage(); renderApparent(); renderProfiles(); renderSweep(); });
    if (window.ResizeObserver) new ResizeObserver(() => { renderStage(); }).observe($('#stage'));
    const rerender = () => { renderStage(); renderLegend(); renderBudget(); renderApparent(); renderProfiles(); renderSweep(); };
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rerender);
    new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(rerender);
  }
  boot();
})();
