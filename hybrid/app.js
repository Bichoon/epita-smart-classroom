'use strict';

const $ = (id) => document.getElementById(id);
const els = {
  status: $('model-status'), input: $('image-input'), image: $('image-preview'), video: $('camera-preview'),
  canvas: $('detection-canvas'), frame: $('media-frame'), empty: $('empty-state'), cameraEmpty: $('camera-empty'),
  sourceTag: $('source-tag'), uploadTab: $('upload-tab'), cameraTab: $('camera-tab'), cameraStart: $('camera-start'),
  cameraCapture: $('camera-capture'), cameraStop: $('camera-stop'), cameraActions: $('camera-actions'), cameraHint: $('camera-hint'),
  privacy: $('privacy-confirm'), confidence: $('confidence-range'), confidenceValue: $('confidence-value'), analyze: $('analyze-btn'),
  reset: $('reset-btn'), inline: $('inline-status'), results: $('results-list'), placeholder: $('results-placeholder'),
  resultCount: $('result-count'), duration: $('analysis-duration'), auditBody: $('audit-table-body'), globalStatus: $('global-status'),
  metricObjects: $('metric-objects'), metricCategories: $('metric-categories'), metricRules: $('metric-rules'), metricGaps: $('metric-gaps'),
  reportTop: $('report-btn'), reportBottom: $('report-btn-bottom'), toast: $('toast')
};

const equipment = [
  {
    id:'chair', label:'Chaises', cocoClass:'chair', expected:20, support:'coco', color:'#315ee8',
    auxLabels:[], help:'COCO-SSD, avec validation multi-vues pour réduire les faux positifs.'
  },
  {
    id:'table', label:'Tables et bureaux', cocoClass:'dining table', expected:10, support:'hybrid', color:'#0b9878',
    auxLabels:['classroom desk','school desk','classroom table','desk','table'],
    help:'Fusion de la classe COCO « dining table » avec une détection zero-shot ciblant les bureaux et tables de cours.'
  },
  {
    id:'laptop', label:'Ordinateurs portables', cocoClass:'laptop', expected:5, support:'coco', color:'#8657dc',
    auxLabels:[], help:'COCO-SSD, avec passes zoomées adaptées aux petits objets.'
  },
  {
    id:'screen', label:'Écrans / moniteurs', cocoClass:'tv', expected:1, support:'hybrid', color:'#d58222',
    auxLabels:['computer monitor','display screen','television screen'],
    help:'COCO « tv » complété par un détecteur zero-shot pour les moniteurs et écrans.'
  },
  {
    id:'board', label:'Tableau blanc', cocoClass:null, expected:1, support:'aux', color:'#cf5d7d',
    auxLabels:['whiteboard','classroom whiteboard'],
    help:'Détection expérimentale avec le modèle complémentaire zero-shot ; contrôle humain recommandé.'
  },
  {
    id:'window', label:'Fenêtres', cocoClass:null, expected:2, support:'aux', color:'#3186a7',
    auxLabels:['window','classroom window'],
    help:'Détection expérimentale avec le modèle complémentaire zero-shot ; contrôle humain recommandé.'
  }
];

const expectedCounts = Object.fromEntries(equipment.map(item => [item.id, item.expected]));

const ANALYSIS_PROFILES = {
  fast: {
    label: 'Rapide',
    description: 'Image entière + grille 2×2. Les grandes catégories et les petits objets utilisent la même passe.',
    grids: [
      { rows:2, cols:2, scale:1.20, overlap:.12, ids:['chair','table','laptop','screen'] }
    ]
  },
  balanced: {
    label: 'Équilibré',
    description: 'Grandes zones pour tables/écrans, puis zones plus serrées seulement pour chaises et laptops.',
    grids: [
      { rows:2, cols:2, scale:1.30, overlap:.18, ids:['chair','table','laptop','screen'] },
      { rows:2, cols:3, scale:1.45, overlap:.12, ids:['chair','laptop'] }
    ]
  },
  precise: {
    label: 'Précis',
    description: 'Grandes zones pour le mobilier étendu + zooms supplémentaires ciblés sur chaises et petits équipements.',
    grids: [
      { rows:2, cols:2, scale:1.38, overlap:.20, ids:['chair','table','laptop','screen'] },
      { rows:2, cols:3, scale:1.55, overlap:.15, ids:['chair','laptop'] },
      { rows:3, cols:3, scale:1.70, overlap:.10, ids:['chair','laptop'] }
    ]
  }
};

const COCO_INTERNAL_THRESHOLD = .05;
const AUX_INTERNAL_THRESHOLD = .045;
const AUXILIARY_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const AUXILIARY_MODEL = 'Xenova/owlvit-base-patch32';

let model = null;
let auxiliaryDetector = null;
let auxiliaryModule = null;
let auxiliaryLoading = null;
let stream = null;
let capturedImage = null;
let sourceType = null;
let rawDetections = [];
let detections = [];
let audit = [];
let lastDate = null;
let busy = false;
let analysisMeta = emptyAnalysisMeta();

function emptyAnalysisMeta(){
  return {
    profile:'balanced', engineMode:'hybrid', cocoPasses:0, auxiliaryPasses:0,
    candidates:0, merged:0, qualityRejected:0, duration:0,
    auxiliaryStatus:'not-run', auxiliaryMessage:''
  };
}
function status(message, type='') {
  if (els.status) { els.status.textContent = message; els.status.className = `header-center ${type}`; }
}
function say(message) { if (els.inline) els.inline.textContent = message; }
function notify(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  setTimeout(() => els.toast.classList.remove('visible'), 2800);
}
function sourceElement() {
  if (sourceType === 'image' && els.image && !els.image.classList.contains('hidden') && els.image.naturalWidth) return els.image;
  if (sourceType === 'capture' && capturedImage && capturedImage.naturalWidth) return capturedImage;
  if (sourceType === 'camera' && els.video && els.video.readyState >= 2) return els.video;
  return null;
}
function updateButton() { if (els.analyze) els.analyze.disabled = !model || !sourceElement() || !els.privacy.checked || busy; }
function clearCanvas() {
  const c=els.canvas; if(!c) return;
  const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
}
function make(tag, cls, text) {
  const e=document.createElement(tag); if(cls)e.className=cls; if(text!==undefined)e.textContent=text; return e;
}
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function selectedIds() {
  return new Set([...document.querySelectorAll('#equipment-selector input:checked')].map(x=>x.dataset.classId));
}
function selectedEquipment(){ return equipment.filter(x=>selectedIds().has(x.id)); }
function currentProfileId(){ return $('analysis-profile')?.value || 'balanced'; }
function currentEngineMode(){ return $('vision-engine')?.value || 'hybrid'; }
function cfgFor(id){ return equipment.find(e=>e.id===id); }

