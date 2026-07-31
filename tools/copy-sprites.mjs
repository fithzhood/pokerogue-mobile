/* ============================================================================
   copy-sprites.mjs — copia da ../PokeRogue gli sprite che al gioco mancano
   ----------------------------------------------------------------------------
   Copre due cose, entrambe nei quattro tagli (fronte/retro × normale/cromatico)
   e con l'atlas .json accanto:

   1. le SPECIE di data/species.json — serviva perché i cromatici erano stati
      copiati solo per la prima generazione: dalla seconda in poi un cromatico
      non trovava il file e finiva a segnaposto colorato (1084 specie, il
      momento più raro del gioco reso il più brutto);
   2. le FORME di data/variants.json (Unown, Vivillon, Rotom…) e di
      data/forms.json (mega/gigamax) — anche queste andavano prese in versione
      cromatica, che prima veniva ignorata del tutto.

   Quando una forma non ha un file suo, non ce l'ha nemmeno l'originale: le 20
   fantasie di Scatterbug e le taglie di Pumpkaboo sono identiche a vedersi e
   ricadono sullo sprite base. Il gioco fa lo stesso, quindi qui si salta.

   Sorgente (sola lettura):  ../PokeRogue/assets/images/pokemon/
     <nome>.png · back/<nome>.png · shiny/<nome>.png · back/shiny/<nome>.png
   Destinazione:             assets/pokemon/
     front/ · back/ · shiny/front/ · shiny/back/

   Uso:  node tools/copy-sprites.mjs        (aggiunge i mancanti)
         node tools/copy-sprites.mjs --dry  (dice solo cosa farebbe)
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = resolve(__dirname, "..");
const SRC = resolve(APP, "..", "PokeRogue", "assets", "images", "pokemon");
const DRY = process.argv.includes("--dry");

const readJson = p => JSON.parse(readFileSync(p, "utf8"));
const species  = readJson(resolve(APP, "data/species.json"));
const variants = readJson(resolve(APP, "data/variants.json"));
const forms    = readJson(resolve(APP, "data/forms.json"));

/* Nomi file da cercare: "<dex>" per la forma base, "<dex>-<formKey>" per le altre. */
const names = new Set();
/* Le specie vere e proprie — TUTTE, comprese quelle marcate `noSprite`.
   ⚠️ Qui prima c'era `if (species[id].noSprite) continue;` con la spiegazione
   «forme regionali che l'originale non disegna». Era falso e faceva un giro
   chiuso: `extract-data.mjs` mette `noSprite` quando il file NON c'e' fra i
   nostri asset, e questa riga impediva per sempre di copiarlo. Risultato: 55
   specie (tutte le forme di Alola/Galar/Hisui) restavano segnaposto colorati,
   e il bioma Isola — che nell'originale e' fatto quasi solo di forme di Alola —
   perdeva 20 specie su 26. Nel sorgente ci sono eccome, coi quattro tagli e le
   mini-icone: si chiamano col numero dex alto (2037 = Vulpix di Alola).
   Se un nome davvero non esiste nel sorgente, il ciclo sotto lo salta da solo. */
for (const id in species) names.add(String(species[id].dex));
for (const id in variants) {
  const dex = species[id] && species[id].dex;
  if (!dex) continue;
  for (const f of variants[id]) names.add(f.key ? `${dex}-${f.key}` : `${dex}`);
}
for (const id in forms) {
  const dex = species[id] && species[id].dex;
  if (!dex) continue;
  for (const f of forms[id]) names.add(`${dex}-${f.formKey}`);
}

/* I quattro posti in cui vive lo stesso sprite. */
const SLOTS = [
  { src: n => `${SRC}/${n}`,            dst: n => `${APP}/assets/pokemon/front/${n}` },
  { src: n => `${SRC}/back/${n}`,       dst: n => `${APP}/assets/pokemon/back/${n}` },
  { src: n => `${SRC}/shiny/${n}`,      dst: n => `${APP}/assets/pokemon/shiny/front/${n}` },
  { src: n => `${SRC}/back/shiny/${n}`, dst: n => `${APP}/assets/pokemon/shiny/back/${n}` },
];
for (const s of SLOTS) mkdirSync(dirname(s.dst("0")), { recursive: true });

/* L'atlas dell'originale descrive tutti i fotogrammi dell'animazione di riposo
   (spesso 144), ma il gioco ne legge SOLO il primo: `atlasFrame0()` prende
   frames[0] e la dimensione del foglio, e il ritaglio avviene in CSS.
   Qui si tiene quindi solo quello — il PNG resta intero, cambia solo la
   descrizione. Riduce gli atlas da ~7,6 KB a poche centinaia di byte.
   Se un giorno servisse l'animazione vera frame per frame, va rifatta questa
   copia senza il taglio. Si normalizza al formato {frames:[…], meta:{size}},
   uno dei due che `atlasFrame0` accetta. */
function trimAtlas(atlas) {
  let frames, size;
  if (atlas.textures) { frames = atlas.textures[0].frames; size = atlas.textures[0].size; }
  else { frames = atlas.frames; size = atlas.meta && atlas.meta.size; }
  const f0 = Array.isArray(frames) ? frames[0] : frames[Object.keys(frames)[0]];
  if (!f0 || !size) return atlas;           // formato inatteso: meglio copiarlo com'e'
  return { frames: [{ filename: f0.filename, frame: f0.frame }], meta: { size } };
}

let copied = 0, already = 0, noSource = 0, bytesPng = 0, bytesJson = 0;
for (const name of names) {
  for (const slot of SLOTS) {
    const sPng = slot.src(name) + ".png", dPng = slot.dst(name) + ".png";
    if (existsSync(dPng)) { already++; continue; }
    if (!existsSync(sPng)) { noSource++; continue; }   // forma senza sprite proprio: si usa la base
    const sJson = slot.src(name) + ".json", dJson = slot.dst(name) + ".json";
    bytesPng += statSync(sPng).size;
    if (existsSync(sJson)) {
      const min = JSON.stringify(trimAtlas(JSON.parse(readFileSync(sJson, "utf8"))));
      bytesJson += Buffer.byteLength(min);
      if (!DRY) writeFileSync(dJson, min);
    }
    if (!DRY) copyFileSync(sPng, dPng);
    copied++;
  }
}
console.log(`Forme considerate: ${names.size}`);
console.log(`${DRY ? "Da copiare" : "Copiati"}: ${copied} sprite · `
  + `${(bytesPng / 1048576).toFixed(1)} MB di PNG + ${(bytesJson / 1048576).toFixed(1)} MB di atlas minificati`);
console.log(`Gia' presenti: ${already} · senza sprite proprio nell'originale (ok, ricadono sulla base): ${noSource}`);
