import { CASES, DEFAULTS, calculate, loads, stressAt } from './beam.js';
import { optimizeBeam, inertiaEfficiency } from './optimizer.js';
import { gridSearchBeam } from './grid-search.js';

const $ = id => document.getElementById(id);
const fmt = (v, digits = 3) => Number.isFinite(v) ? new Intl.NumberFormat('en', { maximumFractionDigits: digits }).format(v) : '—';
const sci = v => v.toExponential(3).replace('e+', 'e');
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const storageKey = 'beam-lab-v1';
let p = { ...DEFAULTS }, records = [], result, frame;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved?.p) p = { ...DEFAULTS, ...saved.p };
  if (Array.isArray(saved?.records)) records = saved.records.filter(r => r && r.p && Number.isFinite(r.eb) && Number.isFinite(r.fe) && Number.isFinite(r.slenderness) && Number.isFinite(r.mass) && Number.isFinite(r.I) && (r.onshape === null || Number.isFinite(r.onshape))).slice(-100);
  calculate(p);
} catch { p = { ...DEFAULTS }; }
const save = () => { try { localStorage.setItem(storageKey, JSON.stringify({ p, records })); } catch { /* Calculator works without storage. */ } };

const geometrySpecs = [
  ['L', 'Length', 'm', 0.2, 30, 0.1], ['b', 'Width b', 'mm', 10, 1000, 1],
  ['a', 'Height a', 'mm', 20, 1500, 1], ['t', 'Thickness τ', 'mm', 1, 100, 0.5],
  ['E', 'Young’s modulus', 'GPa', 1, 250, 0.1], ['nu', 'Poisson’s ratio', 'ν', 0, 0.49, 0.01],
  ['rho', 'Density', 'kg/m³', 100, 15000, 10], ['load', 'Total force F', 'kN', 0.1, 150, 0.1]
];
function control(spec, target) {
  const [key, label, unit, min, max, step] = spec;
  const div = document.createElement('div');
  div.className = 'control'; div.dataset.control = key;
  div.innerHTML = `<div class="label-row"><label for="${key}-number">${label}</label><span class="unit">${unit}</span></div><div class="value-row"><input type="range" id="${key}-range" aria-label="${label} slider" min="${min}" max="${max}" step="${step}"><input type="number" id="${key}-number" aria-label="${label}" min="${min}" step="${step}"></div>`;
  $(target).append(div);
  for (const kind of ['range', 'number']) {
    $(`${key}-${kind}`).addEventListener('input', event => {
      const value = Number(event.target.value);
      if (event.target.value === '' || !Number.isFinite(value)) { showError('Enter a finite number in every field.'); return; }
      p[key] = value;
      $(`${key}-${kind === 'range' ? 'number' : 'range'}`).value = value;
      $('onshape').value = ''; schedule();
    });
  }
}
geometrySpecs.forEach(s => control(s, 'geometry-controls'));
[['nx','Length voxels','x',4,160,2],['ny','Height voxels','y',4,80,1],['nz','Width voxels','z',4,80,1]].forEach(s => control(s, 'mesh-controls'));
for (const [key, c] of Object.entries(CASES)) {
  const button = document.createElement('button');
  button.textContent = c.name; button.dataset.case = key;
  button.addEventListener('click', () => { p.case = key; $('onshape').value = ''; sync(); update(); });
  $('cases').append(button);
}
function sync() {
  for (const key of [...geometrySpecs.map(s => s[0]), 'nx', 'ny', 'nz']) for (const kind of ['range','number']) $(`${key}-${kind}`).value = p[key];
  for (const id of ['section', 'loadMode', 'customI']) $(id).value = p[id];
  $('custom').checked = p.custom;
  document.querySelectorAll('[data-case]').forEach(button => button.setAttribute('aria-pressed', button.dataset.case === p.case));
  document.querySelector('[data-control=t]').hidden = p.section !== 'ibeam';
  $('custom-field').hidden = !p.custom;
  $('loadMode').disabled = !CASES[p.case].uniform;
  const line = CASES[p.case].uniform && p.loadMode === 'line';
  document.querySelector('[data-control=load] label').textContent = line ? 'Line load q' : 'Total force F';
  document.querySelector('[data-control=load] .unit').textContent = line ? 'kN/m' : 'kN';
}
for (const id of ['section', 'loadMode', 'custom', 'customI']) $(id).addEventListener('input', () => {
  if (id === 'loadMode') {
    const line = $('loadMode').value === 'line';
    p.load = line ? p.load / p.L : p.load * p.L;
  }
  p[id] = id === 'custom' ? $(id).checked : id === 'customI' ? Number($(id).value) : $(id).value;
  $('onshape').value = ''; sync(); update();
});
function showError(message) { $('error').textContent = message; $('error').hidden = false; $('record').disabled = true; }
function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); }
function rows(id, values) { $(id).innerHTML = values.map(([name, value, primary]) => `<div${primary ? ' class="primary"' : ''}><dt>${name}</dt><dd>${value}</dd></div>`).join(''); }