function addEquipmentSelector() {
  const host = document.createElement('section');
  host.className = 'equipment-selector'; host.id = 'equipment-selector';
  const heading = document.createElement('div'); heading.className='selector-heading';
  const title = document.createElement('strong'); title.textContent='Éléments à analyser';
  const hint = document.createElement('span'); hint.textContent='Cochez les catégories souhaitées';
  heading.append(title,hint); host.append(heading);
  const list = document.createElement('div'); list.className='equipment-checks';
  equipment.forEach(item => {
    const label=document.createElement('label'); label.className='equipment-option';
    const input=document.createElement('input'); input.type='checkbox'; input.checked=true; input.dataset.classId=item.id; input.setAttribute('aria-label',item.label);
    const swatch=document.createElement('span'); swatch.className='equipment-swatch'; swatch.style.background=item.color;
    const copy=document.createElement('span'); copy.className='equipment-copy';
    const name=document.createElement('strong'); name.textContent=item.label;
    const description=document.createElement('small');
    description.textContent=item.support==='coco'?'COCO-SSD':item.support==='hybrid'?'COCO + modèle complémentaire':'Modèle complémentaire';
    copy.append(name,description); label.append(input,swatch,copy); list.append(label);
    input.addEventListener('change', () => {
      if(lastDate) applyCurrentFilters();
      else renderAudit();
    });
  });
  host.append(list);
  const anchor=document.querySelector('.analysis-options');
  anchor.parentNode.insertBefore(host,anchor);
  const note=document.createElement('p'); note.className='selector-note';
  note.textContent='COCO-SSD reste le moteur principal. Les tables/bureaux, écrans, tableaux blancs et fenêtres peuvent être complétés par OWL-ViT en mode hybride.';
  host.append(note);
}

function addAnalysisProfileSelector() {
  const options=document.querySelector('.analysis-options');
  if(!options) return;
  const block=document.createElement('div'); block.className='analysis-profile';
  const label=document.createElement('label'); label.setAttribute('for','analysis-profile'); label.textContent='Mode d’analyse';
  const select=document.createElement('select'); select.id='analysis-profile'; select.setAttribute('aria-label','Mode d’analyse');
  Object.entries(ANALYSIS_PROFILES).forEach(([id,cfg])=>{
    const opt=document.createElement('option'); opt.value=id; opt.textContent=cfg.label; if(id==='balanced')opt.selected=true; select.append(opt);
  });
  const help=document.createElement('small'); help.id='analysis-profile-help'; help.textContent=ANALYSIS_PROFILES.balanced.description;
  select.addEventListener('change',()=>{ help.textContent=ANALYSIS_PROFILES[select.value]?.description||''; if(lastDate){clearResults();say('Mode d’analyse modifié. Relancez l’analyse pour recalculer les détections.');} });
  block.append(label,select,help);
  options.prepend(block);
}

function addVisionEngineSelector(){
  const options=document.querySelector('.analysis-options');
  if(!options) return;
  const block=document.createElement('div'); block.className='analysis-profile vision-engine-block';
  const label=document.createElement('label'); label.setAttribute('for','vision-engine'); label.textContent='Moteur de vision';
  const select=document.createElement('select'); select.id='vision-engine'; select.setAttribute('aria-label','Moteur de vision');
  const hybrid=document.createElement('option'); hybrid.value='hybrid'; hybrid.textContent='Hybride — COCO + OWL-ViT'; hybrid.selected=true;
  const coco=document.createElement('option'); coco.value='coco'; coco.textContent='COCO-SSD uniquement';
  select.append(hybrid,coco);
  const help=document.createElement('small'); help.id='vision-engine-help';
  help.textContent='OWL-ViT est chargé uniquement si nécessaire pour les catégories difficiles. Le premier chargement peut être nettement plus long.';
  select.addEventListener('change',()=>{
    help.textContent=select.value==='hybrid'
      ? 'OWL-ViT complète COCO pour bureaux/tables, écrans, tableaux blancs et fenêtres. Chargement à la demande.'
      : 'Mode léger : uniquement COCO-SSD. Tableaux blancs et fenêtres redeviennent manuels.';
    if(lastDate){clearResults();say('Moteur de vision modifié. Relancez l’analyse pour recalculer les détections.');}
  });
  block.append(label,select,help);
  options.prepend(block);
}

