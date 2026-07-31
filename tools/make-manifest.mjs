/* ============================================================================
   make-manifest.mjs — genera `versione.json`, l'elenco dei file aggiornabili
   ----------------------------------------------------------------------------
   E' il file che il telefono controlla a ogni avvio (vedi pokerogue-boot.js,
   §28 di HANDOFF.md). Contiene:

     rev        numero che sale a ogni generazione: il telefono aggiorna solo
                se quello del sito e' PIU' ALTO del suo
     assetsRev  cambia solo quando cambiano gli sprite/animazioni/arene, cioe'
                le cose che stanno SOLO dentro l'APK: serve ad accorgersi che
                servirebbe un APK nuovo
     files      { percorso: impronta } — l'impronta e' l'inizio dello sha256 del
                contenuto. Il telefono scarica solo i file la cui impronta non
                ha gia' in casa, quindi una modifica al solo motore muove
                ~400 KB invece di 7 MB.

   NON entrano nel manifesto gli asset (135 MiB): quelli viaggiano solo con
   l'APK. Se un giorno servisse aggiornare anche quelli, la strada e' aggiungere
   un ripiego di rete nei caricatori di sprite, non gonfiare questo elenco.

   Uso:  node tools/make-manifest.mjs            (alza `rev` di 1)
         node tools/make-manifest.mjs --assets   (alza anche `assetsRev`)
   ========================================================================== */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, join } from "node:path";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USCITA = resolve(APP, "versione.json");
const ALZA_ASSET = process.argv.includes("--assets");

/* I file che il telefono puo' aggiornare da solo: il "cervello" del gioco. */
const FISSI = ["pokerogue-app.html", "pokerogue.css", "pokerogue.js"];

/* piu' i dati generati dagli estrattori.
   ⚠️ ESCLUSO `data/anims/` (913 file, 4,7 MB): quelli non passano da `loadJson`
   ma da `prefetchAnim`, che li legge su richiesta dai file dell'APK. Metterli
   qui significherebbe farli scaricare al telefono per non usarli mai, e
   gonfiare ogni aggiornamento da ~400 KB a 7 MB. Contano come ASSET: se un
   giorno le animazioni cambiano si rigenera con `--assets` e serve un APK
   nuovo (nel frattempo il gioco ripiega sulle particelle, senza rompersi).
   `anims-index.json` invece resta: quello lo carica `loadJson` all'avvio. */
function tuttiIDati() {
  const base = resolve(APP, "data");
  const out = [];
  const scendi = (dir) => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) {
        if (nome === "anims") continue;
        scendi(p);
      } else if (nome.endsWith(".json")) out.push(relative(APP, p).replace(/\\/g, "/"));
    }
  };
  scendi(base);
  return out;
}

const impronta = (p) =>
  createHash("sha256").update(readFileSync(resolve(APP, p))).digest("hex").slice(0, 16);

/* rev precedente: si riparte da li' invece che da zero */
let prima = { rev: 0, assetsRev: 1 };
if (existsSync(USCITA)) {
  try { prima = JSON.parse(readFileSync(USCITA, "utf8")); } catch (e) {}
}

const elenco = [...FISSI, ...tuttiIDati()].filter(p => {
  if (existsSync(resolve(APP, p))) return true;
  console.warn("  manca (saltato):", p);
  return false;
});

const files = {};
for (const p of elenco) files[p] = impronta(p);

/* Se non e' cambiato NIENTE non ha senso alzare la revisione: il telefono
   scaricherebbe un manifesto nuovo per poi non fare nulla. */
const uguale = prima.files && elenco.length === Object.keys(prima.files).length
  && elenco.every(p => prima.files[p] === files[p]);
if (uguale && !ALZA_ASSET) {
  console.log(`Nessun file cambiato: resto alla revisione ${prima.rev}.`);
  process.exit(0);
}

const manifesto = {
  rev: (prima.rev || 0) + 1,
  assetsRev: (prima.assetsRev || 1) + (ALZA_ASSET ? 1 : 0),
  generato: new Date().toISOString().slice(0, 19).replace("T", " "),
  files,
};
writeFileSync(USCITA, JSON.stringify(manifesto, null, 1));

const cambiati = prima.files ? elenco.filter(p => prima.files[p] !== files[p]) : elenco;
const peso = cambiati.reduce((t, p) => t + statSync(resolve(APP, p)).size, 0);
console.log(`versione.json → rev ${manifesto.rev} · assetsRev ${manifesto.assetsRev}`);
console.log(`${elenco.length} file nel manifesto · ${cambiati.length} cambiati `
  + `(${(peso / 1024).toFixed(0)} KB da scaricare sul telefono)`);
for (const p of cambiati.slice(0, 12)) console.log("   ~ " + p);
if (cambiati.length > 12) console.log(`   … e altri ${cambiati.length - 12}`);
