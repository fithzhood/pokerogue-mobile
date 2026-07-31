/* ============================================================================
   pokerogue-boot.js — AVVIO e AGGIORNAMENTO A CALDO (§28)
   ----------------------------------------------------------------------------
   Il gioco e' diviso in due pezzi:

     · gli ASSET (sprite, animazioni, arene, icone: ~135 MiB) stanno DENTRO
       l'APK e non cambiano quasi mai;
     · il "cervello" (pokerogue-app.html + .css + .js + data/*.json, meno di
       10 MB) puo' essere aggiornato dalla rete senza reinstallare niente.

   Cosi' una modifica al gioco arriva sul telefono da sola, ma il gioco parte e
   funziona anche senza campo, con la versione che ha gia'.

   COME FUNZIONA
   1. All'avvio si guarda se in IndexedDB c'e' uno strato aggiornato valido.
      Se c'e' si usa quello, altrimenti quello dentro l'APK.
   2. Il gioco parte SUBITO. Solo dopo, e solo se c'e' rete, si controlla
      `versione.json` sul sito: se c'e' una revisione piu' nuova si scaricano i
      file cambiati in sottofondo. **Si applicano al riavvio successivo**, mai a
      meta' partita.
   3. I file sono salvati con chiave = impronta del contenuto, e il manifesto si
      scrive per ULTIMO: se lo scarico si interrompe non resta mai uno strato a
      meta'.
   4. Cane da guardia: se una revisione parte ma non arriva mai in fondo, al
      giro dopo viene buttata e si torna a quella dell'APK. Un push sbagliato
      non puo' lasciare il telefono con un gioco che non si apre.

   Nel browser normale non serve niente di tutto questo: i file del sito sono
   gia' gli ultimi. L'aggiornatore si accende solo dentro l'app (o con `?ota`,
   per poterlo provare da PC).
   ========================================================================== */
