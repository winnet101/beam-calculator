import { DEFAULTS, sectionProperties, theory, validate } from './beam.js';

// Marginal increase in geometric I per kg added by changing one dimension,
// holding all other dimensions (including span) fixed. Derivatives use SI.
export function inertiaEfficiency(p) {
  const s = sectionProperties({ ...p, section: 'ibeam', custom: false });
  const { a, b, t } = s, h = a - 2*t, densityLength = p.rho*p.L;
  return {
    a: (b*a*a - (b-t)*h*h)/4 / (densityLength*t),
    b: (a**3 - h**3)/12 / (densityLength*2*t),
    t: (h**3 + 6*(b-t)*h*h)/12 / (densityLength*(2*b+a-4*t))
  };
}

// Eliminate b analytically: I is linear in b for fixed a and t. This satisfies
// the displacement constraint without an arbitrary penalty coefficient.
export function sizeWidth(base, aMM, tMM, model, targetMM) {
  const p = { ...DEFAULTS, ...base, L:12, a:aMM, t:tMM, b:tMM, section:'ibeam', case:'cantileverUniform', load:57.8, loadMode:'total', custom:false };
  if (!(aMM <= 1000 && tMM >= 8 && aMM > 2*tMM)) return null;
  const s = sectionProperties(p);
  const shear = model === 'timoshenko' ? theory(p,s).shearDelta : 0;
  const allowance = targetMM/1000 - shear;
  if (!(allowance > 0)) return null; // No flange width can remove this shear deflection.
  const requiredI = 57800*12**3/(8*p.E*1e9*allowance);
  const h = s.a - 2*s.t;
  const requiredB = (12*requiredI - s.t*h**3)/(s.a**3-h**3);
  p.b = Math.max(s.t, requiredB)*1000;
  if (!Number.isFinite(p.b) || p.b > 100000) return null;
  const section = sectionProperties(p), eb = theory(p,section);
  return { p, mass:section.mass, I:section.I, eb:eb.delta*1000, timoshenko:eb.timoshenko*1000, predicted:(model === 'timoshenko' ? eb.timoshenko : eb.delta)*1000 };
}