function boxArea(box){ return Math.max(0,box[2])*Math.max(0,box[3]); }
function boxIntersection(a,b){
  const [ax,ay,aw,ah]=a,[bx,by,bw,bh]=b;
  const x1=Math.max(ax,bx), y1=Math.max(ay,by), x2=Math.min(ax+aw,bx+bw), y2=Math.min(ay+ah,by+bh);
  return Math.max(0,x2-x1)*Math.max(0,y2-y1);
}
function iou(a,b) {
  const inter=boxIntersection(a.bbox,b.bbox);
  const union=boxArea(a.bbox)+boxArea(b.bbox)-inter;
  return union>0?inter/union:0;
}
function overlapOverSmaller(a,b){
  const inter=boxIntersection(a.bbox,b.bbox);
  const smaller=Math.min(boxArea(a.bbox),boxArea(b.bbox));
  return smaller>0?inter/smaller:0;
}
function centerDistanceRatio(a,b){
  const [ax,ay,aw,ah]=a.bbox,[bx,by,bw,bh]=b.bbox;
  const acx=ax+aw/2,acy=ay+ah/2,bcx=bx+bw/2,bcy=by+bh/2;
  const d=Math.hypot(acx-bcx,acy-bcy);
  const ref=Math.max(1,Math.min(Math.hypot(aw,ah),Math.hypot(bw,bh)));
  return d/ref;
}
function duplicateThreshold(id){
  if(id==='chair'||id==='laptop') return .32;
  if(id==='table'||id==='screen') return .38;
  return .42;
}
function isLikelyDuplicate(a,b){
  if(a.equipmentId!==b.equipmentId) return false;
  if(iou(a,b)>=duplicateThreshold(a.equipmentId)) return true;
  const containment=overlapOverSmaller(a,b);
  if(containment>.84) return true;
  const areaRatio=Math.max(boxArea(a.bbox),boxArea(b.bbox))/Math.max(1,Math.min(boxArea(a.bbox),boxArea(b.bbox)));
  return areaRatio<1.9 && centerDistanceRatio(a,b)<.20 && containment>.52;
}
function mergeDetections(items){
  const byId=new Map();
  items.forEach(d=>{ if(!byId.has(d.equipmentId))byId.set(d.equipmentId,[]); byId.get(d.equipmentId).push(d); });
  const out=[];
  for(const group of byId.values()){
    const sorted=[...group].sort((a,b)=>b.score-a.score);
    const kept=[];
    for(const candidate of sorted){
      const duplicate=kept.find(k=>isLikelyDuplicate(k,candidate));
      if(!duplicate){
        kept.push({
          ...candidate,
          passes:new Set([candidate.pass]),
          engines:new Set([candidate.engine]),
          engineScores:{[candidate.engine]:candidate.score}
        });
        continue;
      }
      duplicate.passes.add(candidate.pass);
      duplicate.engines.add(candidate.engine);
      duplicate.engineScores[candidate.engine]=Math.max(duplicate.engineScores[candidate.engine]||0,candidate.score);
      if(candidate.score>duplicate.score){ duplicate.score=candidate.score; duplicate.bbox=[...candidate.bbox]; }
    }
    kept.forEach(k=>{
      k.votes=k.passes.size;
      k.engineList=[...k.engines];
      k.passList=[...k.passes];
      delete k.passes; delete k.engines;
    });
    out.push(...kept);
  }
  return out.sort((a,b)=>b.score-a.score);
}

function gridRegions(w,h,{rows,cols,overlap=0}){
  const regions=[];
  const nominalW=w/cols, nominalH=h/rows;
  const padX=nominalW*overlap, padY=nominalH*overlap;
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    const x=Math.max(0,Math.floor(c*nominalW-padX));
    const y=Math.max(0,Math.floor(r*nominalH-padY));
    const right=Math.min(w,Math.ceil((c+1)*nominalW+padX));
    const bottom=Math.min(h,Math.ceil((r+1)*nominalH+padY));
    regions.push({x,y,w:right-x,h:bottom-y});
  }
  return regions;
}
function equipmentForCocoClass(className){ return equipment.find(e=>e.cocoClass===className); }

async function detectCocoRegion(source,region,scale,label,allowedIds){
  const maxDimension=1400;
  const targetScale=Math.min(scale,maxDimension/Math.max(region.w,region.h));
  const appliedScale=Math.max(1,targetScale);
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(region.w*appliedScale));
  canvas.height=Math.max(1,Math.round(region.h*appliedScale));
  const ctx=canvas.getContext('2d',{alpha:false});
  ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  ctx.drawImage(source,region.x,region.y,region.w,region.h,0,0,canvas.width,canvas.height);
  const preds=await model.detect(canvas,100,COCO_INTERNAL_THRESHOLD);
  return preds.flatMap(d=>{
    if(d.class==='person') return [];
    const cfg=equipmentForCocoClass(d.class);
    if(!cfg || !allowedIds.has(cfg.id)) return [];
    return [{
      equipmentId:cfg.id, class:d.class, score:d.score,
      bbox:[region.x+d.bbox[0]/appliedScale,region.y+d.bbox[1]/appliedScale,d.bbox[2]/appliedScale,d.bbox[3]/appliedScale],
      pass:label, engine:'COCO-SSD'
    }];
  });
}

