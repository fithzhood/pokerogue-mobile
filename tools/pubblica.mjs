/* ============================================================================
   pubblica.mjs — manda le modifiche sul telefono. UNICO comando da usare.
   ----------------------------------------------------------------------------
       node tools/pubblica.mjs "cosa ho cambiato"
       node tools/pubblica.mjs "nuovi sprite" --assets

   Fa in fila le quattro cose che servono, nell'ordine giusto:
     1. rigenera `versione.json`  ← se lo si salta, il telefono NON si accorge
                                    di niente e l'aggiornamento non arriva mai
     2. copia il gioco in C:\Users\lfili\WebApps\pokerogue-mobile (il repo)
     3. commit
     4. push  → GitHub Pages ripubblica da solo

   Il telefono se ne accorge al primo avvio con rete e applica al riavvio dopo.

   ⚠️ `--assets` serve quando si aggiungono o cambiano SPRITE, ANIMAZIONI o
   ARENE: quella roba sta solo dentro l'APK e non viaggia via rete, quindi alza
   `assetsRev` per segnalare che serve un APK nuovo.

   ⚠️ Modificando `pokerogue-boot.js` (il guscio) o qualcosa di nativo, il push
   non basta: va rifatto l'APK. Il guscio non si aggiorna da solo per scelta —
   e' lui che decide cosa caricare, se si rompesse non ci sarebbe rete di
   salvataggio.
   ========================================================================== */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "C:\\Users\\lfili\\WebApps\\pokerogue-mobile";

const args = process.argv.slice(2);
const assets = args.includes("--assets");
const messaggio = args.filter(a => !a.startsWith("--")).join(" ").trim();
if (!messaggio) {
  console.error('Serve un messaggio: node tools/pubblica.mjs "cosa ho cambiato"');
  process.exit(1);
}

const passo = (titolo) => console.log(`\n=== ${titolo} ===`);
const esegui = (cmd, argomenti, opts = {}) =>
  execFileSync(cmd, argomenti, { stdio: "inherit", cwd: opts.cwd || APP, shell: false });

passo("1/4 · manifesto");
esegui(process.execPath, ["tools/make-manifest.mjs", ...(assets ? ["--assets"] : [])]);

passo("2/4 · copia nel repo");
/* robocopy torna codici < 8 anche quando e' andata bene (1 = file copiati):
   solo da 8 in su e' un errore vero. */
try {
  execFileSync("robocopy", [APP, REPO, "/E", "/XF", "ZZ.zip", "/XD", "icone", "prova-remoto", ".git",
    "/NFL", "/NDL", "/NJH", "/NJS", "/MT:16"], { stdio: "inherit" });
} catch (e) {
  if ((e.status || 0) >= 8) { console.error("robocopy fallita, codice", e.status); process.exit(1); }
}

passo("3/4 · commit");
try {
  esegui("git", ["add", "-A"], { cwd: REPO });
  esegui("git", ["commit", "-m",
    `${messaggio}\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>`], { cwd: REPO });
} catch (e) {
  console.log("(niente da committare)");
}

passo("4/4 · push");
esegui("git", ["push"], { cwd: REPO });

console.log("\nFatto. GitHub Pages ripubblica da solo (fino a ~10 minuti di cache).");
console.log("Il telefono lo prende al prossimo avvio con rete e lo applica a quello dopo.");
if (assets) console.log("\n⚠️ Hai alzato assetsRev: per vedere gli asset nuovi serve un APK nuovo.");
