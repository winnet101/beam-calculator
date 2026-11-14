// SI throughout: metres, newtons, pascals, kilograms.
export const CASES = {
  tip: { name: 'Cantilever tip load', cantilever: true, uniform: false, formula: 'δmax = F L³ / (3 E I)', boundary: 'Fixed–free: v(0) = θ(0) = 0; free end unrestrained.' },
  center: { name: 'Simply supported center load', cantilever: false, uniform: false, formula: 'δmax = F L³ / (48 E I)', boundary: 'Pinned–roller: v(0) = v(L) = 0; rotations free.' },
  simpleUniform: { name: 'Simply supported uniform load', cantilever: false, uniform: true, formula: 'δmax = 5 q L⁴ / (384 E I)', boundary: 'Pinned–roller: v(0) = v(L) = 0; rotations free.' },
  cantileverUniform: { name: 'Cantilever uniform load', cantilever: true, uniform: true, formula: 'δmax = q L⁴ / (8 E I)', boundary: 'Fixed–free: v(0) = θ(0) = 0; free end unrestrained.' }
};

export const DEFAULTS = { case: 'cantileverUniform', section: 'ibeam', L: 12, b: 300, a: 1000, t: 8, E: 193, nu: 0.29, rho: 8000, load: 57.8, loadMode: 'total', custom: false, customI: 1e9, nx: 64, ny: 24, nz: 16 };

export function validate(p) {
  const errors = [];
  for (const key of ['L', 'b', 'a', 't', 'E', 'rho', 'load', 'nx', 'ny', 'nz']) {
    if (!Number.isFinite(p[key]) || p[key] <= 0) errors.push(`${key} must be a positive finite number.`);
  }
  if (!CASES[p.case]) errors.push('Unknown load case.');
  if (!['rectangle', 'ibeam'].includes(p.section)) errors.push('Unknown cross-section.');
  if (!['total', 'line'].includes(p.loadMode)) errors.push('Unknown load unit.');
  if (!Number.isFinite(p.nu) || p.nu <= -1 || p.nu >= 0.5) errors.push('Poisson’s ratio must be between −1 and 0.5.');
  if (p.section === 'ibeam' && (2 * p.t >= p.a || p.t > p.b)) errors.push('I-beam requires 2τ < a and τ ≤ b.');
  if (p.custom && (!Number.isFinite(p.customI) || p.customI <= 0)) errors.push('Custom I must be positive (mm⁴).');
  if (![p.nx, p.ny, p.nz].every(Number.isInteger) || p.nx < 4 || p.nx > 160 || p.nx % 2 || p.ny < 4 || p.ny > 80 || p.nz < 4 || p.nz > 80) errors.push('Mesh: use even length divisions 4–160 and integer section divisions 4–80.');
  if (p.L > 1000 || p.a > 100000 || p.b > 100000 || p.E > 10000 || p.load > 1e9) errors.push('Input exceeds this educational calculator’s range.');
  return errors;
}

export function sectionProperties(p) {
  const a = p.a / 1000, b = p.b / 1000, t = p.t / 1000;
  const A = p.section === 'ibeam' ? 2 * b * t + (a - 2 * t) * t : b * a;
  const geometricI = p.section === 'ibeam' ? (b * a ** 3 - (b - t) * (a - 2 * t) ** 3) / 12 : b * a ** 3 / 12;
  const I = p.custom ? p.customI * 1e-12 : geometricI;
  const G = p.E * 1e9 / (2 * (1 + p.nu));
  const kappa = 10 * (1 + p.nu) / (12 + 11 * p.nu);
  // Cowper's coefficient applies to solid rectangles only. For an I-section,
  // approximate the effective shear area by 5/6 of the clear web area.
  const shearArea = p.section === 'ibeam' ? (5 / 6) * (a - 2 * t) * t : kappa * A;
  return { a, b, t, A, I, geometricI, G, kappa: shearArea / A, shearArea, mass: p.rho * A * p.L };
}

export function loads(p) {
  const c = CASES[p.case];
  const F = c.uniform && p.loadMode === 'line' ? p.load * 1000 * p.L : p.load * 1000;
  return { F, q: F / p.L };
}

export function theory(p, s = sectionProperties(p)) {
  const { F, q } = loads(p), { L } = p, EI = p.E * 1e9 * s.I;
  const factors = { tip: 1 / 3, center: 1 / 48, simpleUniform: 5 / 384, cantileverUniform: 1 / 8 };
  const delta = factors[p.case] * F * L ** 3 / EI;
  const M = p.case === 'tip' ? F * L : p.case === 'cantileverUniform' ? q * L ** 2 / 2 : p.case === 'center' ? F * L / 4 : q * L ** 2 / 8;
  const shearDelta = F * L / (s.G * s.shearArea) * (p.case === 'tip' ? 1 : p.case === 'center' ? 1 / 4 : p.case === 'simpleUniform' ? 1 / 8 : 1 / 2);
  return { delta, M, stress: M * s.a / (2 * s.I), shearDelta, timoshenko: delta + shearDelta, ratio: delta / L };
}