function update() {
  try { result = calculate(p); } catch (e) { result = null; showError(e.message); return; }
  $('error').hidden = true; $('record').disabled = false;
  sync(); save();
  const { section:s, eb, voxel, fe, peak, difference } = result, c = CASES[p.case], { F, q } = loads(p);
  $('boundary-badge').textContent = c.cantilever ? 'Fixed–free span' : 'Pinned–roller span';
  $('boundary-note').textContent = c.boundary;
  $('formula').textContent = c.formula;
  $('section-formula').textContent = `${p.section === 'ibeam' ? 'I = [b a³ − (b − τ)(a − 2τ)³] / 12' : 'I = b a³ / 12'} = ${sci(s.geometricI * 1e12)} mm⁴${p.custom ? ' (overridden)' : ''}`;
  $('area-mass').textContent = `A = ${fmt(s.A*1e6,1)} mm² · m = ρ A L = ${fmt(s.mass,1)} kg`;
  $('load-note').textContent = c.uniform ? `F = ${fmt(F/1000)} kN total → q = F/L = ${fmt(q/1000)} kN/m` : `F = ${fmt(F/1000)} kN point load`;
  rows('theory-results', [
    ['Maximum displacement', `${fmt(eb.delta*1000)} mm`, true],
    ['Maximum bending moment', `${fmt(eb.M/1000)} kN·m`],
    ['Extreme-fiber bending stress', `${fmt(eb.stress/1e6)} MPa`],
    ['Small-deflection ratio', `${fmt(100*eb.ratio)}% of span`],
    ['Slenderness L/a', fmt(p.L/s.a,2)], ['Beam mass', `${fmt(s.mass,2)} kg`]
  ]);
  $('voxel-count').textContent = `${fmt(voxel.count,0)} occupied voxels`;
  rows('fe-results', [
    ['Timoshenko beam FE displacement', `${fmt(fe.delta*1000)} mm`, true],
    ['Difference from Euler–Bernoulli', `${difference >= 0 ? '+' : ''}${fmt(difference,2)}%`],
    ['Shear modulus G', `${fmt(s.G/1e9,2)} GPa`],
    ['Peak signed von Mises magnitude', `±${fmt(peak/1e6,2)} MPa`],
    [p.section === 'rectangle' ? 'Cowper shear coefficient' : 'Effective shear area / A (web model)', fmt(s.kappa,4)],
    ['Voxel area A', `${sci(voxel.A*1e6)} mm²`],
    ['Voxel section I', `${sci(voxel.I*1e12)} mm⁴`],
    ['Simulation stiffness I', `${sci(fe.I*1e12)} mm⁴`],
    ['Continuum Timoshenko reference', `${fmt(eb.timoshenko*1000)} mm`]
  ]);
  $('stress-blue').textContent = `blue: −${fmt(peak/1e6,2)} MPa`;
  $('stress-red').textContent = `red: +${fmt(peak/1e6,2)} MPa`;
  $('substitution').innerHTML = `<p>${p.section === 'ibeam' ? `I = [(${p.b} mm)(${p.a} mm)³ − (${p.b} − ${p.t}) mm × (${p.a} − 2 × ${p.t})³ mm³] / 12` : `I = (${p.b} mm)(${p.a} mm)³ / 12`} = ${sci(s.geometricI*1e12)} mm⁴${p.custom ? `<br>Using custom I = ${sci(s.I*1e12)} mm⁴ instead.` : ''}</p><p>A = ${p.section === 'ibeam' ? `2(${p.b})(${p.t}) + (${p.a} − 2 × ${p.t})(${p.t})` : `${p.b} × ${p.a}`} mm² = ${fmt(s.A*1e6)} mm²</p><p>m = ρ A L = (${p.rho} kg/m³)(${sci(s.A)} m²)(${p.L} m) = ${fmt(s.mass)} kg</p><p>${c.uniform ? `q = F/L = (${fmt(F)} N)/(${p.L} m) = ${fmt(q)} N/m<br>` : ''}${c.formula}<br>${substitute(p, s, F, q)} = ${sci(eb.delta)} m = ${fmt(eb.delta*1000)} mm</p>`;
  $('model-details').textContent = `The length is divided into ${p.nx} shear-flexible beam elements, with transverse displacement and rotation at each node. Cross-section cells are clipped to the actual shape, conserving area; centroid quadrature of their second moments converges to geometric I. Width cells do not create additional bending DOFs. ${p.section === 'rectangle' ? 'Solid rectangle: κ = 10(1+ν)/(12+11ν), Cowper shear coefficient.' : 'I-section: effective shear area ≈ (5/6)(a−2τ)τ, an engineering web-only approximation, not Cowper’s solid-rectangle formula.'} Shear deformation and voxel quadrature both contribute to the difference from Euler–Bernoulli. Refining length does not turn this into a 3-D solid model. Stress uses bending plus approximate parabolic rectangular / uniform-web shear. Custom I overrides stiffness and bending stress only; area and mass still follow the chosen shape.`;
  const warnings = [];
  if (p.L/s.a < 10) warnings.push('Short/deep beam: shear deformation and local support/load effects can make Euler–Bernoulli theory inaccurate. The beam FE estimate also omits 3-D effects.');
  if (eb.ratio > 0.02) warnings.push('Displacement exceeds 2% of span. Small-deflection linear theory may no longer apply; use geometric-nonlinear FEA.');
  if (eb.stress > 205e6) warnings.push('Bending stress exceeds a nominal 205 MPa reference for annealed 304. Actual yield varies; this is not a strength, buckling, or safety check.');
  if (p.custom) warnings.push('Custom I is active. Assignment geometry checks cannot be confirmed using an overridden inertia.');
  if ((s.geometricI-voxel.I)/s.geometricI > 0.02) warnings.push('Section grid stiffness differs from geometric I by more than 2%. Increase height voxels for a convergence check.');
  $('warnings').innerHTML = warnings.map(w => `<p>${w}</p>`).join('');
  drawSection(); drawBeam(); updateChecks();
  const efficiency = inertiaEfficiency(p);
  $('inertia-efficiency').textContent = p.section === 'ibeam'
    ? `Current I-beam · local ∂I/∂m (mm⁴/kg): a = ${sci(efficiency.a*1e12)} · b = ${sci(efficiency.b*1e12)} · τ = ${sci(efficiency.t*1e12)}. Higher is more efficient, before bounds or shear effects.`
    : 'Select an I-beam to compare its local inertia gain per kilogram.';
}
function substitute(p,s,F,q) {
  const E = `(${p.E} × 10⁹ N/m²)`, I = `(${sci(s.I)} m⁴)`, L = `(${p.L} m)`;
  if (p.case === 'tip') return `(${fmt(F)} N)${L}³ / [3 ${E}${I}]`;
  if (p.case === 'center') return `(${fmt(F)} N)${L}³ / [48 ${E}${I}]`;
  return `${p.case === 'simpleUniform' ? '5 × ' : ''}(${fmt(q)} N/m)${L}⁴ / [${p.case === 'simpleUniform' ? 384 : 8} ${E}${I}]`;
}
function drawSection() {
  const isI = p.section === 'ibeam', thickness = Math.max(3, 80*p.t/p.a), web = Math.max(3, 80*p.t/p.b);
  $('section-svg').innerHTML = `<g fill="#dde9e4" stroke="#58766a" stroke-width="1.4">${isI ? `<path d="M40 15 H130 V${15+thickness} H${85+web/2} V${95-thickness} H130 V95 H40 V${95-thickness} H${85-web/2} V${15+thickness} H40 Z"/>` : '<rect x="40" y="15" width="90" height="80"/>'}</g><g stroke="#9aaaa2" stroke-width=".7"><path d="M30 15 V95 M26 15 H34 M26 95 H34 M40 106 H130 M40 102 V110 M130 102 V110"/></g><g font-size="12" fill="#52695c" font-family="system-ui"><text x="15" y="60">a</text><text x="82" y="119">b</text>${isI ? '<text x="100" y="60">τ</text>' : ''}</g>`;
}
function canvasContext(canvas) {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width*dpr); canvas.height = Math.round(rect.height*dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr,dpr); return { ctx, w:rect.width, h:rect.height };
}
function color(stress, peak) {
  const t = Math.min(1, Math.abs(stress)/(peak || 1));
  const neutral = [220,225,223], extreme = stress < 0 ? [39,117,166] : [181,59,48];
  return `rgb(${neutral.map((n,i) => Math.round(n+(extreme[i]-n)*t)).join(',')})`;
}
function drawBeam() {
  if (!result) return;
  const { ctx, w, h } = canvasContext($('beam')), { section:s, fe, peak } = result;
  if (!w) return;
  ctx.clearRect(0,0,w,h);
  const left = 25, right = w-18, scale = (right-left)/p.L;
  const mid = h*.53, beamHeight = s.a*scale;
  const auto = fe.delta > 0 ? Math.max(1, Math.min(5000, (h*.18)/(fe.delta*scale))) : 1;
  const factor = $('magnify').value === 'auto' ? auto : Number($('magnify').value);
  const offset = v => Math.min(h*0.32, v*scale*factor);
  const clipped = fe.delta*scale*factor > h*.32;
  const y = (node, yPhysical) => mid-yPhysical*scale+offset(node.v);
  ctx.strokeStyle = '#dce5e0'; ctx.lineWidth = 1;
  for (let gy = 20; gy < h-20; gy += 45) { ctx.beginPath(); ctx.moveTo(left,gy); ctx.lineTo(right,gy); ctx.stroke(); }
  // Elevation projection: width cells share the same vertical displacement.
  for (let i = 0; i < p.nx; i++) {
    const n0 = fe.nodes[i], n1 = fe.nodes[i+1];
    for (let j = 0; j < p.ny; j++) {
      const lo = (j/p.ny-.5)*s.a, hi = ((j+1)/p.ny-.5)*s.a;
      ctx.fillStyle = color(stressAt(p,s,fe.I,(n0.x+n1.x)/2,(lo+hi)/2),peak);
      ctx.beginPath(); ctx.moveTo(left+n0.x*scale,y(n0,hi)); ctx.lineTo(left+n1.x*scale,y(n1,hi)); ctx.lineTo(left+n1.x*scale,y(n1,lo)); ctx.lineTo(left+n0.x*scale,y(n0,lo)); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#54696035'; ctx.lineWidth = .4; ctx.stroke();
    }
  }
  ctx.strokeStyle = '#2e4b40'; ctx.lineWidth = 1;
  ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(left,mid); ctx.lineTo(right,mid); ctx.stroke(); ctx.setLineDash([]);
  const config = CASES[p.case];
  if (config.cantilever) {
    ctx.fillStyle = '#536b60'; ctx.fillRect(left-8,mid-beamHeight/2-8,5,beamHeight+16);
    ctx.strokeStyle = '#536b60';
    for (let i = mid-beamHeight/2-8; i < mid+beamHeight/2+8; i += 6) { ctx.beginPath();ctx.moveTo(left-10,i);ctx.lineTo(left-16,i+6);ctx.stroke(); }
  } else {
    for (const x of [left,right]) { ctx.beginPath();ctx.moveTo(x,mid+beamHeight/2+3);ctx.lineTo(x-7,mid+beamHeight/2+15);ctx.lineTo(x+7,mid+beamHeight/2+15);ctx.closePath();ctx.stroke(); }
    ctx.beginPath();ctx.moveTo(right-9,mid+beamHeight/2+19);ctx.lineTo(right+9,mid+beamHeight/2+19);ctx.stroke();
  }
  const top = mid-beamHeight/2;
  const arrowXs = config.uniform ? Array.from({length:7},(_,i) => left+(right-left)*i/6) : [p.case === 'tip' ? right : (left+right)/2];
  const arrowTop = Math.max(20,top-48);
  ctx.strokeStyle = '#b54b3b';ctx.fillStyle='#b54b3b';ctx.lineWidth=1.2;
  for (const x of arrowXs) {
    ctx.beginPath();ctx.moveTo(x,arrowTop);ctx.lineTo(x,top-5);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x,top-3);ctx.lineTo(x-3,top-10);ctx.lineTo(x+3,top-10);ctx.closePath();ctx.fill();
  }
  if (config.uniform) { ctx.beginPath();ctx.moveTo(left,arrowTop);ctx.lineTo(right,arrowTop);ctx.stroke(); }
  ctx.font='10px system-ui';ctx.fillStyle='#64796d';ctx.textAlign='left';
  ctx.fillText(`${fmt(p.L)} m · ${fmt(s.a*1000,0)} mm deep${p.section === 'ibeam' ? ' · I-section elevation' : ''}`,left,h-22);
  ctx.textAlign='right';ctx.fillText(`Deflection ×${fmt(factor,0)}${clipped ? ' (display capped)' : ''}`,right,h-7);
}
$('magnify').addEventListener('change',drawBeam);

