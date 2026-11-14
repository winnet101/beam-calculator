import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS,sectionProperties,theory } from './beam.js';
import { gridSearchBeam } from './grid-search.js';

for(const model of ['eb','timoshenko']) {
  test(`grid ${model}: matches independent full a/b/t enumeration, including off-grid 1000 mm endpoint`,async()=>{
    const options={model,margin:10,aStep:300,tStep:100,bStep:100,bMax:1000};
    const r=await gridSearchBeam(DEFAULTS,options);
    let best=null;
    const feasibleDesigns=[];
    for(const a of [300,600,900,1000])for(let t=8;t<500;t+=100)for(let b=100;b<=1000;b+=100){
      if(a<=2*t||b<t)continue;
      const p={...DEFAULTS,a,t,b};const s=sectionProperties(p),d=theory(p,s);
      const predicted=(model==='eb'?d.delta:d.timoshenko)*1000;
      if(predicted<36) {
        feasibleDesigns.push({mass:s.mass,a,b,t});
        if(!best||s.mass<best.mass)best={mass:s.mass,a,b,t};
      }
    }
    assert.ok(best);assert.equal(r.checked,20);assert.equal(r.total,20);
    assert.ok(Math.abs(r.mass-best.mass)<1e-8);
    assert.deepEqual([r.p.a,r.p.b,r.p.t],[best.a,best.b,best.t]);
    assert.ok(r.predicted<36);assert.equal(r.p.L,12);assert.equal(r.p.load,57.8);
    feasibleDesigns.sort((a,b)=>a.mass-b.mass);
    assert.deepEqual(r.top.map(c=>c.mass),feasibleDesigns.slice(0,10).map(c=>c.mass));
  });
}
test('default grid visits all declared pairs; feasible best histories are monotone and ranked',async()=>{
  const updates=[];
  const r=await gridSearchBeam(DEFAULTS,{onProgress:p=>updates.push(p)});
  assert.equal(r.checked,100*492);assert.equal(r.checked,r.total);
  assert.equal(updates.at(-1).checked,r.total);
  assert.ok(r.geometric<r.total && r.feasible<=r.geometric);
  assert.equal(r.top.length,10);
  assert.ok(r.top.every((v,i)=>i===0||v.mass>=r.top[i-1].mass));
  const masses=r.gridHistory.filter(p=>p.bestMass!==null).map(p=>p.bestMass);
  assert.ok(masses.every((m,i)=>i===0||m<=masses[i-1]));
  assert.equal(r.p.a,1000);assert.equal(r.p.t,8);assert.equal(r.p.b,305);
});
test('finer nested grid cannot be heavier',async()=>{
  const a=await gridSearchBeam(DEFAULTS,{aStep:20,tStep:2,bStep:2});
  const b=await gridSearchBeam(DEFAULTS,{aStep:10,tStep:1,bStep:1});
  assert.ok(b.mass<=a.mass);
});
test('strict displacement limit and grid alignment apply to every ranked candidate',async()=>{
  const r=await gridSearchBeam({...DEFAULTS,rho:7850},{model:'eb',margin:0,aStep:25,tStep:2,bStep:0.5,bMax:500});
  for(const c of r.top){
    assert.ok(c.predicted<40);assert.ok(c.p.a>2*c.p.t);assert.ok(c.p.b>=c.p.t&&c.p.b<=500);
    assert.ok(Math.abs(c.p.b/0.5-Math.round(c.p.b/0.5))<1e-8);
  }
});
test('infeasible search, excessive grid, bad options and invalid material produce clear errors',async()=>{
  await assert.rejects(gridSearchBeam(DEFAULTS,{bMax:1}),/No feasible design/);
  await assert.rejects(gridSearchBeam(DEFAULTS,{aStep:0.1,tStep:0.1}),/1,000,000/);
  for(const options of [{aStep:0},{tStep:NaN},{bStep:-1},{bMax:100001},{margin:-1},{model:'solid'}])await assert.rejects(gridSearchBeam(DEFAULTS,options));
  await assert.rejects(gridSearchBeam({...DEFAULTS,E:0}));
});
test('cancellation returns no partial result',async()=>{
  const controller=new AbortController();
  await assert.rejects(gridSearchBeam(DEFAULTS,{signal:controller.signal,onProgress:()=>controller.abort()}),/cancelled/);
});
test('search fixes assignment inputs, preserving only material, not current case/section/load',async()=>{
  const r=await gridSearchBeam({...DEFAULTS,L:20,section:'rectangle',case:'tip',custom:true,load:100,rho:7850},{aStep:100,tStep:10});
  assert.equal(r.p.section,'ibeam');assert.equal(r.p.case,'cantileverUniform');assert.equal(r.p.custom,false);
  assert.equal(r.p.L,12);assert.equal(r.p.load,57.8);assert.equal(r.p.rho,7850);
});
