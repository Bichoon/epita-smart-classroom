import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const mustExist=['index.html','style.css','app.js','README.md','DOSSIER_PROJET.md','TESTS.md'];
let failed=false;

for(const name of mustExist){
  const p=path.join(root,name);
  if(!fs.existsSync(p)){ console.error(`✗ fichier manquant: ${name}`); failed=true; }
  else console.log(`✓ ${name}`);
}

const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'style.css'),'utf8');
const requiredIds=['model-status','image-input','image-preview','camera-preview','detection-canvas','privacy-confirm','confidence-range','analyze-btn','results-list','audit-table-body','report-btn','report-btn-bottom'];
for(const id of requiredIds){
  if(!html.includes(`id="${id}"`)){ console.error(`✗ id HTML manquant: ${id}`); failed=true; }
}
if(!html.includes('href="style.css"')){ console.error('✗ index.html ne référence pas style.css'); failed=true; }
if(!html.includes('src="app.js"')){ console.error('✗ index.html ne référence pas app.js'); failed=true; }
for(const token of ['rawDetections','detectEnhanced','mergeDetections','qualityGate','expectedCounts','detectAuxiliary','OWL-ViT','ANALYSIS_PROFILES']){
  if(!js.includes(token)){ console.error(`✗ amélioration JS absente: ${token}`); failed=true; }
}
for(const token of ['quantity-stepper','quantity-button','vision-engine-block']){
  if(!css.includes(token)){ console.error(`✗ style absent: ${token}`); failed=true; }
}
if(js.includes('model.detect(canvas,100,.01)')){ console.error('✗ ancien seuil interne COCO à 1% encore présent'); failed=true; }

if(failed){ process.exitCode=1; }
else console.log('\nContrôles statiques OK.');