async function detectCocoEnhanced(source,profileId='balanced') {
  const w=source.naturalWidth||source.videoWidth, h=source.naturalHeight||source.videoHeight;
  if(!w||!h)throw new Error('Image sans dimensions valides');
  const profile=ANALYSIS_PROFILES[profileId]||ANALYSIS_PROFILES.balanced;
  const selected=selectedIds();
  const selectedCocoIds=new Set(equipment.filter(e=>selected.has(e.id)&&e.cocoClass).map(e=>e.id));
  if(!selectedCocoIds.size) return {predictions:[],passes:0};
  const predictions=[];
  let passCount=0;

  say(`COCO-SSD · ${profile.label.toLowerCase()} : image entière…`);
  const full=await model.detect(source,100,COCO_INTERNAL_THRESHOLD);
  full.forEach(d=>{
    if(d.class==='person')return;
    const cfg=equipmentForCocoClass(d.class);
    if(!cfg||!selectedCocoIds.has(cfg.id))return;
    predictions.push({equipmentId:cfg.id,class:d.class,score:d.score,bbox:[...d.bbox],pass:'coco-full',engine:'COCO-SSD'});
  });
  passCount++;

  const total=1+profile.grids.reduce((n,x)=>n+x.rows*x.cols,0);
  for(let g=0;g<profile.grids.length;g++){
    const grid=profile.grids[g];
    const allowedIds=new Set(grid.ids.filter(id=>selectedCocoIds.has(id)));
    if(!allowedIds.size) continue;
    const regions=gridRegions(w,h,grid);
    for(let i=0;i<regions.length;i++){
      say(`COCO-SSD · ${profile.label.toLowerCase()} : passe ${passCount+1} / ${total}…`);
      const preds=await detectCocoRegion(source,regions[i],grid.scale,`coco-g${g+1}-${i+1}`,allowedIds);
      predictions.push(...preds); passCount++;
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  return {predictions,passes:passCount};
}

async function ensureAuxiliaryDetector(){
  if(auxiliaryDetector) return auxiliaryDetector;
  if(auxiliaryLoading) return auxiliaryLoading;
  auxiliaryLoading=(async()=>{
    status('Chargement du modèle complémentaire…');
    say('Téléchargement initial de OWL-ViT. Cette étape peut être longue au premier lancement, puis le navigateur peut réutiliser son cache.');
    auxiliaryModule=await import(AUXILIARY_MODULE_URL);
    if(auxiliaryModule.env) auxiliaryModule.env.allowLocalModels=false;
    auxiliaryDetector=await auxiliaryModule.pipeline('zero-shot-object-detection',AUXILIARY_MODEL);
    status('Modèles prêts','ready');
    return auxiliaryDetector;
  })();
  try{return await auxiliaryLoading;}
  catch(error){
    auxiliaryLoading=null; auxiliaryDetector=null;
    status('COCO prêt · complémentaire indisponible','ready');
    throw error;
  }
}

function sourceCanvas(source,region=null,maxDimension=1024){
  const sw=source.naturalWidth||source.videoWidth, sh=source.naturalHeight||source.videoHeight;
  const r=region||{x:0,y:0,w:sw,h:sh};
  const scale=Math.min(1,maxDimension/Math.max(r.w,r.h));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(r.w*scale)); canvas.height=Math.max(1,Math.round(r.h*scale));
  const ctx=canvas.getContext('2d',{alpha:false}); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  ctx.drawImage(source,r.x,r.y,r.w,r.h,0,0,canvas.width,canvas.height);
  return {canvas,region:r,scale};
}
function auxiliaryLabelMapForSelection(){
  const map=new Map();
  selectedEquipment().forEach(cfg=>cfg.auxLabels.forEach(label=>map.set(label.toLowerCase(),cfg.id)));
  return map;
}
async function detectAuxiliary(source,profileId){
  if(currentEngineMode()!=='hybrid') return {predictions:[],passes:0,status:'skipped',message:'Mode COCO uniquement'};
  const labelMap=auxiliaryLabelMapForSelection();
  if(!labelMap.size) return {predictions:[],passes:0,status:'skipped',message:'Aucune catégorie complémentaire sélectionnée'};
  let detector;
  try{ detector=await ensureAuxiliaryDetector(); }
  catch(error){
    console.error(error);
    return {predictions:[],passes:0,status:'failed',message:'OWL-ViT n’a pas pu être chargé ; résultats COCO conservés.'};
  }
  const labels=[...labelMap.keys()];
  const w=source.naturalWidth||source.videoWidth, h=source.naturalHeight||source.videoHeight;
  const regions=[{x:0,y:0,w,h,label:'owl-full'}];
  if(profileId==='precise'){
    gridRegions(w,h,{rows:1,cols:2,overlap:.10}).forEach((r,i)=>regions.push({...r,label:`owl-half-${i+1}`}));
  }
  const predictions=[];
  let passes=0;
  for(const region of regions){
    say(`OWL-ViT · recherche ciblée : ${passes+1} / ${regions.length}…`);
    const prepared=sourceCanvas(source,region,profileId==='precise'?896:1024);
    const raw=auxiliaryModule.RawImage.fromCanvas(prepared.canvas);
    const outputs=await detector(raw,labels,{threshold:AUX_INTERNAL_THRESHOLD,top_k:100});
    for(const item of outputs){
      const id=labelMap.get(String(item.label).toLowerCase()); if(!id)continue;
      const b=item.box;
      predictions.push({
        equipmentId:id, class:String(item.label), score:Number(item.score), engine:'OWL-ViT', pass:region.label,
        bbox:[region.x+b.xmin/prepared.scale,region.y+b.ymin/prepared.scale,(b.xmax-b.xmin)/prepared.scale,(b.ymax-b.ymin)/prepared.scale]
      });
    }
    passes++;
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  return {predictions,passes,status:'used',message:'OWL-ViT utilisé pour les catégories difficiles.'};
}

function bboxQualityBounds(id){
  const bounds={
    chair:{minArea:.00035,minAspect:.18,maxAspect:2.6,single:.46},
    table:{minArea:.0015,minAspect:.35,maxAspect:6.5,single:.38},
    laptop:{minArea:.00012,minAspect:.35,maxAspect:4.5,single:.48},
    screen:{minArea:.00025,minAspect:.40,maxAspect:4.5,single:.45},
    board:{minArea:.0020,minAspect:.45,maxAspect:6.5,single:.075},
    window:{minArea:.0015,minAspect:.25,maxAspect:5.0,single:.075}
  };
  return bounds[id]||{minArea:.0002,minAspect:.15,maxAspect:8,single:.5};
}
function passesFor(d){ return d.passList?.length||d.votes||1; }
function engineScore(d,name){ return d.engineScores?.[name] ?? (d.engine===name?d.score:0); }
function qualityGate(d,w,h){
  const [x,y,bw,bh]=d.bbox;
  if(!Number.isFinite(x+y+bw+bh)||bw<=1||bh<=1) return false;
  const imageArea=Math.max(1,w*h), ratio=boxArea(d.bbox)/imageArea, aspect=bw/bh;
  const q=bboxQualityBounds(d.equipmentId);
  if(ratio>.92) return false;
  if((ratio<q.minArea || aspect<q.minAspect || aspect>q.maxAspect) && d.score<.72 && passesFor(d)<2) return false;
  const edgeTouch=x<=2||y<=2||x+bw>=w-2||y+bh>=h-2;
  const cocoScore=engineScore(d,'COCO-SSD'), owlScore=engineScore(d,'OWL-ViT');
  const multiEngine=(d.engineList||[]).length>1;
  if(cocoScore>0 && cocoScore<q.single && passesFor(d)<2 && !multiEngine) return false;
  // Les faux positifs isolés faibles sur un bord (notamment l'angle supérieur gauche) sont rejetés,
  // sauf s'ils sont confirmés par plusieurs passes ou un deuxième moteur.
  if(edgeTouch && cocoScore>0 && cocoScore<.52 && passesFor(d)<2 && !multiEngine) return false;
  if(owlScore>0 && owlScore<AUX_INTERNAL_THRESHOLD) return false;
  return true;
}
function auxiliaryThresholdFromUi(){
  const ui=Number(els.confidence.value)/100;
  return .035 + ui*.30; // 10% -> 6.5%, 35% -> 14%, 90% -> 30.5%
}
function passesUserThreshold(d){
  const ui=Number(els.confidence.value)/100;
  const coco=engineScore(d,'COCO-SSD');
  const owl=engineScore(d,'OWL-ViT');
  return (coco>=ui) || (owl>=auxiliaryThresholdFromUi());
}

async function detectEnhanced(source,profileId='balanced') {
  const w=source.naturalWidth||source.videoWidth, h=source.naturalHeight||source.videoHeight;
  if(!w||!h)throw new Error('Image sans dimensions valides');
  const coco=await detectCocoEnhanced(source,profileId);
  const aux=await detectAuxiliary(source,profileId);
  const candidates=[...coco.predictions,...aux.predictions];
  const merged=mergeDetections(candidates);
  const quality=merged.filter(d=>qualityGate(d,w,h));
  analysisMeta={
    profile:profileId, engineMode:currentEngineMode(), cocoPasses:coco.passes, auxiliaryPasses:aux.passes,
    candidates:candidates.length, merged:quality.length, qualityRejected:merged.length-quality.length,
    duration:0, auxiliaryStatus:aux.status, auxiliaryMessage:aux.message
  };
  return quality;
}

function applyCurrentFilters(){
  const ids=selectedIds();
  detections=rawDetections.filter(d=>ids.has(d.equipmentId)&&passesUserThreshold(d));
  if(lastDate){ renderResults(); renderAudit(); }
}

function scoreLabel(d){
  const parts=[];
  const coco=engineScore(d,'COCO-SSD'), owl=engineScore(d,'OWL-ViT');
  if(coco) parts.push(`${Math.round(coco*100)}% COCO`);
  if(owl) parts.push(`${Math.round(owl*100)}% OWL`);
  return parts.join(' · ')||`${Math.round(d.score*100)}%`;
}
function drawBoxes(items) {
  const source=sourceElement(); if(!source)return;
  const w=source.naturalWidth||source.videoWidth,h=source.naturalHeight||source.videoHeight;
  els.canvas.width=w;els.canvas.height=h;
  const ctx=els.canvas.getContext('2d'); ctx.clearRect(0,0,w,h);
  const scale=Math.max(1,w/900); ctx.lineWidth=Math.max(2,w/450); ctx.font=`bold ${Math.max(13,Math.round(w/55))}px system-ui`; ctx.textBaseline='top';
  items.forEach(d=>{
    const cfg=cfgFor(d.equipmentId); if(!cfg)return;
    const [x,y,bw,bh]=d.bbox; ctx.strokeStyle=cfg.color; ctx.strokeRect(x,y,bw,bh);
    const voteText=passesFor(d)>1?` · ${passesFor(d)} vues`:'';
    const label=`${cfg.label} ${scoreLabel(d)}${voteText}`;
    const pad=5*scale, th=Math.max(20,Math.round(w/35));
    const tw=Math.min(w,ctx.measureText(label).width+pad*2);
    const lx=clamp(x,0,w-tw), ly=y>=th?y-th:Math.min(h-th,y+bh);
    ctx.fillStyle=cfg.color; ctx.fillRect(lx,ly,tw,th); ctx.fillStyle='#fff'; ctx.fillText(label,lx+pad,ly+Math.max(2,scale));
  });
}
function countForId(id,items=detections){return items.filter(d=>d.equipmentId===id).length;}

function renderResults() {
  const shown=detections;
  els.results.replaceChildren(); els.results.classList.remove('hidden'); els.placeholder.classList.add('hidden');
  if(!shown.length){
    els.results.classList.add('hidden'); els.placeholder.classList.remove('hidden');
    els.placeholder.querySelector('strong').textContent='Aucun objet retenu pour les catégories sélectionnées';
    els.placeholder.querySelector('p').textContent='Essayez un seuil plus bas. Une absence de détection ne prouve pas une absence réelle.';
  }
  const counts=new Map(); shown.forEach(d=>counts.set(d.equipmentId,(counts.get(d.equipmentId)||0)+1));
  [...counts.entries()].sort((a,b)=>b[1]-a[1]).forEach(([id,count])=>{
    const cfg=cfgFor(id), row=make('div','result-row'), bar=make('span','result-color'); bar.style.background=cfg.color;
    const classItems=shown.filter(d=>d.equipmentId===id);
    const stable=classItems.filter(d=>passesFor(d)>1 || (d.engineList||[]).length>1).length;
    const engines=[...new Set(classItems.flatMap(d=>d.engineList||[d.engine]))].join(' + ');
    const maxCoco=Math.max(0,...classItems.map(d=>engineScore(d,'COCO-SSD')));
    const maxOwl=Math.max(0,...classItems.map(d=>engineScore(d,'OWL-ViT')));
    const scores=[maxCoco?`COCO ${Math.round(maxCoco*100)} %`:'',maxOwl?`OWL ${Math.round(maxOwl*100)} %`:''].filter(Boolean).join(' · ');
    const info=make('div','result-info');
    info.append(make('strong','',cfg.label),make('small','',`${scores}${scores?' · ':''}${engines}${stable?` · ${stable} détection(s) confirmée(s)`:''}`));
    row.append(bar,info,make('strong','result-quantity',`${count} ${count===1?'objet':'objets'}`)); els.results.append(row);
  });
  els.resultCount.textContent=`${shown.length} ${shown.length===1?'objet':'objets'}`;
  drawBoxes(shown);
}

function auditCapability(cfg){
  if(cfg.support==='coco') return {verifiable:true,partial:false,label:'Automatique'};
  if(cfg.support==='hybrid') return {verifiable:true,partial:true,label:analysisMeta.auxiliaryStatus==='used'?'Hybride indicatif':'COCO indicatif'};
  if(cfg.support==='aux'){
    const ok=analysisMeta.auxiliaryStatus==='used';
    return {verifiable:ok,partial:true,label:ok?'Zero-shot indicatif':'Vérification manuelle'};
  }
  return {verifiable:false,partial:true,label:'Vérification manuelle'};
}
function computeAuditItem(cfg){
  const expected=Number(expectedCounts[cfg.id]??cfg.expected);
  const capability=auditCapability(cfg);
  if(!lastDate){
    return {...cfg,expected,observed:null,gap:'—',state:'unknown',stateText:cfg.support==='aux'?'En attente du moteur complémentaire':'En attente',capability};
  }
  if(!capability.verifiable){
    return {...cfg,expected,observed:null,gap:'—',state:'unknown',stateText:'Vérification manuelle',capability};
  }
  const observed=countForId(cfg.id), gap=observed-expected, state=gap===0?'ok':'gap';
  const stateText=gap===0?(capability.partial?'Indicateur cohérent':'Compte identique'):(capability.partial?'Écart indicatif':'Écart observé');
  return {...cfg,expected,observed,gap,state,stateText,capability};
}
function setExpected(id,value){
  const numeric=clamp(Number.isFinite(Number(value))?Math.round(Number(value)):0,0,999);
  expectedCounts[id]=numeric;
  const input=document.querySelector(`[data-expected="${id}"]`); if(input&&Number(input.value)!==numeric) input.value=numeric;
  refreshAuditState();
}
function makeExpectedControl(cfg){
  const wrap=make('div','quantity-stepper');
  const minus=make('button','quantity-button','−'); minus.type='button'; minus.setAttribute('aria-label',`Diminuer la quantité attendue : ${cfg.label}`);
  const input=document.createElement('input'); input.type='number'; input.min='0';input.max='999';input.step='1';input.value=expectedCounts[cfg.id];input.className='expected-input';input.dataset.expected=cfg.id;input.setAttribute('aria-label',`Quantité attendue : ${cfg.label}`);
  const plus=make('button','quantity-button','+'); plus.type='button'; plus.setAttribute('aria-label',`Augmenter la quantité attendue : ${cfg.label}`);
  minus.addEventListener('click',()=>setExpected(cfg.id,Number(expectedCounts[cfg.id])-1));
  plus.addEventListener('click',()=>setExpected(cfg.id,Number(expectedCounts[cfg.id])+1));
  input.addEventListener('input',()=>setExpected(cfg.id,input.value));
  wrap.append(minus,input,plus); return wrap;
}
function buildAuditRows(){
  if(!els.auditBody)return;
  els.auditBody.replaceChildren();
  selectedEquipment().forEach(cfg=>{
    const tr=document.createElement('tr'); tr.dataset.auditId=cfg.id;
    tr.append(make('td','',cfg.label));
    const expectedTd=document.createElement('td'); expectedTd.append(makeExpectedControl(cfg));
    tr.append(expectedTd,make('td','audit-observed','—'),make('td','audit-gap','—'));
    const statusTd=make('td','audit-status-cell'); statusTd.append(make('span','audit-pill unknown','En attente')); tr.append(statusTd);
    els.auditBody.append(tr);
  });
}
function refreshAuditState(){
  audit=selectedEquipment().map(computeAuditItem);
  audit.forEach(item=>{
    const tr=els.auditBody?.querySelector(`[data-audit-id="${item.id}"]`); if(!tr)return;
    const observed=tr.querySelector('.audit-observed'),gap=tr.querySelector('.audit-gap'),statusCell=tr.querySelector('.audit-status-cell');
    if(observed) observed.textContent=item.observed===null?(lastDate?'Non vérifiable':'—'):String(item.observed);
    if(gap) gap.textContent=typeof item.gap==='number'?(item.gap>0?`+${item.gap}`:String(item.gap)):'—';
    if(statusCell){statusCell.replaceChildren(make('span',`audit-pill ${item.state}`,item.stateText));}
  });
  const supported=audit.filter(x=>x.capability.verifiable),gaps=supported.filter(x=>x.state==='gap');
  els.metricObjects.textContent=lastDate?String(detections.length):'—';
  els.metricCategories.textContent=lastDate?String(new Set(detections.map(d=>d.equipmentId)).size):'—';
  els.metricRules.textContent=lastDate?String(supported.length):'—';
  els.metricGaps.textContent=lastDate?String(gaps.length):'—';
  if(!lastDate) els.globalStatus.textContent='En attente d’une analyse';
  else if(gaps.length) els.globalStatus.textContent=`${gaps.length} écart(s) à vérifier`;
  else els.globalStatus.textContent='Analyse terminée';
}
function renderAudit(){ buildAuditRows(); refreshAuditState(); }

function clearResults() {
  rawDetections=[]; detections=[]; audit=[]; lastDate=null; analysisMeta=emptyAnalysisMeta(); analysisMeta.profile=currentProfileId(); analysisMeta.engineMode=currentEngineMode();
  els.results.replaceChildren(); els.results.classList.add('hidden'); els.placeholder.classList.remove('hidden');
  els.placeholder.querySelector('strong').textContent='Les résultats apparaîtront ici';
  els.placeholder.querySelector('p').textContent='Importez une photo, confirmez le cadrage, puis lancez l’analyse.';
  els.resultCount.textContent='0 objet'; els.duration.textContent='Aucune analyse réalisée';
  els.reportTop.disabled=els.reportBottom.disabled=true; clearCanvas(); renderAudit();
}
function setImage(img,kind='image') {
  stopCamera(false); sourceType=kind; capturedImage=kind==='capture'?img:null;
  els.image.classList.toggle('hidden',kind!=='image'&&kind!=='capture'); els.video.classList.add('hidden'); els.cameraEmpty.classList.add('hidden'); els.frame.classList.remove('hidden'); els.empty.classList.add('hidden');
  els.sourceTag.textContent=kind==='capture'?'Instantané capturé':`${img.naturalWidth} × ${img.naturalHeight}`;
  els.privacy.checked=false; clearResults(); updateButton(); say('Vérifiez que l’image ne contient aucune personne, puis confirmez le cadrage.');
}
function loadFile(file){
  if(!file||!file.type.startsWith('image/'))return say('Choisissez un fichier image valide.');
  const url=URL.createObjectURL(file);
  els.image.onload=()=>{setImage(els.image,'image');URL.revokeObjectURL(url);};
  els.image.onerror=()=>{URL.revokeObjectURL(url);say('Impossible de lire cette image.');};
  els.image.src=url;
}
async function startCamera(){
  try{
    stopCamera(false);
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1920},height:{ideal:1080}},audio:false});
    els.video.srcObject=stream; await els.video.play(); sourceType='camera';
    els.image.classList.add('hidden'); els.video.classList.remove('hidden'); els.frame.classList.remove('hidden'); els.empty.classList.add('hidden'); els.cameraEmpty.classList.add('hidden'); els.cameraActions.classList.remove('hidden');
    els.sourceTag.textContent='Caméra active'; els.privacy.checked=false; clearResults(); updateButton();
    say('Cadrez uniquement les équipements. Capturez une image fixe avant de lancer l’analyse.');
  }catch(e){ console.error(e); say('Accès caméra impossible. Autorisez la caméra ou importez une photo.'); }
}
function stopCamera(reset=true){
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  if(els.video){els.video.pause();els.video.srcObject=null;}
  if(els.cameraActions)els.cameraActions.classList.add('hidden');
  if(reset&&sourceType==='camera'){sourceType=null;els.frame.classList.add('hidden');els.empty.classList.remove('hidden');els.cameraEmpty.classList.remove('hidden');els.sourceTag.textContent='Aucune source';clearResults();}
  updateButton();
}
function captureCamera(){
  if(!els.video.videoWidth)return;
  const c=document.createElement('canvas'); c.width=els.video.videoWidth; c.height=els.video.videoHeight; c.getContext('2d').drawImage(els.video,0,0);
  const img=new Image();
  img.onload=()=>{capturedImage=img;sourceType='capture';els.image.src=img.src;els.image.classList.remove('hidden');els.video.classList.add('hidden');els.frame.classList.remove('hidden');els.cameraActions.classList.add('hidden');els.sourceTag.textContent=`Instantané · ${img.naturalWidth} × ${img.naturalHeight}`;els.privacy.checked=false;clearResults();updateButton();say('Instantané capturé. Confirmez que personne n’est visible avant l’analyse.');};
  img.src=c.toDataURL('image/jpeg',.94);
}

