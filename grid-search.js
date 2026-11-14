import { DEFAULTS, sectionProperties, theory, validate } from './beam.js';
import { sizeWidth } from './optimizer.js';

// Exhaustive over the specified discrete a/t grid. Width is eliminated exactly:
// for fixed a,t, increasing b increases mass and reduces (or leaves unchanged)
// the selected model's droop. Only its smallest feasible grid value can win.
export async function gridSearchBeam(base, {
  model='timoshenko', margin=10, aStep=10, tStep=1, bStep=1, bMax=100000,
  onProgress=()=>{}, signal
}={}) {
  if (!['eb','timoshenko'].includes(model)) throw new Error('Choose EB or Timoshenko sizing.');
  if (!Number.isFinite(margin)||margin<0||margin>90) throw new Error('Deflection margin must be between 0 and 90%.');
  for(const [key,value,max] of [['Height step',aStep,1000],['Thickness step',tStep,492],['Width step',bStep,100000],['Width cap',bMax,100000]]) {
    if(!Number.isFinite(value)||value<=0||value>max) throw new Error(`${key} must be positive and at most ${max} mm.`);
  }
  const material={E:base.E,nu:base.nu,rho:base.rho};
  const errors=validate({...DEFAULTS,...material});
  if(errors.length)throw new Error(errors.join(' '));
  const regularHeights=Math.floor(1000/aStep+1e-10);
  const extraHeight=Math.abs(regularHeights*aStep-1000)>1e-8 ? 1:0;
  const thicknesses=Math.ceil(492/tStep-1e-12);
  const total=(regularHeights+extraHeight)*thicknesses;
  if(total>1_000_000)throw new Error(`Grid has ${total.toLocaleString('en')} pairs; use coarser steps to stay at or below 1,000,000.`);
  const targetMM=40*(1-margin/100), top=[], history=[];
  let checked=0, geometric=0, feasible=0, best=null;
  const report=()=>{
    const point={checked,bestMass:best?.mass??null};history.push(point);
    onProgress({checked,total,feasible,bestMass:point.bestMass});
  };
  for(let ai=1;ai<=regularHeights+extraHeight;ai++) {
    const a=ai<=regularHeights?Number((ai*aStep).toPrecision(12)):1000;
    for(let ti=0;ti<thicknesses;ti++) {
      if(signal?.aborted)throw new Error('Grid search cancelled. No incomplete result has been applied.');
      checked++;
      const t=Number((8+ti*tStep).toPrecision(12));
      if(a>2*t) {
        geometric++;
        const sized=sizeWidth(material,a,t,model,targetMM);
        if(sized) {
          let b=Number((Math.ceil(sized.p.b/bStep-1e-10)*bStep).toPrecision(12));
          // Protect b>=t against floating-point rounding at a grid boundary.
          if(b<t)b=Number((b+bStep).toPrecision(12));
          let p={...sized.p,b};
          let s=sectionProperties(p), eb=theory(p,s);
          let predicted=(model==='eb'?eb.delta:eb.timoshenko)*1000;
          // Strict '< target', including margin=0: equality is not admitted.
          if(predicted>=targetMM) {
            b=Number((b+bStep).toPrecision(12));p={...p,b};s=sectionProperties(p);eb=theory(p,s);
            predicted=(model==='eb'?eb.delta:eb.timoshenko)*1000;
          }
          if(b<=bMax && predicted<targetMM && Number.isFinite(predicted)) {
            feasible++;
            const candidate={p,mass:s.mass,I:s.I,eb:eb.delta*1000,timoshenko:eb.timoshenko*1000,predicted,checked};
            if(!best||candidate.mass<best.mass)best=candidate;
            // Also retain the true top ten grid designs, including wider
            // variants of one a/t pair. More than ten widths from one pair
            // can never enter the global top ten (ten lighter ones precede it).
            for(let wi=0;wi<10;wi++) {
              const width=Number((b+wi*bStep).toPrecision(12));
              if(width>bMax)break;
              const wp={...p,b:width},ws=wi===0?s:sectionProperties(wp);
              if(top.length===10&&ws.mass>=top.at(-1).mass)break;
              const wt=wi===0?eb:theory(wp,ws);
              top.push({p:wp,mass:ws.mass,I:ws.I,eb:wt.delta*1000,timoshenko:wt.timoshenko*1000,predicted:(model==='eb'?wt.delta:wt.timoshenko)*1000,checked});
              top.sort((a,b)=>a.mass-b.mass);if(top.length>10)top.pop();
            }
          }
        }
      }
      if(checked%2048===0) { report();await new Promise(resolve=>setTimeout(resolve,0)); }
    }
    if(ai%Math.max(1,Math.ceil((regularHeights+extraHeight)/200))===0||ai===regularHeights+extraHeight)report();
  }
  if(!best)throw new Error(`No feasible design on this grid (${checked.toLocaleString('en')} pairs). Try finer steps, a wider cap or a less restrictive margin.`);
  return {...best,algorithm:'grid',model,margin,targetMM,aStep,tStep,bStep,bMax,
    total,checked,geometric,feasible,top,gridHistory:history,
    status:'Complete: minimum mass on the defined grid for the selected analytic model (not a continuous or FEA optimum)'};
}
