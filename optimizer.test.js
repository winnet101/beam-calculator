import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, sectionProperties, theory } from './beam.js';
import { optimizeBeam, sizeWidth, inertiaEfficiency } from './optimizer.js';
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol*Math.max(1e-15,Math.abs(b)),`${a} != ${b}`);

for(const model of ['eb','timoshenko']) {
  for(const margin of [0,10,40]) {
    test(`${model}, ${margin}% margin: rounded candidate satisfies analytic constraints`,()=>{
      const r=optimizeBeam(DEFAULTS,{model,margin});
      assert.equal(r.p.L,12);assert.equal(r.p.case,'cantileverUniform');assert.equal(r.p.load,57.8);
      assert.equal(r.p.section,'ibeam');assert.equal(r.p.custom,false);
      assert.ok(r.p.a<=1000 && r.p.t>=8 && r.p.a>2*r.p.t && r.p.b>=r.p.t);
      assert.ok(r.predicted<=40*(1-margin/100)+1e-7);
      near(r.mass,sectionProperties(r.p).mass);
      near(r.predicted,(model==='eb'?theory(r.p).delta:theory(r.p).timoshenko)*1000);
      const acceptedMass=r.trace.filter(point=>point.iteration===0||point.accepted).map(point=>point.mass);
      assert.ok(acceptedMass.every((mass,i)=>i===0||mass<acceptedMass[i-1]));
      assert.ok(r.trace.length>1);
      for(const point of r.trace) {
        const section=sectionProperties({...r.p,a:point.a,b:point.b,t:point.t});
        const predicted=(model==='eb'?theory({...r.p,a:point.a,b:point.b,t:point.t},section).delta:theory({...r.p,a:point.a,b:point.b,t:point.t},section).timoshenko)*1000;
        assert.ok(Math.abs(predicted-r.targetMM)<1e-5,`Iteration ${point.iteration} should keep its analytically sized flange width on target`);
        assert.ok(point.a>2*point.t&&point.b>=point.t);
      }
    });
  }
}
test('zero-margin PDF benchmark reaches expected height/thickness bounds and width',()=>{
  const r=optimizeBeam(DEFAULTS,{model:'eb',margin:0});
  assert.equal(r.p.a,1000);assert.equal(r.p.t,8);near(r.p.b,249.5);near(r.mass,1138.944);
});
test('Timoshenko sizing is heavier than EB at the same target',()=>{
  const eb=optimizeBeam(DEFAULTS,{model:'eb'}),t=optimizeBeam(DEFAULTS,{model:'timoshenko'});
  assert.ok(t.mass>eb.mass);assert.ok(eb.timoshenko>eb.predicted);
});
test('density rescales mass but not optimal dimensions; current wrong case/load cannot leak into assignment',()=>{
  const a=optimizeBeam(DEFAULTS),b=optimizeBeam({...DEFAULTS,rho:7850,L:18,a:2400,case:'tip',load:1000,section:'rectangle',custom:true});
  near(b.mass/a.mass,7850/8000);near(a.p.b,b.p.b);near(a.p.a,b.p.a);near(a.p.t,b.p.t);
  assert.equal(b.p.L,12);assert.equal(b.p.load,57.8);assert.equal(b.p.case,'cantileverUniform');
});
test('reduced-width sizing meets exact target and rejects impossible shear allowance',()=>{
  for(const model of ['eb','timoshenko']) {
    const r=sizeWidth(DEFAULTS,700,10,model,36);assert.ok(r);near(r.predicted,36);
  }
  assert.equal(sizeWidth(DEFAULTS,20,8,'timoshenko',1),null);
  assert.equal(sizeWidth(DEFAULTS,2400,8,'eb',40),null);
});
test('analytical inertia-per-mass derivatives agree with finite differences',()=>{
  const efficiencies=inertiaEfficiency(DEFAULTS);
  for(const key of ['a','b','t']) {
    const h=0.0001;
    const lo=sectionProperties({...DEFAULTS,[key]:DEFAULTS[key]-h});
    const hi=sectionProperties({...DEFAULTS,[key]:DEFAULTS[key]+h});
    near(efficiencies[key],(hi.I-lo.I)/(hi.mass-lo.mass),1e-5);
  }
  assert.ok(efficiencies.a>efficiencies.b && efficiencies.b>efficiencies.t);
});
test('multi-start result is no heavier than a dense independent feasible grid',()=>{
  const r=optimizeBeam(DEFAULTS,{model:'timoshenko',margin:10});
  let gridBest=Infinity;
  for(let a=300;a<=1000;a+=10) for(let t=8;t<=40;t+=0.5) {
    const c=sizeWidth(DEFAULTS,a,t,'timoshenko',36);if(c)gridBest=Math.min(gridBest,c.mass);
  }
  assert.ok(r.mass<=gridBest+0.2); // Final width is rounded upward to 0.1 mm.
});
test('optimizer validates options and material',()=>{
  for(const options of [{margin:-1},{margin:91},{margin:NaN},{model:'solid-FEA'},{maxIterations:0}]) assert.throws(()=>optimizeBeam(DEFAULTS,options));
  for(const patch of [{E:0},{rho:NaN},{nu:0.5}]) assert.throws(()=>optimizeBeam({...DEFAULTS,...patch}));
});