async function analyze(){
  if(busy)return;
  const src=sourceElement();
  if(!model||!src)return say('Le modèle ou l’image n’est pas prêt.');
  if(!els.privacy.checked)return say('Confirmez que l’image est cadrée sans personne avant de poursuivre.');
  busy=true;updateButton();
  const start=performance.now(); const profileId=currentProfileId();
  try{
    rawDetections=await detectEnhanced(src,profileId);
    analysisMeta.duration=(performance.now()-start)/1000; lastDate=new Date(); applyCurrentFilters();
    const aux=analysisMeta.auxiliaryStatus==='used'?` + OWL (${analysisMeta.auxiliaryPasses})`:analysisMeta.auxiliaryStatus==='failed'?' · OWL indisponible':'';
    els.duration.textContent=`${ANALYSIS_PROFILES[profileId].label} · COCO ${analysisMeta.cocoPasses} passes${aux} · ${analysisMeta.duration.toFixed(1)} s`;
    els.reportTop.disabled=els.reportBottom.disabled=false;
    const rejected=analysisMeta.qualityRejected?` ${analysisMeta.qualityRejected} candidat(s) instable(s) rejeté(s).`:'';
    const auxMessage=analysisMeta.auxiliaryStatus==='failed'?' Le moteur complémentaire a échoué : audit conservé avec COCO.':'';
    say(`${detections.length} détection(s) retenue(s) après fusion de ${analysisMeta.candidates} candidat(s).${rejected}${auxMessage}`);
  }catch(e){
    console.error(e); say('L’analyse a échoué. Vérifiez le chargement des modèles et réessayez.');
  }finally{busy=false;updateButton(); if(model)status(auxiliaryDetector?'Modèles prêts':'COCO prêt · complémentaire à la demande','ready');}
}

