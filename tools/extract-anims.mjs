// ============================================================================
// ESTRAZIONE ANIMAZIONI DELLE MOSSE (dal PokeRogue originale)
//
// Legge  ../PokeRogue/assets/battle-anims/*.json      (923 animazioni)
//        ../PokeRogue/assets/images/battle_anims/*.png (fogli sprite 96x96)
// Scrive data/anims/<MOSSA>.json     una animazione per mossa, formato COMPATTO
//        data/anims-index.json       indice: fogli sprite + mosse coperte
//        assets/anims/*.png          solo i fogli davvero referenziati
//
// Perche' un formato compatto: l'originale usa oggetti con chiavi ripetute per
// ogni sprite di ogni frame (23,9 MB minificati in totale). Qui ogni sprite
// diventa un ARRAY di numeri, e i valori di default finali vengono tagliati.
// Stesso identico contenuto, molto meno peso.
//
// Uso:  node tools/extract-anims.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("../PokeRogue");
const ANIM_SRC = path.join(SRC, "assets/battle-anims");
const IMG_SRC = path.join(SRC, "assets/images/battle_anims");
const OUT_DATA = path.resolve("data/anims");
const OUT_IMG = path.resolve("assets/anims");
const INDEX_FILE = path.resolve("data/anims-index.json");

// --- ordine dei campi nell'array compatto -----------------------------------
// [x, y, zoomX, zoomY, opacity, graphicFrame, target, focus, blendType,
//  angle, mirror, priority, visible]
// I default stanno in fondo per poter troncare l'array quando coincidono.
const DEFAULTS = [0, 0, 100, 100, 255, 0, 2, 1, 0, 0, 0, 1, 1];

