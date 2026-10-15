/* Etendue Bench: 2D meridional ray tracer for an LED + up to three lenses.
   Units: mm, degrees for output angles, lumens, lux. */
(function (root) {
  'use strict';

  const SUN = { lux: 100000, lum: 1.6e9, angDeg: 0.533, penumbraMmPerM: 9.3 };
  const MATERIALS = [
    { id: 'pmma', name: 'PMMA acrylic (n 1.49)', n: 1.49 },
    { id: 'bk7', name: 'BK7 glass (n 1.517)', n: 1.517 },
    { id: 'pc', name: 'Polycarbonate (n 1.585)', n: 1.585 },
    { id: 'sf', name: 'Dense flint glass (n 1.80)', n: 1.8 }
  ];
  const KINDS = [
    { id: 'asphC', name: 'Aspheric plano-convex, curved side to LED' },
    { id: 'asphF', name: 'Aspheric plano-convex, flat side to LED' },
    { id: 'sphC', name: 'Spherical plano-convex, curved side to LED' },
    { id: 'sphF', name: 'Spherical plano-convex, flat side to LED' },
    { id: 'biconvex', name: 'Spherical biconvex' },
    { id: 'concF', name: 'Plano-concave, flat side to LED' },
    { id: 'concC', name: 'Plano-concave, concave side to LED' },
    { id: 'biconcave', name: 'Spherical biconcave' },
    { id: 'ball', name: 'Ball lens (full sphere)' },
    { id: 'fresnelF', name: 'Fresnel, flat side to LED, grooves facing out' },
    { id: 'fresnelC', name: 'Fresnel, grooves facing the LED' },
    { id: 'ideal', name: 'Ideal thin convex lens (no aberration, no loss)' },
    { id: 'idealNeg', name: 'Ideal thin concave lens (no aberration, no loss)' }
  ];
  const NEG = { concF: 1, concC: 1, biconcave: 1, idealNeg: 1 };
  const DOME_MATERIALS = [
    { n: 1.41, name: 'Silicone (n 1.41)' },
    { n: 1.53, name: 'Epoxy (n 1.53)' },
    { n: 1.49, name: 'PMMA (n 1.49)' },
    { n: 1.585, name: 'Polycarbonate (n 1.585)' }
  ];

  const A1 = 0.7548776662466927, A2 = 0.5698402909980532;
  const frac = (x) => x - Math.floor(x);

  function sagFn(c, k, y) {
    const q = 1 - (1 + k) * c * c * y * y;
    return q <= 0 ? NaN : (c * y * y) / (1 + Math.sqrt(q));
  }

  const sgn = (c) => (c < 0 ? -1 : 1);
  const sagAbs = (c, k, y) => (c === 0 ? 0 : sagFn(Math.abs(c), k, y));

  /* Surface curvatures (signed, positive = centre of curvature on the exit side), thickness
     and principal planes for each lens kind. */
  function lensGeom(kind, f, hIn, n, pitchIn, warns, idx) {
    const a = n - 1, EDGE = 1.5, MINC = 1.0, af = Math.max(0.5, Math.abs(f));
    let c1 = 0, c2 = 0, k1 = 0, k2 = 0, h = hIn, fres = 0, t = 0;
    const kk = (kind.startsWith('asph') || kind.startsWith('fresnel')) ? -n * n : 0;
    const pitch = Math.max(0.05, pitchIn || 0.5, hIn / 200);
    if (kind === 'asphC' || kind === 'sphC' || kind === 'fresnelC') { c1 = 1 / (af * a); k1 = kk; }
    else if (kind === 'asphF' || kind === 'sphF' || kind === 'fresnelF') { c2 = -1 / (af * a); k2 = kk; }
    else if (kind === 'concF') c2 = 1 / (af * a);
    else if (kind === 'concC') c1 = -1 / (af * a);
    if (kind === 'fresnelC') fres = 1;
    if (kind === 'fresnelF') fres = 2;
    const limit = () => {
      for (const [c, k] of [[c1, k1], [c2, k2]]) {
        if (c === 0) continue;
        const q = 1 - (1 + k) * c * c * h * h;
        if (q <= 0.0004) {
          h = Math.sqrt(0.96 / ((1 + k) * c * c));
          warns.push('Lens ' + idx + ': diameter is too large for this focal length. The surface would curve past a hemisphere, so the aperture is clipped to ' + (2 * h).toFixed(1) + ' mm.');
        }
      }
    };
    const thick = () => {
      const S1 = fres === 1 ? sagAbs(c1, k1, h) - sagAbs(c1, k1, Math.max(0, h - pitch)) : sagAbs(c1, k1, h);
      const S2 = fres === 2 ? sagAbs(c2, k2, h) - sagAbs(c2, k2, Math.max(0, h - pitch)) : sagAbs(c2, k2, h);
      return Math.max(MINC, EDGE + sgn(c1) * S1 - sgn(c2) * S2);
    };
    if (kind === 'ball') {
      const R = hIn; c1 = 1 / R; c2 = -1 / R; h = 0.99 * R; t = 2 * R;
    } else if (kind === 'biconvex' || kind === 'biconcave') {
      const conv = kind === 'biconvex'; let R = 2 * a * af;
      for (let i = 0; i < 10; i++) {
        c1 = conv ? 1 / R : -1 / R; c2 = -c1;
        const hh = Math.min(h, 0.97 * R); t = Math.max(MINC, EDGE + sgn(c1) * sagAbs(c1, 0, hh) - sgn(c2) * sagAbs(c2, 0, hh));
        const d = conv ? (a * af) * (a * af) - t * a * a * af / n : (a * af) * (a * af) + t * a * a * af / n;
        if (d < 0) { warns.push('Lens ' + idx + ': this focal length is too short for a biconvex lens of this thickness.'); break; }
        R = a * af + Math.sqrt(d);
      }
      limit(); t = thick();
    } else if (kind !== 'ideal' && kind !== 'idealNeg') { limit(); t = thick(); }
    const P1 = a * c1, P2 = -a * c2, P = P1 + P2 - (t / n) * P1 * P2;
    const fEff = Math.abs(P) > 1e-9 ? 1 / P : 1e9;
    return { c1: c1, c2: c2, k1: k1, k2: k2, t: t, h: h, fres: fres, pitch: pitch, fEff: fEff,
             hObj: -fEff * a * t * c2 / n, hPrime: fEff * a * t * c1 / n };
  }

  function profile(c, k, y, fres, pitch) {
    if (c === 0) return 0;
    const s = sagAbs(c, k, y);
    return fres ? s - sagAbs(c, k, Math.floor(Math.abs(y) / pitch) * pitch) : s;
  }

  /* Build the optical surface list from the parameter set. */
  function buildSystem(p) {
    const n = p.n, s = [], polys = [], warns = [], info = [];
    let zBack = 0, hPrime = 0, fPrev = 0, first = true, zLast = 0.5, hLast = Math.max(1, p.ledD / 2), domeOn = false, zMin = 0;
    const dm = p.dome;
    if (dm && dm.on) {
      const Rd = Math.max(0.2, dm.R), H = Math.max(0.1, dm.hr * Rd), zc = H - Rd;
      const base = zc > 0 ? Rd : Math.sqrt(Math.max(1e-6, 2 * Rd * H - H * H));
      const hd = base * 0.9995;
      if (p.ledD / 2 > hd * 0.98) warns.push('The LED emitter is wider than the dome base. Make the dome bigger or the emitter smaller.');
      s.push({ type: 0, dome: true, z: H, c: 1 / Rd, k: 0, sgn: -1, h: hd, n1: dm.n, n2: 1, zc: zc, wallY: base });
      const pts = [[0, -hd]];
      if (zc > 0) pts.push([zc, -base]);
      for (let i = 0; i <= 48; i++) { const y = -hd + 2 * hd * i / 48; pts.push([H - sagFn(1 / Rd, 0, y), y]); }
      if (zc > 0) pts.push([zc, base]);
      pts.push([0, hd]);
      polys.push({ dome: true, loop: pts });
      domeOn = true; zBack = H; zMin = H; zLast = H; hLast = hd;
    }
    let idx = 0;
    for (const L of p.lenses) {
      idx++;
      if (!L.on) { info.push(null); continue; }
      const kind = L.kind, f = L.f;
      let zf, zb, g, h = L.D / 2;
      if (kind === 'ideal' || kind === 'idealNeg') {
        g = { t: 0, hObj: 0, hPrime: 0, fEff: Math.max(0.5, Math.abs(f)) * (kind === 'idealNeg' ? -1 : 1), h: h };
      } else g = lensGeom(kind, f, h, n, L.pitch, warns, idx);
      h = g.h;
      const ref = first ? 0 : zBack;
      let autoZf = first ? (g.fEff > 0 ? g.fEff - g.hObj : 10) : zBack - hPrime + fPrev + g.fEff - g.hObj;
      const autoGap = autoZf - ref;
      zf = L.free ? ref + Math.max(0, L.gap || 0) : autoZf + (L.trim || 0);
      if (zf < zBack + 0.2) {
        warns.push(first ? 'Lens 1 would touch the LED' + (domeOn ? ' dome' : '') + ' at this position. It was moved to 0.2 mm clear of it.'
                         : 'Lens ' + idx + ' overlaps the previous lens. It was moved to touch it.');
        zf = zBack + 0.2;
      }
      if (kind === 'ideal' || kind === 'idealNeg') {
        zb = zf; s.push({ type: 1, z: zf, f: g.fEff, h: h });
        polys.push({ ideal: true, z: zf, h: h, neg: kind === 'idealNeg', num: idx });
      } else {
        zb = zf + g.t;
        const fr = g.fres;
        s.push({ type: fr === 1 ? 2 : 0, z: zf, c: Math.abs(g.c1), k: g.k1, sgn: sgn(g.c1), h: h, n1: 1, n2: n, pitch: g.pitch });
        s.push({ type: fr === 2 ? 2 : 0, z: zb, c: Math.abs(g.c2), k: g.k2, sgn: sgn(g.c2), h: h, n1: n, n2: 1, pitch: g.pitch });
        const pts = [], M = 48;
        const zF = (y) => zf + sgn(g.c1) * profile(g.c1, g.k1, y, fr === 1, g.pitch);
        const zB = (y) => zb + sgn(g.c2) * profile(g.c2, g.k2, y, fr === 2, g.pitch);
        if (fr) {
          const K = Math.ceil(h / g.pitch), side = [];
          for (let kf = 0; kf < K; kf++) { const ya = kf * g.pitch, yb = Math.min(h, (kf + 1) * g.pitch - 1e-6); side.push(ya, yb); }
          for (let i = side.length - 1; i >= 0; i--) { const y = -side[i]; pts.push([zF(y), y, zB(y)]); }
          for (let i = 0; i < side.length; i++) { const y = side[i]; pts.push([zF(y), y, zB(y)]); }
        } else {
          for (let i = 0; i <= M; i++) { const y = -h + 2 * h * i / M; pts.push([zF(y), y, zB(y)]); }
        }
        polys.push({ ideal: false, pts: pts, zf: zf, zb: zb, h: h, num: idx });
      }
      info.push({ f: g.fEff, t: g.t, zf: zf, zb: zb, autoGap: autoGap, gap: zf - ref });
      zBack = zb; hPrime = g.hPrime; fPrev = g.fEff; first = false; zLast = zb; hLast = h;
    }
    return { s: s, polys: polys, warns: warns, info: info, domeOn: domeOn, zLast: zLast, hLast: hLast, wallZ: zLast + p.wall };
  }

  /* Trace one ray. Writes result into R. path (optional) receives z,y pairs.
     R.wd is the weight after the dome (1 when there is no dome). */
  function traceRay(sys, y0, sinT, R, path) {
    let z = 0, y = y0, dz = Math.sqrt(1 - sinT * sinT), dy = sinT, w = 1;
    if (path) path.push(z, y);
    R.fail = 0; R.wd = sys.domeOn ? 0 : 1;
    for (let j = 0; j < sys.s.length; j++) {
      const S = sys.s[j];
      if (S.type === 1) {
        const t = (S.z - z) / dz; z = S.z; y += dy * t;
        if (path) path.push(z, y);
        if (Math.abs(y) > S.h) { R.fail = 1; R.w = 0; return R; }
        const m = dy / dz - y / S.f, inv = 1 / Math.sqrt(1 + m * m);
        dz = inv; dy = m * inv;
        continue;
      }
      if (S.dome && S.zc > 0 && dy !== 0) {
        const yw = dy > 0 ? S.wallY : -S.wallY, tw = (yw - y) / dy;
        if (tw > 0 && z + dz * tw < S.zc) {
          z += dz * tw; y = yw; if (path) path.push(z, y);
          R.fail = 1; R.w = 0; return R;
        }
      }
      let t = (S.z - z) / dz, sl = 0, ok = true, sk = 0;
      const passes = S.type === 2 ? 4 : 1;
      for (let pass = 0; pass < passes; pass++) {
        if (S.type === 2) sk = sagFn(S.c, S.k, Math.floor(Math.abs(y + dy * t) / S.pitch) * S.pitch);
        t = (S.z - z) / dz;
        for (let it = 0; it < 10; it++) {
          const yy = y + dy * t;
          const q = 1 - (1 + S.k) * S.c * S.c * yy * yy;
          if (q <= 0) { ok = false; break; }
          const rq = Math.sqrt(q);
          const sg = S.sgn * (S.c * yy * yy / (1 + rq) - sk);
          sl = S.sgn * S.c * yy / rq;
          const F = z + dz * t - S.z - sg;
          const dt = F / (dz - sl * dy);
          t -= dt;
          if (Math.abs(dt) < 1e-9) break;
        }
        if (!ok || S.type !== 2) break;
        const yn = y + dy * t;
        if (sagFn(S.c, S.k, Math.floor(Math.abs(yn) / S.pitch) * S.pitch) === sk) break;
      }
      if (!ok || !(t > 0)) { R.fail = 1; R.w = 0; return R; }
      const dzIn = dz, dyIn = dy;
      z += dz * t; y += dy * t;
      if (path) path.push(z, y);
      if (Math.abs(y) > S.h) { R.fail = 1; R.w = 0; return R; }
      if (S.type === 2) {
        const yk = Math.floor(Math.abs(y) / S.pitch) * S.pitch;
        const step = sagFn(S.c, S.k, yk + S.pitch) - sagFn(S.c, S.k, yk);
        w *= Math.max(0.2, 1 - step * Math.abs(dyIn / dzIn) / S.pitch);
      }
      let nz = 1, ny = -sl;
      const nn = Math.sqrt(nz * nz + ny * ny); nz /= nn; ny /= nn;
      let cosi = -(dz * nz + dy * ny);
      if (cosi < 0) { nz = -nz; ny = -ny; cosi = -cosi; }
      const eta = S.n1 / S.n2;
      const s2 = eta * eta * (1 - cosi * cosi);
      if (s2 >= 1) { R.fail = 2; R.w = 0; return R; }
      const cost = Math.sqrt(1 - s2);
      const rs = (S.n1 * cosi - S.n2 * cost) / (S.n1 * cosi + S.n2 * cost);
      const rp = (S.n1 * cost - S.n2 * cosi) / (S.n1 * cost + S.n2 * cosi);
      w *= 1 - 0.5 * (rs * rs + rp * rp);
      const g = eta * cosi - cost;
      dz = eta * dz + g * nz; dy = eta * dy + g * ny;
      const dn = Math.sqrt(dz * dz + dy * dy); dz /= dn; dy /= dn;
      if (dz <= 0.0005) { R.fail = 3; R.w = 0; return R; }
      if (S.dome) R.wd = w;
    }
    R.w = w; R.y = y; R.ang = Math.atan2(dy, dz); R.z = z;
    return R;
  }

  function wquant(vals, wts, idx, q) {
    let tot = 0;
    for (let i = 0; i < idx.length; i++) tot += wts[idx[i]];
    if (tot <= 0) return 0;
    let acc = 0; const target = q * tot;
    for (let i = 0; i < idx.length; i++) {
      acc += wts[idx[i]];
      if (acc >= target) return vals[idx[i]];
    }
    return vals[idx[idx.length - 1]];
  }

  function analyze(p, N) {
    const sys = buildSystem(p);
    const R = { fail: 0, w: 0, y: 0, ang: 0, z: 0, wd: 1 };
    const ez = new Float64Array(N), wdA = new Float64Array(N);
    const ys = new Float64Array(N), as = new Float64Array(N), ws = new Float64Array(N), w3 = new Float64Array(N), geo = new Uint8Array(N);
    let sW2 = 0, sW3 = 0, sG3 = 0, sG2 = 0, D2 = 0, D3 = 0;
    const passed = [];
    for (let i = 0; i < N; i++) {
      const u = frac(0.5 + i * A1), v = frac(0.5 + i * A2);
      const y0 = (u - 0.5) * p.ledD, sinT = 2 * v - 1;
      w3[i] = 2 * Math.abs(sinT);
      traceRay(sys, y0, sinT, R, null);
      wdA[i] = R.wd; D2 += R.wd; D3 += R.wd * w3[i];
      if (R.fail === 0) {
        ys[i] = R.y; as[i] = R.ang; ws[i] = R.w; geo[i] = 1; ez[i] = R.z;
        sW2 += R.w; sW3 += R.w * w3[i]; sG3 += R.wd * w3[i]; sG2 += R.wd;
        passed.push(i);
      }
    }
    if (D2 <= 0) D2 = 1e-12; if (D3 <= 0) D3 = 1e-12;
    const out = { sys: sys, N: N, eta2: sW2 / D2, eta3: sW3 / D3, geo2: sG2 / D2, geo3: sG3 / D3, passed: passed.length };
    const Aled = Math.PI * p.ledD * p.ledD / 4 * (sys.domeOn ? p.dome.n * p.dome.n : 1);
    out.Aled = Aled;
    out.Lled = p.flux / (Math.PI * Aled) * 1e6;
    out.tau = sG2 > 0 ? sW2 / sG2 : 0;
    if (!passed.length || sW3 <= 0) { out.empty = true; return out; }

    // flux weights for 3D estimate and 2D
    const wf3 = new Float64Array(N);
    for (const i of passed) wf3[i] = ws[i] * w3[i];
    const absAng = new Float64Array(N), absY = new Float64Array(N);
    for (const i of passed) { absAng[i] = Math.abs(as[i]); absY[i] = Math.abs(ys[i]); }
    const byAng = passed.slice().sort((a, b) => absAng[a] - absAng[b]);
    const byY = passed.slice().sort((a, b) => absY[a] - absY[b]);
    const D = 180 / Math.PI;
    out.th50 = wquant(absAng, wf3, byAng, 0.5) * D;
    out.th90 = wquant(absAng, wf3, byAng, 0.9) * D;
    out.th95 = wquant(absAng, wf3, byAng, 0.95) * D;
    out.th99 = wquant(absAng, wf3, byAng, 0.99) * D;
    const Hw = Math.max(0.05, wquant(absY, ws, byY, 0.995));
    out.Hw = Hw;

    // irradiance
    const r0 = Math.max(0.15 * Hw, 1e-3);
    let fc = 0;
    for (const i of passed) if (absY[i] < r0) fc += wf3[i];
    out.Ecenter = p.flux * (fc / D3) / (Math.PI * r0 * r0) * 1e6;
    out.Emean = p.flux * out.eta3 / (Math.PI * Hw * Hw) * 1e6;

    // profiles right after the last lens and on the wall (fraction of LED flux per mm, 2D slice)
    const yw = new Float64Array(N), absYw = new Float64Array(N);
    for (const i of passed) { yw[i] = ys[i] + Math.tan(as[i]) * (sys.wallZ - ez[i]); absYw[i] = Math.abs(yw[i]); }
    const byYw = passed.slice().sort((a, b) => absYw[a] - absYw[b]);
    const Hww = Math.max(0.05, wquant(absYw, ws, byYw, 0.995));
    const RE = Math.max(Hw * 1.1, 0.3), RW = Math.max(Hww * 1.15, 0.3);
    const B = 64, bwE = 2 * RE / B, bwW = 2 * RW / B;
    const hE = new Float64Array(B), hW = new Float64Array(B);
    for (const i of passed) {
      const be = Math.floor((ys[i] + RE) / bwE), bw = Math.floor((yw[i] + RW) / bwW);
      if (be >= 0 && be < B) hE[be] += ws[i];
      if (bw >= 0 && bw < B) hW[bw] += ws[i];
    }
    for (let b = 0; b < B; b++) { hE[b] /= D2 * bwE; hW[b] /= D2 * bwW; }
    out.prof = { B: B, RE: RE, RW: RW, exit: hE, wall: hW, Hw: Hw, HwWall: Hww };

    // flatness over the central 80 % of the beam
    let sm = 0, sq = 0, cnt = 0;
    for (let b = 0; b < B; b++) {
      const yc = -RE + (b + 0.5) * bwE;
      if (Math.abs(yc) < 0.8 * Hw) { sm += hE[b]; sq += hE[b] * hE[b]; cnt++; }
    }
    if (cnt > 4) { const m = sm / cnt; out.flatCV = Math.sqrt(Math.max(0, sq / cnt - m * m)) / Math.max(1e-12, m); } else out.flatCV = NaN;

    // apparent source seen from the middle of the last lens
    let cen = passed.filter((i) => absY[i] < 0.12 * Hw);
    if (cen.length < 60) cen = passed;
    const aVal = new Float64Array(N);
    for (const i of cen) aVal[i] = as[i] * D;
    const byA = cen.slice().sort((a, b) => aVal[a] - aVal[b]);
    const aLo = wquant(aVal, ws, byA, 0.005), aHi = wquant(aVal, ws, byA, 0.995);
    out.appW = Math.max(1e-4, aHi - aLo);
    out.appC = 0.5 * (aHi + aLo);
    const range = Math.max(0.6, 1.5 * out.appW / 2 + Math.abs(out.appC));
    const AB = 60, abw = 2 * range / AB, ah = new Float64Array(AB);
    let aTot = 0;
    for (const i of cen) { const b = Math.floor((aVal[i] + range) / abw); if (b >= 0 && b < AB) { ah[b] += ws[i]; aTot += ws[i]; } }
    for (let b = 0; b < AB; b++) ah[b] = aTot > 0 ? ah[b] / aTot / abw : 0;
    out.app = { range: range, AB: AB, h: ah };
    out.penumbra = Math.tan(out.appW / D) * 1000;

    // etendue (mm^2 sr)
    out.Gled = Math.PI * Aled;
    out.Gcap = out.Gled * out.geo3;
    out.Gout = Math.PI * Hw * Hw * Math.PI * Math.pow(Math.sin(out.th95 / D), 2);
    out.Gratio = out.Gcap > 0 ? out.Gout / (0.95 * out.Gcap) : NaN;
    out.Elimit = out.Lled * Math.PI * Math.pow(Math.sin(out.th95 / D), 2);
    out.beamFull = 2 * out.th95;
    return out;
  }

  /* Rays for drawing: a fixed bundle from 5 points on the LED. */
  function rayPaths(p, perPoint) {
    const sys = buildSystem(p), R = { fail: 0, w: 0, y: 0, ang: 0, z: 0 };
    const res = [], pts = [-0.5, -0.25, 0, 0.25, 0.5];
    for (let a = 0; a < pts.length; a++) {
      for (let j = 0; j < perPoint; j++) {
        const sinT = -1 + 2 * (j + 0.5) / perPoint, y0 = pts[a] * p.ledD, path = [];
        traceRay(sys, y0, sinT, R, path);
        if (R.fail === 0) {
          path.push(sys.wallZ, R.y + Math.tan(R.ang) * (sys.wallZ - R.z));
        }
        res.push({ path: path, ok: R.fail === 0, fail: R.fail, led: a, w: R.w });
      }
    }
    return { sys: sys, rays: res };
  }

  function sweep(p, which, xs, N) {
    const q = JSON.parse(JSON.stringify(p)), out = [];
    for (const x of xs) {
      if (which === 'f') q.lenses[0].f = x;
      else if (which === 'D') q.lenses[0].D = x;
      else q.ledD = x;
      const r = analyze(q, N);
      out.push({ x: x, eta: r.empty ? 0 : r.eta3 * 100, ang: r.empty ? NaN : r.beamFull, Ec: r.empty ? 0 : r.Ecenter, pen: r.empty ? NaN : r.penumbra });
    }
    return out;
  }

  const api = { SUN, MATERIALS, DOME_MATERIALS, NEG, KINDS, buildSystem, traceRay, analyze, rayPaths, sweep };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