// Clip each y–z cell against the non-overlapping rectangles of the section.
// Areas are exact; midpoint second moments omit each fragment's local I.
// This makes the sectional stiffness a convergent voxel approximation.
export function voxelSection(p) {
  const s = sectionProperties(p), { a, b, t } = s;
  const rects = p.section === 'rectangle' ? [[-a / 2, a / 2, -b / 2, b / 2]] : [
    [-a / 2, -a / 2 + t, -b / 2, b / 2],
    [a / 2 - t, a / 2, -b / 2, b / 2],
    [-a / 2 + t, a / 2 - t, -t / 2, t / 2]
  ];
  const cells = [];
  let A = 0, I = 0;
  for (let iy = 0; iy < p.ny; iy++) {
    for (let iz = 0; iz < p.nz; iz++) {
      const y0 = -a / 2 + iy * a / p.ny, y1 = y0 + a / p.ny;
      const z0 = -b / 2 + iz * b / p.nz, z1 = z0 + b / p.nz;
      let area = 0, moment = 0;
      for (const [loY, hiY, loZ, hiZ] of rects) {
        const low = Math.max(y0, loY), high = Math.min(y1, hiY);
        const width = Math.max(0, Math.min(z1, hiZ) - Math.max(z0, loZ));
        const part = Math.max(0, high - low) * width;
        area += part;
        moment += part * ((low + high) / 2) ** 2;
      }
      if (area > 0) { cells.push({ iy, iz, area }); A += area; I += moment; }
    }
  }
  return { A, I, cells, count: cells.length * p.nx };
}

// Two-node Timoshenko elements, consistent distributed loading, and a banded
// Cholesky solve. Degrees of freedom: transverse displacement and rotation.
export function solveFE(p, s, voxel) {
  const n = p.nx, nd = 2 * (n + 1), h = p.L / n;
  const I = p.custom ? s.I : voxel.I;
  const EI = p.E * 1e9 * I, GA = s.G * s.shearArea;
  const phi = 12 * EI / (GA * h * h), c = EI / (h ** 3 * (1 + phi));
  const ke = [[12, 6*h, -12, 6*h], [6*h, (4+phi)*h*h, -6*h, (2-phi)*h*h], [-12, -6*h, 12, -6*h], [6*h, (2-phi)*h*h, -6*h, (4+phi)*h*h]];
  const K = new Float64Array(nd * nd), f = new Float64Array(nd);
  const { F, q } = loads(p), config = CASES[p.case];
  for (let e = 0; e < n; e++) {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) K[(2*e+i)*nd+2*e+j] += c * ke[i][j];
    if (config.uniform) {
      const fe = [q*h/2, q*h*h/12, q*h/2, -q*h*h/12];
      for (let i = 0; i < 4; i++) f[2*e+i] += fe[i];
    }
  }
  if (!config.uniform) f[p.case === 'tip' ? 2*n : n] += F;
  const fixed = config.cantilever ? [0, 1] : [0, 2*n];
  for (const d of fixed) {
    for (let i = Math.max(0, d-3); i <= Math.min(nd-1, d+3); i++) { K[d*nd+i] = 0; K[i*nd+d] = 0; }
    K[d*nd+d] = 1; f[d] = 0;
  }
  for (let i = 0; i < nd; i++) {
    for (let j = Math.max(0, i-3); j <= i; j++) {
      let value = K[i*nd+j];
      for (let k = Math.max(0, i-3, j-3); k < j; k++) value -= K[i*nd+k] * K[j*nd+k];
      if (i === j) {
        if (!(value > 0)) throw new Error('The stiffness matrix is not positive definite. Check geometry and material.');
        K[i*nd+j] = Math.sqrt(value);
      } else K[i*nd+j] = value / K[j*nd+j];
    }
  }
  const u = new Float64Array(nd);
  for (let i = 0; i < nd; i++) {
    let v = f[i];
    for (let j = Math.max(0, i-3); j < i; j++) v -= K[i*nd+j] * u[j];
    u[i] = v / K[i*nd+i];
  }
  for (let i = nd-1; i >= 0; i--) {
    let v = u[i];
    for (let j = i+1; j <= Math.min(nd-1, i+3); j++) v -= K[j*nd+i] * u[j];
    u[i] = v / K[i*nd+i];
  }
  const nodes = Array.from({ length: n+1 }, (_, i) => ({ x: i*h, v: u[2*i], theta: u[2*i+1] }));
  return { nodes, delta: Math.max(...nodes.map(node => Math.abs(node.v))), I };
}

export function forcesAt(p, x) {
  const { F, q } = loads(p), { L } = p;
  if (p.case === 'tip') return { M: -F * (L-x), V: F };
  if (p.case === 'cantileverUniform') return { M: -q * (L-x) ** 2 / 2, V: q * (L-x) };
  if (p.case === 'center') return { M: F * Math.min(x, L-x) / 2, V: x < L/2 ? F/2 : -F/2 };
  return { M: q*x*(L-x)/2, V: q*(L/2-x) };
}

export function stressAt(p, s, I, x, y) {
  const { M, V } = forcesAt(p, x);
  const sigma = -M * y / I;
  // Educational shear recovery, not 3-D stress: parabolic rectangle; web-only I-section.
  const tau = p.section === 'rectangle' ? 1.5 * V / s.A * Math.max(0, 1 - (2*y/s.a)**2) : Math.abs(y) < s.a/2-s.t ? V / ((s.a-2*s.t)*s.t) : 0;
  return (sigma < 0 ? -1 : 1) * Math.sqrt(sigma*sigma + 3*tau*tau);
}

export function calculate(p) {
  const errors = validate(p);
  if (errors.length) throw new Error(errors.join(' '));
  const section = sectionProperties(p), eb = theory(p, section), voxel = voxelSection(p);
  const fe = solveFE(p, section, voxel);
  let peak = 0;
  for (let ix = 0; ix <= p.nx; ix++) for (let iy = 0; iy <= p.ny; iy++) peak = Math.max(peak, Math.abs(stressAt(p, section, fe.I, ix*p.L/p.nx, (iy/p.ny-0.5)*section.a)));
  return { section, eb, voxel, fe, peak, difference: (fe.delta / eb.delta - 1) * 100 };
}