/** Larghezza/altezza di un PNG leggendo l'header IHDR (niente librerie). */
function pngSize(file) {
  const b = fs.readFileSync(file);
  // 8 byte firma + 4 lunghezza + 4 "IHDR", poi width e height big-endian
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** Nome file sicuro per il web/Android: "PRAS- Fire" -> "pras-fire". */
function safeName(graphic) {
  return graphic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Converte uno sprite-frame dell'originale nell'array compatto. */
function packFrame(s) {
  const row = [
    Math.round(s.x ?? 0),
    Math.round(s.y ?? 0),
    Math.round(s.zoomX ?? 100),
    Math.round(s.zoomY ?? 100),
    Math.round(s.opacity ?? 255),
    s.graphicFrame ?? 0,
    s.target ?? 2,
    s.focus ?? 1,
    s.blendType ?? 0,
    Math.round(s.angle ?? 0),
    s.mirror ? 1 : 0,
    s.priority ?? 1,
    s.visible === false ? 0 : 1,
  ];
  // taglia i valori finali uguali al default (risparmio di spazio reale)
  let end = row.length;
  while (end > 0 && row[end - 1] === DEFAULTS[end - 1]) end--;
  return row.slice(0, end);
}

/** Estrae gli eventi di sfondo (gli altri frameTimedEvents sono suoni: v1 e' muta). */
function packBgEvents(fte, usedSheets) {
  if (!fte) return null;
  const out = [];
  for (const [frameIdx, events] of Object.entries(fte)) {
    for (const e of events || []) {
      if (!e.eventType || !e.eventType.includes("Bg")) continue; // scarta i suoni
      const isAdd = e.eventType.includes("Add");
      if (isAdd && e.resourceName) usedSheets.add(e.resourceName);
      out.push([
        Number(frameIdx),
        isAdd ? 1 : 0,
        e.resourceName || "",
        Math.round(e.bgX ?? 0),
        Math.round(e.bgY ?? 0),
        Math.round(e.opacity ?? 255),
        Math.round(e.duration ?? 0),
      ]);
    }
  }
  return out.length ? out : null;
}

// ---------------------------------------------------------------------------
console.log("Lettura animazioni da", ANIM_SRC);

const moves = JSON.parse(fs.readFileSync(path.resolve("data/moves.json"), "utf8"));
const moveKeys = Object.keys(moves);
const animFiles = new Set(
  fs.readdirSync(ANIM_SRC).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")),
);

fs.mkdirSync(OUT_DATA, { recursive: true });
fs.mkdirSync(OUT_IMG, { recursive: true });

const usedSheets = new Set();
const covered = {};
let written = 0, totalBytes = 0, skipped = 0;

/** Impacchetta una singola animazione (un elemento del file sorgente). */
function packAnim(src) {
  if (!src || !Array.isArray(src.frames) || !src.frames.length) return null;
  if (src.graphic) usedSheets.add(src.graphic);
  const out = { g: src.graphic || "", f: src.frames.map((fr) => (fr || []).map(packFrame)) };
  const bg = packBgEvents(src.frameTimedEvents, usedSheets);
  if (bg) out.bg = bg;
  if (src.hue) out.hue = src.hue;
  return out;
}

let withOpp = 0;

for (const key of moveKeys) {
  const base = key.toLowerCase().replace(/_/g, "-");
  if (!animFiles.has(base)) { skipped++; continue; } // mosse Z / G-Max: non esistono
  let src;
  try {
    src = JSON.parse(fs.readFileSync(path.join(ANIM_SRC, base + ".json"), "utf8"));
  } catch { skipped++; continue; }

  // 308 file contengono DUE animazioni: [0] quando attacca il giocatore,
  // [1] quando attacca l'avversario (vedi isOppAnim() nell'originale).
  const list = Array.isArray(src) ? src : [src];
  const out = packAnim(list[0]);
  if (!out) { skipped++; continue; }
  if (list.length > 1) {
    const opp = packAnim(list[1]);
    if (opp) { out.o = opp; withOpp++; }
  }

  const json = JSON.stringify(out);
  fs.writeFileSync(path.join(OUT_DATA, key + ".json"), json);
  totalBytes += json.length;
  covered[key] = 1;
  written++;
}

// --- animazioni COMUNI (stati, cure, oggetti) e di CARICA -------------------
// Nell'originale: common-<kebab>.json  e  <kebab>-charging.json.
// Per le comuni utente e bersaglio sono lo STESSO Pokemon (CommonBattleAnim:
// `super(user, target || user)`), quindi si ancorano al Pokemon colpito.
const common = {}, charge = {};

function writeExtra(srcFile, outKey, bucket) {
  let src;
  try { src = JSON.parse(fs.readFileSync(path.join(ANIM_SRC, srcFile), "utf8")); }
  catch { return false; }
  const list = Array.isArray(src) ? src : [src];
  const out = packAnim(list[0]);
  if (!out) return false;
  if (list.length > 1) { const o = packAnim(list[1]); if (o) out.o = o; }
  const json = JSON.stringify(out);
  fs.writeFileSync(path.join(OUT_DATA, outKey + ".json"), json);
  totalBytes += json.length;
  bucket[outKey] = 1;
  return true;
}

for (const f of fs.readdirSync(ANIM_SRC)) {
  if (!f.endsWith(".json")) continue;
  if (f.startsWith("common-")) {
    // common-health-up.json -> COMMON_HEALTH_UP
    const key = "COMMON_" + f.slice(7, -5).toUpperCase().replace(/-/g, "_");
    writeExtra(f, key, common);
  } else if (f.endsWith("-charging.json")) {
    // solar-beam-charging.json -> CHARGE_SOLAR_BEAM (= la mossa che carica)
    const key = "CHARGE_" + f.slice(0, -14).toUpperCase().replace(/-/g, "_");
    writeExtra(f, key, charge);
  }
}

// --- ripiego per le mosse senza animazione ----------------------------------
// Regola presa dall'originale (`initMoveAnim`): quando il file manca o e' vuoto
//   mossa d'attacco   -> animazione di AZIONE (Tackle)
//   mossa di stato su se' -> FOCALENERGIA (Focus Energy)
//   altra mossa di stato  -> COLPOCODA (Tail Whip)
// Cosi' nessuna mossa resta senza animazione, esattamente come nel gioco vero.
const selfStatus = new Set();
try {
  const moveSrc = fs.readFileSync(path.join(SRC, "src/data/moves/move.ts"), "utf8");
  for (const m of moveSrc.matchAll(/new SelfStatusMove\(MoveId\.([A-Z_0-9]+)/g)) selfStatus.add(m[1]);
} catch { /* se il sorgente non c'e', si ripiega comunque per categoria */ }

const fallback = {};
for (const key of moveKeys) {
  if (covered[key]) continue;
  const mv = moves[key];
  if (!mv) continue;
  fallback[key] = mv.category !== "STATUS" ? "TACKLE"
                : selfStatus.has(key) ? "FOCUS_ENERGY"
                : "TAIL_WHIP";
}
// le tre animazioni di ripiego devono esistere, altrimenti il ripiego e' inutile
for (const need of ["TACKLE", "FOCUS_ENERGY", "TAIL_WHIP"]) {
  if (!covered[need]) console.log(`  ATTENZIONE: manca l'animazione di ripiego ${need}`);
}

// --- copia solo i fogli sprite referenziati ---------------------------------
const sheets = {};
let sheetBytes = 0, missing = 0;
for (const g of usedSheets) {
  if (!g) continue;
  const srcPng = path.join(IMG_SRC, g + ".png");
  if (!fs.existsSync(srcPng)) { missing++; continue; }
  const name = safeName(g);
  const dest = path.join(OUT_IMG, name + ".png");
  fs.copyFileSync(srcPng, dest);
  const { w, h } = pngSize(srcPng);
  // Griglia 96x96. Si arrotonda (non si tronca): alcuni fogli sono rifilati e
  // l'ultima riga e' alta un po' meno di 96 (es. Energy Ball 480x286), ma
  // contiene comunque i suoi fotogrammi.
  const cols = Math.max(1, Math.round(w / 96));
  const rows = Math.max(1, Math.round(h / 96));
  sheets[g] = { n: name, w, h, c: cols, k: cols * rows }; // c = colonne · k = celle totali
  sheetBytes += fs.statSync(srcPng).size;
}

fs.writeFileSync(INDEX_FILE, JSON.stringify({ sheets, moves: covered, common, charge, fallback }));

console.log(`Animazioni scritte : ${written}  (saltate ${skipped}: mosse Z/G-Max senza animazione)`);
console.log(`  di cui con variante avversario: ${withOpp}`);
console.log(`Comuni (stati/cure): ${Object.keys(common).length}`);
console.log(`Di carica (2 turni): ${Object.keys(charge).length}`);
console.log(`Con animazione di ripiego: ${Object.keys(fallback).length} (nessuna mossa resta scoperta)`);
console.log(`Peso JSON          : ${(totalBytes / 1048576).toFixed(1)} MB  (originale minificato 23,9 MB)`);
console.log(`Fogli sprite       : ${Object.keys(sheets).length} copiati, ${(sheetBytes / 1048576).toFixed(1)} MB` +
            (missing ? `  (${missing} non trovati)` : ""));
console.log(`Indice             : data/anims-index.json`);