function recommendations(){
  const rec=[];
  if(analysisMeta.qualityRejected)rec.push(`${analysisMeta.qualityRejected} candidat(s) instable(s) ont été écartés par le filtre de qualité ; vérifier visuellement les zones difficiles.`);
  if(analysisMeta.auxiliaryStatus==='failed')rec.push('Le modèle complémentaire OWL-ViT n’a pas été disponible. Refaire l’analyse avec connexion réseau ou contrôler manuellement tables, écrans, tableau et fenêtres.');
  if(audit.some(x=>x.capability.partial))rec.push('Les résultats hybrides/zero-shot sont indicatifs : effectuer un contrôle humain avant de conclure à l’absence d’un équipement.');
  if(audit.some(x=>x.state==='gap'))rec.push('Pour chaque écart, effectuer une seconde prise de vue sous un autre angle avant de conclure à une absence.');
  rec.push('Pour les chaises et petits équipements éloignés, utiliser le mode Précis ; pour les grandes tables, conserver une vue large et bien éclairée.');
  return rec;
}
function report(){
  if(!lastDate)return;
  const win=window.open('','_blank'); if(!win){notify('Autorisez les fenêtres surgissantes pour générer le rapport.');return;}
  const rows=audit.map(x=>`<tr><td>${escapeHtml(x.label)}</td><td>${x.expected}</td><td>${x.observed===null?'Non vérifiable':x.observed}</td><td>${typeof x.gap==='number'?x.gap:'—'}</td><td>${escapeHtml(x.stateText)}</td></tr>`).join('');
  const objects=selectedEquipment().map(e=>`<li>${escapeHtml(e.label)} : ${countForId(e.id)}</li>`).join('');
  const recs=recommendations().map(x=>`<li>${escapeHtml(x)}</li>`).join('');
  const profile=ANALYSIS_PROFILES[analysisMeta.profile]?.label||analysisMeta.profile;
  const engines=analysisMeta.auxiliaryStatus==='used'?'COCO-SSD + OWL-ViT':'COCO-SSD';
  win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport Smart Classroom</title><style>body{font:14px Arial,sans-serif;max-width:900px;margin:40px auto;color:#17243b}h1{font-size:26px}h2{margin-top:28px}p,li{line-height:1.6}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{padding:10px;border:1px solid #ddd;text-align:left}th{background:#f3f5fa}.muted{color:#68758a}.callout{background:#f7f9fd;border:1px solid #e3e8f1;padding:12px 14px;border-radius:8px}</style></head><body><h1>Rapport d’audit — Smart Classroom</h1><p class="muted">Généré le ${lastDate.toLocaleString('fr-FR')} · Analyse locale dans le navigateur</p><div class="callout"><strong>Contexte technique</strong><p>Moteurs : ${escapeHtml(engines)} · Mode : ${escapeHtml(profile)} · COCO ${analysisMeta.cocoPasses} passes · OWL ${analysisMeta.auxiliaryPasses} passe(s) · seuil utilisateur ${escapeHtml(els.confidence.value)} % · durée ${analysisMeta.duration.toFixed(1)} s.</p></div><h2>Détections retenues</h2><ul>${objects||'<li>Aucune détection retenue</li>'}</ul><h2>Comparaison à la configuration</h2><table><thead><tr><th>Équipement</th><th>Attendu</th><th>Observé</th><th>Écart</th><th>Statut</th></tr></thead><tbody>${rows}</tbody></table><h2>Limites</h2><p>COCO-SSD reste le détecteur principal. OWL-ViT est utilisé en complément zero-shot pour des catégories mal couvertes par COCO, notamment bureaux/tables de cours, moniteurs, tableaux blancs et fenêtres. Les scores des deux moteurs ne sont pas directement comparables : le seuil utilisateur est donc calibré séparément pour le moteur complémentaire. Une non-détection ne prouve pas l’absence d’un objet. Les personnes sont exclues du résultat et le cadrage doit rester sans personne.</p><h2>Recommandations</h2><ul>${recs}</ul><script>window.onload=()=>window.print()<\/script></body></html>`);
  win.document.close();
}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}