function onshapeValue() { const raw = $('onshape').value; return raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null; }
function assignmentMatches() { return p.section === 'ibeam' && !p.custom && p.case === 'cantileverUniform' && Math.abs(loads(p).F-57800)<0.1; }
function updateChecks() {
  if (!result) return;
  const { eb, section:s } = result, actual = onshapeValue();
  const material = p.E === 193 && p.rho === 8000;
  const c3 = assignmentMatches() && actual !== null && actual <= 40;
  const checks = [
    [p.L>=12, 'C1 · Length ≥ 12 m', `${fmt(p.L)} m`],
    [null, 'C2 · Stainless Steel 304', material ? '304 theory defaults; verify material in Onshape' : 'Material properties modified; verify 304 library values'],
    [c3 ? true : assignmentMatches() && actual === null ? null : false, 'C3 · Onshape droop ≤ 40 mm', assignmentMatches() ? actual === null ? `Theory ${fmt(eb.delta*1000)} mm; FEA pending` : `Entered FEA ${fmt(actual)} mm · theory ${fmt(eb.delta*1000)} mm` : 'Requires I-beam, uniform cantilever, 57.8 kN, geometric I'],
    [p.section === 'ibeam' && p.t>=8 && p.a<=1000, 'C4 · τ ≥ 8 mm; a ≤ 1000 mm', `τ = ${fmt(p.t)} mm · a = ${fmt(p.a)} mm`]
  ];
  $('checks').innerHTML = checks.map(([pass,title,detail]) => `<div class="check ${pass === null ? 'pending' : pass ? '' : 'fail'}"><strong>${pass === null ? '○' : pass ? '✓' : '×'} ${title}</strong><br>${detail}</div>`).join('');
  $('confirmation').textContent = actual === null ? 'Not FEA-confirmed. Enter the maximum displacement from your matching Onshape run.' : `User-entered Onshape: ${fmt(actual)} mm · EB: ${fmt(eb.delta*1000)} mm · error: ${fmt((actual/(eb.delta*1000)-1)*100,2)}%. Material, load setup and model must still be verified.`;
}
$('onshape').addEventListener('input', updateChecks);
$('assignment').addEventListener('click', () => { p = { ...DEFAULTS }; $('onshape').value=''; sync(); update(); });
$('reset').addEventListener('click', () => { p = { ...DEFAULTS, section:'rectangle', L:4, b:400, a:600, load:5, loadMode:'line', nx:88, ny:22, nz:16 }; $('onshape').value=''; sync(); update(); });
$('print').addEventListener('click', () => window.print());
$('record').addEventListener('click', () => {
  if (!result || !$('error').hidden) return;
  if ($('onshape').value !== '' && onshapeValue() === null) { alert('Onshape displacement must be a nonnegative number in mm.'); return; }
  records.push({ p:{...p}, slenderness:p.L/result.section.a, I:result.section.I*1e12, mass:result.section.mass, eb:result.eb.delta*1000, fe:result.fe.delta*1000, onshape:onshapeValue() });
  records = records.slice(-100); save(); renderStudy();
});
$('clear').addEventListener('click', () => { if (records.length && !confirm('Clear all recorded geometries?')) return; records=[];save();renderStudy(); });
function renderStudy() {
  $('empty-study').hidden = records.length>0;
  $('study-table').hidden = !records.length; $('study').hidden = !records.length;
  $('study-table').querySelector('tbody').innerHTML = records.map((r,i) => `<tr><td>${esc(CASES[r.p.case]?.name || r.p.case)} / ${esc(r.p.section)}</td><td>${fmt(r.slenderness,2)}</td><td>${fmt(r.p.a)} / ${fmt(r.p.b)} / ${r.p.section === 'ibeam' ? fmt(r.p.t) : '—'}</td><td>${fmt(r.p.L)}</td><td>${sci(r.I)}</td><td>${fmt(r.mass,1)}</td><td>${fmt(r.eb)}</td><td>${fmt(r.fe)}</td><td>${r.onshape === null ? 'pending' : fmt(r.onshape)}</td><td>${r.onshape === null ? '—' : fmt((r.onshape/r.eb-1)*100,2)+'%'}</td><td><button aria-label="Remove recorded geometry ${i+1}" data-remove="${i}">×</button></td></tr>`).join('');
  drawStudy();
}
$('study-table').addEventListener('click',e => { const button=e.target.closest('[data-remove]');if(button){records.splice(Number(button.dataset.remove),1);save();renderStudy();} });
function drawStudy() {
  if (!records.length) return;
  const {ctx,w,h} = canvasContext($('study')), left=60,right=w-25,top=30,bottom=h-40;
  const xmax=Math.max(...records.map(r=>r.slenderness))*1.1 || 1;
  const ymax=Math.max(...records.flatMap(r=>[r.eb,r.fe,r.onshape||0]))*1.15 || 1;
  const x=v=>left+v/xmax*(right-left),y=v=>bottom-v/ymax*(bottom-top);
  ctx.font='10px system-ui';ctx.strokeStyle='#d6e0da';ctx.fillStyle='#60756a';
  for(let i=0;i<=4;i++) { const value=ymax*i/4;ctx.beginPath();ctx.moveTo(left,y(value));ctx.lineTo(right,y(value));ctx.stroke();ctx.textAlign='right';ctx.fillText(fmt(value,1),left-8,y(value)+3);ctx.textAlign='center';ctx.fillText(fmt(xmax*i/4,1),x(xmax*i/4),bottom+16); }
  ctx.textAlign='left';ctx.fillText('Displacement (mm)',left,12);ctx.textAlign='right';ctx.fillText('L/a',right,bottom+32);
  const series=[['eb','#236384','Euler–Bernoulli'],['fe','#bc8b3a','Beam FE'],['onshape','#b54b3b','Onshape']];
  series.forEach(([key,color,label],j)=>{ctx.fillStyle=color;ctx.textAlign='left';const lx=left+j*(right-left)/3;ctx.fillRect(lx,h-8,7,7);ctx.fillText(w<500 && key==='eb' ? 'EB theory' : label,lx+12,h-1);for(const r of records){if(r[key]===null)continue;ctx.beginPath();ctx.arc(x(r.slenderness),y(r[key]),4,0,Math.PI*2);ctx.fill();}});
}
$('export').addEventListener('click', () => {
  if (!records.length) { alert('Record at least one geometry before exporting.'); return; }
  const header=['case','section','L_m','a_mm','b_mm','tau_mm','E_GPa','nu','rho_kg_m3','F_kN','custom_I','I_mm4','mass_kg','L_over_a','EB_mm','beam_FE_mm','Onshape_mm','Onshape_error_percent','nx','ny','nz'];
  const data=records.map(r=>[r.p.case,r.p.section,r.p.L,r.p.a,r.p.b,r.p.section==='ibeam'?r.p.t:'',r.p.E,r.p.nu,r.p.rho,loads(r.p).F/1000,r.p.custom,r.I,r.mass,r.slenderness,r.eb,r.fe,r.onshape??'',r.onshape===null?'':(r.onshape/r.eb-1)*100,r.p.nx,r.p.ny,r.p.nz]);
  const csv=[header,...data].map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='beam-geometry-study.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
let optimization = null;
function drawOptimizerHistory() {
  if (!optimization || $('optimizer-output').hidden) return;
  const { ctx,w,h } = canvasContext($('optimizer-history'));
  const grid=optimization.algorithm==='grid';
  const runs=grid ? [{start:1,trace:optimization.gridHistory.filter(point=>point.bestMass!==null).map(point=>({iteration:point.checked,mass:point.bestMass}))}] : optimization.runs.filter(run=>run.feasible);
  const points=runs.flatMap(run=>run.trace);
  const allMass=points.map(point=>point.mass), lo=Math.min(...allMass), hi=Math.max(...allMass);
  const padding=Math.max((hi-lo)*0.07,Math.max(hi,1)*0.002), low=Math.max(0,lo-padding), high=hi+padding;
  const maxIteration=Math.max(1,...points.map(point=>point.iteration));
  const left=64,right=w-20,top=32,bottom=h-38;
  const x=i=>left+i/maxIteration*(right-left),y=value=>bottom-(value-low)/(high-low||1)*(bottom-top);
  ctx.font='10px system-ui';ctx.fillStyle='#64796d';ctx.strokeStyle='#dce5e0';
  for(let i=0;i<=4;i++) {const v=low+(high-low)*i/4;ctx.beginPath();ctx.moveTo(left,y(v));ctx.lineTo(right,y(v));ctx.stroke();ctx.textAlign='right';ctx.fillText(fmt(v,0),left-8,y(v)+3);}
  for(let i=0;i<=Math.min(5,maxIteration);i++){const iteration=Math.round(maxIteration*i/Math.min(5,maxIteration));ctx.beginPath();ctx.moveTo(x(iteration),top);ctx.lineTo(x(iteration),bottom);ctx.stroke();ctx.textAlign='center';ctx.fillText(fmt(iteration,0),x(iteration),bottom+14);}
  const palette=['#aab7b0','#c49c63','#7d9a8b','#c98274','#7587a3','#ada07b','#82a1a4','#9e8a9d','#78926d','#236384'];
  runs.forEach(run=>{const selected=grid||run.start===optimization.bestStart;ctx.strokeStyle=selected?'#236384':palette[(run.start-1)%palette.length];ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=selected?2.5:1.2;ctx.beginPath();run.trace.forEach((point,i)=>i?ctx.lineTo(x(point.iteration),y(point.mass)):ctx.moveTo(x(point.iteration),y(point.mass)));ctx.stroke();run.trace.forEach(point=>{ctx.beginPath();ctx.arc(x(point.iteration),y(point.mass),selected?3:2,0,Math.PI*2);ctx.fill();});});
  ctx.fillStyle='#64796d';ctx.textAlign='left';ctx.fillText(grid?'Best mass so far (kg)':'Mass (kg) · one curve per feasible initialization',left,13);ctx.textAlign='right';ctx.fillText(grid?'Height/thickness pairs checked':`Iteration · highlighted = start ${optimization.bestStart}`,right,bottom+28);
}
function iterationSectionSVG(point, scale, label = `Iteration ${point.iteration}`) {
  const width=point.b*scale,height=point.a*scale,wall=point.t*scale;
  const left=125-width/2,right=125+width/2,top=100-height/2,bottom=100+height/2;
  const wl=125-wall/2,wr=125+wall/2;
  return `<svg viewBox="0 0 250 210" role="img" aria-label="${esc(label)} I-beam: height ${fmt(point.a)} mm, width ${fmt(point.b)} mm, thickness ${fmt(point.t)} mm"><path d="M${left} ${top} H${right} V${top+wall} H${wr} V${bottom-wall} H${right} V${bottom} H${left} V${bottom-wall} H${wl} V${top+wall} H${left} Z" fill="#dde9e4" stroke="#58766a" stroke-width="0.6"/><g stroke="#9aaaa2" stroke-width="0.7"><path d="M${left-10} ${top} V${bottom} M${left-13} ${top} H${left-7} M${left-13} ${bottom} H${left-7} M${left} ${bottom+10} H${right} M${left} ${bottom+7} V${bottom+13} M${right} ${bottom+7} V${bottom+13}"/></g><g fill="#52695c" font-size="11" font-family="system-ui"><text x="${left-22}" y="104">a</text><text x="122" y="${bottom+24}">b</text></g></svg>`;
}
function renderOptimizerDiagnostics(r) {
  if(r.algorithm==='grid') { renderGridDiagnostics(r);return; }
  $('optimizer-history').setAttribute('aria-label','Mass versus iteration for all gradient-descent starts');
  $('optimizer-visualizer-heading').textContent='Cross-sections by starting point';
  $('optimizer-visualizer-note').textContent='Expand a start to inspect its beam at every iteration. Diagrams share a scale within each run; exact dimensions appear below each beam.';
  $('optimizer-run-visualizers').innerHTML=r.runs.map(run=>{
    const best=run.start===r.bestStart;
    const summary=`Start ${run.start}${best?' ★ Best candidate':''} · a ${fmt(run.initialA,1)} / τ ${fmt(run.initialT,1)} mm`;
    if(!run.feasible)return `<details class="run-visualizer"><summary>${summary} · infeasible</summary><p class="note">${esc(run.status)}</p></details>`;
    const scale=Math.min(180/Math.max(...run.trace.map(point=>point.b)),150/Math.max(...run.trace.map(point=>point.a)));
    const cards=run.trace.map(point=>`<article class="iteration-card${point.iteration>0&&!point.accepted?' stopped':''}"><h4>Iteration ${point.iteration}<span>${point.iteration===0?'Initial design':point.accepted?'Accepted update':'No move · stop'}</span></h4>${iterationSectionSVG(point,scale)}<dl><div><dt>Height a</dt><dd>${fmt(point.a,2)} mm</dd></div><div><dt>Width b</dt><dd>${fmt(point.b,2)} mm</dd></div><div><dt>Thickness τ</dt><dd>${fmt(point.t,2)} mm</dd></div><div><dt>Mass</dt><dd>${fmt(point.mass,2)} kg</dd></div></dl></article>`).join('');
    const steps=run.trace.map(point=>`<tr><td>${point.iteration}${point.stopReason?' · stop':''}</td><td>${fmt(point.a,2)}</td><td>${fmt(point.b,2)}</td><td>${fmt(point.t,2)}</td><td>${fmt(point.mass,3)}</td><td>${point.gradientNorm===null?'initial':fmt(point.gradientNorm,5)}</td><td>${point.step===null?'—':fmt(point.step,6)}</td><td>${point.backtracks}</td><td>${point.evaluations}</td></tr>`).join('');
    return `<details class="run-visualizer${best?' best-run':''}"><summary>${summary}<span>${fmt(run.initialMass,1)} → ${fmt(run.finalMass,1)} kg · ${run.iterations} iterations · ${run.accepted} accepted</span></summary><p class="model-note">${esc(run.status)} · Shared drawing scale within this start · Geometry before final 0.1 mm rounding.</p><div class="iteration-cards">${cards}</div><details class="iteration-details"><summary>Numerical diagnostics for start ${run.start}</summary><div class="table-scroll"><table><thead><tr><th>Iteration</th><th>a (mm)</th><th>b (mm)</th><th>τ (mm)</th><th>Mass (kg)</th><th>Scaled gradient norm</th><th>Step size</th><th>Search attempts</th><th>Cumulative evaluations</th></tr></thead><tbody>${steps}</tbody></table></div></details></details>`;
  }).join('');
  $('optimizer-chart-caption').textContent='Mass versus iteration for every feasible start; the best run is highlighted. Expand any starting point below to inspect its I-beam cross-section at every iteration. Terminal no-move attempts remain visible; no extra iterations are synthesized.';
}
function renderGridDiagnostics(r) {
  $('optimizer-history').setAttribute('aria-label','Best feasible mass so far versus height and thickness pairs checked during exhaustive grid search');
  $('optimizer-visualizer-heading').textContent='Lightest grid candidates';
  $('optimizer-visualizer-note').textContent=`Showing up to 10 lightest sections on this grid. Diagrams share a scale. Height and thickness steps: ${fmt(r.aStep)} / ${fmt(r.tStep)} mm; width step: ${fmt(r.bStep)} mm; numerical/practical width cap: ${fmt(r.bMax)} mm. These are candidate ranks, not descent iterations.`;
  const scale=Math.min(180/Math.max(...r.top.map(c=>c.p.b)),150/Math.max(...r.top.map(c=>c.p.a)));
  $('optimizer-run-visualizers').innerHTML=r.top.map((c,i)=>`<details class="run-visualizer${i===0?' best-run':''}"><summary>Rank ${i+1}${i===0?' ★ Grid minimum':''} · ${fmt(c.mass,2)} kg<span>a ${fmt(c.p.a,2)} / b ${fmt(c.p.b,2)} / τ ${fmt(c.p.t,2)} mm · predicted ${fmt(c.predicted,4)} mm</span></summary><div class="iteration-cards"><article class="iteration-card"><h4>Grid candidate ${i+1}</h4>${iterationSectionSVG(c.p,scale,`Grid candidate ${i+1}`)}<dl><div><dt>Height a</dt><dd>${fmt(c.p.a,2)} mm</dd></div><div><dt>Width b</dt><dd>${fmt(c.p.b,2)} mm</dd></div><div><dt>Thickness τ</dt><dd>${fmt(c.p.t,2)} mm</dd></div><div><dt>Mass</dt><dd>${fmt(c.mass,2)} kg</dd></div><div><dt>Selected-model droop</dt><dd>${fmt(c.predicted,4)} mm</dd></div></dl></article></div></details>`).join('');
  $('optimizer-chart-caption').textContent=`Completed ${fmt(r.checked,0)} height/thickness pairs: ${fmt(r.geometric,0)} passed section geometry and ${fmt(r.feasible,0)} admit a feasible grid width. For each pair, every wider width is heavier, so computing only its smallest feasible grid width gives the same minimum as a full a/b/τ enumeration. Not a guarantee between grid points or in Onshape FEA.`;
}
let searchController=null;
$('optimizer-method').addEventListener('change',()=>{ $('grid-settings').hidden=$('optimizer-method').value!=='grid'; });
$('cancel-search').addEventListener('click',()=>searchController?.abort());
$('optimize').addEventListener('click', async () => {
  $('optimize').disabled=true;
  $('optimizer-output').hidden=true;optimization=null;
  const method=$('optimizer-method').value;
  $('optimizer-status').textContent=method==='grid'?'Enumerating the discrete design grid…':'Running multi-start projected gradient descent…';
  const base={...p}, model=$('optimizer-model').value;
  searchController=new AbortController();
  $('cancel-search').hidden=method!=='grid';
  const gridOptions={aStep:Number($('grid-a-step').value),tStep:Number($('grid-t-step').value),bStep:Number($('grid-b-step').value),bMax:$('grid-b-max').value===''?100000:Number($('grid-b-max').value)};
  const rawMargin=$('optimizer-margin').value;
  const margin=rawMargin==='' ? NaN : Number(rawMargin);
  await new Promise(resolve=>setTimeout(resolve,0));
  try {
    optimization=method==='grid' ? await gridSearchBeam(base,{model,margin,...gridOptions,signal:searchController.signal,onProgress:progress=>{
      $('optimizer-status').textContent=`Grid ${fmt(progress.checked,0)} / ${fmt(progress.total,0)} pairs (${fmt(100*progress.checked/progress.total,1)}%) · ${fmt(progress.feasible,0)} feasible${progress.bestMass===null?'':` · best ${fmt(progress.bestMass,2)} kg`}`;
    }}) : optimizeBeam(base,{model,margin});
    const r=optimization;
    rows('optimizer-results',[
      ['Candidate mass',`${fmt(r.mass,2)} kg`,true],
      ['Dimensions a / b / τ',`${fmt(r.p.a,1)} / ${fmt(r.p.b,1)} / ${fmt(r.p.t,1)} mm`],
      ['Span / total force','12 m / 57.8 kN'],
      ['Material inputs used',`E ${fmt(r.p.E)} GPa · ν ${fmt(r.p.nu)} · ρ ${fmt(r.p.rho)} kg/m³`],
      ['Geometric I',`${sci(r.I*1e12)} mm⁴`],
      ['Euler–Bernoulli droop',`${fmt(r.eb)} mm`],
      ['Continuum Timoshenko droop',`${fmt(r.timoshenko)} mm`],
      ['Selected-model target',`${r.algorithm==='grid'?'<':'≤'} ${fmt(r.targetMM)} mm (${fmt(r.margin)}% margin)`],
      ['Search effort',r.algorithm==='grid'?`${fmt(r.checked,0)} / ${fmt(r.total,0)} grid pairs · ${fmt(r.feasible,0)} feasible`: `${r.runs.filter(run=>run.feasible).length}/${r.starts} feasible starts · ${r.iterations} iterations · ${r.accepted} accepted steps · ${r.evaluations} evaluations · best start ${r.bestStart}`]
    ]);
    $('optimizer-output').hidden=false;
    renderOptimizerDiagnostics(r);
    $('optimizer-status').textContent=`Candidate found using ${r.model==='eb'?'Euler–Bernoulli':'continuum Timoshenko'}. ${r.status}. Not FEA-confirmed. Apply explicitly to replace the current model. The voxelized FE result may be slightly higher because of section quadrature.`;
    $('optimizer-caveat').textContent=(r.algorithm==='grid'?'Minimum on the specified finite grid only; a finer grid may find a lighter design.':'Multi-start local search, not a certified global optimum. Dimensions rounded to 0.1 mm with width re-sized upward.')+' Both methods omit local plate bending, bearing, buckling, self-weight and yielding. Onshape FEA confirmation is required.';
    drawOptimizerHistory();
  } catch(e) { $('optimizer-status').textContent=e.message; }
  finally { $('optimize').disabled=false;$('cancel-search').hidden=true;searchController=null; }
});
$('apply-optimum').addEventListener('click',()=>{
  if(!optimization)return;
  p={...optimization.p};$('onshape').value='';sync();update();
  $('optimizer-status').textContent='Candidate applied. Enter the matching Onshape FEA result after testing it; the solver has not confirmed C2 or C3.';
  $('theory-results').scrollIntoView({behavior:'smooth',block:'center'});
});
new ResizeObserver(() => { drawBeam();drawStudy();drawOptimizerHistory(); }).observe(document.querySelector('.workspace'));
let closedDetails = [];
window.addEventListener('beforeprint',()=>{
  closedDetails = [...document.querySelectorAll('details:not([open])')];
  closedDetails.forEach(detail => { detail.open = true; });
  drawBeam();drawStudy();drawOptimizerHistory();
});
window.addEventListener('afterprint',()=>{
  closedDetails.forEach(detail => { detail.open = false; });
  closedDetails = [];drawBeam();drawStudy();drawOptimizerHistory();
});
sync();update();renderStudy();
