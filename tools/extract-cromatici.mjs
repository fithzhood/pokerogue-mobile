/* ============================================================================
   extract-cromatici.mjs — porta qui le VARIANTI CROMATICHE dell'originale
   ----------------------------------------------------------------------------
   In PokeRogue un cromatico non e' uno solo: ce ne sono tre livree, estratte
   60% / 30% / 10% (`generateShinyVariant`, rates.ts SHINY_VARIANT_CHANCE=4 e
   SHINY_EPIC_CHANCE=1). Valgono 1, 2 e 3 punti di FORTUNA.

   Come le disegna l'originale (`pokemon-species.ts:410` + `sprite.ts:131`):
     · `_masterlist.json` da', per ogni sprite, una TERNA [v0, v1, v2]
     · valore 0 → si usa lo sprite della cartella `shiny/`, tale e quale
     · valore 1 → si usa lo sprite NORMALE e lo si RICOLORA con una tabella
                  esadecimale (`variant/<nome>.json`, chiave "0"/"1"/"2")
     · valore 2 → esiste un file dedicato `variant/<nome>_<v+1>.png`

   Nel nostro masterlist i valori 0 stanno TUTTI nella casella 0 (935 su 935):
   le varianti 1 e 2 hanno sempre o una tabella o un file. Comodo: non esiste
   il caso "variante rara senza livrea".

   Produce DUE file, perche' pesano in modo molto diverso:
     data/cromatici.json     solo le TERNE (~40 KiB) — serve a ogni tiro di
                             cromatico, quindi si carica all'avvio
     data/cromatici-col.json le tabelle colore (~950 KiB) — servono solo quando
                             una rara/epica va davvero disegnata (un incontro
                             su ~2560), quindi si carica alla prima occorrenza
     assets/pokemon/cromatico/{front,back}/<nome>_<n>.png|.json
     assets/pokemon/femmina/cromatico/{front,back}/...

   ⚠️ Il nome del file NON e' `variants.json`: quello da noi esiste gia' e vuol
   dire tutt'altro (le FORME: Unown, Vivillon, Rotom).

   Uso:  node tools/extract-cromatici.mjs
         node tools/extract-cromatici.mjs --dry
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = resolve(__dirname, "..");
const SRC = resolve(APP, "..", "PokeRogue", "assets", "images", "pokemon", "variant");
const DRY = process.argv.includes("--dry");

if (!existsSync(resolve(SRC, "_masterlist.json"))) {
  console.error("Non trovo", SRC, "— serve il repo originale in ../PokeRogue");
  process.exit(1);
}
const master = JSON.parse(readFileSync(resolve(SRC, "_masterlist.json"), "utf8"));

/* I quattro tagli, ognuno con: da dove viene la terna, dove stanno le tabelle
   colore nell'originale, e dove sta da noi lo sprite NORMALE da ricolorare. */
const SET = [
  { pre: "front/",         nodo: master,                  dir: "",             base: "assets/pokemon/front" },
  { pre: "back/",          nodo: master.back,             dir: "back",         base: "assets/pokemon/back" },
  { pre: "femmina/front/", nodo: master.female,           dir: "female",       base: "assets/pokemon/femmina/front" },
  { pre: "femmina/back/",  nodo: master.back && master.back.female, dir: "back/female", base: "assets/pokemon/femmina/back" },
];

const set = {};   // "front/25" -> [0,1,1]
const col = {};   // "front/25" -> { "1": {"f7bd21":"ed8094", ...}, "2": {...} }
let dedicati = 0, saltati = 0, senzaTabella = 0;

for (const s of SET) {
  if (!s.nodo) continue;
  for (const nome of Object.keys(s.nodo)) {
    const terna = s.nodo[nome];
    if (!Array.isArray(terna)) continue;              // "female" annidato: lo fa il suo giro
    // Se lo sprite base non ce l'abbiamo, la variante non ha su cosa vivere.
    if (!existsSync(resolve(APP, s.base, `${nome}.png`))) { saltati++; continue; }
    const chiave = s.pre + nome;
    set[chiave] = terna;

    // tabelle colore (servono solo alle caselle che valgono 1)
    if (terna.includes(1)) {
      const p = resolve(SRC, s.dir, `${nome}.json`);
      if (existsSync(p)) {
        const j = JSON.parse(readFileSync(p, "utf8"));
        const tenute = {};
        terna.forEach((v, i) => { if (v === 1 && j[String(i)]) tenute[String(i)] = j[String(i)]; });
        if (Object.keys(tenute).length) col[chiave] = tenute;
        else senzaTabella++;
      } else senzaTabella++;
    }

    // file dedicati (caselle che valgono 2)
    terna.forEach((v, i) => {
      /* Solo rara/epica. La variante 0 resta quella che gia' usiamo — lo sprite
         della cartella `shiny/`. Tutte e 99 le specie con casella0 != 0 ce
         l'hanno (verificato), quindi non si tocca niente di funzionante. */
      if (v !== 2 || i === 0) return;
      const suff = `_${i + 1}`;
      const destDir = resolve(APP, s.base.replace("assets/pokemon/", "assets/pokemon/cromatico/"));
      for (const est of ["png", "json"]) {
        const da = resolve(SRC, s.dir, `${nome}${suff}.${est}`);
        if (!existsSync(da)) continue;
        if (!DRY) { mkdirSync(destDir, { recursive: true }); copyFileSync(da, resolve(destDir, `${nome}${suff}.${est}`)); }
        if (est === "png") dedicati++;
      }
    });
  }
}

const testoSet = JSON.stringify({ set });
const testoCol = JSON.stringify(col);
if (!DRY) {
  writeFileSync(resolve(APP, "data/cromatici.json"), testoSet);
  writeFileSync(resolve(APP, "data/cromatici-col.json"), testoCol);
}

const conta = { v0: 0, v1: 0, v2: 0 };
for (const k in set) set[k].forEach((v, i) => { if (i > 0) conta["v" + v]++; });
console.log(`sprite con varianti: ${Object.keys(set).length}`);
console.log(`  caselle 1/2 (rara+epica):  ricolorate ${conta.v1} · file dedicato ${conta.v2} · nessuna livrea ${conta.v0}`);
console.log(`tabelle colore tenute: ${Object.keys(col).length}${senzaTabella ? ` (${senzaTabella} annunciate ma assenti)` : ""}`);
console.log(`png dedicati copiati: ${dedicati}`);
console.log(`saltati (sprite base non nostro): ${saltati}`);
console.log(`data/cromatici.json (terne): ${Math.round(testoSet.length / 1024)} KiB`);
console.log(`data/cromatici-col.json (tabelle): ${Math.round(testoCol.length / 1024)} KiB${DRY ? " — NON scritti, --dry" : ""}`);
