/* Etendue Bench: ray tracer for a Lambertian LED, optional dome, reflector or TIR optic, and up to three lenses.
   The drawing uses a meridional (2D) trace; every statistic comes from a 3D skew-ray trace of the
   rotationally symmetric system. Units: mm, degrees for angles, lumens, lux. */
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

  /* ---------- reflectors and TIR collimator ---------- */
  const EPS = 1e-6, DEG = Math.PI / 180;
  const PRIMARIES = [
    { id: 'none', name: 'None' },
    { id: 'parab', name: 'Flashlight reflector (parabolic, hole in the middle)' },
    { id: 'cone', name: 'Cone reflector (straight walls)' },
    { id: 'cpc', name: 'Compound parabolic reflector (CPC, etendue-ideal)' },
    { id: 'tir', name: 'TIR collimator (solid optic with total internal reflection)' }
  ];
  const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

  /* Quadric mirror wall: g(z,y) = a11 z^2 + 2 a12 z y + a22 y^2 + 2 b1 z + 2 b2 y + c0 = 0,
     used for z in [zlo, zhi] on the side where y has sign s. */
  function seg(a11, a12, a22, b1, b2, c0, s, zlo, zhi) {
    return { a11: a11, a12: a12, a22: a22, b1: b1, b2: b2, c0: c0, s: s, zlo: zlo, zhi: zhi };
  }
  function segY(g, z, guess) {
    const A = g.a22, B = 2 * (g.a12 * z + g.b2), C = g.a11 * z * z + 2 * g.b1 * z + g.c0;
    if (Math.abs(A) < 1e-12) return -C / B;
    const d = B * B - 4 * A * C; if (d < 0) return NaN;
    const r1 = (-B + Math.sqrt(d)) / (2 * A), r2 = (-B - Math.sqrt(d)) / (2 * A);
    return Math.abs(r1 - guess) < Math.abs(r2 - guess) ? r1 : r2;
  }

  function buildPrimary(p, pr, warns) {
    const rho = clampN(pr.rho == null ? 0.92 : pr.rho, 0.05, 1), M = 60;
    const mirror = (segs, zExit, hExit, info, lines, pz, pr3) => ({
      surf: { type: 3, segs: segs, rho: rho, pz: Float64Array.from(pz), pr: Float64Array.from(pr3) }, polys: lines.map((l) => ({ mirror: true, pts: l })), zExit: zExit, hExit: hExit, info: info
    });

    if (pr.type === 'parab') {
      const fp = Math.max(0.3, pr.fp), k = pr.k == null ? -1 : pr.k, R2 = 2 * fp, c = 1 / R2;
      const rmax = k > -1 ? 0.995 * R2 / Math.sqrt(1 + k) : 1e9;
      const rRim = Math.min(Math.max(0.5, pr.rim / 2), rmax);
      if (pr.rim / 2 > rmax) warns.push('Reflector: this shape closes up at a diameter of ' + (2 * rmax).toFixed(1) + ' mm, so the rim was limited to that.');
      const rHole = Math.min(Math.max(0.05, pr.hole / 2), rRim * 0.95);
      const zv = (pr.fz || 0) - fp;
      const zlo = zv + sagFn(c, k, rHole), zhi = zv + sagFn(c, k, rRim);
      const a11 = 1 + k, b1 = -(1 + k) * zv - R2, c0 = (1 + k) * zv * zv + 2 * R2 * zv;
      const segs = [seg(a11, 0, 1, b1, 0, c0, 1, zlo, zhi), seg(a11, 0, 1, b1, 0, c0, -1, zlo, zhi)];
      const lines = [[], []];
      for (let i = 0; i <= M; i++) {
        const y = rHole + (rRim - rHole) * i / M, z = zv + sagFn(c, k, y);
        lines[0].push([z, y]); lines[1].push([z, -y]);
      }
      let rOpen = rHole;
      if (zlo <= 0) { const zp = -zv, y2 = 2 * R2 * zp - (1 + k) * zp * zp; rOpen = y2 > 0 ? Math.sqrt(y2) : 0; }
      if (p.ledD / 2 > rOpen * 0.98) warns.push('Reflector: the LED is wider than the opening at its base (' + (2 * rOpen).toFixed(1) + ' mm). Make the hole bigger or the LED smaller.');
      if (zhi < 0.5) warns.push('Reflector: the rim is almost level with the LED, so it barely catches any light. Increase the rim diameter or the hole diameter.');
      const pz = [], pr3 = [];
      for (let i = 0; i <= 100; i++) { const y = rHole + (rRim - rHole) * i / 100; pr3.push(y); pz.push(zv + sagFn(c, k, y)); }
      return mirror(segs, zhi, rRim, {
        type: 'parab', zStart: zlo, zRim: zhi, rimD: 2 * rRim, holeD: 2 * rHole, depth: zhi - zlo,
        catchDeg: Math.atan2(rRim, zhi) / DEG, behind: zlo < -0.01
      }, lines, pz, pr3);
    }

    if (pr.type === 'cone') {
      const a = Math.max(0.05, p.ledD / 2), al = clampN(pr.alpha, 0, 70) * DEG, m = Math.tan(al), L = Math.max(1, pr.len);
      const segs = [seg(-m * m, 0, 1, -a * m, 0, -a * a, 1, 0, L), seg(-m * m, 0, 1, -a * m, 0, -a * a, -1, 0, L)];
      const rim = a + m * L;
      return mirror(segs, L, rim, { type: 'cone', rimD: 2 * rim, depth: L, entryD: 2 * a, catchDeg: Math.atan2(rim, L) / DEG },
        [[[0, a], [L, rim]], [[0, -a], [L, -rim]]], [0, L], [a, rim]);
    }

    if (pr.type === 'cpc') {
      const a = Math.max(0.05, p.ledD / 2), th = clampN(pr.theta, 1, 70) * DEG, sT = Math.sin(th), cT = Math.cos(th), tT = Math.tan(th);
      const ap = a / sT, Lfull = (a + ap) / tT, Lt = Lfull * clampN(pr.lenFrac == null ? 1 : pr.lenFrac, 0.1, 1), pf = a * (1 + sT);
      const wall = (s) => {
        const Fz = 0, Fy = -s * a, uz = cT, uy = -s * sT;
        const A11 = 1 - uz * uz, A12 = -uz * uy, A22 = 1 - uy * uy;
        const b1 = -(A11 * Fz + A12 * Fy) - 2 * pf * uz, b2 = -(A12 * Fz + A22 * Fy) - 2 * pf * uy;
        const c0 = A11 * Fz * Fz + 2 * A12 * Fz * Fy + A22 * Fy * Fy + 4 * pf * (uz * Fz + uy * Fy) - 4 * pf * pf;
        return seg(A11, A12, A22, b1, b2, c0, s, 0, Lt);
      };
      const w1 = wall(1), w2 = wall(-1), lines = [[], []];
      for (let i = 0; i <= M; i++) {
        const z = Lt * i / M;
        lines[0].push([z, segY(w1, z, a + z * tT)]); lines[1].push([z, segY(w2, z, -(a + z * tT))]);
      }
      const rim = lines[0][M][1], pz = [], pr3 = [];
      for (let i = 0; i <= 100; i++) { const z = Lt * i / 100; pz.push(z); pr3.push(segY(w1, z, a + z * tT)); }
      return mirror([w1, w2], Lt, rim, {
        type: 'cpc', rimD: 2 * rim, depth: Lt, fullLen: Lfull, entryD: 2 * a, thetaDeg: th / DEG, truncated: Lt < Lfull * 0.999,
        catchDeg: Math.atan2(rim, Lt) / DEG
      }, lines, pz, pr3);
    }

    if (pr.type === 'tir') {
      const n = p.n, rc = Math.max(p.ledD / 2 * 1.05, pr.rc), hc = Math.max(0.5, pr.hc);
      const cc = 1 / ((n - 1) * hc), kk = -n * n;
      const zEdge = hc + sagFn(cc, kk, rc), thC = Math.atan2(rc, zEdge), rb = Math.max(rc + 0.2, pr.rb);
      const fS = (th, sv) => {
        const sn = Math.sin(th), cs = Math.cos(th), dz = cs / n, dy = Math.sqrt(1 - dz * dz);
        const ddz = -sn / n, ddy = cs * sn / (n * n * dy);
        let nz = dz - 1, ny = dy; const nl = Math.hypot(nz, ny); nz /= nl; ny /= nl;
        const num = (-rc / (sn * sn)) * nz + sv * (ddz * nz + ddy * ny), den = dz * nz + dy * ny;
        return -num / den;
      };
      const K = 90, WZ = new Float64Array(K + 1), WY = new Float64Array(K + 1);
      let th = Math.PI / 2 - 1e-4, sv = rb - rc; const h = (thC - th) / K;
      const put = (i) => { const dz = Math.cos(th) / n, dy = Math.sqrt(1 - dz * dz); WZ[i] = rc / Math.tan(th) + sv * dz; WY[i] = rc + sv * dy; };
      put(0);
      for (let i = 0; i < K; i++) {
        const k1 = fS(th, sv), k2 = fS(th + h / 2, sv + h / 2 * k1), k3 = fS(th + h / 2, sv + h / 2 * k2), k4 = fS(th + h, sv + h * k3);
        sv += h / 6 * (k1 + 2 * k2 + 2 * k3 + k4); th += h; put(i + 1);
      }
      let bad = !isFinite(WZ[K]) || !isFinite(WY[K]);
      for (let i = 1; i <= K && !bad; i++) if (!(WZ[i] > WZ[i - 1] - 1e-9) || !(sv > 0)) bad = true;
      if (bad) { warns.push('TIR collimator: the outer wall folds back with these settings. Try a smaller cavity height or a larger base radius.'); return null; }
      const zt = WZ[K], Rt = WY[K];
      const loop = [];
      for (let i = K; i >= 0; i--) loop.push([WZ[i], WY[i]]);
      loop.push([0, rc], [zEdge, rc]);
      for (let i = 0; i <= 40; i++) { const y = rc - 2 * rc * i / 40; loop.push([hc + sagFn(cc, kk, Math.abs(y)), y]); }
      loop.push([zEdge, -rc], [0, -rc]);
      for (let i = 0; i <= K; i++) loop.push([WZ[i], -WY[i]]);
      return {
        surf: { type: 4, n: n, rc: rc, zEdge: zEdge, top: { z: hc, a11: 1 - n * n, R: (n - 1) * hc }, WZ: WZ, WY: WY, K: K, zt: zt, Rt: Rt },
        polys: [{ solid: true, loop: loop }], zExit: zt, hExit: Rt,
        info: { type: 'tir', rimD: 2 * Rt, depth: zt, lensDeg: thC / DEG, cavityD: 2 * rc, cavityH: hc, baseD: 2 * rb }
      };
    }
    return null;
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
    let primary = false, primInfo = null;
    if (p.prim && p.prim.type && p.prim.type !== 'none') {
      const el = buildPrimary(p, p.prim, warns);
      if (el) {
        s.push(el.surf); el.polys.forEach((q) => polys.push(q));
        zBack = Math.max(zBack, el.zExit); zLast = el.zExit; hLast = el.hExit; primary = true; primInfo = el.info;
      }
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
      const ref = (first && !primary) ? 0 : zBack;
      let autoZf = first ? (primary ? zBack + 1 : (g.fEff > 0 ? g.fEff - g.hObj : 10)) : zBack - hPrime + fPrev + g.fEff - g.hObj;
      const autoGap = autoZf - ref;
      zf = L.free ? ref + Math.max(0, L.gap || 0) : autoZf + (L.trim || 0);
      if (zf < zBack + 0.2) {
        warns.push(first ? (primary ? 'Lens 1 would overlap the optic in front of the LED. It was moved to 0.2 mm clear of it.' : 'Lens 1 would touch the LED' + (domeOn ? ' dome' : '') + ' at this position. It was moved to 0.2 mm clear of it.')
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
    return { s: s, polys: polys, warns: warns, info: info, prim: primInfo, primary: primary, domeOn: domeOn, zLast: zLast, hLast: hLast, wallZ: zLast + p.wall };
  }

  const ST = { z: 0, y: 0, dz: 1, dy: 0, w: 1, nb: 0 }, IO = { dz: 0, dy: 0 };

  /* Refraction at an interface. Returns transmittance (0 = total internal reflection)
     and writes the refracted unit direction into IO. */
  function ifaceAt(dz, dy, nz, ny, n1, n2) {
    let cosi = -(dz * nz + dy * ny);
    if (cosi < 0) { nz = -nz; ny = -ny; cosi = -cosi; }
    const eta = n1 / n2, s2 = eta * eta * (1 - cosi * cosi);
    if (s2 >= 1) return 0;
    const cost = Math.sqrt(1 - s2);
    const rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost), rp = (n1 * cost - n2 * cosi) / (n1 * cost + n2 * cosi);
    const g = eta * cosi - cost, tz = eta * dz + g * nz, ty = eta * dy + g * ny, l = Math.hypot(tz, ty);
    IO.dz = tz / l; IO.dy = ty / l;
    return 1 - 0.5 * (rs * rs + rp * rp);
  }

  /* Mirror stage. Returns 0 when the ray leaves forwards, 4 when it escapes backwards, 5 when trapped. */
  function traceMirror(S, st, path) {
    let z = st.z, y = st.y, dz = st.dz, dy = st.dy, w = st.w, done = false;
    const segs = S.segs;
    for (let bounce = 0; bounce < 14; bounce++) {
      let bt = Infinity, bg = null;
      for (let q = 0; q < segs.length; q++) {
        const g = segs[q];
        const qa = g.a11 * dz * dz + 2 * g.a12 * dz * dy + g.a22 * dy * dy;
        const qb = (g.a11 * z + g.a12 * y + g.b1) * dz + (g.a12 * z + g.a22 * y + g.b2) * dy;
        const qc = g.a11 * z * z + 2 * g.a12 * z * y + g.a22 * y * y + 2 * (g.b1 * z + g.b2 * y) + g.c0;
        let t1, t2;
        if (Math.abs(qa) < 1e-12) {
          if (Math.abs(qb) < 1e-14) continue;
          t1 = t2 = -qc / (2 * qb);
        } else {
          const disc = qb * qb - qa * qc;
          if (disc < 0) continue;
          const sq = Math.sqrt(disc);
          t1 = (-qb - sq) / qa; t2 = (-qb + sq) / qa;
        }
        for (let r = 0; r < 2; r++) {
          const t = r ? t2 : t1;
          if (t > EPS && t < bt) {
            const zz = z + dz * t, yy = y + dy * t;
            if (zz >= g.zlo - 1e-7 && zz <= g.zhi + 1e-7 && yy * g.s > 0) { bt = t; bg = g; }
          }
        }
      }
      if (!bg) { done = true; break; }
      z += dz * bt; y += dy * bt;
      if (path) path.push(z, y);
      let nz = bg.a11 * z + bg.a12 * y + bg.b1, ny = bg.a12 * z + bg.a22 * y + bg.b2;
      const nl = Math.hypot(nz, ny); nz /= nl; ny /= nl;
      const dot = dz * nz + dy * ny;
      dz -= 2 * dot * nz; dy -= 2 * dot * ny;
      w *= S.rho; st.nb++;
    }
    st.z = z; st.y = y; st.dz = dz; st.dy = dy; st.w = w;
    if (!done) return 5;
    if (dz <= 0.0005) { if (path) path.push(z + dz * 15, y + dy * 15); return 4; }
    return 0;
  }

  /* TIR collimator: central refracting surface, cavity wall, TIR outer wall, flat exit face. */
  function traceTIR(S, st, path) {
    let z = st.z, y = st.y, dz = st.dz, dy = st.dy, w = st.w;
    const T = S.top, rc = S.rc, n = S.n;
    /* central surface: hyperboloid a11 z'^2 - 2R z' + y^2 = 0 with z' = z - T.z >= 0 (exact intersection) */
    let tTop = Infinity;
    {
      const zp = z - T.z;
      const qa = T.a11 * dz * dz + dy * dy, qb = T.a11 * zp * dz - T.R * dz + y * dy, qc = T.a11 * zp * zp - 2 * T.R * zp + y * y;
      let t1, t2, okq = true;
      if (Math.abs(qa) < 1e-12) { if (Math.abs(qb) < 1e-14) okq = false; else t1 = t2 = -qc / (2 * qb); }
      else { const disc = qb * qb - qa * qc; if (disc < 0) okq = false; else { const sq = Math.sqrt(disc); t1 = (-qb - sq) / qa; t2 = (-qb + sq) / qa; } }
      if (okq) {
        for (let r = 0; r < 2; r++) {
          const t = r ? t2 : t1;
          if (t > EPS && t < tTop && zp + dz * t >= -1e-9 && Math.abs(y + dy * t) <= rc) tTop = t;
        }
      }
    }
    let tWall = Infinity, wsd = 0;
    if (Math.abs(dy) > 1e-12) {
      wsd = dy > 0 ? 1 : -1;
      const t = (wsd * rc - y) / dy;
      if (t > 0 && z + dz * t <= S.zEdge + 1e-9) tWall = t;
    }
    const viaTop = tTop < tWall, t0 = viaTop ? tTop : tWall;
    if (!isFinite(t0)) return 1;
    z += dz * t0; y += dy * t0;
    if (path) path.push(z, y);
    let nz = viaTop ? 2 * (T.a11 * (z - T.z) - T.R) : 0, ny = viaTop ? 2 * y : wsd;
    const nl0 = Math.hypot(nz, ny); nz /= nl0; ny /= nl0;
    const tin = ifaceAt(dz, dy, nz, ny, 1, n);
    if (tin === 0) return 2;
    w *= tin; dz = IO.dz; dy = IO.dy;

    const WZ = S.WZ, WY = S.WY, K = S.K;
    for (let bounce = 0; bounce < 8; bounce++) {
      let bt = Infinity, kind = 0, sez = 0, sey = 0;
      for (let sd = 1; sd >= -1; sd -= 2) {
        for (let j = 0; j < K; j++) {
          const z0 = WZ[j], y0 = sd * WY[j], ez = WZ[j + 1] - z0, ey = sd * WY[j + 1] - y0;
          const den = dz * ey - dy * ez;
          if (Math.abs(den) < 1e-14) continue;
          const wz = z0 - z, wy = y0 - y;
          const t = (wz * ey - wy * ez) / den, u = (wz * dy - wy * dz) / den;
          if (t > EPS && t < bt && u >= -1e-9 && u <= 1 + 1e-9) { bt = t; kind = 1; sez = ez; sey = ey; }
        }
      }
      if (dz > 1e-9) {
        const t = (S.zt - z) / dz;
        if (t > EPS && t < bt && Math.abs(y + dy * t) <= S.Rt + 1e-9) { bt = t; kind = 2; }
      }
      if (kind === 0) {
        st.z = z; st.y = y; st.dz = dz; st.dy = dy; st.w = w;
        if (dz <= 0) { if (path) path.push(z + dz * 8, y + dy * 8); return 4; }
        return 1;
      }
      z += dz * bt; y += dy * bt;
      if (path) path.push(z, y);
      if (kind === 2) {
        const tout = ifaceAt(dz, dy, 1, 0, n, 1);
        if (tout === 0) { dz = -dz; st.nb++; continue; }
        w *= tout; dz = IO.dz; dy = IO.dy;
        st.z = z; st.y = y; st.dz = dz; st.dy = dy; st.w = w;
        return 0;
      }
      let wnz = -sey, wny = sez; const wl = Math.hypot(wnz, wny); wnz /= wl; wny /= wl;
      const dot = dz * wnz + dy * wny, cosi = Math.abs(dot), s2 = n * n * (1 - cosi * cosi);
      if (s2 < 1) {
        const cost = Math.sqrt(1 - s2);
        const rs = (n * cosi - cost) / (n * cosi + cost), rp = (n * cost - cosi) / (n * cost + cosi);
        w *= 0.5 * (rs * rs + rp * rp);
      }
      dz -= 2 * dot * wnz; dy -= 2 * dot * wny; st.nb++;
    }
    st.z = z; st.y = y; st.dz = dz; st.dy = dy; st.w = w;
    return 5;
  }

  /* Trace one ray. Writes result into R. path (optional) receives z,y pairs.
     R.wd is the weight after the dome (1 when there is no dome). */
  function traceRay(sys, y0, sinT, R, path) {
    let z = 0, y = y0, dz = Math.sqrt(1 - sinT * sinT), dy = sinT, w = 1;
    if (path) path.push(z, y);
    R.fail = 0; R.wd = sys.domeOn ? 0 : 1; R.nb = 0;
    for (let j = 0; j < sys.s.length; j++) {
      const S = sys.s[j];
      if (S.type === 3 || S.type === 4) {
        ST.z = z; ST.y = y; ST.dz = dz; ST.dy = dy; ST.w = w; ST.nb = 0;
        const fl = S.type === 3 ? traceMirror(S, ST, path) : traceTIR(S, ST, path);
        z = ST.z; y = ST.y; dz = ST.dz; dy = ST.dy; w = ST.w; R.nb += ST.nb;
        if (fl) { R.fail = fl; R.w = 0; return R; }
        continue;
      }
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
    if (sys.zLast > z && dz > 1e-9) { y += dy / dz * (sys.zLast - z); z = sys.zLast; }
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

  /* ---------- full 3D trace of the rotationally symmetric system (used for all statistics) ---------- */
  const IO3 = { x: 0, y: 0, z: 0 };
  const ST3 = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, w: 1, nb: 0 };

  function refract3(dx, dy, dz, nx, ny, nz, n1, n2) {
    let cosi = -(dx * nx + dy * ny + dz * nz);
    if (cosi < 0) { nx = -nx; ny = -ny; nz = -nz; cosi = -cosi; }
    const eta = n1 / n2, s2 = eta * eta * (1 - cosi * cosi);
    if (s2 >= 1) return 0;
    const cost = Math.sqrt(1 - s2);
    const rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost), rp = (n1 * cost - n2 * cosi) / (n1 * cost + n2 * cosi);
    const g = eta * cosi - cost;
    const tx = eta * dx + g * nx, ty = eta * dy + g * ny, tz = eta * dz + g * nz, l = Math.sqrt(tx * tx + ty * ty + tz * tz);
    IO3.x = tx / l; IO3.y = ty / l; IO3.z = tz / l;
    return 1 - 0.5 * (rs * rs + rp * rp);
  }

  /* Nearest forward hit with the surface of revolution r = r0 + m (z - z0) for z in [za, zb]. */
  function frustumHit(x, y, z, dx, dy, dz, r0, m, z0, za, zb) {
    const rr = r0 + m * (z - z0);
    const a = dx * dx + dy * dy - m * m * dz * dz, b = x * dx + y * dy - m * dz * rr, c = x * x + y * y - rr * rr;
    let t1, t2;
    if (Math.abs(a) < 1e-12) { if (Math.abs(b) < 1e-14) return Infinity; t1 = t2 = -c / (2 * b); }
    else { const disc = b * b - a * c; if (disc < 0) return Infinity; const sq = Math.sqrt(disc); t1 = (-b - sq) / a; t2 = (-b + sq) / a; }
    let best = Infinity;
    for (let k = 0; k < 2; k++) {
      const t = k ? t2 : t1;
      if (t > EPS && t < best) {
        const zz = z + dz * t;
        if (zz >= za - 1e-7 && zz <= zb + 1e-7 && r0 + m * (zz - z0) >= -1e-9) best = t;
      }
    }
    return best;
  }

  function mirror3(S, st) {
    let x = st.x, y = st.y, z = st.z, dx = st.dx, dy = st.dy, dz = st.dz, w = st.w, done = false;
    const pz = S.pz, pr = S.pr, nseg = pz.length - 1;
    for (let bounce = 0; bounce < 14; bounce++) {
      let bt = Infinity, bj = -1;
      for (let j = 0; j < nseg; j++) {
        const z0 = pz[j], z1 = pz[j + 1], r0 = pr[j], r1 = pr[j + 1], dzs = z1 - z0;
        let t;
        if (Math.abs(dzs) < 1e-9) {
          if (Math.abs(dz) < 1e-12) continue;
          t = (z0 - z) / dz;
          if (!(t > EPS)) continue;
          const rh = Math.hypot(x + dx * t, y + dy * t);
          if (rh < Math.min(r0, r1) - 1e-9 || rh > Math.max(r0, r1) + 1e-9) continue;
        } else t = frustumHit(x, y, z, dx, dy, dz, r0, (r1 - r0) / dzs, z0, Math.min(z0, z1), Math.max(z0, z1));
        if (t < bt) { bt = t; bj = j; }
      }
      if (bj < 0) { done = true; break; }
      x += dx * bt; y += dy * bt; z += dz * bt;
      const dzs = pz[bj + 1] - pz[bj], rh = Math.hypot(x, y);
      let nx = 0, ny = 0, nz = 1;
      if (Math.abs(dzs) >= 1e-9) {
        const m = (pr[bj + 1] - pr[bj]) / dzs, inv = 1 / Math.sqrt(1 + m * m);
        nz = -m * inv;
        if (rh > 1e-12) { nx = x / rh * inv; ny = y / rh * inv; } else { nx = 0; ny = 0; nz = nz < 0 ? -1 : 1; }
      }
      const dot = dx * nx + dy * ny + dz * nz;
      dx -= 2 * dot * nx; dy -= 2 * dot * ny; dz -= 2 * dot * nz;
      w *= S.rho; st.nb++;
    }
    st.x = x; st.y = y; st.z = z; st.dx = dx; st.dy = dy; st.dz = dz; st.w = w;
    if (!done) return 5;
    if (dz <= 0.0005) return 4;
    return 0;
  }

  function tir3(S, st) {
    let x = st.x, y = st.y, z = st.z, dx = st.dx, dy = st.dy, dz = st.dz, w = st.w;
    const T = S.top, rc = S.rc, n = S.n;
    let tTop = Infinity;
    {
      const zp = z - T.z, dr2 = dx * dx + dy * dy;
      const qa = T.a11 * dz * dz + dr2, qb = T.a11 * zp * dz - T.R * dz + x * dx + y * dy, qc = T.a11 * zp * zp - 2 * T.R * zp + x * x + y * y;
      let t1 = 0, t2 = 0, okq = true;
      if (Math.abs(qa) < 1e-12) { if (Math.abs(qb) < 1e-14) okq = false; else t1 = t2 = -qc / (2 * qb); }
      else { const disc = qb * qb - qa * qc; if (disc < 0) okq = false; else { const sq = Math.sqrt(disc); t1 = (-qb - sq) / qa; t2 = (-qb + sq) / qa; } }
      if (okq) for (let r = 0; r < 2; r++) {
        const t = r ? t2 : t1;
        if (t > EPS && t < tTop && zp + dz * t >= -1e-9 && Math.hypot(x + dx * t, y + dy * t) <= rc) tTop = t;
      }
    }
    let tWall = Infinity;
    {
      const aa = dx * dx + dy * dy;
      if (aa > 1e-18) {
        const bb = x * dx + y * dy, cc = x * x + y * y - rc * rc, disc = bb * bb - aa * cc;
        if (disc >= 0) { const t = (-bb + Math.sqrt(disc)) / aa; if (t > 0 && z + dz * t <= S.zEdge + 1e-9) tWall = t; }
      }
    }
    const viaTop = tTop < tWall, t0 = viaTop ? tTop : tWall;
    st.x = x; st.y = y; st.z = z; st.dx = dx; st.dy = dy; st.dz = dz; st.w = w;
    if (!isFinite(t0)) return 1;
    x += dx * t0; y += dy * t0; z += dz * t0;
    let nx, ny, nz;
    if (viaTop) { nx = 2 * x; ny = 2 * y; nz = 2 * (T.a11 * (z - T.z) - T.R); } else { nx = x; ny = y; nz = 0; }
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= nl; ny /= nl; nz /= nl;
    const tin = refract3(dx, dy, dz, nx, ny, nz, 1, n);
    if (tin === 0) return 2;
    w *= tin; dx = IO3.x; dy = IO3.y; dz = IO3.z;

    const WZ = S.WZ, WY = S.WY, K = S.K;
    for (let bounce = 0; bounce < 8; bounce++) {
      let bt = Infinity, kind = 0, bj = 0;
      for (let j = 0; j < K; j++) {
        const z0 = WZ[j], z1 = WZ[j + 1], dzs = z1 - z0;
        if (dzs < 1e-9) continue;
        const t = frustumHit(x, y, z, dx, dy, dz, WY[j], (WY[j + 1] - WY[j]) / dzs, z0, z0, z1);
        if (t < bt) { bt = t; kind = 1; bj = j; }
      }
      if (dz > 1e-9) {
        const t = (S.zt - z) / dz;
        if (t > EPS && t < bt && Math.hypot(x + dx * t, y + dy * t) <= S.Rt + 1e-9) { bt = t; kind = 2; }
      }
      if (kind === 0) {
        st.x = x; st.y = y; st.z = z; st.dx = dx; st.dy = dy; st.dz = dz; st.w = w;
        return dz <= 0 ? 4 : 1;
      }
      x += dx * bt; y += dy * bt; z += dz * bt;
      if (kind === 2) {
        const tout = refract3(dx, dy, dz, 0, 0, 1, n, 1);
        if (tout === 0) { dz = -dz; st.nb++; continue; }
        w *= tout; dx = IO3.x; dy = IO3.y; dz = IO3.z;
        st.x = x; st.y = y; st.z = z; st.dx = dx; st.dy = dy; st.dz = dz; st.w = w;
        return 0;
      }
      const m = (WY[bj + 1] - WY[bj]) / (WZ[bj + 1] - WZ[bj]), inv = 1 / Math.sqrt(1 + m * m), rh = Math.hypot(x, y);
      const wnx = rh > 1e-12 ? x / rh * inv : 0, wny = rh > 1e-12 ? y / rh * inv : 0, wnz = -m * inv;
      const dot = dx * wnx + dy * wny + dz * wnz, cosi = Math.abs(dot), s2 = n * n * (1 - cosi * cosi);
      if (s2 < 1) {
        const cost = Math.sqrt(1 - s2);
        const rs = (n * cosi - cost) / (n * cosi + cost), rp = (n * cost - cosi) / (n * cost + cosi);
        w *= 0.5 * (rs * rs + rp * rp);
      }
      dx -= 2 * dot * wnx; dy -= 2 * dot * wny; dz -= 2 * dot * wnz; st.nb++;
    }
    st.x = x; st.y = y; st.z = z; st.dx = dx; st.dy = dy; st.dz = dz; st.w = w;
    return 5;
  }

  /* Trace one skew ray. Result in R: x,y,z,dx,dy,dz at the plane of the last optic, weight w, fail code. */
  function trace3(sys, x, y, dx, dy, dz, R) {
    let z = 0, w = 1;
    R.fail = 0; R.wd = sys.domeOn ? 0 : 1; R.nb = 0;
    const SS = sys.s;
    for (let j = 0; j < SS.length; j++) {
      const S = SS[j];
      if (S.type === 3 || S.type === 4) {
        ST3.x = x; ST3.y = y; ST3.z = z; ST3.dx = dx; ST3.dy = dy; ST3.dz = dz; ST3.w = w; ST3.nb = 0;
        const fl = S.type === 3 ? mirror3(S, ST3) : tir3(S, ST3);
        x = ST3.x; y = ST3.y; z = ST3.z; dx = ST3.dx; dy = ST3.dy; dz = ST3.dz; w = ST3.w; R.nb += ST3.nb;
        if (fl) { R.fail = fl; R.w = 0; return R; }
        continue;
      }
      if (S.type === 1) {
        const t = (S.z - z) / dz; z = S.z; x += dx * t; y += dy * t;
        if (Math.hypot(x, y) > S.h) { R.fail = 1; R.w = 0; return R; }
        const ux = dx / dz - x / S.f, uy = dy / dz - y / S.f, inv = 1 / Math.sqrt(1 + ux * ux + uy * uy);
        dx = ux * inv; dy = uy * inv; dz = inv;
        continue;
      }
      if (S.dome && S.zc > 0) {
        const aa = dx * dx + dy * dy;
        if (aa > 1e-18) {
          const bb = x * dx + y * dy, cc = x * x + y * y - S.wallY * S.wallY, disc = bb * bb - aa * cc;
          if (disc >= 0) { const tw = (-bb + Math.sqrt(disc)) / aa; if (tw > 0 && z + dz * tw < S.zc) { R.fail = 1; R.w = 0; return R; } }
        }
      }
      let t = (S.z - z) / dz, ok = true, sk = 0, sl = 0, last = 0;
      const passes = S.type === 2 ? 4 : 1;
      for (let pass = 0; pass < passes; pass++) {
        if (S.type === 2) { const px = x + dx * t, py = y + dy * t; sk = sagFn(S.c, S.k, Math.floor(Math.hypot(px, py) / S.pitch) * S.pitch); }
        t = (S.z - z) / dz;
        for (let it = 0; it < 14; it++) {
          const px = x + dx * t, py = y + dy * t, r2 = px * px + py * py, q = 1 - (1 + S.k) * S.c * S.c * r2;
          if (q <= 0) { ok = false; break; }
          const rq = Math.sqrt(q), r = Math.sqrt(r2);
          const sg = S.sgn * (S.c * r2 / (1 + rq) - sk);
          sl = S.sgn * S.c * r / rq;
          const drdt = r > 1e-12 ? (px * dx + py * dy) / r : 0;
          const dt = (z + dz * t - S.z - sg) / (dz - sl * drdt);
          t -= dt; last = Math.abs(dt);
          if (last < 1e-9) break;
        }
        if (!ok || S.type !== 2) break;
        const rn = Math.hypot(x + dx * t, y + dy * t);
        if (sagFn(S.c, S.k, Math.floor(rn / S.pitch) * S.pitch) === sk) break;
      }
      if (!ok || !(t > 0) || last > 1e-6) { R.fail = 1; R.w = 0; return R; }
      const dzIn = dz, drIn = (dx * x + dy * y);
      x += dx * t; y += dy * t; z += dz * t;
      const rh = Math.hypot(x, y);
      if (rh > S.h) { R.fail = 1; R.w = 0; return R; }
      if (S.type === 2) {
        const yk = Math.floor(rh / S.pitch) * S.pitch, step = sagFn(S.c, S.k, yk + S.pitch) - sagFn(S.c, S.k, yk);
        const rad = rh > 1e-12 ? Math.abs((dx * x + dy * y) / rh) : 0;
        w *= Math.max(0.2, 1 - step * rad / Math.max(1e-9, dzIn) / S.pitch);
      }
      let nx = 0, ny = 0, nz = 1;
      if (rh > 1e-12) { nx = -sl * x / rh; ny = -sl * y / rh; }
      const nl = Math.sqrt(nx * nx + ny * ny + 1); nx /= nl; ny /= nl; nz /= nl;
      const T = refract3(dx, dy, dz, nx, ny, nz, S.n1, S.n2);
      if (T === 0) { R.fail = 2; R.w = 0; return R; }
      w *= T; dx = IO3.x; dy = IO3.y; dz = IO3.z;
      if (dz <= 0.0005) { R.fail = 3; R.w = 0; return R; }
      if (S.dome) R.wd = w;
    }
    if (sys.zLast > z && dz > 1e-9) { const t = (sys.zLast - z) / dz; x += dx * t; y += dy * t; z = sys.zLast; }
    R.x = x; R.y = y; R.z = z; R.dx = dx; R.dy = dy; R.dz = dz; R.w = w;
    return R;
  }

  const AL = [0.8566748838545029, 0.7338918566271260, 0.6287067210378087, 0.5385972572236101];

  function analyze(p, N) {
    const sys = buildSystem(p), R = { fail: 0, w: 0, wd: 1, nb: 0, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 };
    const rx = new Float64Array(N), rw = new Float64Array(N), th = new Float64Array(N), ws = new Float64Array(N);
    const rl = p.ledD / 2, TW = 2 * Math.PI, D2R = Math.PI / 180;
    let D = 0, sW = 0, sG = 0, sDir = 0;
    const passed = [];
    for (let i = 0; i < N; i++) {
      const u1 = frac(0.5 + i * AL[0]), u2 = frac(0.5 + i * AL[1]), u3 = frac(0.5 + i * AL[2]), u4 = frac(0.5 + i * AL[3]);
      const rr = rl * Math.sqrt(u1), f0 = TW * u2, st = Math.sqrt(u3), ct = Math.sqrt(1 - u3), ps = TW * u4;
      trace3(sys, rr * Math.cos(f0), rr * Math.sin(f0), st * Math.cos(ps), st * Math.sin(ps), ct, R);
      D += R.wd;
      if (R.fail === 0) {
        const t = (sys.wallZ - R.z) / R.dz;
        rx[i] = Math.hypot(R.x, R.y); rw[i] = Math.hypot(R.x + R.dx * t, R.y + R.dy * t);
        th[i] = Math.acos(Math.min(1, R.dz)); ws[i] = R.w;
        sW += R.w; sG += R.wd; if (R.nb === 0) sDir += R.w;
        passed.push(i);
      }
    }
    if (D <= 0) D = 1e-12;
    const out = { sys: sys, N: N, eta3: sW / D, geo3: sG / D, passed: passed.length };
    const Aled = Math.PI * p.ledD * p.ledD / 4 * (sys.domeOn ? p.dome.n * p.dome.n : 1);
    out.Aled = Aled;
    out.Lled = p.flux / (Math.PI * Aled) * 1e6;
    out.tau = sG > 0 ? sW / sG : 0;
    out.fDirect = sDir / D; out.fRedirect = (sW - sDir) / D; out.prim = sys.prim;
    if (passed.length < 30 || sW <= 0) { out.empty = true; return out; }

    const DEGR = 180 / Math.PI;
    const byTh = passed.slice().sort((a, b) => th[a] - th[b]);
    out.th50 = wquant(th, ws, byTh, 0.5) * DEGR;
    out.th90 = wquant(th, ws, byTh, 0.9) * DEGR;
    out.th95 = wquant(th, ws, byTh, 0.95) * DEGR;
    out.th99 = wquant(th, ws, byTh, 0.99) * DEGR;
    out.beamFull = 2 * out.th95;
    const byRx = passed.slice().sort((a, b) => rx[a] - rx[b]), byRw = passed.slice().sort((a, b) => rw[a] - rw[b]);
    const Hw = Math.max(0.05, wquant(rx, ws, byRx, 0.995)), Hww = Math.max(0.05, wquant(rw, ws, byRw, 0.995));
    out.Hw = Hw; out.Hww = Hww;

    // irradiance profiles (equal-area rings): lux
    const radial = (arr, Rm) => {
      const B = 32, cnt = new Float64Array(B), E = new Float64Array(B), edges = new Float64Array(B + 1);
      for (let b = 0; b <= B; b++) edges[b] = Rm * Math.sqrt(b / B);
      for (const i of passed) { const r = arr[i]; if (r < Rm) cnt[Math.min(B - 1, Math.floor(B * r * r / (Rm * Rm)))] += ws[i]; }
      const area = Math.PI * Rm * Rm / B;
      for (let b = 0; b < B; b++) E[b] = p.flux * (cnt[b] / D) / area * 1e6;
      return { B: B, R: Rm, edges: edges, E: E };
    };
    out.prof = { exit: radial(rx, Hw * 1.05), wall: radial(rw, Hww * 1.05), Hw: Hw, HwWall: Hww };

    // brightness at the wall centre: smallest central disc holding enough rays, capped by the etendue limit seen from there
    const cnt0 = Math.min(byRw.length - 1, Math.max(150, Math.round(0.02 * byRw.length)));
    const r0 = Math.max(rw[byRw[cnt0]], 1e-3);
    const cenIdx = []; let fc = 0;
    for (let q = 0; q < byRw.length; q++) { const i = byRw[q]; if (rw[i] > r0) break; cenIdx.push(i); fc += ws[i]; }
    const cenTh = cenIdx.slice().sort((a, b) => th[a] - th[b]);
    const thLoc = cenTh.length >= 30 ? wquant(th, ws, cenTh, 0.99) * DEGR : out.th99;
    out.thLoc = thLoc;
    out.Elimit = out.Lled * Math.PI * Math.pow(Math.sin(thLoc / DEGR), 2);
    const tauC = cenIdx.length ? fc / cenIdx.length : 0;
    const Eest = p.flux * (fc / D) / (Math.PI * r0 * r0) * 1e6;
    out.Ecenter = Math.min(Eest, out.Elimit * tauC);
    out.Emean = p.flux * out.eta3 / (Math.PI * Hww * Hww) * 1e6;

    // evenness: variation of brightness over the area holding the central 80 % of the light on the wall
    const r80 = wquant(rw, ws, byRw, 0.8), FB = 6, fcnt = new Float64Array(FB);
    for (const i of passed) { const r = rw[i]; if (r < r80) fcnt[Math.min(FB - 1, Math.floor(FB * r * r / (r80 * r80)))] += ws[i]; }
    let fm = 0, fq = 0;
    for (let b = 0; b < FB; b++) { fm += fcnt[b]; fq += fcnt[b] * fcnt[b]; }
    fm /= FB; out.flatCV = byRw.length >= 120 && fm > 0 ? Math.sqrt(Math.max(0, fq / FB - fm * fm)) / fm : NaN;

    // apparent source seen from the wall centre: luminance versus angular radius
    const cen = cenIdx.length >= 60 ? cenIdx : passed, cenA = cen.slice().sort((a, b) => th[a] - th[b]);
    const th99 = wquant(th, ws, cenA, 0.99) * DEGR;
    out.appW = Math.max(1e-4, 2 * th99);
    const range = Math.max(0.6, 1.5 * th99), AB = 36, rad = range / DEGR, sinMax = Math.sin(rad);
    const aEdges = new Float64Array(AB + 1), aL = new Float64Array(AB), aC = new Float64Array(AB);
    for (let b = 0; b <= AB; b++) aEdges[b] = Math.asin(sinMax * Math.sqrt(b / AB)) * DEGR;
    for (const i of cen) { const s2 = Math.sin(th[i]) * Math.sin(th[i]) / (sinMax * sinMax); if (s2 < 1) aC[Math.floor(AB * s2)] += ws[i]; }
    const nCen = cen.length, Ac = Math.PI * (cen === passed ? Hww * Hww : r0 * r0), dOm = Math.PI * sinMax * sinMax / AB;
    for (let b = 0; b < AB; b++) {
      const mid = 0.5 * (aEdges[b] + aEdges[b + 1]) / DEGR;
      aL[b] = p.flux * (aC[b] / D) / (Ac * 1e-6 * dOm * Math.cos(mid)) / 1e6;
    }
    out.app = { range: range, AB: AB, edges: aEdges, L: aL };
    out.penumbra = 2 * Math.tan(Math.min(out.appW, 170) * D2R / 2) * 1000;

    // etendue (mm^2 sr)
    out.Gled = Math.PI * Aled;
    out.Gcap = out.Gled * out.geo3;
    out.Gout = Math.PI * Hw * Hw * Math.PI * Math.pow(Math.sin(out.th95 * D2R), 2);
    out.Gratio = out.Gcap > 0 ? out.Gout / (0.95 * out.Gcap) : NaN;
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

  function sweep(p, apply, xs, N) {
    const out = [];
    for (const x of xs) {
      const q = JSON.parse(JSON.stringify(p));
      apply(q, x);
      const r = analyze(q, N);
      out.push({ x: x, eta: r.empty ? 0 : r.eta3 * 100, ang: r.empty ? NaN : r.beamFull, Ec: r.empty ? 0 : r.Ecenter, pen: r.empty ? NaN : r.penumbra });
    }
    return out;
  }

  const api = { SUN, MATERIALS, DOME_MATERIALS, NEG, KINDS, PRIMARIES, buildSystem, traceRay, trace3, analyze, rayPaths, sweep };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