(function () {
  "use strict";

  /* Da dove si scaricano gli aggiornamenti. `?remoto=<url>` lo dirotta altrove:
     serve a provare tutto il giro (controllo, scarico, riavvio, ritorno alla
     versione dell'APK) da PC, senza aspettare che Pages ripubblichi. */
  const REMOTO_DEF = "https://fithzhood.github.io/pokerogue-mobile/";
  const DB_NOME  = "pokerogue_ota";
  const DEPOSITO = "file";
  const K_MANIFESTO = "__manifesto";        // chiave del manifesto installato
  const K_TENTATIVO = "pokerogue_ota_try";  // revisione avviata ma mai conclusa
  const K_BOCCIATE  = "pokerogue_ota_bad";  // revisioni che non si sono avviate
  const RITARDO_CONTROLLO = 4000;          // ms: prima far partire il gioco

  const par = new URLSearchParams(location.search);
  const REMOTO = par.get("remoto") || REMOTO_DEF;
  const nativo = () => !!(window.Capacitor && window.Capacitor.isNativePlatform
                          && window.Capacitor.isNativePlatform());
  // `?ota` accende l'aggiornatore anche da PC (per provarlo), `?noota` lo spegne
  const attivo = (nativo() || par.has("ota")) && !par.has("noota");

  /* ---------------------------- IndexedDB ------------------------------- */
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((ok, ko) => {
      const r = indexedDB.open(DB_NOME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(DEPOSITO);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    return dbp;
  }
  function conTransazione(modo, fn) {
    return db().then(d => new Promise((ok, ko) => {
      const t = d.transaction(DEPOSITO, modo);
      const richiesta = fn(t.objectStore(DEPOSITO));
      richiesta.onsuccess = () => ok(richiesta.result);
      richiesta.onerror = () => ko(richiesta.error);
    }));
  }
  const leggi    = k => conTransazione("readonly",  s => s.get(k));
  const scrivi   = (k, v) => conTransazione("readwrite", s => s.put(v, k));
  const elimina  = k => conTransazione("readwrite", s => s.delete(k));
  const chiavi   = () => conTransazione("readonly", s => s.getAllKeys());

  /* ------------------------- Strato attivo ------------------------------ */
  // manifesto = { rev, assetsRev, files: { "percorso": "impronta" } }
  let manifesto = null;    // quello in uso adesso (null = si usa l'APK)
  let revApk = 0;          // revisione dei file dentro l'APK

  /* Testo di un file dello strato attivo. `null` = non ce l'ho, il chiamante
     ripiega sul file dell'APK (o del sito, nel browser). */
  function fileStrato(percorso) {
    if (!manifesto || !manifesto.files[percorso]) return Promise.resolve(null);
    return leggi(manifesto.files[percorso]).then(t => (typeof t === "string" ? t : null));
  }

  /* Prende un file dallo strato attivo, altrimenti dai file locali. */
  function prendi(percorso, versione) {
    return fileStrato(percorso).then(t => {
      if (t != null) return t;
      const u = percorso + (versione ? "?v=" + versione : "");
      return fetch(u).then(r => {
        if (!r.ok) throw new Error(percorso + ": HTTP " + r.status);
        return r.text();
      });
    });
  }

  /* ------------------------- Cane da guardia ----------------------------
     Due informazioni distinte, e vanno tenute separate:

       K_TENTATIVO  la revisione che si sta provando ADESSO. La scrive l'avvio,
                    la cancella il gioco quando e' davvero su.
       K_BOCCIATE   le revisioni che hanno gia' fallito: non si riprovano piu',
                    ne' si riscaricano.

     ⚠️ Il primo tentativo di scriverlo aveva un buco grosso: `avvioRiuscito()`
     cancellava la sentinella SEMPRE, anche quando il gioco era partito dalla
     copia dell'APK. Cosi' la revisione guasta non veniva mai bocciata e al
     riavvio dopo si ritentava: il telefono avrebbe oscillato fra "si apre" e
     "schermo nero" per sempre. Ora la sentinella la cancella solo chi l'ha
     scritta, e chi fallisce finisce nella lista dei bocciati. */
  let revInProva = null;      // revisione di rete che stiamo tentando ora

  function segnaTentativo(rev) { try { localStorage.setItem(K_TENTATIVO, String(rev)); } catch (e) {} }
  function leggiBocciate() {
    try { return JSON.parse(localStorage.getItem(K_BOCCIATE) || "[]"); } catch (e) { return []; }
  }
  function bocciata(rev) { return leggiBocciate().indexOf(Number(rev)) >= 0; }
  function boccia(rev) {
    const l = leggiBocciate();
    if (l.indexOf(Number(rev)) < 0) l.push(Number(rev));
    // se ne tengono poche: le vecchie non le riproporra' mai nessuno
    try { localStorage.setItem(K_BOCCIATE, JSON.stringify(l.slice(-8))); } catch (e) {}
    console.warn("[ota] revisione", rev, "bocciata: non si e' avviata");
  }
  /* Da chiamare all'inizio: se e' rimasta una sentinella, quell'avvio non e'
     mai arrivato in fondo. */
  function raccogliFallimento() {
    let inSospeso = null;
    try { inSospeso = localStorage.getItem(K_TENTATIVO); } catch (e) {}
    if (!inSospeso) return;
    boccia(inSospeso);
    try { localStorage.removeItem(K_TENTATIVO); } catch (e) {}
  }
  function avvioRiuscito() {
    if (revInProva == null) return;       // avvio dall'APK: non tocca nulla
    try { localStorage.removeItem(K_TENTATIVO); } catch (e) {}
  }

  /* --------------------------- Avvio del gioco -------------------------- */
  function errore(msg) {
    const b = document.getElementById("pr-boot");
    if (b) b.innerHTML = '<div class="pr-msg">Non riesco ad avviare il gioco.<br><small>'
      + String(msg).replace(/[<>]/g, "") + "</small></div>";
  }

  async function avviaGioco() {
    // versione dei file locali (serve a capire se lo strato scaricato e' vecchio)
    let locale = null;
    try { locale = await fetch("versione.json?t=" + Date.now(), { cache: "no-store" }).then(r => r.json()); }
    catch (e) { /* nel browser puo' non esserci: si tira avanti */ }
    revApk = (locale && locale.rev) || 0;

    if (attivo) {
      // per prima cosa: l'avvio precedente e' arrivato in fondo?
      raccogliFallimento();
      try {
        const m = await leggi(K_MANIFESTO);
        if (m && m.rev) {
          if (bocciata(m.rev)) {
            // gia' provata e mai partita: si butta e si torna a quella dell'APK
            await elimina(K_MANIFESTO);
          } else if (m.rev <= revApk) {
            // l'APK e' stato aggiornato e ha sorpassato lo strato scaricato
            await elimina(K_MANIFESTO);
          } else {
            manifesto = m;
            revInProva = m.rev;
            segnaTentativo(m.rev);
          }
        }
      } catch (e) { console.warn("[ota] deposito non leggibile:", e.message); }
    }

    const v = manifesto ? "" : (locale && locale.rev) || "";
    const [markup, css, js] = await Promise.all([
      prendi("pokerogue-app.html", v),
      prendi("pokerogue.css", v),
      prendi("pokerogue.js", v),
    ]);

    // il gioco espone questi due al motore: i dati e la conferma di avvio
    window.PR = {
      file: fileStrato,
      avvioRiuscito,
      get rev() { return manifesto ? manifesto.rev : revApk; },
      get daRete() { return !!manifesto; },
    };

    document.body.innerHTML = markup;
    const stile = document.createElement("style");
    stile.textContent = css;
    document.head.appendChild(stile);
    const codice = document.createElement("script");
    codice.textContent = js;
    document.body.appendChild(codice);
  }

  /* ------------------------ Controllo aggiornamenti --------------------- */
  /* Gira DOPO l'avvio e solo se c'e' rete. Scarica i file cambiati e scrive il
     manifesto per ultimo: o l'aggiornamento c'e' tutto, o non c'e' affatto. */
  async function controlla() {
    if (!attivo) return { saltato: "aggiornatore spento" };
    if (navigator.onLine === false) return { saltato: "niente rete" };
    let remoto;
    try {
      remoto = await fetch(REMOTO + "versione.json?t=" + Date.now(), { cache: "no-store" })
        .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    } catch (e) { return { saltato: "sito irraggiungibile: " + e.message }; }

    const revOra = manifesto ? manifesto.rev : revApk;
    if (!(remoto.rev > revOra)) return { aggiornato: true, rev: revOra };
    // gia' provata e mai partita: non si riscarica finche' non ne esce una nuova
    if (bocciata(remoto.rev)) return { saltato: "revisione " + remoto.rev + " bocciata" };

    const daPrendere = [];
    for (const p in remoto.files) {
      const impronta = remoto.files[p];
      const gia = await leggi(impronta);
      if (typeof gia !== "string") daPrendere.push([p, impronta]);
    }
    let presi = 0;
    for (const [p, impronta] of daPrendere) {
      try {
        const t = await fetch(REMOTO + p + "?h=" + impronta).then(r => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        });
        await scrivi(impronta, t);
        presi++;
      } catch (e) {
        console.warn("[ota] scarico fallito:", p, e.message);
        return { fallito: p + ": " + e.message };   // manifesto NON scritto
      }
    }
    await scrivi(K_MANIFESTO, remoto);              // solo ora diventa valido
    await ripulisci(remoto);
    console.log("[ota] revisione", remoto.rev, "pronta:", presi, "file scaricati");
    return { pronta: remoto.rev, scaricati: presi, totale: Object.keys(remoto.files).length,
             assetNuovi: remoto.assetsRev > ((await impronteApk()) || 0) };
  }

  async function impronteApk() {
    try { return (await fetch("versione.json?t=" + Date.now(), { cache: "no-store" }).then(r => r.json())).assetsRev; }
    catch (e) { return 0; }
  }

  /* Butta i contenuti che nessun manifesto usa piu'. */
  async function ripulisci(m) {
    const vive = new Set(Object.values(m.files));
    vive.add(K_MANIFESTO);
    for (const k of await chiavi()) if (!vive.has(k)) await elimina(k);
  }

  /* ------------------------------ Aggancio ------------------------------ */
  window.__ota = {
    stato: async () => {
      const m = await leggi(K_MANIFESTO).catch(() => null);
      return {
        attivo, nativo: nativo(), revApk,
        inUso: manifesto ? "rete (rev " + manifesto.rev + ")" : "APK (rev " + revApk + ")",
        // ⚠️ questa e' quella nel deposito, che puo' essere piu' nuova di quella
        // in uso: si applica al prossimo avvio
        pronta: m ? m.rev : null,
        file: m ? Object.keys(m.files).length : 0,
        bocciate: leggiBocciate(),
        sentinella: localStorage.getItem(K_TENTATIVO),
      };
    },
    controlla,                                   // forza il controllo adesso
    azzera: async () => {
      await elimina(K_MANIFESTO);
      try { localStorage.removeItem(K_TENTATIVO); localStorage.removeItem(K_BOCCIATE); } catch (e) {}
      return "strato scaricato buttato, riavvia";
    },
    remoto: () => fetch(REMOTO + "versione.json?t=" + Date.now(), { cache: "no-store" }).then(r => r.json()),
  };

  avviaGioco()
    .then(() => setTimeout(() => controlla().catch(e => console.warn("[ota]", e)), RITARDO_CONTROLLO))
    .catch(e => { console.error(e); errore(e.message); });
})();