export function optimizeBeam(base, { model = 'timoshenko', margin = 10, maxIterations = 300 } = {}) {
  if (!['eb','timoshenko'].includes(model)) throw new Error('Choose EB or Timoshenko sizing.');
  if (!Number.isFinite(margin) || margin < 0 || margin > 90) throw new Error('Deflection margin must be between 0 and 90%.');
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 2000) throw new Error('Iteration limit must be an integer from 1 to 2000.');
  const material = { E:base.E, nu:base.nu, rho:base.rho };
  const errors = validate({ ...DEFAULTS, ...material });
  if (errors.length) throw new Error(errors.join(' '));
  const targetMM = 40*(1-margin/100);
  // x = [height in metres, thickness / 20 mm]. Normalization makes gradients
  // of the two dimensions comparable. The projection enforces the bounds.
  const project = x => {
    const a = Math.max(0.016002, Math.min(1, x[0]));
    return [a, Math.max(0.4, Math.min((a/2-1e-6)/0.02, x[1]))];
  };
  const evaluate = x => sizeWidth(material,x[0]*1000,x[1]*20,model,targetMM);
  const objective = x => { const c = evaluate(x); return c ? c.mass/1000 : 1e12; };
  const seeds = [];
  for (const a of [0.3,0.6,1]) for (const t of [0.008,0.012,0.024]) seeds.push([a,t/0.02]);
  if (Number.isFinite(base.a) && Number.isFinite(base.t)) seeds.push([base.a/1000,base.t/20]);
  let best = null, totalIterations = 0, evaluations = 0;
  const runs = [];
  for (let startIndex = 0; startIndex < seeds.length; startIndex++) {
    const seed = seeds[startIndex];
    let x = project(seed), current = evaluate(x);
    if (!current) { runs.push({ start:startIndex+1, initialA:seed[0]*1000, initialT:seed[1]*20, feasible:false, trace:[], status:'Infeasible initial point' }); continue; }
    let f = current.mass/1000, accepted = 0, converged = false;
    const trace = [{ iteration:0, a:current.p.a, b:current.p.b, t:current.p.t, mass:current.mass, gradientNorm:null, accepted:true, step:null, backtracks:0, evaluations }];
    for (let i = 0; i < maxIterations; i++) {
      totalIterations++;
      const gradient = [0,1].map(axis => {
        const h = 1e-5, plus = [...x], minus = [...x];
        plus[axis] += h; minus[axis] -= h;
        const xp = project(plus), xm = project(minus);
        const fp = objective(xp), fm = objective(xm); evaluations += 2;
        const distance = xp[axis]-xm[axis];
        return distance > 0 ? (fp-fm)/distance : 0;
      });
      const gradientNorm = Math.hypot(...gradient);
      let step = 0.5, moved = false, backtracks = 0, stopReason = '';
      for (let backtrack = 0; backtrack < 35; backtrack++, step *= 0.5) {
        backtracks = backtrack + 1;
        const nextX = project(x.map((value,j) => value-step*gradient[j]));
        const dx = nextX.map((value,j) => value-x[j]);
        if (Math.hypot(...dx) < 1e-10) { converged = true; stopReason = 'Projected step tolerance'; break; }
        const next = evaluate(nextX); evaluations++;
        const slope = gradient.reduce((sum,g,j) => sum+g*dx[j],0);
        if (next && slope < 0 && next.mass/1000 <= f+1e-4*slope) {
          x = nextX; current = next; f = current.mass/1000;
          accepted++; moved = true; break;
        }
      }
      trace.push({ iteration:i+1, a:current.p.a, b:current.p.b, t:current.p.t, mass:current.mass, gradientNorm, accepted:moved, step:moved?step:null, backtracks, evaluations, stopReason:stopReason || (!moved?'Line search stopped':'') });
      if (!moved) { converged = true; break; }
    }
    const run = { start:startIndex+1, initialA:seed[0]*1000, initialT:seed[1]*20, feasible:true, initialMass:trace[0].mass, finalMass:current.mass, accepted, iterations:trace.length-1, converged, trace, status:converged?(trace.at(-1).stopReason||'Converged'):'Iteration limit' };
    runs.push(run);
    if (!best || current.mass < best.candidate.mass) best = { candidate:current, run };
  }
  if (!best) throw new Error('No feasible candidate found from the search starts for these material properties and target.');
  // Round to practical 0.1 mm dimensions, then re-size width and round it UP
  // so the reported/applied candidate still meets the chosen analytic target.
  const roundUp = value => Math.ceil((value-1e-9)*10)/10;
  const a = Math.min(1000,roundUp(best.candidate.p.a)), t = roundUp(best.candidate.p.t);
  const rounded = sizeWidth(material,a,t,model,targetMM);
  if (!rounded) throw new Error('Rounding made this candidate infeasible; use a less restrictive target.');
  rounded.p.b = roundUp(rounded.p.b);
  const s = sectionProperties(rounded.p), eb = theory(rounded.p,s);
  const predicted = (model === 'timoshenko' ? eb.timoshenko : eb.delta)*1000;
  if (predicted > targetMM+1e-7) throw new Error('Rounded candidate failed the displacement constraint.');
  return {
    p:rounded.p, mass:s.mass, I:s.I, eb:eb.delta*1000, timoshenko:eb.timoshenko*1000,
    predicted, targetMM, model, margin, history:best.run.trace.map(point=>point.mass), trace:best.run.trace,
    runs, bestStart:best.run.start, iterations:totalIterations,
    accepted:best.run.accepted, evaluations, starts:seeds.length,
    status:best.run.status, rawMass:best.candidate.mass
  };
}