els.input.addEventListener('change',e=>loadFile(e.target.files?.[0]));
els.uploadTab.addEventListener('click',()=>{els.uploadTab.classList.add('selected');els.cameraTab.classList.remove('selected');stopCamera(false);if(!sourceElement()){els.frame.classList.add('hidden');els.empty.classList.remove('hidden');els.cameraEmpty.classList.add('hidden');}});
els.cameraTab.addEventListener('click',()=>{els.cameraTab.classList.add('selected');els.uploadTab.classList.remove('selected');els.empty.classList.add('hidden');els.cameraEmpty.classList.remove('hidden');els.frame.classList.add('hidden');});
els.cameraStart.addEventListener('click',startCamera);els.cameraCapture.addEventListener('click',captureCamera);els.cameraStop.addEventListener('click',()=>stopCamera());els.analyze.addEventListener('click',analyze);
els.privacy.addEventListener('change',updateButton);
els.confidence.addEventListener('input',()=>{els.confidenceValue.textContent=`${els.confidence.value} %`;if(lastDate)applyCurrentFilters();updateButton();});
els.reset.addEventListener('click',()=>{stopCamera(false);sourceType=null;capturedImage=null;els.input.value='';els.image.removeAttribute('src');els.image.classList.add('hidden');els.video.classList.add('hidden');els.frame.classList.add('hidden');els.empty.classList.remove('hidden');els.cameraEmpty.classList.add('hidden');els.sourceTag.textContent='Aucune source';els.privacy.checked=false;clearResults();updateButton();say('Importez une image ou démarrez la caméra pour commencer.');});
els.reportTop.addEventListener('click',report);els.reportBottom.addEventListener('click',report);

addEquipmentSelector();
addAnalysisProfileSelector();
addVisionEngineSelector();
renderAudit();

(async()=>{
  try{
    if(!window.tf||!window.cocoSsd)throw new Error('Bibliothèques de détection indisponibles');
    await tf.ready();
    model=await cocoSsd.load({base:'mobilenet_v2'});
    status('COCO prêt · complémentaire à la demande','ready'); say('COCO-SSD est chargé. Le modèle complémentaire OWL-ViT sera chargé uniquement si une analyse hybride en a besoin.'); updateButton();
  }catch(e){
    console.error(e); status('Modèle indisponible','error'); say('Impossible de charger COCO-SSD. Vérifiez la connexion internet et rechargez la page.');
  }
})();
