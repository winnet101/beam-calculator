import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, CASES, sectionProperties, theory, calculate, loads, validate, voxelSection, solveFE, stressAt } from './beam.js';
const near = (actual, expected, tol = 1e-7) => assert.ok(Math.abs(actual-expected) <= tol*Math.max(Math.abs(expected),1e-16), `${actual} != ${expected}`);

test('PDF I-beam geometry, units, mass and total bearing load', () => {
  const p = {...DEFAULTS}, s = sectionProperties(p);
  near(s.A, 2*0.3*0.008+0.984*0.008);
  near(s.I, (0.3-0.292*0.984**3)/12);
  near(s.mass, 8000*s.A*12);
  near(loads(p).F, 57800); near(loads(p).q, 57800/12);
  near(theory(p).delta, 57800*12**3/(8*193e9*s.I));
});
test('screenshot rectangular uniform cantilever benchmark', () => {
  const p = {...DEFAULTS,section:'rectangle',L:4,b:400,a:600,load:5,loadMode:'line',nx:88,ny:22,nz:16};
  const r = calculate(p);
  near(r.section.I*1e12, 7.2e9);
  near(r.eb.delta*1000,0.11514104778353484,1e-6);
  near(r.eb.M,40000); near(r.eb.stress/1e6,1.6666666666666667);
  assert.ok(r.fe.delta > r.eb.delta);
  near(r.section.G/1e9,74.8062015503876);
});
for (const key of Object.keys(CASES)) {
  test(`${key}: finite-element solver matches continuum Timoshenko reference with exact I`, () => {
    const p = {...DEFAULTS,section:'rectangle',case:key,L:4,a:600,b:400,nx:40};
    const s = sectionProperties(p), ref = theory(p,s), vox = voxelSection(p);
    const fe = solveFE(p,s,{...vox,I:s.I});
    near(fe.delta,ref.timoshenko,2e-7);
    near(fe.nodes[0].v,0);
    if (CASES[key].cantilever) near(fe.nodes[0].theta,0); else near(fe.nodes.at(-1).v,0);
  });
}
test('voxel clipping preserves I-section area, including thin flanges/web', () => {
  for (const ny of [4,12,24,80]) {
    const p={...DEFAULTS,ny,t:1};
    const s=sectionProperties(p), v=voxelSection(p);
    near(v.A,s.A);assert.ok(v.I>0 && v.I<s.I);assert.ok(v.count>0);
  }
});
test('rectangular centroid quadrature converges as 1/ny²', () => {
  for(const ny of [4,12,24,80]) {
    const p={...DEFAULTS,section:'rectangle',ny},s=sectionProperties(p),v=voxelSection(p);
    near(v.I,s.I*(1-1/ny**2));
  }
});
test('custom inertia affects stiffness and stress, not area/mass', () => {
  const p={...DEFAULTS,custom:true,customI:1e9};
  const r=calculate(p), base=calculate(DEFAULTS);
  near(r.fe.I,0.001); near(r.section.mass,base.section.mass);
  assert.ok(r.eb.delta>base.eb.delta);
});
test('total load and equivalent line load produce identical solutions', () => {
  const a=calculate(DEFAULTS), b=calculate({...DEFAULTS,loadMode:'line',load:57.8/12});
  near(a.eb.delta,b.eb.delta);near(a.fe.delta,b.fe.delta);
});
test('validation rejects singular geometry, invalid materials and mesh', () => {
  for(const patch of [{L:0},{E:NaN},{nu:0.5},{nu:-1},{a:16,t:8},{t:400},{nx:7},{nx:10000},{ny:3},{custom:true,customI:0},{case:'unknown'}]) assert.ok(validate({...DEFAULTS,...patch}).length,JSON.stringify(patch));
  assert.throws(()=>calculate({...DEFAULTS,L:-2}));
});
test('stress recovery has opposite signs at top and bottom fibers', () => {
  const p={...DEFAULTS},s=sectionProperties(p);
  near(stressAt(p,s,s.I,0,s.a/2),-stressAt(p,s,s.I,0,-s.a/2));
});
test('mesh refinement approaches exact Timoshenko bending solution', () => {
  const coarse=calculate({...DEFAULTS,section:'rectangle',ny:4});
  const fine=calculate({...DEFAULTS,section:'rectangle',ny:80});
  const exact=fine.eb.timoshenko;
  assert.ok(Math.abs(fine.fe.delta-exact)<Math.abs(coarse.fe.delta-exact));
});
