/* ============================================================================
   pokerogue.js — Lotta 1v1, ora su DATI REALI Gen 1 (Fase 1)
   ----------------------------------------------------------------------------
   I dati (specie, mosse, learnset, typechart, tipi) sono caricati dai JSON in
   data/, generati da ../PokeRogue con tools/extract-data.mjs. Gli sprite sono
   quelli reali di PokeRogue (frame 0 dell'atlas, ritagliato via CSS).
   In scope battaglia: danno + tipi + STAB + PP + priorita' + precisione + KO.
   FUORI scope (dopo): stati/effetti mossa, abilita', oggetti, squadra, ondate.
   Le mosse a effetto (categoria STATUS) sono escluse dal moveset finche' non
   c'e' il motore a mattoncini (Fase 3): per ora ogni Pokemon usa le sue 4
   mosse da DANNO di livello piu' alto, prese dal learnset reale.
   ========================================================================== */

(function () {
  "use strict";

  const START_LEVEL = 5;                 // livello dello starter a inizio run
  const BOSS_EVERY = 10;                 // ogni quante ondate arriva un boss

  /* ======================================================================
     LIVELLO DEL NEMICO — la curva VERA di PokeRogue (`Battle.getLevelForWave`)

        livello = 1 + ondata/2 + (ondata/25)²          · boss ×1,2

     Quasi piatta all'inizio e ripida solo dopo, non lineare. La nostra
     vecchia formula (`5 + (ondata-1)·1,8`) partiva molto piu' alta e saliva
     al doppio della velocita': all'ondata 8 dava livello 17 invece di 5, e
     all'ondata 100 dava 183 invece di 67. Era il motivo per cui la
     progressione "sembrava troppo veloce": lo era davvero, di quasi tre volte.
     ⚠️ Il livello adesso NON dipende piu' da START_LEVEL.
     ====================================================================== */
  function enemyLevelFor(w) {
    const base = 1 + w / 2 + Math.pow(w / 25, 2);
    if (w % BOSS_EVERY === 0) return Math.max(1, Math.floor(base * 1.2));
    // piccola variazione verso l'alto, come il `randSeedGauss` dell'originale
    return Math.max(1, Math.round(base + Math.random() * Math.min(2, 10 / Math.max(1, w))));
  }

  /* ======================================================================
     ESPERIENZA — come nell'originale, non piu' livelli regalati

     · quanta ne frutta un nemico:  baseExp × livello / 5 + 1   (×1,5 allenatori)
     · quanta ne prende ciascuno:   chi ha combattuto la divide fra sé;
       chi era in panchina prende il 20% (l'Esperienza Condivisa che in
       PokeRogue si ottiene presto). Pokerus ×1,5, Esperienzamuleto +%.
     · da esperienza a livello: PokeRogue MESCOLA la curva della specie con
       quella "media veloce" — `0,325 × propria + 0,675 × livello³` — quindi
       le differenze fra curve sono molto smorzate.
     ====================================================================== */
  const EXP_QUOTA_PANCHINA = 0.2;        // 1 Esperienza Condivisa (0,2 per pezzo)
  // Costanti delle sei curve, per livelli >= 100 e per la formula chiusa
  function expCurvaPropria(l, gr) {
    switch (gr) {
      case "ERRATIC":     return (Math.pow(l, 4) + Math.pow(l, 3) * 2000) / 3500;
      case "FAST":        return Math.pow(l, 3) * 4 / 5;
      case "MEDIUM_SLOW": return Math.pow(l, 3) * 6 / 5 - 15 * Math.pow(l, 2) + 100 * l - 140;
      case "SLOW":        return Math.pow(l, 3) * 5 / 4;
      case "FLUCTUATING": return Math.pow(l, 3) * (l / 2 + 8) * 4 / (100 + l);
      default:            return Math.pow(l, 3);     // MEDIUM_FAST
    }
  }
  /* Esperienza TOTALE per arrivare al livello `l`. */
  function expTotalePerLivello(l, gr) {
    if (l <= 1) return 0;
    const media = Math.pow(l, 3);
    if (!gr || gr === "MEDIUM_FAST") return Math.floor(media);
    return Math.floor(expCurvaPropria(l, gr) * 0.325 + media * 0.675);
  }
  const LIVELLO_MAX = 250;               // oltre l'ondata 200 non si va
  /* Livello corrispondente a una certa esperienza totale. */
  function livelloPerExp(exp, gr) {
    let l = 1;
    while (l < LIVELLO_MAX && exp >= expTotalePerLivello(l + 1, gr)) l++;
    return l;
  }

  /* ⚠️ IL TETTO DI LIVELLO — è QUESTO il freno vero di PokeRogue, non la
     quantità di esperienza (`getMaxExpLevel`). Chi lo ha raggiunto smette di
     prendere esperienza finché non sale il tetto, che cresce a scaglioni di
     10 ondate seguendo la stessa curva dei nemici:

        tetto = arrotonda_pari((1 + O/2 + (O/25)²) × 1,2) + 2   con O = ondata
                                                                 arrotondata
                                                                 ai 10 sopra

     Ondata 10 → 10 · ondata 50 → 38 · ondata 100 → 84 · ondata 200 → 200.
     Senza il tetto la squadra scappa in avanti (era il nostro caso: +2 livelli
     regalati a ogni ondata, livello 19 all'ondata 8) oppure resta indietro. */
  function livelloMassimo(w) {
    const o = Math.ceil((w || 1) / 10) * 10;
    const base = (1 + o / 2 + Math.pow(o / 25, 2)) * 1.2;
    return Math.ceil(base / 2) * 2 + 2;
  }
  // Ingrandimento sprite. base = fattore desiderato (i frame Gen1 sono ~40-117px);
  // maxW/maxH = tetto come frazione della scena, cosi' i piccoli si ingrandiscono
  // del pieno ma i giganti (Moltres/Onix) vengono limitati e non si accavallano.
  // Il giocatore ("vicino") e' piu' grande del nemico ("lontano").
  // ⚠️ I due maxH vanno letti INSIEME alle posizioni degli slot in pokerogue.css
  // (`.battler-slot.enemy` in alto, `.ally` in basso): la loro somma deve stare
  // dentro la fascia fra i due slot, o i Pokémon più grandi si toccano.
  // Il caso peggiore non è teorico: 54 sprite del giocatore e 9 del nemico
  // arrivano davvero al tetto (Tyranitar 0,42 · Wyrdeer 0,38).
  //   fascia = 1 − 5% − 5% = 0,90   ·   tetti = 0,42 + 0,38 = 0,80   → 0,10 di stacco
  // Prima i riquadri PS erano impilati con gli sprite e si mangiavano altri
  // 0,24 di scena: da lì la sovrapposizione. Ora sono sovrapposti alla scena.
  const PLAYER_SPRITE = { base: 3.1, maxW: 0.62, maxH: 0.42 };
  const ENEMY_SPRITE  = { base: 2.6, maxW: 0.52, maxH: 0.38 };
  // Riempiti dal loader (vedi bootstrap in fondo). Restano data-driven.
  let T = {};                  // tipi:  { FIRE: {it,color}, ... }
  let M = {};                  // mosse: { FLAMETHROWER: {...}, ... }
  let S = {};                  // specie:{ CHARIZARD: {...}, ... }
  let LEARN = {};              // learnset: { CHARIZARD: [[lvl,MOVE],...] }
  let CHART = {};              // typechart: { FIRE: {GRASS:2,...}, ... }
  let ABIL = {};               // abilita': { BLAZE: {it, attrs, ...}, ... }
  let BIOMES = {};             // biomi: { PLAINS: {it, sky, ground, pools, links}, ... }
  let FORMS = {};              // forme potenziate: { CHARIZARD: [{formKey,baseStats,...}] }
  let ICONS = {};              // mini icone: { dex: {a,x,y,w,h,sw,sh} }
  let VARIANTS = {};           // forme estetiche: { dex: [formKey,...] } (Vivillon, Unown…)
  let TMS = { perSpecie: {}, tier: {} };  // MT: chi impara cosa + rarita' per mossa
  let EGGM = {};               // mosse da uovo: { BULBASAUR: [m0,m1,m2,m3] } (la 4a e' la RARA)
  let DIAL = {};               // dialoghi allenatori: { youngster: {encounter:[[…]], victory:[[…]]} }
  let SPECIES_KEYS = [];       // elenco specie per scelte casuali

  /* ====================================================================== */
  /*  META — persistenza (localStorage): voucher, uova, starter sbloccati    */
  /* ====================================================================== */
  const META_KEY = "pokerogue_clear_meta_v1";
  // Tier uovo: ondate per la schiusa + peso nel gacha. (numeri ridotti: le run
  // sono corte ma le uova PERSISTONO tra le run, quindi si schiudono col tempo)
  /* Le ondate per la schiusa restano le NOSTRE (ridotte: nell'originale sono
     10/25/50/100 e una run corta non ne vedrebbe mai schiudere una). */
  const EGG_TIERS = {
    COMMON:    { it: "Comune",      hatch: 8 },
    RARE:      { it: "Raro",        hatch: 16 },
    EPIC:      { it: "Epico",       hatch: 30 },
    LEGENDARY: { it: "Leggendario", hatch: 50 },
  };

  /* ======================================================================
     GACHA — le TRE macchine dell'originale (`GachaType`)

       🎯 MOSSE       alza il tasso della mossa da uovo RARA
                      (`BOOSTED_RARE_EGGMOVE_RATES` invece di quelle normali)
       👑 LEGGENDARIO sposta di 1/256 le soglie verso il leggendario, e un uovo
                      di tier LEGGENDARIO ha il 50% di diventare la SPECIE IN
                      EVIDENZA del giorno
       ✨ CROMATICO   raddoppia il tasso di cromatico (1/64 invece di 1/128)

     Le soglie del tier sono quelle vere, su 256: COMMON 204 · RARE 44 ·
     EPIC 7 · LEGENDARY 1. (Le nostre erano 68/25/6/1 su 100, molto più
     generose: senza la scala giusta l'offset del gacha leggendario non
     vorrebbe dire niente.)
     ====================================================================== */
  const GACHA = {
    MOVE:      { it: "Gacha Mosse",       emoji: "🎯", sub: "più probabile la mossa da uovo RARA" },
    LEGENDARY: { it: "Gacha Leggendario", emoji: "👑", sub: "più uova leggendarie, e la specie in evidenza" },
    SHINY:     { it: "Gacha Cromatico",   emoji: "✨", sub: "doppia probabilità di cromatico" },
  };
  const SOGLIA_COMMON = 52, SOGLIA_RARE = 8, SOGLIA_EPIC = 1;   // su 256
  const GACHA_LEGGENDARIO_OFFSET = 1;
  const TASSO_SHINY_GACHA = 128, TASSO_SHINY_GACHA_SU = 64;
  const RARE_EGGMOVE_SU = { COMMON: 16, RARE: 12, EPIC: 6, LEGENDARY: 3 };
  const GACHA_EGG_HA_RATE = 192;      // 1/192: il nato ha l'abilità NASCOSTA

  /* Tier dell'uovo: `rollEggTier` dell'originale, soglie su 256. */
  function rollEggTier(tipo) {
    const off = tipo === "LEGENDARY" ? GACHA_LEGGENDARIO_OFFSET : 0;
    const v = Math.floor(Math.random() * 256);
    if (v >= SOGLIA_COMMON + off) return "COMMON";
    if (v >= SOGLIA_RARE + off) return "RARE";
    if (v >= SOGLIA_EPIC + off) return "EPIC";
    return "LEGENDARY";
  }

  /* SPECIE IN EVIDENZA del gacha leggendario: cambia ogni giorno, uguale per
     tutti i tiri di quel giorno (come `getLegendaryGachaSpeciesForTimestamp`,
     che ruota su base giornaliera). Eternatus è escluso, come nell'originale. */
  function specieInEvidenza() {
    const pool = SPECIES_KEYS.filter(k => S[k].eggTier === "LEGENDARY" && k !== "ETERNATUS");
    if (!pool.length) return null;
    const giorno = Math.floor(Date.now() / 86400000);
    return pool[giorno % pool.length];
  }
  function defaultMeta() {
    return {
      vouchers: 3,   // qualche voucher iniziale per provare subito il gacha
      eggs: [],      // [{tier, waves}]
      // vuoto: i 27 starter di partenza sono sempre schierabili di loro
      // (DEFAULT_STARTER_SET), qui ci finisce solo cio' che catturi davvero
      unlocked: {},
      pullsSinceEpic: 0,
      stats: { hatched: 0, bestWave: 0, runs: 0 },
      starterBest: {},   // record di ondate raggiunte con ogni starter (statistica)
      ribbons: {},       // FIOCCHI: quante volte hai VINTO con quella specie
      candy: {},         // caramelle per specie (da catture/schiuse)
      costCut: {},       // riduzione permanente del costo starter (comprata con caramelle)
      passiveOn: {},     // specie con PASSIVA sbloccata (caramelle)
      ivs: {},           // migliori IV visti per specie: { SPECIE: {hp,atk,...} }
      formsSeen: {},     // forme estetiche già catturate: { dex: {formKey: true} }
      seen: {},          // specie INCONTRATE (anche senza catturarle): { SPECIE: true }
      eggMoves: {},      // mosse da uovo sbloccate: { SPECIE: maschera di bit 0-15 }
      abils: {},         // abilità sbloccate: { SPECIE: 1|2|4 } (4 = nascosta)
      // livrea cromatica più alta vista per specie: { SPECIE: 0|1|2 }
      // (0 = comune, 1 = rara, 2 = epica). È da qui che lo starter prende i
      // suoi punti di fortuna, come `getDexAttrLuck` nell'originale.
      shinyVar: {},
      // sessi incontrati per specie: { SPECIE: 1|2|3 } (1 maschio, 2 femmina)
      genders: {},
    };
  }

  /* ====================================================================== */
  /*  MOSSE DA UOVO                                                         */
  /*  Ogni specie base ha 4 mosse da uovo; la quarta (indice 3) e' la RARA. */
  /*  NON si scelgono: si sbloccano UNA alla volta facendo schiudere le     */
  /*  uova. E' il motivo per cui in PokeRogue le mosse iniziali disponibili */
  /*  sono pochissime all'inizio e crescono giocando.                       */
  /* ====================================================================== */

  /* Quale slot sblocca una schiusa. Copia di `rollEggMoveIndex`: 1 su X e' la
     rara, altrimenti una delle 3 comuni a caso. X dipende dal tier dell'uovo. */
  const RARE_EGGMOVE_RATES = { COMMON: 48, RARE: 24, EPIC: 12, LEGENDARY: 6 };
  function rollEggMoveIndex(tier, potenziato) {
    const tabella = potenziato ? RARE_EGGMOVE_SU : RARE_EGGMOVE_RATES;
    const base = tabella[tier] || tabella.COMMON;
    return Math.floor(Math.random() * base) ? Math.floor(Math.random() * 3) : 3;
  }

  const eggMaskOf = k => (meta.eggMoves && meta.eggMoves[k]) || 0;
  /* Le mosse da uovo GIA' sbloccate per quella specie, in ordine di slot. */
  function unlockedEggMoves(k) {
    const list = EGGM[k];
    if (!list) return [];
    const mask = eggMaskOf(k);
    return list.filter((id, i) => (mask & (1 << i)) && M[id]);
  }
  const isRareEggMove = (k, id) => !!(EGGM[k] && EGGM[k][3] === id);

  /* Sblocca uno slot. Ritorna il nome della mossa se era davvero nuova
     (come `setEggMoveUnlocked`, che torna false se ce l'avevi gia'). */
  function unlockEggMove(k, tier, potenziato) {
    if (!EGGM[k]) return null;
    const i = rollEggMoveIndex(tier, potenziato);
    const id = EGGM[k][i];
    if (!id || !M[id]) return null;
    meta.eggMoves = meta.eggMoves || {};
    const mask = meta.eggMoves[k] || 0;
    if (mask & (1 << i)) return null;         // gia' sbloccata: niente di nuovo
    meta.eggMoves[k] = mask | (1 << i);
    return { id, it: M[id].it, rara: i === 3 };
  }

  /* Registro dei Pokémon VISTI. Nell'originale il dex ha due livelli — `seenAttr`
     e `caughtAttr` — e la griglia degli starter li distingue: mai visto = sagoma
     nera, visto = grigio, catturato = a colori. Senza questo registro il grigio
     non esisterebbe. */
  function registerSeen(speciesId) {
    if (!speciesId || !S[speciesId]) return;
    meta.seen = meta.seen || {};
    if (meta.seen[speciesId]) return;
    meta.seen[speciesId] = true;
    saveMeta();
  }

  // Pokerus del giorno: 3 specie estratte in modo deterministico dalla data
  // (come getPokerusStarters dell'originale). Bonus: +1 livello per ondata.
  function pokerusToday() {
    const d = new Date();
    let seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const out = [];
    for (let i = 0; out.length < 3 && i < 60; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const k = SPECIES_KEYS[seed % SPECIES_KEYS.length];
      if (!out.includes(k)) out.push(k);
    }
    return out;
  }
  /* FIOCCO ("ribbon"). Nell'originale (`incrementRibbonCount`, chiamato da
     `awardFirstClassicCompletion`) si prende **completando la modalita'
     Classica**, cioe' battendo l'ondata 200 — e lo prende OGNI Pokemon che
     era in squadra alla vittoria, sul suo capostipite. Il primo fiocco di una
     specie frutta anche un buono uovo (`VOUCHER_PLUS`).
     ⚠️ Da noi si prendeva all'ondata 30, che e' un'altra cosa: un traguardo
     di meta' strada, non una vittoria. Adesso e' quello vero.
     `starterBest` resta, ma solo come statistica: non fa piu' fiocchi. */
  function hasRibbon(k) { return (((meta.ribbons || {})[k]) || 0) > 0; }
  function assegnaFiocchi(messages) {
    meta.ribbons = meta.ribbons || {};
    const nuovi = [];
    for (const p of game.party) {
      const root = rootOf(p.speciesId);
      const prima = meta.ribbons[root] || 0;
      meta.ribbons[root] = prima + 1;
      if (!prima) nuovi.push(root);
    }
    for (const k of nuovi) messages.push(`🎀 ${S[k].it} ha ottenuto il suo primo Fiocco!`);
    // un buono uovo per ogni specie al suo PRIMO fiocco, come nell'originale
    if (nuovi.length) {
      meta.vouchers += nuovi.length;
      messages.push(`🎟 ${nuovi.length} Voucher Uovo per i primi fiocchi!`);
    }
    saveMeta();
  }
  let meta = defaultMeta();
  function loadMeta() {
    try { const s = localStorage.getItem(META_KEY); if (s) meta = Object.assign(defaultMeta(), JSON.parse(s)); } catch (e) {}
  }
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {} }
  function speciesOfTier(tier) { return SPECIES_KEYS.filter(k => S[k].eggTier === tier); }

  // helper abilita': trova un mattoncino-abilita' di un dato tipo sul combattente
  // Attributi-abilita' del combattente: abilita' normale + PASSIVA (in PokeRogue
  // la passiva e' una seconda abilita' che agisce insieme alla prima).
  function abAttrs(f) {
    const own = (f.ability && f.ability.attrs) || [];
    const pas = (f.passiveAbility && f.passiveAbility.attrs) || [];
    return pas.length ? own.concat(pas) : own;
  }
  function findAb(f, kind) { return abAttrs(f).find(a => a.kind === kind); }
  /* COPRICAPO, MAGICSCUDO e Antisabbia: il meteo non li tocca. Sta qui perche'
     la usano sia il danno di fine turno sia i controlli di immunita'. */
  const immuneAlMeteo = f => ha(f, "OVERCOAT") || ha(f, "MAGIC_GUARD")
    || ha(f, "SAND_VEIL") || ha(f, "SAND_RUSH") || ha(f, "SAND_FORCE");
  /* 🔴 «HA questa abilita'?», per nome.
     243 abilita' su 306 arrivavano dai dati con `attrs: []` — lo stesso buco
     delle 136 mosse della §47, ma piu' largo: 2.628 assegnazioni
     specie-abilita' che non facevano assolutamente nulla. Non sono traducibili
     in mattoncini perche' nell'originale sono classi a se' (`AbAttr`) con la
     loro logica; vanno scritte a mano, agganciate al punto giusto del motore.
     ⚠️ Guarda ANCHE la passiva: si sblocca con le caramelle ed è a tutti gli
     effetti una seconda abilita'. Dimenticarla vuol dire che chi ha speso le
     caramelle non vede niente. */
  const ha = (f, id) => !!(f && ((f.ability && f.ability.id === id)
                              || (f.passiveAbility && f.passiveAbility.id === id)));
  const nomeAb = (f, id) => (f.ability && f.ability.id === id ? f.ability.it
                            : (f.passiveAbility || {}).it) || id;

  /* ---------------------------------------------------------------------- */
  /*  STATISTICHE — dalla base della specie alla stat reale (IV 31, EV 0)   */
  /*  Ora dipendono dal LIVELLO del singolo combattente (roguelite).        */
  /* ---------------------------------------------------------------------- */
  function calcHP(base, lvl, iv)   { return Math.floor((2 * base + (iv == null ? 31 : iv)) * lvl / 100) + lvl + 10; }
  function calcStat(base, lvl, iv) { return Math.floor((2 * base + (iv == null ? 31 : iv)) * lvl / 100) + 5; }
  const IV_KEYS = ["hp", "atk", "def", "spatk", "spdef", "spd"];
  // IV casuali (0-31), come nei giochi. Le catture li tirano; i migliori per
  // specie si salvano nel meta e valgono per gli starter futuri (come PokeRogue).
  function rollIVs() { const o = {}; for (const k of IV_KEYS) o[k] = Math.floor(Math.random() * 32); return o; }
  function bestIVsFor(speciesId) { return (meta.ivs && meta.ivs[speciesId]) || null; }
  function recordIVs(speciesId, ivs) {
    if (!ivs) return false;
    meta.ivs = meta.ivs || {};
    const cur = meta.ivs[speciesId] || {};
    let improved = false;
    for (const k of IV_KEYS) if ((ivs[k] || 0) > (cur[k] || 0)) { cur[k] = ivs[k]; improved = true; }
    meta.ivs[speciesId] = cur;
    return improved;
  }

  // (Ri)calcola le stat reali dai baseStats correnti + livello. Se maxHp cresce
  // (level-up / vitamina PS), aggiunge il guadagno agli HP correnti.
  /* ----------------------------------------------------------------------
     METEO — come `weather.ts` dell'originale.
       Sole      : mosse Fuoco ×1,5 · Acqua ×0,5
       Pioggia   : mosse Acqua ×1,5 · Fuoco ×0,5
       Tempesta  : danno a fine turno a chi non e' Terra/Roccia/Acciaio
       Grandine  : danno a fine turno a chi non e' Ghiaccio
     Dura 5 turni (8 con la Rocciamistica, come MYSTICAL_ROCK).
     ---------------------------------------------------------------------- */
  const WEATHER = {
    SUNNY:     { it: "Sole",      emoji: "☀️", su: "FIRE",  giu: "WATER" },
    RAIN:      { it: "Pioggia",   emoji: "🌧️", su: "WATER", giu: "FIRE" },
    SANDSTORM: { it: "Tempesta",  emoji: "🌪️", danno: ["GROUND", "ROCK", "STEEL"] },
    HAIL:      { it: "Grandine",  emoji: "🌨️", danno: ["ICE"] },
  };
  /* Imposta il meteo. `fonte` finisce nel messaggio. */
  function setWeather(kind, messages, fonte) {
    if (!WEATHER[kind]) return;
    const extra = aliveParty().some(p => p.held && p.held.mysticalrock) ? 3 : 0;
    game.weather = { kind, turns: 5 + extra };
    if (messages) messages.push(`${WEATHER[kind].emoji} ${fonte || ""}${fonte ? ": " : ""}inizia ${WEATHER[kind].it.toLowerCase()}!`);
  }
  const weatherKind = () => (game.weather && game.weather.turns > 0) ? game.weather.kind : null;

  /* Porta ORA DEL GIORNO e METEO sulla scena: il resto lo fa il CSS
     (`#ambiente`). Nell'originale il fondale non cambia, cambia la LUCE — e
     con essa quali Pokemon compaiono e che tempo puo' fare. */
  function applyAmbiente() {
    const s = document.getElementById("scene");
    if (!s) return;
    s.dataset.ora = timeOfDay();
    const w = weatherKind();
    if (w) s.dataset.meteo = w; else delete s.dataset.meteo;
  }
  // Mosse che chiamano il meteo, e abilita' che lo chiamano entrando in campo
  const WEATHER_MOVES = { SUNNY_DAY: "SUNNY", RAIN_DANCE: "RAIN", SANDSTORM: "SANDSTORM",
                          HAIL: "HAIL", SNOWSCAPE: "HAIL", CHILLY_RECEPTION: "HAIL" };
  const WEATHER_ABIL = { DROUGHT: "SUNNY", DRIZZLE: "RAIN", SAND_STREAM: "SANDSTORM",
                         SNOW_WARNING: "HAIL", DESOLATE_LAND: "SUNNY", PRIMORDIAL_SEA: "RAIN",
                         ORICHALCUM_PULSE: "SUNNY", SAND_SPIT: "SANDSTORM" };
  const WEATHER_ANIM = { SUNNY: "SUNNY", RAIN: "RAIN", SANDSTORM: "SANDSTORM", HAIL: "HAIL" };
  /* Fine turno: il meteo scade. */
  function tickWeather(messages) {
    if (!game.weather || game.weather.turns <= 0) return;
    if (--game.weather.turns <= 0) {
      const w = WEATHER[game.weather.kind];
      game.weather = null;
      if (w && messages) messages.push(`Il tempo torna normale.`);
    }
  }
  /* Moltiplicatore del meteo sulla potenza di una mossa. */
  function weatherMoveMult(moveType) {
    const w = WEATHER[weatherKind()];
    if (!w) return 1;
    if (w.su === moveType) return 1.5;
    if (w.giu === moveType) return 0.5;
    return 1;
  }
  /* Danno di fine turno da Tempesta/Grandine (1/16, chi non e' immune). */
  function weatherResidual(f, messages) {
    const k = weatherKind(); const w = WEATHER[k];
    if (!w || !w.danno || f.fainted) return;
    if (f.types.some(t => w.danno.includes(t))) return;
    if (immuneAlMeteo(f)) return;      // Copricapo, Magicscudo, Antisabbia...
    // le abilita' che immunizzano dal meteo (Scudopolvere, Corpogelo...) lo evitano
    if (abAttrs(f).some(a => a.kind === "weatherImmune")) return;
    const d = Math.max(1, Math.floor(f.maxHp / 16));
    f.hp = Math.max(0, f.hp - d); f._justHit = true;
    messages.push(`${f.name} è sferzato dalla ${w.it.toLowerCase()}!`);
    if (f.hp <= 0) { f.fainted = true; messages.push(`${f.name} è esausto!`); }
  }

  /* ----------------------------------------------------------------------
     TERRENI — come `terrain.ts` e `arena.ts` dell'originale.
       Elettrico : mosse Elettro ×1,3 · chi sta a terra non si addormenta
       Erboso    : mosse Erba ×1,3 · chi sta a terra recupera 1/16 a fine turno
       Psichico  : mosse Psico ×1,3 · niente mosse di priorita' su chi sta a terra
       Nebbioso  : mosse Drago ×0,5 · chi sta a terra e' immune agli stati
     Valgono solo per chi tocca il suolo: i Volanti e chi ha Levitazione no.
     Durano 5 turni (8 con la Rocciamistica), come il meteo.
     ---------------------------------------------------------------------- */
  const TERRAINS = {
    ELECTRIC: { it: "Campo Elettrico", emoji: "⚡", tipo: "ELECTRIC" },
    GRASSY:   { it: "Campo Erboso",    emoji: "🌿", tipo: "GRASS" },
    PSYCHIC:  { it: "Campo Psichico",  emoji: "🔮", tipo: "PSYCHIC" },
    MISTY:    { it: "Campo Nebbioso",  emoji: "🌫️", tipo: null },
  };
  const terrainKind = () => (game.terrain && game.terrain.turns > 0) ? game.terrain.kind : null;
  // Abilita' che stendono un terreno entrando in campo
  const TERRAIN_ABIL = { ELECTRIC_SURGE: "ELECTRIC", GRASSY_SURGE: "GRASSY",
                         PSYCHIC_SURGE: "PSYCHIC", MISTY_SURGE: "MISTY",
                         HADRON_ENGINE: "ELECTRIC", SEED_SOWER: "GRASSY" };
  /* "Tocca terra?" — i Volanti e chi ha Levitazione restano fuori dal terreno. */
  /* MAGICOZONA e DIVIETO spengono gli oggetti tenuti. Invece di controllarlo
     in venti punti diversi, si mettono da parte: chi non ha oggetti non puo'
     usarli, e al ritorno se li riprende tutti.
     ⚠️ Rete di sicurezza in `fineBattaglia`: se una lotta finisce mentre sono
     spenti, non devono restare spenti per sempre. */
  function spegniOggetti(f) {
    if (!f || f._heldOff) return;
    f._heldOff = { held: f.held || {}, berries: f.berries || {} };
    f.held = {}; f.berries = {};
  }
  function riaccendiOggetti(f) {
    if (!f || !f._heldOff) return;
    f.held = f._heldOff.held; f.berries = f._heldOff.berries; f._heldOff = null;
  }
  function isGrounded(f) {
    if (!f) return false;
    if (game.gravita > 0) return true;          // la gravita' inchioda tutti a terra
    if (f.volatile && f.volatile.levita > 0) return false;
    if (f.types.includes("FLYING")) return false;
    if (abAttrs(f).some(a => a.kind === "typeImmunity" && a.moveType === "GROUND")) return false;
    return true;
  }
  function setTerrain(kind, messages, fonte) {
    if (!TERRAINS[kind]) return;
    const extra = aliveParty().some(p => p.held && p.held.mysticalrock) ? 3 : 0;
    game.terrain = { kind, turns: 5 + extra };
    if (messages) messages.push(`${TERRAINS[kind].emoji} ${fonte ? fonte + ": " : ""}il campo diventa ${TERRAINS[kind].it}!`);
  }
  /* Moltiplicatore del terreno sulla potenza (solo se chi attacca tocca terra). */
  function terrainMoveMult(attacker, moveType) {
    const t = TERRAINS[terrainKind()];
    if (!t || !isGrounded(attacker)) return 1;
    if (t.tipo && t.tipo === moveType) return 1.3;
    if (terrainKind() === "MISTY" && moveType === "DRAGON") return 0.5;
    return 1;
  }
  function tickTerrain(messages) {
    if (!game.terrain || game.terrain.turns <= 0) return;
    if (--game.terrain.turns <= 0) {
      game.terrain = null;
      if (messages) messages.push("Il campo torna normale.");
    }
  }
  /* Campo Erboso: chi sta a terra recupera 1/16 a fine turno. */
  function terrainResidual(f, messages) {
    if (terrainKind() !== "GRASSY" || f.fainted || !isGrounded(f) || f.hp >= f.maxHp) return;
    f.hp = Math.min(f.maxHp, f.hp + Math.max(1, Math.floor(f.maxHp / 16)));
    messages.push(`${f.name} si rigenera sul Campo Erboso!`);
  }

  /* ---------------------------------------------------------------------- */
  /*  NATURE — 25, come nei giochi: +10% a una stat e −10% a un'altra        */
  /*  (5 sono neutre). Tabella e nomi italiani presi dall'originale.         */
  /* ---------------------------------------------------------------------- */
  const NATURES = {
    HARDY:   { it: "Ardita",   su: null,    giu: null },
    LONELY:  { it: "Schiva",   su: "atk",   giu: "def" },
    BRAVE:   { it: "Audace",   su: "atk",   giu: "spd" },
    ADAMANT: { it: "Decisa",   su: "atk",   giu: "spatk" },
    NAUGHTY: { it: "Birbona",  su: "atk",   giu: "spdef" },
    BOLD:    { it: "Sicura",   su: "def",   giu: "atk" },
    DOCILE:  { it: "Docile",   su: null,    giu: null },
    RELAXED: { it: "Placida",  su: "def",   giu: "spd" },
    IMPISH:  { it: "Scaltra",  su: "def",   giu: "spatk" },
    LAX:     { it: "Fiacca",   su: "def",   giu: "spdef" },
    TIMID:   { it: "Timida",   su: "spd",   giu: "atk" },
    HASTY:   { it: "Lesta",    su: "spd",   giu: "def" },
    SERIOUS: { it: "Seria",    su: null,    giu: null },
    JOLLY:   { it: "Allegra",  su: "spd",   giu: "spatk" },
    NAIVE:   { it: "Ingenua",  su: "spd",   giu: "spdef" },
    MODEST:  { it: "Modesta",  su: "spatk", giu: "atk" },
    MILD:    { it: "Mite",     su: "spatk", giu: "def" },
    QUIET:   { it: "Quieta",   su: "spatk", giu: "spd" },
    BASHFUL: { it: "Ritrosa",  su: null,    giu: null },
    RASH:    { it: "Ardente",  su: "spatk", giu: "spdef" },
    CALM:    { it: "Calma",    su: "spdef", giu: "atk" },
    GENTLE:  { it: "Gentile",  su: "spdef", giu: "def" },
    SASSY:   { it: "Vivace",   su: "spdef", giu: "spd" },
    CAREFUL: { it: "Cauta",    su: "spdef", giu: "spatk" },
    QUIRKY:  { it: "Furba",    su: null,    giu: null },
  };
  const NATURE_KEYS = Object.keys(NATURES);

  /* ---------------------------------------------------------------------- */
  /*  SESSO — `malePercent` per specie: null = senza sesso (Magnemite…)      */
  /* ---------------------------------------------------------------------- */
  function rollGender(sp) {
    if (!sp || sp.malePercent == null) return "GENDERLESS";
    return (Math.random() * 100 <= sp.malePercent) ? "MALE" : "FEMALE";
  }
  const genderSymbol = f => f && f.gender === "MALE" ? "♂" : f && f.gender === "FEMALE" ? "♀" : "";

  /* ======================================================================
     SESSO SBLOCCATO (dex) — §34

     Come abilità e nature: nella scheda starter si sceglie il sesso, ma solo
     fra quelli che hai già incontrato. Conta perché per certe specie il sesso
     cambia tutto — un Combee femmina evolve in Vespiquen, uno maschio no — e
     per 98 specie cambia anche lo sprite.

     Il sesso COMUNE è sempre disponibile, quello raro va trovato: senza questa
     regola una specie mai catturata non sarebbe schierabile affatto. «Comune»
     vuol dire quello che esce più spesso (`malePercent >= 50`): per Combee,
     87,5% maschi, di partenza puoi schierare solo il maschio — la femmina si
     sblocca trovandone una, **o trovando una sua evoluzione** (Vespiquen è
     femmina al 100%), perché la registrazione va sul CAPOSTIPITE come per le
     abilità.
     ====================================================================== */
  const SESSO_M = 1, SESSO_F = 2;
  /* Quali sessi ESISTONO per quella specie. */
  function sessiPossibili(k) {
    const mp = S[k] && S[k].malePercent;
    if (mp == null) return ["GENDERLESS"];
    if (mp <= 0) return ["FEMALE"];
    if (mp >= 100) return ["MALE"];
    return ["MALE", "FEMALE"];
  }
  const sessoComune = k => ((S[k] && S[k].malePercent) >= 50 ? "MALE" : "FEMALE");
  function registraSesso(speciesId, gender) {
    if (!gender || gender === "GENDERLESS") return null;
    meta.genders = meta.genders || {};
    const bit = gender === "MALE" ? SESSO_M : SESSO_F;
    const prima = meta.genders[speciesId] || 0;
    if (prima & bit) return null;                 // già visto: niente da dire
    meta.genders[speciesId] = prima | bit;
    /* Vale la pena annunciarlo solo se apre davvero una scelta nuova: per una
       specie a sesso unico non hai guadagnato niente. */
    return sessiPossibili(speciesId).length > 1 ? (gender === "MALE" ? "maschio" : "femmina") : null;
  }
  /* Quelli che puoi SCEGLIERE per quella specie nella schermata starter. */
  function sessiSbloccati(k) {
    const poss = sessiPossibili(k);
    if (poss.length < 2) return poss;
    const mask = (meta.genders && meta.genders[k]) || 0;
    const comune = sessoComune(k);
    return poss.filter(g => g === comune || (mask & (g === "MALE" ? SESSO_M : SESSO_F)));
  }
  const rollNature = () => NATURE_KEYS[Math.floor(Math.random() * NATURE_KEYS.length)];
  // Moltiplicatore della natura su una statistica (i PS non sono mai toccati)
  function natureMult(f, stat) {
    const n = NATURES[f.nature];
    if (!n || stat === "hp") return 1;
    // Cuorugiada amplifica l'effetto della natura di 10 punti per pezzo
    const dew = 0.1 * ((f.held && f.held.souldew) || 0);
    if (n.su === stat) return 1.1 + dew;
    if (n.giu === stat) return 0.9 - dew;
    return 1;
  }
  const natureLabel = f => {
    const n = NATURES[f.nature];
    if (!n) return "";
    if (!n.su) return n.it;
    return `${n.it} (+${VIT_IT[n.su]} −${VIT_IT[n.giu]})`;
  };

  function recomputeStats(f) {
    const lvl = f.level, oldMax = f.maxHp || 0;
    const iv = f.ivs || {};
    // VITAMINE: come nell'originale il bonus e' LINEARE sul numero di pezzi
    // (base × (1 + 0,1 × pezzi)), non composto. Tenerle come conteggio a parte
    // fa anche si' che sopravvivano a evoluzioni e cambi di forma.
    const v = f.vits || {};
    const b = k => Math.floor(f.baseStats[k] * (1 + 0.1 * (v[k] || 0)));
    const bs = { hp: b("hp"), atk: b("atk"), def: b("def"),
                 spatk: b("spatk"), spdef: b("spdef"), spd: b("spd") };
    // La NATURA moltiplica la statistica finale (+10% / −10%), mai i PS.
    // Gli oggetti legati alla specie (Elettropalla, Osso spesso...) raddoppiano.
    const nat = k => Math.floor(calcStat(bs[k], lvl, iv[k]) * natureMult(f, k) * specieBoostMult(f, k));
    f.stats = {
      hp:    calcHP(bs.hp, lvl, iv.hp),
      atk:   nat("atk"),
      def:   nat("def"),
      spatk: nat("spatk"),
      spdef: nat("spdef"),
      spd:   nat("spd"),
    };
    f.maxHp = f.stats.hp;
    if (oldMax > 0) f.hp = Math.min(f.maxHp, f.hp + Math.max(0, f.maxHp - oldMax));
    else f.hp = f.maxHp;
  }

  // Una mossa STATUS e' "utile" se ha un effetto che il motore sa gestire.
  function hasUsefulEffect(mv) {
    return (mv.attrs || []).some(a => ["status", "statStage", "confuse", "heal"].includes(a.kind));
  }

  // Moveset dal learnset reale, LIMITATO alle mosse imparabili al livello dato
  // (come nei giochi veri): mix di 2 mosse da DANNO + fino a 2 di STATO utili,
  // scelte tra le piu' recenti. Garantita almeno una mossa da danno.
  function buildMovepool(speciesId, level) {
    const learn = (LEARN[speciesId] || []).filter(([lv]) => lv <= (level || 100));
    const seen = new Set();
    const dmg = [], sta = [];
    for (let i = learn.length - 1; i >= 0; i--) {   // dalla piu' recente
      const id = learn[i][1], mv = M[id];
      if (!mv || seen.has(id)) continue;
      seen.add(id);
      if (mv.category !== "STATUS" && mv.power) dmg.push(id);
      else if (hasUsefulEffect(mv)) sta.push(id);
    }
    const pick = [...dmg.slice(0, 2), ...sta.slice(0, 2)];
    const rest = [...dmg.slice(2), ...sta.slice(2)];
    while (pick.length < 4 && rest.length) pick.push(rest.shift());
    // rete di sicurezza: almeno una mossa da danno
    if (!pick.some(id => M[id].category !== "STATUS" && M[id].power)) {
      pick.unshift(M.TACKLE ? "TACKLE" : (dmg[0] || Object.keys(M)[1]));
    }
    return pick.slice(0, 4);
  }

  // Sceglie l'abilita' della specie (a caso tra le normali; fallback nascosta).
  /* Abilità di un esemplare che compare in campo. Come `generateAbilityIndex`:
     l'abilità NASCOSTA è rara — 1 su 256 — e le due normali si tirano a sorte.
     L'Abilitamuleto alza la probabilità della nascosta (solo sui selvatici).
     Ritorna anche l'INDICE (0,1,2), che serve per registrare nel dex quale
     abilità hai davvero catturato. */
  const TASSO_NASCOSTA = 256;            // BASE_HIDDEN_ABILITY_RATE
  function pickAbilityIndex(sp, isTrainer) {
    const nasc = (!isTrainer && game.charms && game.charms.ability) || 0;
    const tasso = Math.max(2, Math.floor(TASSO_NASCOSTA / (1 + nasc)));
    if (sp.abilities.hidden && ABIL[sp.abilities.hidden]
        && Math.floor(Math.random() * tasso) === 0) return 2;
    const n = (sp.abilities.normal || []).length;
    return n > 1 ? Math.floor(Math.random() * 2) : 0;
  }
  function abilityByIndex(sp, i) {
    const id = i === 2 ? sp.abilities.hidden : (sp.abilities.normal || [])[i];
    if (id && ABIL[id]) return ABIL[id];
    const alt = (sp.abilities.normal || [])[0] || sp.abilities.hidden;
    return alt && ABIL[alt] ? ABIL[alt] : null;
  }
  function pickAbility(sp, isTrainer) { return abilityByIndex(sp, pickAbilityIndex(sp, isTrainer)); }

  /* ======================================================================
     ABILITÀ SBLOCCATE (dex) — `starterData.abilityAttr` dell'originale
     Maschera per specie: 1 = prima abilità · 2 = seconda · 4 = NASCOSTA.
     Gli starter di partenza hanno solo la PRIMA. Le altre si sbloccano
     catturando (o schiudendo) un esemplare che ce l'ha — e la nascosta
     capita 1 volta su 256, quindi è una conquista vera.
     ====================================================================== */
  const ABIL_1 = 1, ABIL_2 = 2, ABIL_H = 4;
  const abilMaskOf = (k) => {
    const m = (meta.abils && meta.abils[k]) || 0;
    // gli starter di partenza hanno sempre almeno la prima abilità
    return m || ABIL_1;
  };
  function registraAbilita(speciesId, indice) {
    meta.abils = meta.abils || {};
    const bit = indice === 2 ? ABIL_H : (1 << indice);
    const prima = meta.abils[speciesId] || 0;
    if (prima & bit) return null;
    meta.abils[speciesId] = prima | bit;
    const sp = S[speciesId];
    const ab = abilityByIndex(sp, indice);
    return ab ? { it: ab.it, nascosta: indice === 2 } : null;
  }
  /* ======================================================================
     NATURE SBLOCCATE (dex) — `dexEntry.natureAttr` dell'originale

     Stessa idea delle abilità qui sopra, e per lo stesso motivo: nella scheda
     starter si sceglie la natura, ma solo fra quelle che hai già incontrato.
     Nell'originale è una maschera di bit (`natureAttr |= 1 << (nature + 1)`) e
     si riempie catturando o facendo schiudere esemplari con quella natura.

     ⚠️ Con la natura a piacere lo starter diventa più forte: è proprio per
     questo che vanno CONQUISTATE una alla volta. Non regalarle tutte.
     Le 5 nature NEUTRE (Ardita, Docile, Seria, Sciolta, Fermezza) sono sempre
     disponibili: non danno alcun vantaggio, e senza almeno una la schermata
     resterebbe vuota per una specie mai catturata.
     ====================================================================== */
  const natureNeutra = (k) => !NATURES[k].su && !NATURES[k].giu;
  function registraNatura(speciesId, nature) {
    if (!nature || !NATURES[nature]) return null;
    meta.nature = meta.nature || {};
    const bit = 1 << NATURE_KEYS.indexOf(nature);
    const prima = meta.nature[speciesId] || 0;
    if (prima & bit) return null;              // già registrata: niente da dire
    meta.nature[speciesId] = prima | bit;
    return NATURES[nature].it;
  }
  /* Le nature che puoi SCEGLIERE per quella specie nella schermata starter. */
  function natureSbloccate(k) {
    const mask = (meta.nature && meta.nature[k]) || 0;
    return NATURE_KEYS.filter((n, i) => natureNeutra(n) || (mask & (1 << i)));
  }
  /* Etichetta breve dell'effetto: «+Att −A.Sp», o «nessun effetto». */
  const NAT_STAT_IT = { atk: "Att", def: "Dif", spatk: "A.Sp", spdef: "D.Sp", spd: "Vel" };
  function naturaEffetto(k) {
    const n = NATURES[k];
    if (!n.su || !n.giu) return "neutra";
    return `+${NAT_STAT_IT[n.su]} −${NAT_STAT_IT[n.giu]}`;
  }

  /* Le abilità che puoi SCEGLIERE per quella specie nella schermata starter. */
  function abilitaSbloccate(k) {
    const sp = S[k], mask = abilMaskOf(k), out = [];
    const norm = sp.abilities.normal || [];
    if (norm[0] && (mask & ABIL_1)) out.push(norm[0]);
    if (norm[1] && (mask & ABIL_2)) out.push(norm[1]);
    if (sp.abilities.hidden && (mask & ABIL_H)) out.push(sp.abilities.hidden);
    return out.length ? out : (norm[0] ? [norm[0]] : []);
  }

  /* ---- FORME (Unown, Vivillon, Rotom, Oricorio…) -------------------------
     VARIANTS[SPECIE] = [ {key, it, types, baseStats, ability}, … ] IN ORDINE.

     ⚠️ L'ORDINE È IL DATO. Nell'originale (`getSpeciesFormIndex`, battle-scene.ts)
     la forma di chi compare è un INDICE nell'array, e per parecchie specie il
     sorteggio si ferma PRIMA della fine dell'array proprio per non pescare le
     forme da battaglia: Pikachu `randSeedInt(8)` su 9 forme lascia fuori la
     Gigamax, Zygarde 4 su 7 lascia fuori Complete, Tatsugiri 3 su 6 lascia
     fuori le mega, Alcremie 9 su 10, Magearna 2 su 4.

     ⚠️ E soprattutto: fuori dalle regole qui sotto **ogni specie usa la forma 0**.
     Non si estrae a caso una forma qualsiasi. (Prima si faceva, e comparivano
     come se fossero mantelli colorati un Terapagos Cristallino, un Calyrex
     Cavaliere Spettrale o un Necrozma Ultra — per giunta con le statistiche
     della forma base, quindi lo sprite mentiva.)

     Le forme NON sono solo estetiche: 111 delle 249 che comparivano prima
     cambiano tipi, statistiche o abilità (Rotom Lavaggio è Acqua/Elettro con
     520 di totale base contro 440). `makeFighter` le applica davvero.        */

  // "a caso fra le PRIME N forme" — gli N vengono da getSpeciesFormIndex()
  const FORM_RANDOM = {
    UNOWN: 28, SHELLOS: 2, GASTRODON: 2, ROTOM: 6, BASCULIN: 2, DEERLING: 4,
    SAWSBUCK: 4, SCATTERBUG: 20, SPEWPA: 20, VIVILLON: 20, FLABEBE: 5,
    FLOETTE: 5, FLORGES: 5, FURFROU: 10, PUMPKABOO: 4, GOURGEIST: 4,
    ORICORIO: 4, ZARUDE: 2, SQUAWKABILLY: 4, PALDEA_TAUROS: 3,
    PIKACHU: 8, EEVEE: 2, MAGEARNA: 2, URSHIFU: 2, TATSUGIRI: 3,
    ZYGARDE: 4, MINIOR: 7, ALCREMIE: 9,
  };
  // forma 1 rara: esce con probabilità 1 su N (le teiere false, Pichu Spunzorek…)
  const FORM_RARE = {
    SINISTEA: 16, POLTEAGEIST: 16, MAUSHOLD: 16, DUDUNSPARCE: 16,
    POLTCHAGEIST: 16, SINISTCHA: 16, PICHU: 8,
  };
  // la forma è il sesso
  const FORM_BY_GENDER = new Set(["MEOWSTIC", "INDEEDEE", "BASCULEGION", "OINKOLOGNE"]);
  // un allenatore "a tema" manda la forma del PROPRIO tipo (Rotom Calore al Mangiafuoco)
  const FORM_BY_TYPE = new Set(["WORMADAM", "ROTOM", "ORICORIO", "PALDEA_TAUROS", "ARCEUS", "SILVALLY"]);
  // Toxtricity: la natura decide Melodia (0) o Discordia (1)
  const LOWKEY_NATURES = new Set(["LONELY", "BOLD", "RELAXED", "TIMID", "SERIOUS",
    "MODEST", "MILD", "QUIET", "BASHFUL", "CALM", "GENTLE", "CAREFUL"]);

  /* Quale forma tocca a questa specie adesso. ctx: {gender, nature, isTrainer,
     trainerTypes}. Ricalca getSpeciesFormIndex(); il default è 0 = forma base. */
  function speciesFormIndex(speciesId, ctx) {
    const forms = VARIANTS[speciesId];
    if (!forms || forms.length < 2) return 0;
    ctx = ctx || {};

    // allenatore con un tipo di specialità: forma coerente col suo tipo
    if (ctx.trainerTypes && ctx.trainerTypes.length && FORM_BY_TYPE.has(speciesId)) {
      const i = forms.findIndex(f => f.types && f.types.some(t => ctx.trainerTypes.includes(t)));
      if (i >= 0) return i;
    }
    if (FORM_BY_GENDER.has(speciesId)) return ctx.gender === "FEMALE" ? 1 : 0;
    if (speciesId === "TOXTRICITY") return LOWKEY_NATURES.has(ctx.nature) ? 1 : 0;
    if (speciesId === "GIMMIGHOUL") return 1;          // in Classica solo la forma Errante
    /* Manto di Burmy e ora di Lycanroc dipendono da DOVE e QUANDO li incontri —
       ma solo se li incontri: per i Pokémon del giocatore (starter, uova)
       l'originale passa `ignoreArena` e sorteggia, perché bioma e orario del
       momento non c'entrano nulla con un Pokémon che è già tuo. */
    if (speciesId === "BURMY" || speciesId === "WORMADAM") {
      if (ctx.ignoreArena) return Math.floor(Math.random() * forms.length);
      if (game.biome === "BEACH") return 1;            // Sabbia
      if (game.biome === "SLUM") return 2;             // Scarti
      return 0;                                        // Pianta
    }
    if (speciesId === "LYCANROC") {
      if (ctx.ignoreArena) return Math.floor(Math.random() * forms.length);
      const t = timeOfDay();
      if (t === "NIGHT") return 1;                     // Notte
      if (t === "DUSK") return 2;                      // Crepuscolo
      return 0;                                        // Giorno
    }
    // Cosplay e Compagno vietati agli allenatori prima dell'ondata 30
    if ((speciesId === "PIKACHU" || speciesId === "EEVEE") && ctx.isTrainer && (game.wave || 0) < 30) return 0;

    const rare = FORM_RARE[speciesId];
    if (rare) return Math.floor(Math.random() * rare) ? 0 : 1;
    const n = FORM_RANDOM[speciesId];
    if (n) return Math.floor(Math.random() * Math.min(n, forms.length));
    return 0;
  }

  /* Ritrova una forma dalla sua chiave (cattura, furto, evoluzione, salvataggi
     vecchi). Torna null se la specie non ha forme o la chiave non esiste più. */
  function formByKey(speciesId, key) {
    const forms = VARIANTS[speciesId];
    if (!forms || forms.length < 2) return null;
    const i = forms.findIndex(f => (f.key || null) === (key || null));
    return i >= 0 ? forms[i] : null;
  }
  /* Forma alla posizione i, con la stessa rete di sicurezza dell'originale
     (`forms.length <= formIndex` → forma base): serve dopo un'evoluzione, quando
     l'indice si porta dietro ma la nuova specie può avere meno forme. */
  function formAt(speciesId, i) {
    const forms = VARIANTS[speciesId];
    if (!forms || forms.length < 2) return null;
    return forms[i] || forms[0];
  }
  const formIndexOf = (speciesId, key) => {
    const forms = VARIANTS[speciesId];
    if (!forms) return 0;
    const i = forms.findIndex(f => (f.key || null) === (key || null));
    return i >= 0 ? i : 0;
  };

  // Nome italiano ufficiale della forma ("Lavaggio", "Giardinfiore", "A"…).
  function formNameOf(speciesId, key) {
    const f = formByKey(speciesId, key);
    return (f && f.it) || (key || "").split("-")
      .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  /* Quante forme si possono davvero incontrare: è il denominatore del contatore
     "ne hai 3 su 20". Contare tutto l'array direbbe bugie (le 9 forme di Pikachu
     includono la Gigamax, che non compare mai). */
  function collectableForms(speciesId) {
    const forms = VARIANTS[speciesId];
    if (!forms || forms.length < 2) return 0;
    if (FORM_RANDOM[speciesId]) return Math.min(FORM_RANDOM[speciesId], forms.length);
    if (FORM_RARE[speciesId]) return 2;
    if (FORM_BY_GENDER.has(speciesId)) return 2;
    if (speciesId === "TOXTRICITY") return 2;
    if (speciesId === "BURMY" || speciesId === "WORMADAM" || speciesId === "LYCANROC") return 3;
    if (speciesId === "GIMMIGHOUL") return 1;
    return 1;
  }

  /* 🔴 Le forme SCEGLIIBILI nella schermata starter.
     Si registravano («Nuova forma: Acqua!») e poi non servivano a niente: la
     squadra si componeva sempre con la forma di partenza. Un Tauros di Paldea
     Acqua catturato restava una riga nel contatore.
     Come per abilità e nature, si guarda cosa hai già incontrato; la prima
     forma dell'elenco è sempre disponibile, o le specie a piu' forme non ne
     avrebbero nessuna finche' non ne trovi una. */
  function formeSbloccate(k) {
    const forms = VARIANTS[k];
    if (!forms || forms.length < 2) return [];
    // le forme che dipendono da sesso/natura non si scelgono: le decide altro
    if (FORM_BY_GENDER.has(k) || k === "TOXTRICITY") return [];
    const viste = (meta.formsSeen && meta.formsSeen[S[k].dex]) || {};
    const quante = Math.max(1, collectableForms(k));
    const pool = forms.slice(0, quante);
    return pool.filter((f, i) => i === 0 || !f.key || viste[f.key]);
  }

  // Il "collezionismo" delle forme resta: meta.formsSeen è indicizzato per dex
  // (così i salvataggi già esistenti continuano a valere).
  function registerForm(dex, formKey) {
    if (!formKey) return false;
    meta.formsSeen = meta.formsSeen || {};
    meta.formsSeen[dex] = meta.formsSeen[dex] || {};
    if (meta.formsSeen[dex][formKey]) return false;
    meta.formsSeen[dex][formKey] = true;
    return true;
  }

  // Crea un "combattente" istanziando una specie a un dato livello.
  // opts.boss = versione potenziata (stat x1.3, corona nel nome).
  function makeFighter(speciesId, level, opts) {
    opts = opts || {};
    const sp = S[speciesId];
    const boss = !!opts.boss;
    const shiny = !!opts.shiny;
    // Sesso e natura si estraggono PRIMA: per qualche specie decidono la forma.
    const gender = opts.gender || rollGender(sp);
    const nature = opts.nature || rollNature();
    /* FORMA — va risolta prima delle statistiche, perché può cambiarle.
       `opts.variant` la impone (cattura, furto, evoluzione); `opts.formIndex`
       la impone per posizione (evoluzione che si porta dietro l'indice). */
    let form = null;
    if (opts.variant !== undefined && opts.variant !== null) form = formByKey(speciesId, opts.variant);
    else if (opts.formIndex !== undefined) form = formAt(speciesId, opts.formIndex);
    else if (opts.variant === undefined) form = formAt(speciesId, speciesFormIndex(speciesId,
      { gender, nature, isTrainer: opts.isTrainer, trainerTypes: opts.trainerTypes,
        ignoreArena: opts.ignoreArena }));
    /* Quale delle tre abilità tocca a questo esemplare (la nascosta è 1/256).
       `opts.abilIndex` la impone: lo usano la scelta starter e la cattura,
       che devono conservare quella che avevi davanti. */
    const abilIdx = opts.abilIndex != null ? opts.abilIndex : pickAbilityIndex(sp, opts.isTrainer);
    const srcStats = (form && form.baseStats) ? form.baseStats : sp.baseStats;
    const bs = {};
    for (const k in sp.baseStats) {
      const v = srcStats[k] != null ? srcStats[k] : sp.baseStats[k];
      bs[k] = Math.round(v * (boss ? 1.3 : 1));
    }
    // Il nome porta la forma fra parentesi, come `appendForm.generic`
    // dell'originale — tranne quando la forma È il sesso, che si vede già da ♂/♀.
    const formSuffix = (form && form.key && form.it && !FORM_BY_GENDER.has(speciesId))
      ? ` (${form.it})` : "";
    /* LIVREA cromatica (0 comune · 1 rara · 2 epica) e i punti di fortuna che
       ne derivano. `opts.shinyVar` la impone: la usano cattura, furto,
       evoluzione e ripresa da salvataggio, che devono conservare quella che
       avevi davanti. Va estratta DOPO la forma, perché le forme hanno livree
       proprie (Rotom Lavaggio non ha le stesse di Rotom). */
    const shinyVar = shiny
      ? (opts.shinyVar != null ? opts.shinyVar : rollShinyVar(sp.dex, form && form.key))
      : 0;
    const f = {
      speciesId,
      dex: sp.dex,
      name: (boss ? "👑 " : "") + (shiny ? "✨" : "") + sp.it + formSuffix,
      shiny,
      shinyVar,                          // 0 comune · 1 rara · 2 epica
      // `pokemon.ts:445`. Sta sul singolo: sopravvive all'evoluzione.
      luck: shiny ? shinyVar + 1 : 0,
      level: level,
      // ESPERIENZA: si parte con quella minima del proprio livello, come i
      // Pokemon che incontri gia' cresciuti. Da qui in poi sale davvero.
      exp: expTotalePerLivello(level, sp.growthRate),
      growthRate: sp.growthRate,
      baseExp: sp.baseExp || 60,
      movesCheckedTo: level,   // fino a che livello abbiamo gia' valutato il learnset
      held: {},                // oggetti tenuti impilabili { leftovers:n, shellbell:n, typeboost:{FIRE:n} }
      berries: {},             // bacche tenute { SITRUS:n, LUM:n, ... }, si consumano
      vits: {},                // vitamine per statistica: { atk:2, spd:1 } -> +10% l'una
      nature,                 // 25 nature: +10% a una stat, -10% a un'altra
      gender,                 // MALE | FEMALE | GENDERLESS
      types: (form && form.types) ? form.types.slice() : sp.types.slice(),
      baseStats: bs,          // dalla forma se ce l'ha (le vitamine stanno in `vits`)
      boss,
      fainted: false,
      // la forma può imporre l'abilità (Rotom Lavaggio, Lycanroc Crepuscolo…)
      ability: (form && form.ability && ABIL[form.ability]) ? ABIL[form.ability] : abilityByIndex(sp, abilIdx),
      abilIndex: abilIdx,      // 0/1 normali, 2 NASCOSTA — serve al dex alla cattura
      // PASSIVA: attiva solo se sbloccata con le caramelle (come PokeRogue)
      passiveAbility: (sp.passive && ABIL[sp.passive] && meta.passiveOn && meta.passiveOn[speciesId]) ? ABIL[sp.passive] : null,
      ivs: opts.ivs || rollIVs(),
      // forma: chiave (per lo sprite e il collezionismo) e posizione nell'array,
      // che l'evoluzione si porta dietro come fa l'originale
      variant: form ? (form.key || null) : null,
      formIndex: form ? formIndexOf(speciesId, form.key) : 0,
      formIt: form ? form.it : null,
      spr: null,   // dati sprite (riempiti async)
      status: null,          // BURN | PARALYSIS | SLEEP | POISON | FREEZE
      sleepTurns: 0,         // turni di sonno rimanenti
      stages: { atk: 0, def: 0, spatk: 0, spdef: 0, spd: 0, acc: 0, eva: 0 },
      /* 🔴 I CONTATORI D'INGRESSO NASCONO QUI, non solo in `entraInCampo`.
         Chi entra a lotta in corso passa da `entraInCampo`, che glieli azzera;
         ma il PRIMO di ogni schieramento avversario — il selvatico e il capofila
         dell'allenatore — arriva in campo senza passarci, e restava con
         `turniInCampo` a `undefined`. Le mosse che chiedono «e' il tuo primo
         turno?» (Bruciapelo, Bruciatutto, Bloccoscudo) confrontano con `=== 0`:
         su un `undefined` fallivano sempre. E l'avversario non risultava mai
         «appena entrato» per l'IA che valuta il cambio. */
      volatile: { confusion: 0, flinch: false, turniInCampo: 0, usate: [] },
      // istanze mossa con PP correnti, dal learnset reale
      moves: buildMovepool(speciesId, level).map(id => ({ id, pp: M[id].pp, maxPp: M[id].pp })),
    };
    recomputeStats(f);        // calcola stats/maxHp/hp dal livello
    // boss: barra HP a SEGMENTI (come nell'originale): il danno che sfonderebbe
    // un segmento viene scartato — il boss va "rotto" un segmento alla volta.
    if (boss) {
      /* 🔴 GLI SCUDI ERANO FUORI SCALA. Qui stava `2 + floor(level / 25)`:
         a livello 100 sono SEI scudi, a 200 ne sono DIECI, e una lotta contro
         un boss di fine run diventava una fila di dieci barre da sfondare.
         La formula vera dell'originale (`getEncounterBossSegments`) e' molto
         piu' avara e non guarda quasi il livello:
             2, +1 se il livello e' almeno 100, +1 se il totale base della
             specie e' almeno 670, +1 ogni 250 ondate.
         In una run che finisce alla 200 il massimo e' QUATTRO, e lo vedono
         solo i pesi massimi. La funzione giusta — `bossSegmentsFor` — c'era
         gia' e la usavano i boss finali: era `makeFighter`, cioe' la strada di
         tutti gli altri boss, a tenersi la vecchia. */
      const bstBase = Object.values(sp.baseStats).reduce((a, b) => a + b, 0);
      setSegments(f, bossSegmentsFor(level, bstBase, game.wave || 1));
    }
    return f;
  }

  // Danno contro un boss: non puo' superare il confine del segmento corrente.
  /* Rompere uno scudo POTENZIA il boss, come `handleBossSegmentCleared`
     dell'originale: +1 stadio a una statistica a caso non ancora al massimo,
     scelta col peso del suo valore (quindi tende a rinforzare ciò in cui è già
     forte). L'ultimo scudo vale +2 se gli scudi erano almeno 3, e con almeno 5
     scudi valgono +2 anche i penultimi. I boss degli ALLENATORI non prendono
     il bonus (`doStatBoost = !this.hasTrainer()`). */
  function bossShieldBonus(foe, messages) {
    if (foe.trainer) return;
    const rimasti = foe.segBounds.length - foe.segBroken;           // scudi ancora interi
    const pool = ["atk", "def", "spatk", "spdef", "spd"].filter(s => foe.stages[s] < 6);
    if (!pool.length) return;
    const pesi = pool.map(s => Math.max(1, foe.stats[s] || 1));
    let r = Math.random() * pesi.reduce((a, b) => a + b, 0);
    let stat = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) { r -= pesi[i]; if (r <= 0) { stat = pool[i]; break; } }
    let stadi = 1;
    if (foe.segTotal >= 3 && rimasti === 0) stadi++;
    if (foe.segTotal >= 5 && rimasti === 1) stadi++;
    foe.stages[stat] = Math.min(6, foe.stages[stat] + stadi);
    messages.push(`${foe.name}: ${STAT_IT[stat]} ${stadi > 1 ? "aumenta molto" : "aumenta"}!`);
  }

  function bossClamp(foe, dmg, messages) {
    /* BOSS FINALE: finché NON è all'ultima fase non può essere sconfitto.
       Nell'originale il danno è tagliato a `hp - 1` finché Eternatus è in forma
       base (`isClassicFinalBoss && formIndex === 0`): si arriva a 1 PS e lì
       scatta la trasformazione. Qui vale per tutte le fasi intermedie, perché
       i boss possono averne tre. */
    const bloccoFinale = d => (foe.finalBoss && foe.finalPhase < (foe.bossFasi || 1))
      ? Math.min(d, Math.max(0, foe.hp - 1)) : d;
    if (!foe.boss || !foe.segBounds || !foe.segBounds.length) return bloccoFinale(dmg);
    /* ⚠️ Gli scudi si contano, non si deducono dai PS. Prima si cercava il
       primo confine sotto la vita attuale: bastava che il boss si curasse (le
       bacche che tiene lo fanno) perché un confine già superato tornasse
       "intero" e lo scudo si riformasse. `segBroken` invece scende e basta,
       come il `bossSegmentIndex` dell'originale. */
    const bound = foe.segBounds[foe.segBroken];
    if (bound !== undefined && foe.hp - dmg < bound) {
      foe.segBroken++;
      messages.push("💠 Uno scudo del boss si infrange!");
      const tagliato = foe.hp - bound;
      bossShieldBonus(foe, messages);
      return bloccoFinale(tagliato);
    }
    return bloccoFinale(dmg);
  }

  /* ---------------------------------------------------------------------- */
  /*  STAT STAGES — moltiplicatori standard (-6..+6)                        */
  /* ---------------------------------------------------------------------- */
  function stageMult(stage) { return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage); }
  function accMult(stage)   { return stage >= 0 ? (3 + stage) / 3 : 3 / (3 - stage); }

  const STAT_IT = { atk: "Attacco", def: "Difesa", spatk: "Att. Speciale", spdef: "Dif. Speciale", spd: "Velocità", acc: "Precisione", eva: "Elusione" };
  /* 🔴 IPERAVVELENAMENTO. Nei dati Tossina e Velenzanna danno
     `status: "TOXIC"`, ma nel motore quello stato NON ESISTEVA: si scriveva
     `f.status = "TOXIC"` e poi nessuno lo guardava. Risultato: Tossina non
     faceva niente — peggio di un veleno normale, che almeno rosicchia.
     Il veleno grave cresce: 1/16 dei PS massimi il primo turno, 2/16 il
     secondo, 3/16 il terzo… Il contatore riparte da capo rientrando nella
     ball, come nei giochi veri (ed è il modo di «curarlo» a meta'). */
  const STATUS_IT = { BURN: "SCT", PARALYSIS: "PAR", SLEEP: "DOR", POISON: "VEL", FREEZE: "CON", TOXIC: "TOX" };
  // Immunita' di tipo agli stati principali.
  const STATUS_IMMUNE = {
    BURN: ["FIRE"], FREEZE: ["ICE"], PARALYSIS: ["ELECTRIC"], POISON: ["POISON", "STEEL"],
    TOXIC: ["POISON", "STEEL"],
  };

  /* ---------------------------------------------------------------------- */
  /*  CALCOLO DANNO — formula standard + STAB + tipi + critico + random     */
  /* ---------------------------------------------------------------------- */
  /* ⚠️ Il tipo ASTRALE non sta nella tabella dei 18: è quello di Terapagos
     Stellare e, da noi, dell'Arceus Perfetto. Nell'originale in DIFESA è
     neutro a tutto — né debolezze né resistenze — e in attacco è neutro salvo
     contro i Terastallizzati, che noi non abbiamo. Quindi qui: chi ce l'ha non
     viene mai colpito in super efficacia, e nemmeno resiste a qualcosa. */
  const ASTRALE = "STELLAR";
  function typeMultiplier(moveType, defenderTypes) {
    if (defenderTypes.includes(ASTRALE)) return 1;
    if (moveType === ASTRALE) return 1;
    let mult = 1;
    const row = CHART[moveType] || {};
    for (const dt of defenderTypes) {
      if (row[dt] !== undefined) mult *= row[dt];
    }
    return mult;
  }

  // Ritorna { damage, effectiveness, crit, immune }. forceCrit: da CritOnlyAttr;
  // critStage: +prob critico (HighCritAttr).
  function computeDamage(attacker, defender, move, opts) {
    opts = opts || {};
    /* ROMPIFORMA / Pressavuoto / Turbostrike: chi attacca IGNORA l'abilita' di
       chi difende. Si toglie di mezzo per tutto il calcolo e si rimette dopo:
       e' il modo piu' onesto di dire «come se non ce l'avesse». */
    const rompi = ha(attacker, "MOLD_BREAKER") || ha(attacker, "TERAVOLT") || ha(attacker, "TURBOBLAZE");
    const abSospesa = rompi ? defender.ability : null;
    const pasSospesa = rompi ? defender.passiveAbility : null;
    if (rompi) { defender.ability = null; defender.passiveAbility = null; }
    try {
    return computeDamageInterno(attacker, defender, move, opts);
    } finally {
      if (rompi) { defender.ability = abSospesa; defender.passiveAbility = pasSospesa; }
    }
  }
  function computeDamageInterno(attacker, defender, move, opts) {
    /* PIOGGIAPLASMA: le mosse Normali diventano Elettro finche' dura. Va fatto
       PRIMA della tabella dei tipi, o cambierebbe solo il STAB. */
    if (game.plasma > 0 && move.type === "NORMAL") move = Object.assign({}, move, { type: "ELECTRIC" });
    /* ELETTRIZZA: per questo turno, qualunque cosa lanci diventa Elettro. */
    if (attacker.volatile && attacker.volatile.elettro && move.type !== "ELECTRIC")
      move = Object.assign({}, move, { type: "ELECTRIC" });
    let eff = typeMultiplier(move.type, defender.types);
    /* Preveggenza, Segugio, Miracolvista: il bersaglio non ha piu' l'immunita'
       ai tipi indicati (Spettro contro Normale/Lotta, Buio contro Psico). */
    if (eff === 0 && defender.volatile && (defender.volatile.smascherato || []).includes(move.type)) eff = 1;
    /* NERVISALDI: Normale e Lotta colpiscono gli Spettro. */
    if (eff === 0 && ha(attacker, "SCRAPPY") && (move.type === "NORMAL" || move.type === "FIGHTING")
        && defender.types.includes("GHOST")) eff = 1;
    /* ARCEUS PERFETTO: le sue mosse sono SEMPRE superefficaci. Spunto dalla
       Lastra Legum di Leggende: Arceus, che gli fa assumere il tipo che
       infligge più danno (in PokéRogue l'oggetto esiste ma non fa nulla).
       Le immunità restano tali: se non ha effetto, non ha effetto. */
    if (attacker.superEff && eff > 0) eff = Math.max(eff, 2);
    /* LENTIFUMÉ: le mosse poco efficaci fanno il doppio (cioe' tornano a 1). */
    if (eff > 0 && eff < 1 && ha(attacker, "TINTED_LENS")) eff *= 2;
    if (eff === 0) return { damage: 0, effectiveness: 0, crit: false, immune: true };

    const isPhysical = move.category === "PHYSICAL";
    // stat stages: nel critico gli sbalzi negativi di chi attacca e positivi di
    // chi difende vengono ignorati (semplificazione: ignoriamo il def buff nel crit).
    // Scala del brutto colpo: stadio 0 = 1/16, poi 1/8, 1/2, sempre.
    // Gli stadi arrivano da HighCritAttr, dal Mirino, dalla Baccalangsa e dal Supercolpo.
    const CRIT_ODDS = [1 / 16, 1 / 8, 1 / 2, 1];
    const cs = Math.min(3, (opts.highCrit ? 1 : 0) + (opts.critStage || 0));
    /* Fortuncanto: dal suo lato non si prendono brutti colpi. */
    /* GUSCIOSCUDO e Corazza: niente brutti colpi contro di loro. */
    const noCrit = (ha(defender, "SHELL_ARMOR") || ha(defender, "BATTLE_ARMOR"))
      || (latoDi(defender) && (game.lati ? game.lati[latoDi(defender)].luckychant > 0 : false));
    const crit = !noCrit && (opts.forceCrit || Math.random() < CRIT_ODDS[cs]);
    /* IMPRUDENZA: chi ce l'ha ignora gli sbalzi dell'AVVERSARIO — sia quando
       attacca (niente difese gonfiate) sia quando difende (niente attacchi
       gonfiati). I propri se li tiene. */
    const ignoraLoro = ha(attacker, "UNAWARE");
    const ignoraMiei = ha(defender, "UNAWARE");
    const atkStage = ignoraMiei ? 0 : (isPhysical ? attacker.stages.atk : attacker.stages.spatk);
    const defStage = ignoraLoro ? 0 : (isPhysical ? defender.stages.def : defender.stages.spdef);
    // abilita': moltiplicatori di statistica (es. Grancampione ATK x2, Corposcelto)
    const atkAb = abStatMult(attacker, isPhysical ? "ATK" : "SPATK");
    // Evolcondensa: +50% alle difese se la specie puo' ancora evolvere
    const evio = (defender.held && defender.held.eviolite && (S[defender.speciesId].evolutions || []).length) ? 1.5 : 1;
    // FOLTOPELO: Difesa raddoppiata. DENTISTRETTI: +50% Attacco se stai male.
    const foltopelo = (isPhysical && ha(defender, "FUR_COAT")) ? 2 : 1;
    const defAb = abStatMult(defender, isPhysical ? "DEF" : "SPDEF") * evio * foltopelo;
    const grinta = (isPhysical && attacker.status && ha(attacker, "GUTS")) ? 1.5 : 1;
    const atk = (isPhysical ? attacker.stats.atk : attacker.stats.spatk) * stageMult(atkStage) * atkAb * grinta
              * tempStatMult(attacker, isPhysical ? "atk" : "spatk");
    /* MIRABILZONA: Difesa e Difesa Speciale si scambiano — la STATISTICA, non
       gli stadi, come nell'originale. */
    const statDif = game.mirabil > 0 ? (isPhysical ? "spdef" : "def") : (isPhysical ? "def" : "spdef");
    const def = defender.stats[statDif] * stageMult(crit ? Math.min(0, defStage) : defStage) * defAb
              * tempStatMult(defender, isPhysical ? "def" : "spdef");

    // abilita': boost di potenza per tipo (Aiutofuoco/Erbaiuto a HP bassi, ecc.)
    // `opts.potenza` sovrascrive la potenza: la usano le mosse a potenza
    // VARIABILE (Colpo Basso, Vortexpalla, Flagello…), che nel dato hanno -1
    let power = opts.potenza != null ? opts.potenza : move.power;
    /* ROTOLAMENTO / PALLA GELO: raddoppia a ogni colpo di fila, fino a cinque
       (30 · 60 · 120 · 240 · 480), e RADDOPPIA ANCORA se prima hai usato
       Ricciolscudo. Il contatore lo tiene `aggiornaVincolo`, che gira prima
       del danno: al primo colpo vale 1, quindi 2^0 = potenza base. */
    const rot = attacker.volatile && attacker.volatile.rotola;
    if (rot && rot.id === move.id) {
      power *= Math.pow(2, Math.min(4, rot.colpi - 1));
      if (attacker.volatile.arricciato) power *= 2;
    }
    /* FORBICIDÀNZA (×2 fino a tre) ed ECHEGGIAVOCE (+40 fino a cinque):
       crescono usandole di fila, ma non vincolano niente. */
    const con = attacker.volatile && attacker.volatile.consec;
    if (con && con.id === move.id && CRESCE[move.id]) {
      power = CRESCE[move.id].doppia
        ? power * Math.pow(2, con.n - 1)
        : power * con.n;
    }
    const lowHp = findAb(attacker, "lowHpTypeBoost");
    if (lowHp && move.type === lowHp.moveType && attacker.hp <= attacker.maxHp / 3) power *= lowHp.mult;
    const tb = findAb(attacker, "typeBoost");
    if (tb && move.type === tb.moveType) power *= tb.mult;
    // held: Boost di Tipo impilabile (+20% l'uno)
    const hb = attacker.held && attacker.held.typeboost && attacker.held.typeboost[move.type];
    if (hb) power *= 1 + 0.2 * hb;
    /* ABILITA' CHE POTENZIANO UNA FAMIGLIA DI MOSSE. I flag (`pugno`, `morso`,
       `taglio`…) arrivano dai `MoveFlags` dell'originale: senza, queste
       abilita' non avrebbero modo di sapere a quali mosse applicarsi. */
    if (ha(attacker, "TECHNICIAN") && move.power > 0 && move.power <= 60) power *= 1.5;
    // TEMERARIETÀ: chi si fa male picchiando, picchia di piu'
    if (ha(attacker, "RECKLESS") && (move.attrs || []).some(a => a.kind === "recoil")) power *= 1.2;
    if (ha(attacker, "TOUGH_CLAWS") && move.contact) power *= 1.3;
    if (ha(attacker, "IRON_FIST") && move.pugno) power *= 1.2;
    if (ha(attacker, "STRONG_JAW") && move.morso) power *= 1.5;
    if (ha(attacker, "SHARPNESS") && move.taglio) power *= 1.5;
    if (ha(attacker, "MEGA_LAUNCHER") && move.onda) power *= 1.5;
    if (ha(attacker, "PUNK_ROCK") && move.sonora) power *= 1.3;
    /* FORZABRUTTA: +30% ma gli effetti aggiuntivi non partono (li spegne
       `applyMoveAttrs`, che guarda la stessa abilita'). */
    if (ha(attacker, "SHEER_FORCE") && move.effectChance > 0) power *= 1.3;
    /* ANTAGONISMO: ±25% secondo il sesso del bersaglio. */
    if (ha(attacker, "RIVALRY") && attacker.gender && defender.gender
        && attacker.gender !== "GENDERLESS" && defender.gender !== "GENDERLESS") {
      power *= attacker.gender === defender.gender ? 1.25 : 0.75;
    }
    // PRECEDENZA: il colpo soffiato all'avversario picchia il 50% in piu'
    if (attacker.volatile && attacker.volatile.precedenza) power *= 1.5;
    // METEO: Sole potenzia il Fuoco e smorza l'Acqua, la Pioggia il contrario
    power *= weatherMoveMult(move.type);
    // TERRENO: +30% al tipo del campo (solo se chi attacca tocca terra)
    power *= terrainMoveMult(attacker, move.type);

    // Nucleo della formula (Gen moderne). Usa il livello di chi attacca.
    let dmg = Math.floor(Math.floor(Math.floor(2 * attacker.level / 5 + 2) * power * atk / def) / 50) + 2;

    // Modificatori
    // ADATTABILITÀ: il bonus di tipo passa da 1,5 a 2
    const stab = attacker.types.includes(move.type) ? (ha(attacker, "ADAPTABILITY") ? 2 : 1.5) : 1;
    // CECCHINO: il brutto colpo vale 2,25 invece di 1,5
    const critMult = crit ? (ha(attacker, "SNIPER") ? 2.25 : 1.5) : 1;
    const rand = 0.85 + Math.random() * 0.15;    // varianza 85-100%
    // la scottatura dimezza il fisico — ma non a chi ha DENTISTRETTI
    const burn = (isPhysical && attacker.status === "BURN" && !ha(attacker, "GUTS")) ? 0.5 : 1;
    // abilita' del difensore: riduce il danno di certi tipi (Grassottello, Antifuoco)
    let abMult = 1;
    for (const a of abAttrs(defender)) if (a.kind === "typeDamageMult" && a.moveType === move.type) abMult *= a.mult;
    /* SOLIDROCCIA / Filtro / Corazzprisma: −25% dalle superefficaci.
       MULTISQUAME / Scudo Ombra: metà danno se il bersaglio è a PS pieni. */
    if (eff > 1 && (ha(defender, "SOLID_ROCK") || ha(defender, "FILTER") || ha(defender, "PRISM_ARMOR"))) abMult *= 0.75;
    if (defender.hp >= defender.maxHp && (ha(defender, "MULTISCALE") || ha(defender, "SHADOW_SHIELD"))) abMult *= 0.5;
    // MORBIDONE: il pelo attutisce il contatto ma prende fuoco facilmente
    if (ha(defender, "FLUFFY")) {
      if (move.contact) abMult *= 0.5;
      if (move.type === "FIRE") abMult *= 2;
    }
    // FUOCARDORE acceso: le proprie mosse di Fuoco valgono il 50% in piu'
    if (move.type === "FIRE" && attacker.volatile && attacker.volatile.fuocardore) abMult *= 1.5;

    /* SCHERMI: dimezzano il danno che arriva su quel lato — Riflesso il
       fisico, Schermoluce lo speciale, Velaurora tutti e due.
       ⚠️ Un brutto colpo li IGNORA, come nei giochi veri: e' il modo di
       sfondarli, e senza questa riga diventerebbero troppo forti. */
    // INTRAPASSO: gli schermi avversari non lo riguardano
    const Ld = (game.lati && !ha(attacker, "INFILTRATOR")) ? game.lati[latoDi(defender)] : null;
    const schermo = (!crit && Ld && (Ld.auroravelo > 0 || (isPhysical ? Ld.reflect > 0 : Ld.lightscreen > 0)))
      ? 0.5 : 1;
    /* Colpo AD AREA: quando i bersagli sono piu' d'uno ognuno prende il 25% in
       meno, come nell'originale (`targetMultiplier = numTargets > 1 ? .75 : 1`). */
    const area = game._colpoLargo ? 0.75 : 1;
    /* Fangata e Docciascudo: indeboliscono un tipo per tutto il campo. */
    const sport = (game.fangata > 0 && move.type === "ELECTRIC") ? (1 / 3)
                : (game.doccia > 0 && move.type === "FIRE") ? (1 / 3) : 1;
    dmg = Math.floor(dmg * stab * eff * critMult * rand * burn * abMult * schermo * sport * area);
    if (dmg < 1) dmg = 1;                          // almeno 1 se non immune

    return { damage: dmg, effectiveness: eff, crit, immune: false };
  }

  /* ======================================================================
     STRUMENTI X — come `TempStatStageBoosterModifier` dell'originale.

     🔴 Prima scrivevano +1 STADIO dentro `f.stages` a ogni entrata in campo.
     Due difetti veri: valeva 1,5x invece di 1,2x, e soprattutto lo stadio
     RESTAVA li' per sempre (gli stadi persistono fra le ondate dal §30.1),
     cioe' un oggetto da 5 ondate regalava un bonus eterno.
     Ora non toccano piu' gli stadi: sono un moltiplicatore applicato dove la
     statistica viene usata, +20% per ogni pezzo comprato. La PRECISIONE fa
     eccezione anche nell'originale: li' vale +1 stadio.
     ====================================================================== */
  function tempStatMult(f, stat) {
    if (stat === "acc" || !game.tempBoost || !game.party.includes(f)) return 1;
    if (!(game.tempBoost[stat] > 0)) return 1;
    return 1 + 0.2 * ((game.tempBoostN || {})[stat] || 1);
  }
  // Stadi di precisione regalati da Precisione X (0 se non attiva)
  function tempAccStages(f) {
    if (!game.tempBoost || !game.party.includes(f) || !(game.tempBoost.acc > 0)) return 0;
    return (game.tempBoostN || {}).acc || 1;
  }
  /* Velocita' che conta per l'ORDINE del turno.
     ⚠️ Prima l'ordine leggeva `stats.spd` crudo: gli STADI di velocita' non
     contavano niente (Agilita' non faceva nulla sull'iniziativa) e neanche gli
     Strumenti X. Le abilita' legate al meteo (Clorofilla, Nuotovelox...) restano
     fuori: nei dati non portano la condizione, applicarle sempre sarebbe peggio. */
  function velEff(f) {
    /* AGILTECNICA: perso o usato l'oggetto, la Velocita' raddoppia.
       `_avevaOggetto` si accende appena si tiene qualcosa: cosi' si distingue
       «non ho mai avuto niente» da «l'ho perso», che e' la condizione vera. */
    if (f && ha(f, "UNBURDEN") && f._avevaOggetto
        && !Object.keys(f.held || {}).length && !Object.keys(f.berries || {}).length) {
      return velEffBase(f) * 2;
    }
    return velEffBase(f);
  }
  function velEffBase(f) {
    const vento = (game.lati && game.lati[latoDi(f)].tailwind > 0) ? 2 : 1;
    return f.stats.spd * stageMult(f.stages.spd) * tempStatMult(f, "spd") * vento;
  }

  // Moltiplicatore statistica da abilita' (StatMultiplierAbAttr).
  function abStatMult(f, stat) {
    let m = 1;
    for (const a of abAttrs(f)) if (a.kind === "statMult" && a.stat === stat) m *= a.mult;
    return m;
  }

  // Danno da confusione: fisico "senza tipo", potenza 40, atk/def propri, no crit.
  function confusionDamage(self) {
    const atk = self.stats.atk * stageMult(self.stages.atk);
    const def = self.stats.def * stageMult(self.stages.def);
    let dmg = Math.floor(Math.floor(Math.floor(2 * self.level / 5 + 2) * 40 * atk / def) / 50) + 2;
    return Math.max(1, Math.floor(dmg * (0.85 + Math.random() * 0.15)));
  }

  /* ---------------------------------------------------------------------- */
  /*  STATO DELLA PARTITA + macchina a stati                                */
  /* ---------------------------------------------------------------------- */
  const PARTY_MAX = 6;
  const START_BALLS = 5;
  const game = {
    party: [],         // squadra del giocatore (max 6), PERSISTE tra le ondate
    active: 0,         // indice del Pokemon attivo in squadra
    box: [],           // Pokemon catturati oltre la squadra (deposito)
    balls: START_BALLS,// Poke Ball disponibili
    greatballs: 0,     // Mega Ball (x1.5)
    ultraballs: 0,     // Ultra Ball (x2)
    money: 0,          // ₽ della run corrente (si azzera a ogni run)
    stones: {},        // pietre evolutive possedute { FIRE_STONE: n, ... }
    player: null,      // = party[active] (comodita'; aggiornato a ogni cambio)
    enemy: null,       // nemico dell'ondata corrente (nuovo ogni volta)
    wave: 0,           // ondata corrente
    phase: "STARTER",  // STARTER | CHOICE | MESSAGE | REWARD | CAPTURE | FORCESWITCH | GAMEOVER
    events: [],        // eventi del turno da riprodurre (testo + snapshot HP/stato)
    eventIndex: 0,     // evento corrente in riproduzione
    afterEvents: null, // callback a fine narrazione
    timer: null,       // timer dell'auto-avanzamento
    pendingLearns: [], // mosse in attesa di sostituzione (4 slot pieni)
    expPending: 0,     // esperienza dei nemici caduti in questa ondata
    rivalBattuto: 0,   // a quale incontro col Rivale siamo (per i premi garantiti)
    biome: null,       // id del bioma corrente (chiave di BIOMES)
    enemyQueue: [],    // Pokemon rimanenti dell'allenatore (combattuti in sequenza)
  };

  // Rende attivo il Pokemon `i` della squadra (aggiorna game.player).
  function setActive(i) { game.active = i; game.player = game.party[i]; }
  function aliveParty() { return game.party.filter(p => !p.fainted); }
  function firstAliveIndex() { return game.party.findIndex(p => !p.fainted); }
  // Cura completa dell'intera squadra (dopo un boss / cambio zona).
  function healParty() {
    for (const p of game.party) {
      p.hp = p.maxHp; p.fainted = false; p.status = null; p.sleepTurns = 0;
      p.moves.forEach(m => m.pp = m.maxPp);
    }
  }
  window.__game = game; // hook di debug (ispezione stato/stadi/stati)
  /* Il DEX persistente (starter sbloccati, caramelle, abilità, nature, IV).
     ⚠️ È una funzione, non un riferimento: `meta` viene RIASSEGNATA da
     `loadMeta()` e da «Azzera tutto», quindi un riferimento fisso punterebbe
     all'oggetto sbagliato. */
  window.__meta = () => meta;
  /* hook di debug per le FORME. Le regole dipendono da bioma, ora del giorno,
     sesso e natura: provarle a click vorrebbe dire giocare per ore sperando
     nell'incontro giusto. Qui si estraggono a comando.
       __forme.dist("ROTOM", 400)   distribuzione delle forme su 400 estrazioni
       __forme.mon("ROTOM")         un esemplare: forma, tipi, statistiche, sprite
       __forme.regola("LYCANROC")   che forma esce ADESSO (bioma/ora correnti)
       __forme.audit()              nessuna forma da battaglia fra quelle estraibili? */
  window.__forme = {
    get data() { return VARIANTS; },
    dist: (id, n) => {
      const out = {};
      for (let i = 0; i < (n || 200); i++) {
        const f = formAt(id, speciesFormIndex(id, { gender: rollGender(S[id]), nature: rollNature() }));
        const k = f ? (f.it || f.key || "«base»") : "—";
        out[k] = (out[k] || 0) + 1;
      }
      return out;
    },
    mon: (id, opts) => {
      const f = makeFighter(id, 50, opts || {});
      return { nome: f.name, forma: f.variant, idx: f.formIndex, tipi: f.types,
        base: f.baseStats, abilita: f.ability && f.ability.it, sesso: f.gender,
        scudi: f.segTotal, scudiRotti: f.segBroken, confini: f.segBounds,
        sprite: (f.formKey || f.variant) ? `${f.shiny ? "shiny/" : ""}${f.dex}-${f.formKey || f.variant}` : `${f.shiny ? "shiny/" : ""}${f.dex}` };
    },
    regola: (id) => {
      const f = formAt(id, speciesFormIndex(id, { gender: "MALE", nature: "HARDY" }));
      return { bioma: game.biome, ora: timeOfDay(), forma: f && (f.it || f.key) };
    },
    // la forma si porta dietro l'evoluzione? (Deerling Autunno -> Sawsbuck Autunno)
    evo: (id, toId, variant) => {
      const p = makeFighter(id, 30, variant !== undefined ? { variant } : {});
      const prima = { nome: p.name, tipi: p.types.join("/"), atk: p.baseStats.atk };
      evolve(p, toId, []);
      return { prima, dopo: { nome: p.name, tipi: p.types.join("/"), atk: p.baseStats.atk,
        forma: p.variant, sprite: `${p.dex}${p.variant ? "-" + p.variant : ""}` } };
    },
    /* Nessuna mega/gigamax/archeo deve poter comparire come forma normale:
       era il difetto peggiore di prima (Terapagos Cristallino fra i selvatici). */
    audit: () => {
      const vietate = /^(mega|primal|gigantamax|eternamax)/;
      const brutte = [];
      for (const id in VARIANTS) {
        const n = collectableForms(id);
        for (let i = 0; i < n; i++) {
          const f = VARIANTS[id][i];
          if (f && f.key && vietate.test(f.key)) brutte.push(`${id}[${i}] ${f.key}`);
        }
      }
      return { specieConForme: Object.keys(VARIANTS).length, formeDaBattagliaEstraibili: brutte };
    },
  };
  // hook di debug per gli OGGETTI: permette di provare pool, negozio e filtri
  // senza dover giocare fino all'ondata giusta.
  window.__items = {
    get pool() { return REWARD_POOL; },
    stock: (w) => { const o = game.wave; game.wave = w; const s = shopStock(); game.wave = o; return s; },
    stones: () => usefulStones(),
    /* Fa vedere UN LANCIO con un numero di oscillazioni deciso da te, senza
       consumare ball ne' chiudere il turno: e' l'unico modo di confrontare a
       occhio «una scossa» e «due», che giocando escono a caso.
         __items.dondolo(0)  __items.dondolo(1)  __items.dondolo(2)
         __items.dondolo(4)  -> cattura riuscita */
    dondolo: (n) => {
      if (!game.enemy) return "serve un avversario in campo";
      const scosse = Math.max(0, Math.min(4, n == null ? 2 : n));
      animaBall("balls", { preso: scosse >= 4, scosse, critica: false }, () => {});
      return "lancio con " + scosse + " oscillazioni";
    },
    /* Consegna un premio PRECISO, come se lo avessi appena scelto dall'emporio:
       serve a collaudare le schermate che si aprono dopo (chi lo usa, quale
       mossa, l'evoluzione) senza restare in attesa che quel premio esca.
         __items.dai("mushroom")   __items.dai("tm")   __items.dai("stone") */
    dai: (id) => {
      const it = REWARD_POOL.find(x => x.id === id);
      if (!it) return "premio sconosciuto: " + REWARD_POOL.map(x => x.id).join(", ");
      const pick = fillPick(it);
      if (!pick) return "adesso non e' assegnabile (nessuno puo' usarlo)";
      hideMeta();
      grantItem(pick, () => { game.phase = "CHOICE"; showMainMenu(); }, () => openShop());
      return "consegnato: " + it.label;
    },
    roll: (n) => Array.from({ length: n || 10 }, () => rollReward([])),
    waveMoney: (w) => { const o = game.wave; game.wave = w; const m = waveMoney(1); game.wave = o; return m; },
    berries: (f) => { const msg = []; checkBerries(f || game.player, msg); return msg; },
    // incontri misteriosi: elenco, requisiti soddisfatti, e apertura forzata
    get encounters() { return MYSTERY_ENCOUNTERS; },
    encOk: () => MYSTERY_ENCOUNTERS.filter(e => encAllowed(e)).map(e => e.id),
    pickEnc: () => pickEncounter(),
    // cambio zona: per provare il salto in END delle ultime ondate
    zona: () => showBiomeChoice(),
    /* MOSSE DA UOVO — a click servirebbero decine di schiuse per vederne una.
       `.mosseUovo(specie)` dice a che punto sei, `.schiudi(specie,tier)`
       simula una schiusa, `.tiriUovo(n,tier)` misura quanto e' rara la RARA. */
    mosseUovo: (k) => {
      const list = EGGM[k] || [];
      const mask = eggMaskOf(k);
      return {
        specie: k, sbloccate: unlockedEggMoves(k).map(id => M[id].it),
        tutte: list.map((id, i) => `${i === 3 ? "RARA " : ""}${(M[id] || {}).it || id}${(mask & (1 << i)) ? " ✅" : " 🔒"}`),
        maschera: mask,
      };
    },
    /* Fa schiudere un uovo ADESSO, con la sua animazione: è l unico modo di
       collaudare quella schermata senza aspettare dieci ondate. */
    schiusa: (k, tier) => {
      if (!game.player) return "serve una run in corso";
      const sp = k && S[k] ? k : SPECIES_KEYS[Math.floor(Math.random() * SPECIES_KEYS.length)];
      game.pendingHatches = game.pendingHatches || [];
      /* ⚠️ Serve anche il `nato`, o `offriNato` esce subito e l'offerta di
         portarselo dietro non compare mai: la sonda non provava meta' della
         strada che voleva provare. */
      const a = rollIVs(), b = rollIVs(), ivs = {};
      for (const k in a) ivs[k] = Math.max(a[k], b[k]);
      game.pendingHatches.push({ sp, shiny: false, shinyVar: 0, tipo: "MOVE", tier: tier || "COMMON",
                                 extra: [`Prova di schiusa: ${S[sp].it}.`],
                                 nato: { ivs, nature: rollNature(), abilIndex: null } });
      hideMeta();
      processHatches(() => { game.phase = "CHOICE"; showMainMenu(); });
      return "schiusa avviata: " + S[sp].it;
    },
    schiudi: (k, tier) => { const r = unlockEggMove(k, tier || "COMMON"); saveMeta(); return r || "niente di nuovo"; },
    tiriUovo: (n, tier) => {
      const c = [0, 0, 0, 0];
      for (let i = 0; i < (n || 1000); i++) c[rollEggMoveIndex(tier || "COMMON")]++;
      return { comuni: c.slice(0, 3), rara: c[3], attesoRara: ((n || 1000) / (RARE_EGGMOVE_RATES[tier || "COMMON"])).toFixed(1) };
    },
    /* Chi puo' uscire davvero da un bioma. Serve per accorgersi delle specie
       SENZA SPRITE finite nei pool: giocando si vedrebbero solo per caso.
         __items.pesca("ISLAND", 300)  -> { specie: {...}, senzaSprite: [...] } */
    pesca: (bioma, n) => {
      const prima = game.biome; game.biome = bioma || game.biome;
      const conto = {}, brutte = new Set();
      for (let i = 0; i < (n || 200); i++) {
        const k = biomePick(false);
        conto[k] = (conto[k] || 0) + 1;
        if (!S[k] || S[k].noSprite) brutte.add(k);
      }
      for (let i = 0; i < (n || 200); i++) {
        const k = biomePick(true);
        if (!S[k] || S[k].noSprite) brutte.add(k);
      }
      game.biome = prima;
      return { estratte: Object.keys(conto).length, senzaSprite: [...brutte] };
    },
    /* Tutti i biomi in una volta: quante specie non disegnabili sono
       raggiungibili come avversario. */
    pescaTutti: (n) => {
      const brutte = new Set();
      for (const b in BIOMES) {
        const r = window.__items.pesca(b, n || 120);
        r.senzaSprite.forEach(k => brutte.add(b + "/" + k));
      }
      return { biomi: Object.keys(BIOMES).length, casiTrovati: brutte.size, esempi: [...brutte].slice(0, 20) };
    },
    /* Evoluzioni raggiungibili che porterebbero a una specie senza sprite. */
    evoRotte: () => {
      const out = [];
      for (const k in S) {
        if (S[k].noSprite) continue;
        for (const e of (S[k].evolutions || [])) {
          if (S[e.to] && S[e.to].noSprite) out.push(`${k} -> ${e.to} (${e.item || "Lv." + e.level})`);
        }
      }
      return out;
    },
    /* Salta a un'ondata QUALUNQUE tenendo squadra e bioma: serve a vedere chi
       esce a quel livello senza doverci arrivare giocando.
         __items.ondata(45)        __items.ondata(45, 50) */
    ondata: (n, livello) => {
      if (!game.player) return "serve una run in corso";
      clearTimeout(game.timer); game.events = []; game.eventIndex = 0;
      game.wave = Math.max(1, (n || 1)) - 1;
      for (const p of game.party) {
        if (livello) { p.level = livello; recomputeStats(p); p.hp = p.maxHp; }
        p.fainted = false;
      }
      nextWave();
      return "ondata " + (game.wave);
    },
    /* Salta direttamente alla lotta finale dell'ondata 200: provarla giocando
       vorrebbe dire arrivarci, e sono 199 ondate. `livello` alza la squadra
       per non farsi spazzare via al primo colpo. */
    finale: (livello, chi) => {
      clearTimeout(game.timer); game.events = []; game.eventIndex = 0;
      if (chi) {
        const i = FINAL_BOSSES.findIndex(b => b.id === chi);
        if (i < 0) return "boss sconosciuto: " + FINAL_BOSSES.map(b => b.id).join(", ");
        game.finalBossIdx = i;
      }
      game.biome = "END";
      // ⚠️ senza questo le pedane restano quelle del bioma precedente e il
      // test non riproduce lo stato vero della lotta finale
      applyBiomeBackground();
      game.wave = FINAL_WAVE - 1;
      for (const p of game.party) {
        if (livello) { p.level = livello; recomputeStats(p); p.hp = p.maxHp; }
        p.fainted = false;
      }
      nextWave();
      return `ondata ${FINAL_WAVE}, squadra a livello ${game.party[0].level}`;
    },
    /* Quanto danno passerebbe davvero al boss, senza applicarlo: serve a
       provare il taglio degli scudi e il "non può morire" della prima fase
       senza dover reggere i tempi della narrazione. */
    clamp: (dmg) => {
      const e = game.enemy; if (!e) return "nessun nemico";
      const prima = { ps: e.hp, segBroken: e.segBroken, stadi: Object.assign({}, e.stages) };
      const msgs = [];
      const passa = bossClamp(e, dmg, msgs);
      // si ripristina: e' una prova, non deve cambiare la partita
      e.segBroken = prima.segBroken; e.stages = prima.stadi;
      return { chiesto: dmg, passa, psRestanti: prima.ps - passa, messaggi: msgs };
    },
    /* La rosa dei boss finali, con tutte le fasi risolte: serve a controllare
       statistiche, tipi, mosse e sprite di ognuno senza giocarli uno per uno. */
    bossFinali: () => FINAL_BOSSES.map((b, i) => {
      const sp = S[b.id];
      const fasi = b.fasi.map((fa, n) => {
        const k = typeof fa.forma === "function" ? "(a caso)" : fa.forma;
        const d = (typeof fa.forma === "string") ? datiForma(b.id, fa.forma) : null;
        const base = d ? d.baseStats : sp.baseStats;
        const tot = Math.round(Object.values(base).reduce((a, c) => a + c, 0) * (fa.boost || 1));
        return { n: n + 1, forma: k || "«base»", tot,
          tipi: (fa.tipi || (d ? d.types : sp.types)).join("/"),
          mosse: (fa.mosse || []).filter(m => M[m]).length + "/" + (fa.mosse || []).length,
          extra: [fa.filtro, fa.fx, fa.superEff ? "superEff" : null, fa.buconero ? "buconero" : null].filter(Boolean).join(",") };
      });
      return { i, id: b.id, gen: sp && sp.gen, sprite: sp && !sp.noSprite, fasi };
    }),
    /* Stato della lotta finale, per controllarne le due fasi a colpo d'occhio. */
    finaleStato: () => {
      const e = game.enemy;
      if (!e || !e.finalBoss) return "non e' in corso la lotta finale";
      return { nome: e.name, fase: e.finalPhase, forma: e.formKey || "base",
        ps: `${e.hp}/${e.maxHp}`, scudi: e.segTotal, tipi: e.types,
        abilita: e.ability && e.ability.it, doppio: game.double,
        mosse: e.moves.map(m => M[m.id].it),
        stadi: Object.entries(e.stages).filter(([, v]) => v).map(([s, v]) => s + (v > 0 ? "+" : "") + v) };
    },
    // quale sprite verrebbe caricato per questo combattente (per provare il sesso)
    sprite: (f, side) => loadFighterSprite(f || game.player, side || "front").then(s => s && s.sheet),
    /* Stato dex dell'avversario in campo: perche' la pokeball accanto al nome
       e' assente, grigia o piena. Elenca cosa manca ancora. */
    dex: (f) => {
      const e = f || game.enemy;
      if (!e) return "nessun avversario in campo";
      const root = rootOf(e.speciesId);
      return { specie: e.speciesId, capostipite: root, stato: statoDex(e),
        sbloccato: meta.unlocked[root] || 0,
        abilita: { indice: e.abilIndex, maschera: (meta.abils || {})[root] || 0 },
        natura: { quale: e.nature, bit: 1 << NATURE_KEYS.indexOf(e.nature), maschera: (meta.nature || {})[root] || 0 },
        forma: e.variant || "«base»", cromatico: !!e.shiny };
    },
    /* Apre il NEGOZIO di fine ondata senza dover vincere una lotta. Serve a
       collaudare la schermata dei premi e il pannello squadra che ci si apre
       da dentro: arrivarci giocando costa una lotta intera, e con una squadra
       di prova costruita a mano finisce spesso in un game over. */
    negozio: () => { if (!game.player) return "serve una run in corso"; hideMeta(); openShop(); return "negozio aperto"; },
    /* Squadra di prova nel CASO PEGGIORE: sei membri, nomi lunghi, stati,
       oggetti tenuti, PS bassi, uno esausto e uno cromatico. Serve a misurare
       il pannello squadra: con un solo Pokémon in squadra la schermata sta
       comoda sempre, e non dice niente. */
    squadraProva: (quanti) => {
      if (!game.player) return "serve una run in corso";
      const lunghi = SPECIES_KEYS.filter(k => !S[k].noSprite && S[k].it.length >= 10);
      const stati = ["BURN", "PARALYSIS", "SLEEP", "POISON", "FREEZE", null];
      const n = Math.min(6, quanti || 6);
      game.party.length = 0;
      for (let i = 0; i < n; i++) {
        const k = lunghi[Math.floor(Math.random() * lunghi.length)];
        const p = makeFighter(k, 18 + i * 9, { shiny: i === 0, shinyVar: 2, ignoreArena: true });
        p.fainted = (i === n - 1 && n > 1);
        p.hp = p.fainted ? 0 : Math.max(1, Math.floor(p.maxHp * (i + 1) / (n + 1)));
        p.status = p.fainted ? null : stati[i % stati.length];
        addHeld(p, "leftovers"); addHeld(p, "shellbell");
        if (p.moves[3]) p.moves[3].pp = 0;
        game.party.push(p);
      }
      setActive(0);
      redrawScene();
      return `squadra di prova: ${game.party.length} membri, ${game.party.filter(x => x.fainted).length} esausti`;
    },
    /* --- FORTUNA E LIVREE CROMATICHE (§33) ------------------------------ */
    /* Da dove viene la fortuna che hai adesso, membro per membro. */
    fortuna: () => {
      const l = runLuck();
      const odds = Math.floor(512 / (l + 4));
      return {
        fortuna: l, rango: LUCK_RANK[l],
        squadra: (game.party || []).map(p => ({
          nome: p.name, punti: p.luck || 0, esausto: !!p.fainted,
          livrea: p.shiny ? CROM_IT[p.shinyVar || 0] : "—",
          contaPerLaFortuna: !p.fainted ? (p.luck || 0) : 0 })),
        promozione: `${(4 / odds * 100).toFixed(2)}% per passo (odds ${odds}), ripetuta finché fallisce`,
        promozioneMedia: (4 / odds / (1 - 4 / odds)).toFixed(3) + " tier a premio",
      };
    },
    /* Che premi escono a una data fortuna. Confrontare 0 e 14 è l'unico modo
       di vedere se la cascata di promozioni sposta davvero qualcosa. */
    premi: (fortuna, prove) => {
      const n = prove || 20000, prima = fortunaForzata;
      fortunaForzata = fortuna == null ? null : Math.max(0, Math.min(14, fortuna));
      const l = runLuck(), odds = Math.floor(512 / (l + 4)), conta = {};
      /* try/finally NON e' pignoleria: `rollReward` fuori da una run lancia
         (legge game.charms), e senza il finally la fortuna restava FISSATA al
         valore di prova. Ci sono cascato: la sonda diceva fortuna 0 mentre la
         squadra aveva 2 punti, e sembrava un difetto del gioco. */
      try {
        for (let i = 0; i < n; i++) { const t = rollReward([]).item.tier; conta[t] = (conta[t] || 0) + 1; }
      } finally { fortunaForzata = prima; }
      const out = { fortuna: l, rango: LUCK_RANK[l], promozione: (4 / odds * 100).toFixed(2) + "%" };
      for (const k of TIER_ORD) out[k] = ((conta[k] || 0) / n * 100).toFixed(2) + "%";
      return out;
    },
    /* Il tiro delle livree deve dare 60/30/10. Se una specie non ha livree
       nell'originale esce sempre 0: è giusto così, non è un difetto nostro. */
    livree: (specie, prove) => {
      const k = specie || (game.party && game.party[0] && game.party[0].speciesId) || SPECIES_KEYS[0];
      const dex = S[k].dex, n = prove || 10000, conta = { 0: 0, 1: 0, 2: 0 };
      for (let i = 0; i < n; i++) conta[rollShinyVar(dex, null)]++;
      return { specie: S[k].it, haLivree: !!cromTerna("front", dex, null),
        terna: cromTerna("front", dex, null),
        comune: (conta[0] / n * 100).toFixed(1) + "% (atteso 60)",
        rara: (conta[1] / n * 100).toFixed(1) + "% (atteso 30)",
        epica: (conta[2] / n * 100).toFixed(1) + "% (atteso 10)" };
    },
    /* Come viene disegnata una livrea: file dedicato, ricolore, o ripiego.
       `pixel: 0` vuol dire che la tabella colore non ha trovato niente da
       cambiare — in quel caso si ripiega apposta sulla cromatica classica. */
    cromatico: (specie, sv, side) => {
      const k = specie || (game.party && game.party[0] && game.party[0].speciesId);
      if (!k || !S[k]) return "specie sconosciuta";
      const dex = S[k].dex, v = sv == null ? 1 : sv, lato = side || "front";
      const terna = cromTerna(lato, dex, null);
      const modo = terna ? ["ripiego sulla cromatica classica", "ricolore dello sprite normale", "file dedicato"][terna[v]] : "nessuna livrea";
      return cromSprite(cromChiave(lato, false), String(dex), v).then(spr => ({
        specie: S[k].it, dex, livrea: CROM_IT[v], terna, modo,
        disegnata: !!spr, foglio: spr ? spr.sheet.slice(0, 60) : null,
        diagnosi: cromDiagnosi[`${cromChiave(lato, false)}/${dex}#${v}`] || null,
      }));
    },
    /* Rende cromatico un membro della squadra per guardarlo davvero: è l'unico
       modo di vedere una epica senza aspettare un incontro su 10.240. */
    daiLivrea: (i, sv) => {
      const p = (game.party || [])[i || 0];
      if (!p) return "nessun Pokémon in quella posizione";
      p.shiny = true;
      p.shinyVar = sv == null ? 1 : sv;
      p.luck = p.shinyVar + 1;
      if (!p.name.startsWith("✨") && !p.name.includes("✨")) p.name = "✨" + p.name;
      p.spr = null;
      loadFighterSprite(p, game.player === p ? "back" : "front").then(spr => { p.spr = spr; redrawScene(); });
      return { nome: p.name, livrea: CROM_IT[p.shinyVar], punti: p.luck, fortunaOra: runLuck() };
    },
    /* Distribuzione delle SCOSSE della ball sul nemico in campo: quante volte
       dondola prima di aprirsi. Serve a capire se l'animazione "e' sempre
       uguale" per un difetto o perche' la matematica manda quasi sempre lo
       stesso numero. */
    scosse: (mult, prove) => {
      const e = game.enemy;
      if (!e) return "serve un avversario in campo";
      const n = prove || 2000, conta = {}, fallite = {};
      let presi = 0;
      for (let i = 0; i < n; i++) {
        const r = rollCaptureDettaglio(e, mult || 1);
        conta[r.scosse] = (conta[r.scosse] || 0) + 1;
        if (r.preso) presi++; else fallite[r.scosse] = (fallite[r.scosse] || 0) + 1;
      }
      const perc = (o, tot) => Object.fromEntries(Object.entries(o)
        .sort((a, b) => a[0] - b[0]).map(([k, v]) => [k + " scosse", Math.round(v / tot * 100) + "%"]));
      return { bersaglio: e.name, ps: e.hp + "/" + e.maxHp,
        percentualeCattura: captureChancePct(e, mult || 1) + "%",
        catturati: Math.round(presi / n * 100) + "%",
        seSCAPPA: perc(fallite, n - presi) };
    },
    /* Apre la schermata «quale mossa dimentica» a comando. Aspettare che un
       Pokemon con 4 mosse ne impari una quinta al livello giusto e' l'ennesima
       coincidenza da rincorrere a click. */
    impara: (moveId, quale) => {
      const p = game.party[quale || 0];
      if (!p) return "nessun Pokemon in squadra";
      const id = moveId || "SOLAR_BEAM";
      if (!M[id]) return "mossa sconosciuta: " + id;
      while (p.moves.length < 4) {                 // serve che ne abbia gia' quattro
        const tappo = (LEARN[p.speciesId] || []).map(x => x[1]).find(x => M[x] && !p.moves.some(m => m.id === x));
        if (!tappo) break;
        p.moves.push({ id: tappo, pp: M[tappo].pp, maxPp: M[tappo].pp });
      }
      game.pendingLearns = game.pendingLearns || [];
      game.pendingLearns.push({ mon: p, moveId: id });
      processLearns(() => { game.phase = "CHOICE"; showMainMenu(); });
      return `${p.name} (${p.moves.length} mosse) deve decidere su ${M[id].it}`;
    },
    /* Le NOVE mosse che prima usavano `POTENZA_RIPIEGO` (§31). Prepara le
       condizioni che a ciascuna servono e le esegue sul vero motore, poi
       rimette tutto a posto: il numero che stampa e' il danno DAVVERO
       inflitto, non una formula ricalcolata a parte. */
    mosse9: () => {
      const a = game.player, d = game.enemy;
      if (!a || !d) return "serve una lotta in corso";
      const hp0 = d.hp, max0 = d.maxHp, vol0 = JSON.parse(JSON.stringify(a.volatile)),
            bacche0 = { ...a.berries }, held0 = { ...a.held }, dst0 = a.dannoSubitoTurno;
      // bersaglio di paglia ma ROBUSTO: se cade al primo colpo tutti i danni
      // si leggono uguali (= i suoi PS massimi) e il numero non dice niente
      d.maxHp = 100000;
      const out = [];
      const prova = (id, prepara) => {
        d.hp = d.maxHp; d.fainted = false;
        a.dannoSubitoTurno = { fisico: 40, speciale: 30, da: d };
        if (prepara) prepara();
        const msg = [];
        try { dannoSenzaPotenza(a, d, M[id], msg); }
        catch (e) { out.push({ mossa: M[id].it, errore: e.message }); return; }
        out.push({ mossa: M[id].it, danno: d.maxHp - d.hp, detto: msg.join(" / ").slice(0, 70) });
      };
      prova("COUNTER");        // atteso 80 = 2 x 40 fisici
      prova("MIRROR_COAT");    // atteso 60 = 2 x 30 speciali
      prova("METAL_BURST");    // atteso 105 = 1,5 x 70
      prova("COMEUPPANCE");
      prova("BEAT_UP");
      prova("SPIT_UP", () => { a.volatile.accumulo = 3; });
      prova("SPIT_UP", () => { a.volatile.accumulo = 0; });   // deve FALLIRE
      prova("NATURAL_GIFT", () => { a.berries = { LIECHI: 1 }; });
      prova("NATURAL_GIFT", () => { a.berries = {}; });       // deve FALLIRE
      prova("FLING", () => { a.held = { gripclaw: 1 }; });
      prova("FLING", () => { a.held = {}; });                 // deve FALLIRE
      d.maxHp = max0; d.hp = hp0; d.fainted = hp0 <= 0;
      a.volatile = vol0; a.berries = bacche0; a.held = held0;
      a.dannoSubitoTurno = dst0;
      recomputeStats(a);
      return out;
    },
    /* Mostra SUBITO l'animazione di evoluzione del Pokemon attivo (o di
       `quale`, indice in squadra). Senza specie di arrivo prende la prima
       evoluzione possibile. Arrivarci giocando vorrebbe dire portare un
       Pokemon fin sotto la soglia E avere il tetto di livello dell'ondata
       abbastanza alto: due condizioni che a click non si azzeccano mai. */
    evoluzione: (verso, quale) => {
      const p = game.party[quale || 0];
      if (!p) return "nessun Pokemon in squadra";
      const to = verso || ((S[p.speciesId].evolutions || [])[0] || {}).to;
      if (!to || !S[to]) return "questa specie non evolve: passa una specie a mano";
      animaEvoluzione(p, to, (proseguito) => {
        const msgs = [];
        if (proseguito) evolve(p, to, msgs);
        else msgs.push(`Cosa?! ${p.name} ha smesso di evolversi!`);
        queueMessages(msgs, () => { game.phase = "CHOICE"; showMainMenu(); });
      });
      return `${p.name} → ${S[to].it}`;
    },
    /* Avvia SUBITO una lotta con un ALLENATORE, senza dover arrivare a un'onda
       ×5. Serve a provare il RICHIAMO prima della sfida (stati curati, stadi
       azzerati, PS invariati) e le animazioni di ritiro/uscita: a click
       vorrebbe dire giocare quattro ondate sperando che l'autopilota non si
       impianti — ed e' esattamente quello che succede. */
    allenatore: (quanti) => {
      if (!game.player) return "nessuna run in corso";
      clearTimeout(game.timer); game.events = []; game.eventIndex = 0;
      const lvl = enemyLevelFor(game.wave);
      const cls = TRAINER_CLASSES[Math.floor(Math.random() * TRAINER_CLASSES.length)];
      const mons = [];
      for (let i = 0; i < (quanti || 2); i++) {
        const f = makeFighter(evolvedFormFor(pickThemed(cls.types, lvl), lvl), lvl,
                              { isTrainer: true, trainerTypes: cls.types });
        f.trainer = cls.name;
        mons.push(f);
      }
      const prima = { stato: game.player.status,
                      stadi: Object.entries(game.player.stages).filter(([, v]) => v).map(([k, v]) => k + v).join(" ") || "nessuno",
                      ps: game.player.hp + "/" + game.player.maxHp };
      startTrainerBattle(mons, cls.sprites[0], cls.name, [`${cls.name} ti sfida!`]);
      return { prima, dopoIlRichiamo: { stato: game.player.status,
                 stadi: Object.entries(game.player.stages).filter(([, v]) => v).map(([k, v]) => k + v).join(" ") || "nessuno",
                 ps: game.player.hp + "/" + game.player.maxHp } };
    },
    /* Avvia SUBITO una lotta in doppio (per provarla senza aspettare il caso). */
    doppia: () => {
      if (game.party.filter(p => !p.fainted).length < 2) return "servono 2 Pokemon vivi";
      clearTimeout(game.timer); game.events = []; game.eventIndex = 0;
      const lvl = enemyLevelFor(game.wave);
      const a = makeFighter(biomePickLv(lvl), lvl, {});
      const b = makeFighter(biomePickLv(lvl), lvl, {});
      game.double = true; game.enemy2 = b;
      game.chooser = 0; game.queued = null;
      game.player2 = game.party.find(p => !p.fainted && p !== game.player) || null;
      entraInCampo(game.player); if (game.player2) entraInCampo(game.player2);
      const msgs = [];
      deployEnemy(a, msgs);
      b._heldGiven = true; giveEnemyHeldItems(b, false);
      b.spr = null; loadFighterSprite(b, "front").then(s => { b.spr = s; redrawScene(); });
      if (game.player2) loadFighterSprite(game.player2, "back").then(s => { game.player2.spr = s; redrawScene(); });
      loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
      renderScene();
      game.phase = "CHOICE"; showMainMenu();
      return `${a.name} + ${b.name} contro ${game.player.name} + ${game.player2 ? game.player2.name : "?"}`;
    },
    // oggetti tenuti dai nemici: simula l'assegnazione a una data ondata
    heldNemico: (ondata, boss, allenatore, prove) => {
      const o = game.wave; game.wave = ondata;
      const conta = {}; let con = 0, tot = 0;
      for (let i = 0; i < (prove || 300); i++) {
        const f = makeFighter("RATTATA", 20, { boss: !!boss });
        giveEnemyHeldItems(f, !!allenatore);
        const n = heldIcons(f).reduce((s, x) => s + x.n, 0);
        tot += n; if (n) con++;
        for (const k in f.held) if (k !== "typeboost") conta[k] = (conta[k] || 0) + f.held[k];
        if (f.held.typeboost) conta.typeboost = (conta.typeboost || 0) + Object.values(f.held.typeboost).reduce((a, b) => a + b, 0);
        for (const k in f.berries) conta.bacche = (conta.bacche || 0) + f.berries[k];
        if (Object.keys(f.vits).length) conta.vitamine = (conta.vitamine || 0) + Object.values(f.vits).reduce((a, b) => a + b, 0);
      }
      game.wave = o;
      return { conAlmenoUno: con + "/" + (prove || 300), oggettiMedi: (tot / (prove || 300)).toFixed(2), tipi: conta };
    },
    // sonda di danno: calcola (senza applicarlo) il danno di una mossa, per
    // verificare meteo, boost di tipo, nature... in modo deterministico
    danno: (moveId, meteo) => {
      const vecchio = game.weather;
      game.weather = meteo ? { kind: meteo, turns: 9 } : null;
      let tot = 0;
      for (let i = 0; i < 200; i++) tot += computeDamage(game.player, game.enemy, M[moveId], {}).damage;
      game.weather = vecchio;
      return Math.round(tot / 200);
    },
    showEnc: (id) => showMysteryEncounter(MYSTERY_ENCOUNTERS.find(e => e.id === id)),
  };

  // Ritmo della narrazione (ms per messaggio). ?fast = iper-veloce per il beta test.
  /* `?fast` = narrazione automatica a raffica. Fuori da li' i messaggi NON
     scorrono da soli: si avanza toccando (vedi playEvents). */
  const NARRAZIONE_AUTO = new URLSearchParams(location.search).has("fast");
  const TURN_DELAY = NARRAZIONE_AUTO ? 40 : 780;

  // Cattura un evento: testo + istantanea di HP/stato/KO/colpo dei due combattenti,
  // cosi' la riproduzione mostra le barre "a quel momento" (non lo stato finale).
  /* Un messaggio puo' arrivare come semplice stringa oppure come oggetto
     `{ text, ball }` (vedi `conBall`): serve alle frasi che devono portarsi
     dietro l'animazione della ball che si apre o si chiude. */
  function snapEvent(text) {
    let ball = null;
    if (text && typeof text === "object") { ball = text.ball || null; text = text.text; }
    const p = game.player, e = game.enemy;
    /* 🔴 ANCHE I SECONDI SLOT. Prima l'istantanea riguardava solo
       `game.player` e `game.enemy`: in doppio gli altri due riquadri mostravano
       sempre lo stato di FINE turno, quindi si vedeva un Pokemon gia' a terra
       alla prima frase, prima delle mosse che l'avrebbero abbattuto.
       (Segnalazione: «gli eventi non appaiono nell'ordine in cui vengono
       eseguiti».) */
    const p2 = game.player2, e2 = game.enemy2;
    const ev = {
      text,
      php: p ? p.hp : 0, pmax: p ? p.maxHp : 1, pst: p ? p.status : null, pfaint: p ? p.fainted : false, phit: !!(p && p._justHit),
      ehp: e ? e.hp : 0, emax: e ? e.maxHp : 1, est: e ? e.status : null, efaint: e ? e.fainted : false, ehit: !!(e && e._justHit),
      p2hp: p2 ? p2.hp : 0, p2max: p2 ? p2.maxHp : 1, p2st: p2 ? p2.status : null, p2faint: p2 ? p2.fainted : false, p2hit: !!(p2 && p2._justHit),
      e2hp: e2 ? e2.hp : 0, e2max: e2 ? e2.maxHp : 1, e2st: e2 ? e2.status : null, e2faint: e2 ? e2.fainted : false, e2hit: !!(e2 && e2._justHit),
      /* CHI c'e' in campo in questo momento. Senza questo la scena disegnava
         sempre `game.player`, che al cambio e' gia' il Pokemon NUOVO: si
         leggeva «Ritirati, Ivysaur!» mentre a schermo c'era gia' Charmander,
         e l'animazione del ritiro avrebbe risucchiato quello sbagliato. */
      pmon: p, emon: e, p2mon: game.player2 || null, e2mon: game.enemy2 || null,
      /* Anche gli SBALZI vanno fotografati, o i badge del riquadro PS
         mostrerebbero il risultato di fine turno gia' alla prima frase: si
         leggeva «L'Attacco di X sale!» con la freccia verde gia' accesa. */
      pstg: p ? { ...p.stages } : null, estg: e ? { ...e.stages } : null,
      p2stg: p2 ? { ...p2.stages } : null, e2stg: e2 ? { ...e2.stages } : null,
    };
    if (ball) ev.ball = ball;
    // il colpo si "consuma": solo il 1° evento dopo scuote. Vale per tutti e
    // quattro, o in doppio la scossa resterebbe appiccicata per tutto il turno.
    if (p) p._justHit = false;
    if (e) e._justHit = false;
    if (p2) p2._justHit = false;
    if (e2) e2._justHit = false;
    return ev;
  }
  /* Marca un messaggio con l'animazione della ball: `verso` e' "ritiro"
     (il Pokemon rientra) o "uscita" (il Pokemon esce). Funziona sia negli
     array di messaggi sia nei log di battaglia, perche' passano entrambi
     da `snapEvent`. */
  const conBall = (text, verso, lato) => ({ text, ball: { verso, lato } });
  // "log" del turno: gli attributi del motore fanno messages.push(testo);
  // qui lo intercettiamo per catturare anche lo snapshot.
  /* Riallinea l'istantanea di un evento allo stato ATTUALE, conservando in
     `pre` quella di partenza. Il "prima" serve alla riproduzione: durante
     l'animazione della mossa si mostra lui, così le barre calano al momento
     dell'impatto e non un istante prima. Vale anche per il PRIMO evento del
     turno, che non avrebbe un evento precedente da cui pescare. */
  const CAMPI_SNAP = ["php", "pmax", "pst", "pfaint", "ehp", "emax", "est", "efaint",
                      "p2hp", "p2max", "p2st", "p2faint", "e2hp", "e2max", "e2st", "e2faint",
                      "pmon", "emon", "p2mon", "e2mon",
                      "pstg", "estg", "p2stg", "e2stg"];
  function riallinea(e) {
    if (!e.pre) { e.pre = {}; for (const k of CAMPI_SNAP) e.pre[k] = e[k]; }
    const s = snapEvent("");
    for (const k of CAMPI_SNAP) e[k] = s[k];
    if (s.phit) e.phit = true;
    if (s.ehit) e.ehit = true;
    if (s.p2hit) e.p2hit = true;
    if (s.e2hit) e.e2hit = true;
  }
  function makeLog() {
    const events = [];
    return {
      events,
      push(t) { events.push(snapEvent(t)); },
      // marca l'ultimo evento con un effetto visivo (tipo mossa + bersaglio + quale mossa)
      fx(type, side, move, from) { if (events.length) events[events.length - 1].fx = { type, side, move, from }; },
      /* Come `fx`, ma su un evento PRECISO. Serve perche' l'animazione della
         mossa va sul messaggio «X usa Y!», che fotografa la situazione PRIMA
         del colpo. Attaccandola all'ultimo evento finiva su un messaggio gia'
         successivo al danno (spesso «X e' esausto!»): si vedeva il nemico
         cadere e solo dopo partiva l'animazione che avrebbe dovuto colpirlo. */
      fxAt(i, type, side, move, from) { if (events[i]) events[i].fx = { type, side, move, from }; },
      /* AGGIUNGE una riga all'ULTIMO evento invece di crearne uno nuovo.
         Serve alle frasi che raccontano lo STESSO momento: «Zubat usa
         Velenospina!» e «È superefficace!» sono una cosa sola, e chiedere due
         tocchi per leggerle spezzava l'azione a metà. */
      /* Riallinea l'istantanea dell'ultimo evento allo stato ATTUALE, senza
         aggiungere testo. Serve dopo aver applicato il danno: così la barra
         cala sull'evento della mossa (al termine della sua animazione) anche
         quando non c'è nessuna frase in più da dire — se no il calo slittava
         al messaggio successivo, che magari parla d'altro. */
      snap() { if (events.length) riallinea(events[events.length - 1]); },
      add(t) {
        if (!events.length) { events.push(snapEvent(t)); return; }
        const e = events[events.length - 1];
        e.text += "\n" + t;
        riallinea(e);   // la riga aggiunta racconta lo stato di ADESSO
      },
      // marca l'ultimo evento con un'animazione COMUNE o di CARICA (stati, cure,
      // oggetti, mosse a due turni). Si ancora al Pokemon indicato da `side`,
      // che vale sia per il giocatore sia per l'avversario.
      anim(key, side) {
        if (!events.length || !animAvailable(key)) return;
        prefetchAnim(key);
        events[events.length - 1].anim = { key, side };
      },
      get length() { return events.length; },
    };
  }

  // Una specie qualsiasi (diversa da `exclude`).
  function randomSpecies(exclude) {
    let k;
    do { k = SPECIES_KEYS[Math.floor(Math.random() * SPECIES_KEYS.length)]; }
    while (k === exclude);
    return k;
  }

  /* Specie per gli INCONTRI (il venditore, la Zona Safari, l'allevatrice…).
     ⚠️ Qui non va bene pescare fra TUTTE le 1084: così un incontro all'ondata 5
     poteva regalare un Guzzlord o un leggendario. Si escludono le specie della
     fascia leggendaria — quelle restano roba da uovo leggendario o da boss. */
  function specieDaIncontro(exclude) {
    for (let i = 0; i < 60; i++) {
      const k = randomSpecies(exclude);
      const sp = S[k];
      if (!sp) continue;
      // gli stessi filtri dell'originale: niente leggendari, semi-leggendari
      // (ci stanno le Ultracreature come Guzzlord) né misteriosi
      if (sp.leggendario || sp.semiLeggendario || sp.misterioso) continue;
      if (sp.eggTier === "LEGENDARY") continue;
      if ((sp.starterCost || 0) >= 8) continue;
      return k;
    }
    return randomSpecies(exclude);
  }

  // Override opzionale via URL: ?p=CHARIZARD forza lo starter; ?e=... il 1° nemico.
  function overrideKey(param) {
    const v = (new URLSearchParams(location.search).get(param) || "").toUpperCase();
    return S[v] ? v : null;
  }

  /* ---------------- Biomi: pesca dal pool + sfondo + scelta zona --------- */
  // Probabilita' dei tier come nell'originale (circa): comune 55%, non comune
  // 30%, raro 10.5%, super raro 3.5%, ultra raro 1%.
  const TIER_ROLL = [["COMMON", 55], ["UNCOMMON", 30], ["RARE", 10.5], ["SUPER_RARE", 3.5], ["ULTRA_RARE", 1]];
  const TIER_CHAIN = ["ULTRA_RARE", "SUPER_RARE", "RARE", "UNCOMMON", "COMMON"];

  /* ⚠️ "La specie esiste" NON basta: 55 forme regionali (Alola/Galar/Hisui,
     numeri dex 2000+/4000+) stanno nei dati ma NON hanno sprite, e mostrarle
     significa il segnaposto colorato al posto del Pokemon. `SPECIES_KEYS` era
     gia' filtrato al boot, ma i POOL DEI BIOMI e le EVOLUZIONI li leggono da
     `S` e se le riprendevano: sull'Isola uscivano 17 specie senza sprite.
     Da qui in poi si passa sempre da questi due controlli. */
  const specieUsabile = k => !!(S[k] && !S[k].noSprite);
  const evoUsabile = e => !!(e && specieUsabile(e.to));

  /* 🔴 La specie del bioma, PORTATA AL LIVELLO GIUSTO.
     `biomePick` pesca dal pool del bioma, che contiene anche le forme base:
     all'ondata 40 usciva un Bulbasaur di livello 40, che nei giochi non
     esiste. Gli allenatori passavano gia' tutti da `evolvedFormFor` — i
     selvatici no, ed erano gli unici a restare cuccioli.
     ⚠️ Non e' un ripiego nostro: nell'originale `getSpeciesForLevel` fa
     esattamente questo, cammina la catena evolutiva in base al livello. */
  function biomePickLv(level, boss) {
    return evolvedFormFor(biomePick(boss), level);
  }

  // Sceglie la specie del nemico dal pool del bioma corrente.
  function biomePick(boss) {
    const b = BIOMES[game.biome];
    const gen1 = arr => (arr || []).filter(specieUsabile);
    if (!b) return randomSpecies(game.player.speciesId);
    if (boss) {
      const pool = [...gen1(b.pools.BOSS), ...gen1(b.pools.BOSS_RARE), ...gen1(b.pools.BOSS_SUPER_RARE)];
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    }
    let r = Math.random() * 100, tier = "COMMON";
    for (const [t, w] of TIER_ROLL) { r -= w; if (r <= 0) { tier = t; break; } }
    for (let i = TIER_CHAIN.indexOf(tier); i < TIER_CHAIN.length; i++) {
      const pool = gen1(b.pools[TIER_CHAIN[i]]);
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    }
    const all = gen1([].concat(...Object.values(b.pools)));
    if (all.length) return all[Math.floor(Math.random() * all.length)];
    return randomSpecies(game.player.speciesId);
  }

  // Applica lo SFONDO REALE del bioma (arenas/<bioma>_bg.png) più le pedane
  // (_a = alleato, _b = nemico). Fallback al gradiente se manca l'immagine.
  function applyBiomeBackground() {
    const b = BIOMES[game.biome];
    const scene = document.getElementById("scene");
    if (!scene) return;
    const key = (game.biome || "PLAINS").toLowerCase();
    const bg = `assets/arenas/${key}_bg.png`;
    // il gradiente resta come colore di riposo sotto l'immagine
    if (b) scene.style.background = `linear-gradient(${b.sky} 0%, ${b.sky} 40%, ${b.ground} 75%, ${b.ground} 100%)`;
    // l'arte del bioma (16:9) riempie la FASCIA DI TERRENO in basso; sopra
    // resta il cielo col colore del bioma → niente zoom eccessivo in verticale.
    const arena = document.getElementById("arena");
    const img = new Image();
    img.onload = () => {
      if (!arena) return;
      arena.style.backgroundImage = `url("${bg}")`;
      arena.classList.add("on");
    };
    img.onerror = () => { if (arena) arena.classList.remove("on"); };
    img.src = bg;
    // pedane: immagini reali del bioma sotto i lottatori. Anche i SECONDI slot
    // della lotta in doppio, che restavano con l'ovale scuro piatto.
    setPlatform(".ally .platform, .ally2 .platform", `assets/arenas/${key}_a.png`, "ally");
    setPlatform(".enemy .platform, .enemy2 .platform", `assets/arenas/${key}_b.png`, "enemy");
  }
  /* Le immagini _a/_b del bioma sono 320x132 con la pedana disegnata in un
     angolo (pensate per il layout orizzontale dell'originale). Qui ne
     RITAGLIAMO la sola pedana e la posizioniamo sotto il lottatore. */
  const PLAT_CROP = {
    ally:  { x: 8,   y: 92, w: 200, h: 40, k: 1.25 },   // pedana in basso a sinistra
    enemy: { x: 142, y: 38, w: 146, h: 60, k: 1.05 },   // pedana a destra, più in alto
  };
  /* ⚠️ Non tutte le arene sono 320x132. Il bioma **END** ha la pedana ANIMATA:
     le sue immagini (155x155 e 170x170) non sono una scena ma una STRISCIA
     VERTICALE di fotogrammi uguali. Ritagliarle con le coordinate fisse
     prendeva una fetta a cavallo di più fotogrammi — erano le pedane sbagliate
     che si vedevano nella lotta finale. Qui si misura l'altezza del primo
     fotogramma cercando le righe completamente trasparenti, così vale anche
     per eventuali altre arene fuori formato. */
  function primoFotogramma(img) {
    try {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const cx = c.getContext("2d");
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, c.width, c.height).data;
      const vuota = y => {
        for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) return false;
        return true;
      };
      let y = 0;
      while (y < c.height && vuota(y)) y++;      // salta il margine trasparente in cima
      const inizio = y;
      while (y < c.height && !vuota(y)) y++;     // fine del primo fotogramma
      const h = y - inizio;
      if (h > 0 && h < c.height) return { y: inizio, h };
    } catch (e) { /* canvas non leggibile: si usa tutta l'immagine */ }
    return { y: 0, h: img.naturalHeight };
  }

  function setPlatform(sel, src, side) {
    const els = [...document.querySelectorAll(sel)];   // anche i secondi slot
    if (!els.length) return;
    const c = PLAT_CROP[side];
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight;
      // arena nel formato solito: si ritaglia la pedana dall'angolo
      let sx = c.x, sy = c.y, sw = c.w, sh = c.h, k = c.k;
      if (W !== 320 || H !== 132) {
        const f = primoFotogramma(img);
        sx = 0; sy = f.y; sw = W; sh = f.h;
        k = (c.w * c.k) / W;                    // stessa larghezza a schermo delle altre
      }
      for (const el of els) {
        el.style.width = (sw * k) + "px";
        el.style.height = (sh * k) + "px";
        el.style.backgroundImage = `url("${src}")`;
        el.style.backgroundSize = `${W * k}px ${H * k}px`;
        el.style.backgroundPosition = `-${sx * k}px -${sy * k}px`;
        el.style.backgroundRepeat = "no-repeat";
        el.style.imageRendering = "pixelated";
        el.classList.add("has-art");
      }
    };
    img.onerror = () => { for (const el of els) el.classList.remove("has-art"); };
    img.src = src;
  }

  /* Ogni 10 ondate si cambia zona. Come nell'originale (`select-biome-phase.ts`
     controlla il MapModifier) la SCELTA c'e' solo se possiedi la Mappa:
     senza, la zona successiva viene estratta a caso fra i collegamenti. */
  /* 🔴 CURA DI SQUADRA ALLE ONDATE DELLE DECINE (10, 20, 30...)

     E' la `PartyHealPhase` dell'originale, che scatta al cambio zona, e fa
     quello che fa lei: stato, stadi e volatili via, **PS e PP rifatti**. E'
     l'unico momento in cui l'attrito accumulato si ferma DAVVERO: fuori di qui
     stato e stadi appartengono al Pokemon finche' resta in campo.
     Gli ESAUSTI tornano in piedi, come nell'originale. ⚠️ Vuol dire che ogni
     dieci ondate la squadra si rialza da sola: i Revitalizzanti e la Cenere
     magica servono per arrivarci, non per il dopo. E' voluto. */
  function curaSquadraDecina() {
    const daCurare = game.party.filter(p => p.status || p.hp < p.maxHp || p.fainted
      || Object.values(p.stages || {}).some(v => v)
      || p.moves.some(m => m.pp < m.maxPp)).length;
    for (const p of game.party) {
      richiamaNellaBall(p);                       // stadi a zero e forma base
      p.status = null; p.sleepTurns = 0;
      p.fainted = false; p.hp = p.maxHp;          // in piedi e PS pieni
      for (const m of p.moves) m.pp = m.maxPp;    // PP pieni
      p.volatile = { confusion: 0, flinch: false, protect: null, protectUsi: 0,
                     trap: null, seed: false, seedBy: null, perish: 0, recharge: false,
                     charging: null, infatuated: false, encore: null, taunt: 0,
                     torment: false, drowsy: 0, nightmare: false, ingrain: false,
                     aquaring: false, saltcure: false, curse: false, lastMove: null,
                     accumulo: 0, bide: null };
      p.sleepTurns = 0;
    }
    renderScene();
    return daCurare
      ? ["La squadra rientra nelle ball e ne esce rimessa a nuovo: PS e PP pieni, nessun problema di stato, nessuno sbalzo."]
      : [];
  }

  function showBiomeChoice() {
    const cura = curaSquadraDecina();
    if (cura.length) { queueMessages(cura, scegliBioma); return; }
    scegliBioma();
  }

  function scegliBioma() {
    // ultime 10 ondate: si va in END e basta, senza scelta (vedi `versoEND`)
    if (versoEND() && BIOMES.END && game.biome !== "END") {
      game.biome = "END";
      applyBiomeBackground();
      queueMessages([
        "Il paesaggio si dissolve…",
        `Sei arrivato: ${BIOMES.END.it}. Qui vive qualcosa che non dovrebbe esistere.`,
      ], nextWave);
      return;
    }
    if (game.biome === "END") { nextWave(); return; }   // da END non si esce
    const b = BIOMES[game.biome];
    let links = ((b && b.links) || []).filter(k => BIOMES[k]);
    if (!links.length) links = ["PLAINS"];
    if (!game.charms.map) {
      game.biome = links[Math.floor(Math.random() * links.length)];
      applyBiomeBackground();
      queueMessages([`Il viaggio prosegue: ${BIOMES[game.biome].it}!`], nextWave);
      return;
    }
    if (links.length > 3) { const cp = links.slice(); links = []; while (links.length < 3) links.push(cp.splice(Math.floor(Math.random() * cp.length), 1)[0]); }
    const btns = links.map(k => {
      const bb = BIOMES[k];
      return `<button class="btn starter-btn" data-k="${k}" style="background:linear-gradient(${bb.sky}, ${bb.ground});color:#0c1018;text-shadow:none;">
        <span class="starter-name">${bb.it}</span></button>`;
    }).join("");
    game.phase = "BIOME";
    cmd().innerHTML = `<div class="prompt-line">Dove prosegue il viaggio?</div><div class="starter-grid">${btns}</div>`;
    cmd().querySelectorAll(".starter-btn").forEach(btn => btn.onclick = () => {
      game.biome = btn.dataset.k;
      applyBiomeBackground();
      queueMessages([`Ti addentri: ${BIOMES[game.biome].it}!`], nextWave);
    });
  }

  /* ======================================================================
     ENTRARE IN CAMPO / RIENTRARE NELLA BALL

     🔴 SCELTA DEL PROPRIETARIO, DIVERSA DALL'ORIGINALE.
     Regola in vigore dal **2026-09-02** (sostituisce quella del 14 agosto, che
     faceva guarire dallo stato anche davanti agli allenatori):

       · rientrando nella ball si perdono SOLO gli stadi (e la forma mega);
       · veleno, paralisi, sonno, scottatura e congelamento RESTANO;
       · davanti a un ALLENATORE la squadra rientra: stadi azzerati e
         confusione tolta, nient'altro;
       · alle ondate delle DECINE (10, 20, 30...) si azzera tutto e si rifanno
         anche PS e PP: e' l'unico momento in cui l'attrito si ferma davvero
         (vedi `curaSquadraDecina`).

     Il modello e' fisico e si regge da solo: stato e stadi appartengono al
     Pokemon FINCHE' STA IN CAMPO. Chi non viene mai richiamato se li porta
     dietro da un'ondata all'altra. Prima invece una sola funzione azzerava
     tutto a ogni ondata.
     ====================================================================== */

  // Il Pokemon ENTRA IN CAMPO: si azzera solo cio' che appartiene alla singola
  // battaglia, cioe' i volatili (confusione, protezione, prese, tentennamento).
  /* ======================================================================
     EFFETTI DI SQUADRA (le "arena tags" dell'originale)

     Non appartengono a un Pokemon ma a un LATO del campo, e restano anche se
     chi li ha creati rientra nella ball. Due famiglie:
       · a TEMPO  — schermi, Salvaguardia, Nebbia, Ventoincoda, Fortuncanto:
                     durano un tot di turni e poi scadono;
       · TRAPPOLE — Punte, Fielepunte, Levitoroccia, Rete Vischiosa: restano
                     finche' dura la lotta e colpiscono CHI ENTRA.
     ⚠️ Si azzerano a fine battaglia (`fineBattaglia`), come nell'originale:
     sono roba di quella lotta li', non della run. */
  const latiVuoti = () => ({
    mio: { reflect: 0, lightscreen: 0, auroravelo: 0, safeguard: 0, mist: 0,
           luckychant: 0, tailwind: 0, spikes: 0, toxicspikes: 0, stealthrock: 0, stickyweb: 0,
           /* protezioni di SQUADRA: durano un turno solo e ognuna para una cosa
              diversa (vedi il blocco 1-bis-bis di `resolveAction`) */
           wideguard: 0, quickguard: 0, craftyshield: 0, matblock: 0,
           nocambio: 0 },
    suo: { reflect: 0, lightscreen: 0, auroravelo: 0, safeguard: 0, mist: 0,
           luckychant: 0, tailwind: 0, spikes: 0, toxicspikes: 0, stealthrock: 0, stickyweb: 0,
           /* protezioni di SQUADRA: durano un turno solo e ognuna para una cosa
              diversa (vedi il blocco 1-bis-bis di `resolveAction`) */
           wideguard: 0, quickguard: 0, craftyshield: 0, matblock: 0,
           nocambio: 0 },
  });
  // Il lato a cui appartiene un combattente, e quello di fronte.
  const latoDi = f => (isEnemySide(f) ? "suo" : "mio");
  const lato = f => (game.lati || (game.lati = latiVuoti()))[latoDi(f)];
  const latoDiFronte = f => (game.lati || (game.lati = latiVuoti()))[isEnemySide(f) ? "mio" : "suo"];
  const nomeLato = f => (isEnemySide(f) ? "avversaria" : "tua");

  const SCHERMO_IT = { reflect: "Riflesso", lightscreen: "Schermoluce", auroravelo: "Velaurora",
                       safeguard: "Salvaguardia", mist: "Nebbia", luckychant: "Fortuncanto",
                       tailwind: "Ventoincoda" };

  /* Accende un effetto a tempo sul lato di chi usa la mossa. Se c'e' gia', la
     mossa fallisce: e' quello che fa l'originale, e dirlo evita che sembri un
     turno buttato senza motivo. */
  function accendiLato(f, chiave, turni, messages) {
    const L = lato(f);
    if (L[chiave] > 0) { stessoMomento(messages, "Ma non ha funzionato!"); return false; }
    L[chiave] = turni;
    messages.push(`${SCHERMO_IT[chiave]} protegge la squadra ${nomeLato(f)}!`);
    return true;
  }

  /* Scala i contatori di UN turno. ⚠️ Va chiamata una volta sola per turno:
     `endOfTurnResidual` gira su ogni combattente, quindi si aggancia al solo
     `game.player`, che c'e' in tutte le strade del turno. */
  /* Il DESIDERIO matura due turni dopo e cura chi si trova su quel lato in
     quel momento — anche se non e' chi l'ha espresso: e' proprio il senso
     della mossa. */
  function maturaDesideri(messages) {
    if (!game.lati) return;
    for (const chi of ["mio", "suo"]) {
      const L = game.lati[chi];
      if (!L.wish) continue;
      if (--L.wish.turni > 0) continue;
      const quota = L.wish.quota; L.wish = null;
      const f = chi === "mio" ? game.player : game.enemy;
      if (!f || f.fainted || f.hp >= f.maxHp) continue;
      f.hp = Math.min(f.maxHp, f.hp + quota);
      messages.push(`Il desiderio si avvera: ${f.name} recupera energie!`);
      if (messages.anim) messages.anim("COMMON_HEALTH_UP", sideOf(f));
    }
  }

  /* Gli effetti che riguardano TUTTO il campo (non un lato solo). */
  const CAMPO_IT = { fangata: "La fangata", doccia: "Il Docciascudo", gravita: "La gravità",
                     distorto: "La distorsione", mirabil: "La Mirabilzona",
                     magica: "La Magicozona", plasma: "La pioggia di plasma" };
  function scalaCampo(messages) {
    for (const k in CAMPO_IT) {
      if (game[k] > 0 && --game[k] === 0) {
        messages.push(`${CAMPO_IT[k]} svanisce.`);
        if (k === "magica") for (const x of game.party.concat(onField())) riaccendiOggetti(x);
      }
    }
    // Magicozona accesa: anche chi entra dopo trova gli oggetti spenti
    if (game.magica > 0) for (const x of onField()) spegniOggetti(x);
    // Divieto e levitazione sono personali
    for (const x of onField()) {
      if (!x || !x.volatile) continue;
      if (x.volatile.embargo > 0) {
        spegniOggetti(x);
        if (--x.volatile.embargo === 0) { riaccendiOggetti(x); messages.push(`${x.name} può di nuovo usare il suo oggetto.`); }
      }
      if (x.volatile.levita > 0 && --x.volatile.levita === 0) messages.push(`${x.name} torna a terra.`);
      if (x.volatile.anticura > 0) x.volatile.anticura--;
    }
  }

  function scalaLati(messages) {
    scalaCampo(messages);
    if (!game.lati) return;
    maturaDesideri(messages);
    for (const chi of ["mio", "suo"]) {
      const L = game.lati[chi];
      for (const k of ["reflect", "lightscreen", "auroravelo", "safeguard", "mist", "luckychant", "tailwind"]) {
        if (L[k] > 0 && --L[k] === 0) {
          messages.push(`${SCHERMO_IT[k]} non fa piu' effetto sulla squadra ${chi === "mio" ? "tua" : "avversaria"}.`);
        }
      }
    }
  }

  /* TRAPPOLE D'INGRESSO: mordono chi entra in campo. Non toccano chi vola o
     levita (tranne Levitoroccia, che e' fatta di pietre in aria). */
  function trappoleIngresso(f, messages) {
    if (!f || f.fainted || !messages) return;
    const L = lato(f);
    const aTerra = isGrounded(f);
    if (L.stealthrock) {
      const eff = typeMultiplier("ROCK", f.types);
      const quota = Math.max(1, Math.floor(f.maxHp * eff / 8));
      f.hp = Math.max(0, f.hp - quota); f._justHit = true;
      messages.push(`Le pietre levitanti feriscono ${f.name}!`);
      if (f.hp <= 0) { f.fainted = true; messages.push(`${f.name} è esausto!`); return; }
    }
    if (aTerra && L.spikes) {
      const frazione = [0, 8, 6, 4][Math.min(3, L.spikes)];
      f.hp = Math.max(0, f.hp - Math.max(1, Math.floor(f.maxHp / frazione))); f._justHit = true;
      messages.push(`${f.name} è ferito dalle punte!`);
      if (f.hp <= 0) { f.fainted = true; messages.push(`${f.name} è esausto!`); return; }
    }
    if (aTerra && L.toxicspikes) {
      /* Un Pokemon di tipo VELENO che tocca terra PORTA VIA le fielepunte:
         e' cosi' anche nell'originale, ed e' il modo di ripulirle. */
      if (f.types.includes("POISON")) {
        L.toxicspikes = 0;
        messages.push(`${f.name} porta via le fielepunte!`);
      } else {
        // due strati = veleno GRAVE, uno solo = veleno normale
        applyStatus(f, L.toxicspikes >= 2 ? "TOXIC" : "POISON", messages);
      }
    }
    if (aTerra && L.stickyweb) {
      applyStatStage(f, ["SPD"], -1, messages, false);
    }
  }

  /* ======================================================================
     MOSSE SPECIALI — quelle che l'estrattore non sa tradurre

     🔴 127 mosse di stato arrivavano con `attrs: []` e non facevano NIENTE:
     nell'originale non sono fatte di mattoncini ma sono classi a se'
     (`CurseAttr`, `ReflectAttr`, `AddArenaTagAttr`…), e l'estrattore le perde.
     Qui c'e' la tabella che le rimette in piedi, una funzione per mossa.

     Ogni voce riceve `(actor, foe, move, messages)` e fa quello che deve.
     ⚠️ Il `foe` per le mosse "su di se'" e' l'avversario d'ufficio (chi non
     sceglie il bersaglio non lo ha davvero): le voci che agiscono sul
     lanciatore devono usare `actor`, non `foe`.
     ====================================================================== */
  const MOSSE_SPECIALI = {};
  window.__mosse = MOSSE_SPECIALI;   // sonda: quali mosse speciali sono in piedi
  /* Sonda: fa usare una mossa qualsiasi a chi è in campo, passando da TUTTO
     il motore (divieti, protezioni, animazioni, danno). Serve a collaudare le
     mosse speciali senza doverle incontrare in partita:
       __provaMossa("METRONOME")        — la usa il tuo
       __provaMossa("ROAR", "e")        — la usa l'avversario
     Restituisce le righe di log che la mossa ha prodotto. */
  window.__provaMossa = (id, chi) => {
    const a = chi === "e" ? game.enemy : game.player;
    const f = a === game.player ? game.enemy : game.player;
    const log = makeLog();
    resolveAction(a, f, { id, pp: 5, maxPp: 5 }, log);
    return log.events.map(e => e.text);
  };

  function entraInCampo(f, messages) {
    if (!f) return;
    f.volatile = { confusion: 0, flinch: false, protect: null, protectUsi: 0,
                   trap: null, seed: false, seedBy: null, perish: 0, recharge: false,
                   charging: null, infatuated: false, encore: null, taunt: 0,
                   torment: false, drowsy: 0, nightmare: false, ingrain: false,
                   aquaring: false, saltcure: false, curse: false, lastMove: null,
                   accumulo: 0, bide: null };
    f._lansat = false;
    f.fainted = false;
    /* Da quanti turni e' in campo, e cosa ha gia' usato da quando e' entrato.
       Servono alle mosse con una CONDIZIONE di tempo (vedi `CONDIZIONI`):
       Bruciapelo vale solo appena entrato, Ultimascelta solo dopo aver usato
       tutto il resto. Stanno fuori da `volatile` no: dentro, cosi' si azzerano
       da sole rientrando nella ball — che e' esattamente la regola. */
    f.volatile.turniInCampo = 0;
    f.volatile.usate = [];
    /* Curardore e Lunardanza hanno lasciato una promessa sul lato: chi entra
       adesso la riscuote (PS pieni e niente problemi di stato). Viene PRIMA
       delle trappole, come nell'originale. */
    const L = game.lati ? lato(f) : null;
    if (messages && L && L.curaProssimo) {
      L.curaProssimo = false;
      f.hp = f.maxHp; f.status = null; f.sleepTurns = 0;
      messages.push(`Il desiderio di ${f.name} si avvera: è come nuovo!`);
      if (messages.anim) messages.anim("COMMON_HEALTH_UP", sideOf(f));
    }
    // le trappole mordono SOLO chi entra a lotta in corso (serve un log)
    if (messages) trappoleIngresso(f, messages);
  }

  /* Il Pokemon RIENTRA NELLA BALL: perde gli stadi — boost e debuff valgono
     finche' resta in campo — e l'eventuale forma mega/gigamax.
     🔴 Non cura NIENTE: ne' stato ne' PS. Aveva un parametro `curaStato` che
     guariva veleno & co. davanti agli allenatori; dal 2 settembre lo stato lo
     toglie soltanto la cura delle decine (`curaSquadraDecina`). */
  function richiamaNellaBall(f) {
    if (!f) return;
    /* RIGENERGIA e ALTERNACURA lavorano nel momento in cui si LASCIA il campo:
       un terzo dei PS la prima, via il problema di stato la seconda. Sono due
       delle abilita' piu' diffuse che non facevano niente. */
    if (ha(f, "REGENERATOR") && !f.fainted && f.hp < f.maxHp) {
      f.hp = Math.min(f.maxHp, f.hp + Math.max(1, Math.floor(f.maxHp / 3)));
    }
    if (ha(f, "NATURAL_CURE") && !f.fainted) { f.status = null; f.sleepTurns = 0; }
    f.toxicN = 0;              // il veleno grave riparte da capo, come nei giochi
    annullaTrasformazione(f); // chi era trasformato torna se stesso
    revertForm(f);            // mega/gigamax durano solo una battaglia
    f.stages = { atk: 0, def: 0, spatk: 0, spdef: 0, spd: 0, acc: 0, eva: 0 };
  }

  /* Fine di una battaglia: cadono meteo e terreno (non passano da una lotta
     all'altra) e le forme mega/gigamax, che durano una lotta sola.
     ⚠️ Prima lo faceva `resetForBattle`, che pero' veniva chiamata anche a ogni
     CAMBIO: cambiare Pokemon spazzava via il meteo a meta' battaglia. */
  function fineBattaglia() {
    game.weather = null; game.terrain = null;
    game.tentativiFuga = 0;      // ogni lotta riparte da capo
    game.cambiAi = 0;            // e cosi' i cambi dell'avversario
    game.lati = latiVuoti();     // schermi e trappole valgono per UNA lotta
    // effetti di campo a tempo: valgono per la lotta, non per la run
    game.fangata = 0; game.doccia = 0; game.gravita = 0;
    game.distorto = 0; game.mirabil = 0; game.magica = 0; game.plasma = 0;
    for (const x of game.party.concat(onField())) { riaccendiOggetti(x); annullaTrasformazione(x); }
    for (const p of game.party) revertForm(p);
  }

  /* ---------------- Avvio run + scelta starter ---------------- */
  function startRun() {
    game.wave = 0;
    game.party = [];
    game.box = [];
    game.balls = START_BALLS;
    game.greatballs = 0;
    game.ultraballs = 0;
    game.rogueballs = 0;
    game.theftballs = 0;
    game.pendingTheft = 0;
    game.money = 400;
    game.stones = {};
    // amuleti e potenziamenti di run (Esperienzamuleto, Monetamuleto, Mappa, ecc.)
    game.charms = { exp: 0, amulet: 0, healing: 0, shiny: 0, catching: 0, ability: 0, lure: 0,
                    candyJar: 0, berryPouch: 0, ivScanner: 0, goldenPunch: 0, map: 0 };
    // Strumenti X / Supercolpo: durano 5 ondate. `tempBoostN` conta i pezzi
    // (si accumulano, come nell'originale); i salvataggi vecchi non ce l'hanno
    // e valgono 1 pezzo.
    game.tempBoost = {};
    game.tempBoostN = {};
    game.lati = latiVuoti();     // schermi e trappole: si azzerano a ogni lotta
    game.fangata = 0; game.doccia = 0; game.gravita = 0;
    game.distorto = 0; game.mirabil = 0; game.magica = 0; game.plasma = 0;
    game.cuccagna = false;       // Cuccagna: dura tutta la run, come l'originale
    game.shopMarkup = 1;      // rincaro dei prezzi (incontro dei rifiuti)
    game.weather = null;      // meteo attivo (dura pochi turni)
    game.terrain = null;      // terreno attivo
    game.cicloOffset = Math.floor(Math.random() * 40);   // sfasa il ciclo giorno/notte
    game.encSeen = [];        // incontri gia' capitati in questa run
    game.encTiersSeen = [];   // e i loro tier, per abbassarne il peso
    game.encReward = null;    // premio promesso da un incontro finito in lotta
    starterTeam = [];
    // Lega e Team cattivo di QUESTA run (come l'originale: casuali ma coerenti)
    game.leagueIdx = Math.floor(Math.random() * LEAGUES.length);
    game.evilIdx = Math.floor(Math.random() * EVIL_TEAMS.length);
    /* Anche il BOSS FINALE si estrae qui e resta quello per tutta la run:
       nell'originale all'ondata 200 c'è sempre Eternatus, da noi no. */
    game.finalBossIdx = Math.floor(Math.random() * FINAL_BOSSES.length);
    game.rivalFemale = Math.random() < 0.5;    // il Rivale è uomo o donna (50%)
    game.rivalRoster = [];                     // la sua squadra nasce al primo incontro
    game.hasMegaRing = false;
    game.hasDynamaxBand = false;
    game.active = 0;
    game.pendingLearns = [];
    game.biome = null;
    meta.stats.runs++; saveMeta();
    game.player = null;
    game.enemy = null;
    game.phase = "STARTER";
    renderScene();
    const forced = overrideKey("p");
    if (forced) { chooseStarter(forced); return; }
    renderStarterSelect();
  }

  // Avvia la run con la squadra composta col sistema a punti.
  function beginRunWithTeam() {
    hideMeta();
    game.party = starterTeam.map(e => {
      // la natura scelta nella scheda vale da subito: `makeFighter` la usa nel
      // calcolo delle statistiche, non basta assegnarla dopo
      const mon = makeFighter(e.k, START_LEVEL, { shiny: e.shiny, nature: e.nature,
                                                 shinyVar: e.shinyVar || 0, gender: e.gender,
                                                 // la forma scelta nella scheda: `undefined` = decidila tu
                                                 variant: e.formKey || undefined,
                                                 ivs: bestIVsFor(e.k) || rollIVs(), ignoreArena: true });
      mon.luck = dexLuck(e.k);       // starter: fortuna dal DEX (§33)
      if (e.ability && ABIL[e.ability]) {
        mon.ability = ABIL[e.ability];
        // tiene allineato l'indice: 2 = nascosta (serve se poi lo si registra)
        const sp = S[e.k];
        mon.abilIndex = sp.abilities.hidden === e.ability ? 2
          : Math.max(0, (sp.abilities.normal || []).indexOf(e.ability));
      }
      if (e.moves && e.moves.length) mon.moves = e.moves.map(id => ({ id, pp: M[id].pp, maxPp: M[id].pp }));
      if (e.pkrs) mon.pokerus = true;
      return mon;
    });
    game.starterSpecies = starterTeam[0] && starterTeam[0].k;
    setActive(0);
    loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
    nextWave();
  }

  // opts (dalla selezione starter): { shiny, ability, moves:[ids], pokerus }
  function chooseStarter(speciesId, opts) {
    opts = opts || {};
    hideMeta();
    const shiny = opts.shiny != null ? opts.shiny : meta.unlocked[speciesId] === 2;
    // lo starter esce con la livrea migliore che hai sbloccato per quella specie
    const shinyVar = opts.shinyVar != null ? opts.shinyVar
      : (meta.shinyVar && meta.shinyVar[speciesId]) || 0;
    const gender = opts.gender || sessiSbloccati(speciesId)[0];
    const mon = makeFighter(speciesId, START_LEVEL, { shiny, shinyVar, gender, ignoreArena: true });
    mon.luck = dexLuck(speciesId);   // dal DEX, non dalla livrea a schermo (§33)
    if (opts.ability) mon.ability = opts.ability;
    if (opts.moves && opts.moves.length) {
      mon.moves = opts.moves.map(id => ({ id, pp: M[id].pp, maxPp: M[id].pp }));
    }
    if (opts.pokerus) { mon.pokerus = true; }
    game.starterSpecies = speciesId;   // per i fiocchi (record ondate con questo starter)
    game.party = [mon];
    setActive(0);
    loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
    nextWave();
  }

  /* ---------------- Ondate ---------------- */
  // Shiny selvatici: 64/65536 = 1/1024, come BASE_SHINY_CHANCE dell'originale.
  // Il Cromamuleto moltiplica la probabilita' (come SHINY_CHARM dell'originale).
  function rollShiny() {
    const mult = 1 + 2 * ((game.charms && game.charms.shiny) || 0);
    return Math.random() * 65536 < 64 * mult;
  }

  /* ======================================================================
     LIVREE CROMATICHE E FORTUNA (§33)

     Un cromatico non è uno solo: l'originale ne ha TRE livree, estratte
     60% / 30% / 10% (`generateShinyVariant` in pokemon.ts, con
     SHINY_VARIANT_CHANCE=4 e SHINY_EPIC_CHANCE=1 su un tiro 0-9). Valgono
     1, 2 e 3 punti di FORTUNA.

     Le livree stanno in data/cromatici.json (le fa tools/extract-cromatici.mjs):
       set["front/25"] = [0, 1, 1]   che fare per la variante 0 / 1 / 2
         0 → lo sprite della cartella `shiny/`: quello che usiamo da sempre
         1 → lo sprite NORMALE, RICOLORATO con la tabella esadecimale in
             data/cromatici-col.json
         2 → un file dedicato in assets/pokemon/cromatico/
     ⚠️ Le 340 specie che nell'originale non hanno voce nel masterlist non
     possono avere livree rare: `generateShinyVariant` lì torna 0 e basta.
     Non è una nostra mancanza, è il comportamento giusto.
     ====================================================================== */
  let CROMSET = {};            // le terne: piccole (47 KiB), si caricano all'avvio
  let CROMCOL = null;          // le tabelle colore: 930 KiB, solo alla prima rara
  let cromColPromessa = null;
  /* Le tabelle servono una volta ogni ~2560 incontri: farle scaricare a tutti
     all'avvio sarebbe un megabyte speso per niente. */
  function cromColCarica() {
    if (CROMCOL) return Promise.resolve(CROMCOL);
    if (!cromColPromessa) {
      cromColPromessa = loadJson("cromatici-col")
        .then(j => (CROMCOL = j || {}))
        .catch(() => (CROMCOL = {}));   // senza tabelle si ricade sulla livrea 0
    }
    return cromColPromessa;
  }
  const cromNome = (dex, formKey) => (formKey ? `${dex}-${formKey}` : String(dex));
  /* La terna di uno sprite: prima la forma, poi la specie — come l'originale,
     che cerca "3-mega" e poi ripiega su "3". */
  function cromTerna(chiave, dex, formKey) {
    return CROMSET[`${chiave}/${cromNome(dex, formKey)}`] || CROMSET[`${chiave}/${dex}`] || null;
  }
  function rollShinyVar(dex, formKey) {
    if (!cromTerna("front", dex, formKey)) return 0;
    const r = Math.floor(Math.random() * 10);
    return r >= 4 ? 0 : r >= 1 ? 1 : 2;      // 6/10 · 3/10 · 1/10
  }
  const CROM_IT = ["cromatico", "cromatico RARO", "cromatico EPICO"];
  /* Stellina della livrea giusta. ⚠️ Uno `<span>` con l'immagine incorporata nel
     CSS, non un `<img src="assets/…">`: gli asset non viaggiano con
     l'aggiornamento a caldo e sul telefono darebbero 404 (§33). */
  const cromStella = v => `<span class="crom-stella v${v || 0}"></span>`;

  /* --- FORTUNA ---------------------------------------------------------
     `getPartyLuckValue` (modifier-type.ts:2906): somma dei punti dei membri
     SCHIERABILI — un esausto vale 0 — con tetto a 14.

     I punti stanno sul SINGOLO Pokémon (`f.luck`), non sulla specie. È la
     differenza che conta: prima li ricavavamo dal dex a ogni chiamata, e così
     un evoluto li perdeva (cambiava `speciesId` e il dex non aveva quella
     voce), mentre un catturato NON cromatico li guadagnava per il solo fatto
     che quella specie era già stata trovata cromatica in passato.

     ⚠️ Lo STARTER è l'eccezione, e c'è anche nell'originale
     (`select-starter-phase.ts:80`): i suoi punti vengono dal DEX, cioè dalla
     livrea più alta mai catturata di quella specie — anche se lo stai giocando
     in versione normale. */
  function dexLuck(speciesId) {
    if ((meta.unlocked[speciesId] || 0) < 2) return 0;
    return 1 + Math.min(2, (meta.shinyVar && meta.shinyVar[speciesId]) || 0);
  }
  /* Fortuna imposta a mano: serve solo alle prove (`__items.premi`). Per
     arrivare a 14 davvero servirebbero sei epici in squadra, cioè un incontro
     su 10.240 sei volte di fila. */
  let fortunaForzata = null;
  function runLuck() {
    if (fortunaForzata != null) return fortunaForzata;
    let l = 0;
    for (const p of game.party || []) if (!p.fainted) l += p.luck || 0;
    return Math.max(0, Math.min(14, l));
  }
  /* Ranghi e colori dell'originale (`getLuckString` / `getLuckTextTint`). */
  const LUCK_RANK = ["D", "C", "C+", "B-", "B", "B+", "A-", "A", "A+", "A++", "S", "S+", "SS", "SS+", "SSS"];
  /* Quanto vale la fortuna, detto in modo utile: la percentuale è quella che
     conta davvero (probabilità che un premio salga di tier a ogni passo). */
  function luckPct(l) { return (4 / Math.floor(512 / (l + 4)) * 100).toFixed(1).replace(".", ","); }
  // pastiglia da mettere nelle schermate meta (Squadra, premi)
  function luckBar() {
    const l = runLuck();
    return `<div class="luck-bar">🍀 <span class="lb-rango" style="color:${luckColor(l)}">${LUCK_RANK[l]}</span>`
      + `<span class="lb-nota">fortuna ${l}/14 · premi migliori ${luckPct(l)}%</span></div>`;
  }
  function luckColor(l) {
    if (l >= 14) return "#ffd05c";                 // il massimo: nell'originale è arcobaleno
    return l > 11 ? "#e07a2a" : l > 9 ? TIER_COL.MASTER : l > 5 ? TIER_COL.ROGUE
         : l > 2 ? TIER_COL.ULTRA : l ? TIER_COL.GREAT : "#9aa4b4";
  }

  /* ---- Classi allenatore: nome, sprite e TIPI preferiti (squadre a tema) ---
     Con la dex completa ogni classe può pescare Pokémon coerenti dal proprio
     tema, invece che a caso: il Pescatore ha Acqua, il Fantasista Spettro, ecc. */
  const TRAINER_CLASSES = [
    { name: "il Bullo", sprites: ["youngster_m", "youngster_f"], types: ["NORMAL", "BUG"] },
    { name: "il Pescatore", sprites: ["fisherman"], types: ["WATER"] },
    { name: "il Montanaro", sprites: ["hiker"], types: ["ROCK", "GROUND"] },
    { name: "lo Scienziato", sprites: ["scientist_m", "scientist_f"], types: ["ELECTRIC", "STEEL", "POISON"] },
    { name: "la Bellezza", sprites: ["beauty"], types: ["FAIRY", "NORMAL"] },
    { name: "il Cinturanera", sprites: ["black_belt_m"], types: ["FIGHTING"] },
    { name: "il Campeggiatore", sprites: ["camper_m", "camper_f"], types: ["GRASS", "BUG"] },
    { name: "il Fantallenatore", sprites: ["ace_trainer_m", "ace_trainer_f"], types: null },   // qualsiasi
    { name: "il Nuotatore", sprites: ["swimmer_m", "swimmer_f"], types: ["WATER", "ICE"] },
    { name: "il Sensitivo", sprites: ["psychic_m", "psychic_f"], types: ["PSYCHIC"] },
    { name: "la Streghetta", sprites: ["hex_maniac"], types: ["GHOST", "DARK"] },
    { name: "il Mangiafuoco", sprites: ["firebreather"], types: ["FIRE"] },
    { name: "il Ranger", sprites: ["ranger_m", "ranger_f"], types: ["GRASS", "FLYING"] },
    { name: "la Recluta Team Rocket", sprites: ["rocket_grunt_m", "rocket_grunt_f"], types: ["POISON", "DARK"] },
  ];

  /* ---- Capipalestra: TUTTE le regioni, sprite reali, squadra MONOTIPO ----
     Ordinati per regione (Kanto→Paldea): affrontandoli ogni 30 ondate si
     percorre la storia dei giochi. */
  const GYM_LEADERS = [
    // Kanto
    { name: "Brock", sprite: "brock", type: "ROCK" },
    { name: "Misty", sprite: "misty", type: "WATER" },
    { name: "Lt. Surge", sprite: "lt_surge", type: "ELECTRIC" },
    { name: "Erika", sprite: "erika", type: "GRASS" },
    { name: "Koga", sprite: "koga", type: "POISON" },
    { name: "Sabrina", sprite: "sabrina", type: "PSYCHIC" },
    { name: "Blaine", sprite: "blaine", type: "FIRE" },
    { name: "Giovanni", sprite: "giovanni", type: "GROUND" },
    // Johto
    { name: "Falkner", sprite: "falkner", type: "FLYING" },
    { name: "Bugsy", sprite: "bugsy", type: "BUG" },
    { name: "Whitney", sprite: "whitney", type: "NORMAL" },
    { name: "Morty", sprite: "morty", type: "GHOST" },
    { name: "Chuck", sprite: "chuck", type: "FIGHTING" },
    { name: "Jasmine", sprite: "jasmine", type: "STEEL" },
    { name: "Pryce", sprite: "pryce", type: "ICE" },
    { name: "Clair", sprite: "clair", type: "DRAGON" },
    // Hoenn
    { name: "Roxanne", sprite: "roxanne", type: "ROCK" },
    { name: "Brawly", sprite: "brawly", type: "FIGHTING" },
    { name: "Wattson", sprite: "wattson", type: "ELECTRIC" },
    { name: "Flannery", sprite: "flannery", type: "FIRE" },
    { name: "Norman", sprite: "norman", type: "NORMAL" },
    { name: "Winona", sprite: "winona", type: "FLYING" },
    { name: "Tate & Liza", sprite: "tate", type: "PSYCHIC" },
    { name: "Juan", sprite: "juan", type: "WATER" },
    // Sinnoh
    { name: "Roark", sprite: "roark", type: "ROCK" },
    { name: "Gardenia", sprite: "gardenia", type: "GRASS" },
    { name: "Maylene", sprite: "maylene", type: "FIGHTING" },
    { name: "Crasher Wake", sprite: "crasher_wake", type: "WATER" },
    { name: "Fantina", sprite: "fantina", type: "GHOST" },
    { name: "Byron", sprite: "byron", type: "STEEL" },
    { name: "Candice", sprite: "candice", type: "ICE" },
    { name: "Volkner", sprite: "volkner", type: "ELECTRIC" },
    // Unima
    { name: "Cilan", sprite: "cilan", type: "GRASS" },
    { name: "Lenora", sprite: "lenora", type: "NORMAL" },
    { name: "Burgh", sprite: "burgh", type: "BUG" },
    { name: "Elesa", sprite: "elesa", type: "ELECTRIC" },
    { name: "Clay", sprite: "clay", type: "GROUND" },
    { name: "Skyla", sprite: "skyla", type: "FLYING" },
    { name: "Brycen", sprite: "brycen", type: "ICE" },
    { name: "Drayden", sprite: "drayden", type: "DRAGON" },
    { name: "Marlon", sprite: "marlon", type: "WATER" },
    // Kalos
    { name: "Viola", sprite: "viola", type: "BUG" },
    { name: "Grant", sprite: "grant", type: "ROCK" },
    { name: "Korrina", sprite: "korrina", type: "FIGHTING" },
    { name: "Ramos", sprite: "ramos", type: "GRASS" },
    { name: "Clemont", sprite: "clemont", type: "ELECTRIC" },
    { name: "Valerie", sprite: "valerie", type: "FAIRY" },
    { name: "Olympia", sprite: "olympia", type: "PSYCHIC" },
    { name: "Wulfric", sprite: "wulfric", type: "ICE" },
    // Alola (capitani)
    { name: "Acerola", sprite: "acerola", type: "GHOST" },
    // Galar
    { name: "Milo", sprite: "milo", type: "GRASS" },
    { name: "Nessa", sprite: "nessa", type: "WATER" },
    { name: "Kabu", sprite: "kabu", type: "FIRE" },
    { name: "Bea", sprite: "bea", type: "FIGHTING" },
    { name: "Allister", sprite: "allister", type: "GHOST" },
    { name: "Opal", sprite: "opal", type: "FAIRY" },
    { name: "Gordie", sprite: "gordie", type: "ROCK" },
    { name: "Melony", sprite: "melony", type: "ICE" },
    { name: "Piers", sprite: "piers", type: "DARK" },
    { name: "Raihan", sprite: "raihan", type: "DRAGON" },
    // Paldea
    { name: "Katy", sprite: "katy", type: "BUG" },
    { name: "Brassius", sprite: "brassius", type: "GRASS" },
    { name: "Iono", sprite: "iono", type: "ELECTRIC" },
    { name: "Kofu", sprite: "kofu", type: "WATER" },
    { name: "Larry", sprite: "larry", type: "NORMAL" },
    { name: "Ryme", sprite: "ryme", type: "GHOST" },
    { name: "Tulip", sprite: "tulip", type: "PSYCHIC" },
    { name: "Grusha", sprite: "grusha", type: "ICE" },
  ];
  const GYM_EVERY = 30;   // come nell'originale: capipalestra ogni 30 ondate

  /* ---- ENDGAME come l'originale ----
     Onde fisse: E4 a 182/184/186/188, Campione a 190, Rivale finale a 195,
     ETERNATUS a 200. **La Lega NON è fissa**: a inizio run si estrae una delle
     9 regioni e si affrontano i SUOI Superquattro + Campione (come fa
     l'originale con getRandomTrainerFunc + seed condiviso). */
  const FINAL_WAVE = 200;
  const E4_WAVES = [182, 184, 186, 188];
  const CHAMPION_WAVE = 190;
  const LEAGUES = [
    { region: "Kanto",  e4: [["Lorelei","lorelei","ICE"],["Bruno","bruno","FIGHTING"],["Agatha","agatha","GHOST"],["Lance","lance","DRAGON"]], champ: ["Blu","blue"] },
    { region: "Johto",  e4: [["Will","will","PSYCHIC"],["Koga","koga","POISON"],["Bruno","bruno","FIGHTING"],["Karen","karen","DARK"]], champ: ["Rosso","red"] },
    { region: "Hoenn",  e4: [["Sidney","sidney","DARK"],["Phoebe","phoebe","GHOST"],["Glacia","glacia","ICE"],["Drake","drake","DRAGON"]], champ: ["Steven","steven"] },
    { region: "Sinnoh", e4: [["Aaron","aaron","BUG"],["Bertha","bertha","GROUND"],["Flint","flint","FIRE"],["Lucian","lucian","PSYCHIC"]], champ: ["Cynthia","cynthia"] },
    { region: "Unima",  e4: [["Shauntal","shauntal","GHOST"],["Marshal","marshal","FIGHTING"],["Grimsley","grimsley","DARK"],["Caitlin","caitlin","PSYCHIC"]], champ: ["Alder","alder"] },
    { region: "Kalos",  e4: [["Malva","malva","FIRE"],["Siebold","siebold","WATER"],["Wikstrom","wikstrom","STEEL"],["Drasna","drasna","DRAGON"]], champ: ["Diantha","diantha"] },
    { region: "Alola",  e4: [["Hala","hala","FIGHTING"],["Olivia","olivia","ROCK"],["Acerola","acerola","GHOST"],["Kahili","kahili","FLYING"]], champ: ["Kukui","kukui"] },
    { region: "Galar",  e4: [["Bede","bede","FAIRY"],["Nessa","nessa","WATER"],["Bea","bea","FIGHTING"],["Raihan","raihan","DRAGON"]], champ: ["Leon","leon"] },
    { region: "Paldea", e4: [["Rika","rika","GROUND"],["Poppy","poppy","STEEL"],["Larry","larry","FLYING"],["Hassel","hassel","DRAGON"]], champ: ["Geeta","geeta"] },
  ];
  const RIVAL_WAVES = [8, 25, 55, 95, 145, 195];   // come l'originale (RIVAL_1..6)
  /* Ranghi dei premi GARANTITI dopo ogni Rivale (dal 2° in poi: il primo non ne
     dà). Presi da `fixed-battle-configs.ts`, dove hanno `allowLuckUpgrades:
     false` — quindi sono esattamente questi, non migliorabili dalla fortuna. */
  const TIER_PREMI_RIVALE = [
    [],                                                   // 1° incontro: niente
    ["ULTRA", "GREAT", "GREAT"],                          // 2°
    ["ULTRA", "ULTRA", "GREAT", "GREAT"],                 // 3°
    ["ULTRA", "ULTRA", "ULTRA", "ULTRA"],                 // 4°
    ["ROGUE", "ULTRA", "ULTRA", "ULTRA"],                 // 5°
    ["ROGUE", "ROGUE", "ULTRA", "ULTRA"],                 // 6°
  ];

  /* PREMI FISSI DELLA RUN (`victory-phase.ts`, modalità Classica). Arrivano
     sulle ondate multiple di 10, quando non c'è la schermata di scelta. */
  function premiFissi(onda, messages) {
    const dai = (id, testo) => {
      const it = REWARD_POOL.find(r => r.id === id);
      if (!it) return;
      const pick = fillPick(it);
      if (!pick) return;
      it.apply(null, pick);
      stessoMomento(messages, testo);
    };
    if (onda % 10) return;                       // solo sulle ondate x10
    // un Esperienzamuleto ogni 10 ondate, che ogni 30 diventa il Super
    if (onda <= 500) {
      if (onda % 30 === 20) dai("superexpcharm", "🎁 Ricevi un Esperienzamuleto super!");
      else dai("expcharm", "🎁 Ricevi un Esperienzamuleto!");
    }
    if (onda === 10) dai("expcharm", "🎁 Il professore ti manda un Esperienzamuleto!");
    if (onda === 50 || onda === 100 || onda === 150) dai("amulet", "🎁 Ricevi un Monetamuleto!");
  }

  /* ---- TEAM CATTIVO della run: uno dei 10, coerente per tutta la partita ----
     Onde fisse dell'originale: recluta 35/62/64, admin 66/114/164, boss 115/165. */
  const EVIL_TEAMS = [
    { name: "Team Rocket", grunt: ["rocket_grunt_m","rocket_grunt_f"], admins: [["Archer","archer"],["Ariana","ariana"],["Proton","proton"],["Petrel","petrel"]], boss: ["Giovanni","giovanni"], types: ["POISON","DARK"] },
    { name: "Team Magma", grunt: ["magma_grunt_m","magma_grunt_f"], admins: [["Tabitha","tabitha"],["Courtney","courtney"]], boss: ["Maxie","maxie"], types: ["FIRE","GROUND"] },
    { name: "Team Idro", grunt: ["aqua_grunt_m","aqua_grunt_f"], admins: [["Shelly","shelly"],["Matt","matt"]], boss: ["Archie","archie"], types: ["WATER"] },
    { name: "Team Galassia", grunt: ["galactic_grunt_m","galactic_grunt_f"], admins: [["Jupiter","jupiter"],["Mars","mars"],["Saturn","saturn"]], boss: ["Cyrus","cyrus"], types: ["PSYCHIC","STEEL"] },
    { name: "Team Plasma", grunt: ["plasma_grunt_m","plasma_grunt_f"], admins: [["Zinzolin","zinzolin"],["Colress","colress"]], boss: ["Ghetsis","ghetsis"], types: ["ICE","STEEL","DARK"] },
    { name: "Team Flare", grunt: ["flare_grunt_m","flare_grunt_f"], admins: [["Bryony","bryony"],["Xerosic","xerosic"]], boss: ["Lysandre","lysandre"], types: ["FIRE","ELECTRIC"] },
    { name: "Fondazione Aether", grunt: ["aether_grunt_m","aether_grunt_f"], admins: [["Faba","faba"]], boss: ["Lusamine","lusamine"], types: ["PSYCHIC","FAIRY"] },
    { name: "Team Skull", grunt: ["skull_grunt_m","skull_grunt_f"], admins: [["Plumeria","plumeria"]], boss: ["Guzma","guzma"], types: ["POISON","BUG","DARK"] },
    { name: "Macro Cosmos", grunt: ["macro_grunt_m","macro_grunt_f"], admins: [["Oleana","oleana"]], boss: ["Rose","rose"], types: ["STEEL","FAIRY"] },
    { name: "Team Star", grunt: ["star_grunt_m","star_grunt_f"], admins: [["Giacomo","giacomo"],["Mela","mela"],["Atticus","atticus"],["Ortega","ortega"],["Eri","eri"]], boss: ["Penny","penny"], types: ["DARK","FIRE","POISON"] },
  ];
  const EVIL_GRUNT_WAVES = [35, 62, 64];
  const EVIL_ADMIN_WAVES = [66, 114, 164];
  const EVIL_BOSS_WAVES = [115, 165];

  /* Indice tipo -> specie, costruito una volta dalla dex completa. */
  let SPECIES_BY_TYPE = null;
  function buildTypeIndex() {
    SPECIES_BY_TYPE = {};
    for (const k of SPECIES_KEYS) {
      for (const t of S[k].types) {
        if (!t) continue;
        (SPECIES_BY_TYPE[t] = SPECIES_BY_TYPE[t] || []).push(k);
      }
    }
  }
  // Pesca una specie di uno dei `types`, con forza adeguata al livello:
  // a livelli bassi preferisce base-stat basse, a livelli alti quelle alte.
  function pickThemed(types, level) {
    if (!SPECIES_BY_TYPE) buildTypeIndex();
    let pool = [];
    if (types && types.length) for (const t of types) pool = pool.concat(SPECIES_BY_TYPE[t] || []);
    if (!pool.length) pool = SPECIES_KEYS;
    const bst = k => { const b = S[k].baseStats; return b.hp + b.atk + b.def + b.spatk + b.spdef + b.spd; };
    // fascia di potenza in base al livello (BST tipica: 200 debole → 600 forte)
    const target = Math.min(600, 240 + level * 6);
    const band = pool.filter(k => Math.abs(bst(k) - target) < 110);
    const use = band.length >= 4 ? band : pool;
    return use[Math.floor(Math.random() * use.length)];
  }

  // Dipinge il frame 0 di un atlas (basePath senza estensione) su un elemento,
  // ridimensionato all'altezza target. Riutilizzato per allenatori e NPC.
  function paintAtlasSprite(el, basePath, targetH, maxK) {
    fetch(basePath + ".json").then(r => r.json()).then(atlas => {
      const { frame, size } = atlasFrame0(atlas);
      const k = Math.min(maxK || 3, targetH / frame.h);
      el.style.width = frame.w * k + "px"; el.style.height = frame.h * k + "px";
      el.style.background = `url("${basePath}.png") -${frame.x * k}px -${frame.y * k}px / ${size.w * k}px ${size.h * k}px no-repeat`;
      el.style.imageRendering = "pixelated";
      el.hidden = false;
    }).catch(() => {});
  }

  // Ritratto allenatore nella scena (durante l'intro), poi nascosto in battaglia.
  function showTrainerPortrait(spriteName) {
    const scene = document.getElementById("scene");
    paintAtlasSprite(document.getElementById("trainer-portrait"), `assets/trainer/${spriteName}`, scene.clientHeight * 0.5, 2.2);
  }
  function hideTrainerPortrait() { const el = document.getElementById("trainer-portrait"); if (el) el.hidden = true; }

  // Manda in campo il nemico `f` (usato per selvatici, boss e mon degli allenatori).
  /* ----------------------------------------------------------------------
     LOTTE IN DOPPIO
     `game.double` accende il secondo slot per lato (`game.player2`,
     `game.enemy2`). Gli slot PRIMARI restano `game.player`/`game.enemy`, cosi'
     tutto il resto del gioco continua a funzionare com'era.
     Probabilita' come l'originale (`getDoubleBattleChance`): 1 su 8, e 1 su 32
     sulle ondate multiple di 10. Le Esche la alzano.
     ---------------------------------------------------------------------- */
  const enemiesOnField = () => [game.enemy, game.enemy2].filter(f => f && !f.fainted);
  const alliesOnField  = () => [game.player, game.player2].filter(f => f && !f.fainted);
  const onField = () => [game.player, game.player2, game.enemy, game.enemy2].filter(Boolean);
  const isEnemySide = f => f === game.enemy || f === game.enemy2;
  /* Un bersaglio a caso dal lato opposto (per l'IA e per le mosse senza scelta). */
  /* 🔴 MOSSE AD AREA. 101 mosse d'attacco hanno un bersaglio multiplo
     (`ALL_NEAR_ENEMIES` come Bora e Foglielama, `ALL_NEAR_OTHERS` come
     Terremoto e Surf) e in doppio ne colpivano UNA SOLA: Terremoto era un
     attacco singolo da 100, e il rischio di prendere anche il compagno — che
     e' tutto il suo carattere — non esisteva.
     Restituisce i bersagli IN PIU' rispetto a quello principale. */
  function bersagliExtra(actor, move, principale) {
    if (!game.double || !move) return [];
    const t = move.target;
    if (t !== "ALL_NEAR_ENEMIES" && t !== "ALL_NEAR_OTHERS" && t !== "ALL") return [];
    const nemici = isEnemySide(actor) ? alliesOnField() : enemiesOnField();
    const alleato = (actor === game.player ? game.player2
                   : actor === game.player2 ? game.player
                   : actor === game.enemy ? game.enemy2 : game.enemy);
    const tutti = nemici.slice();
    // ALL_NEAR_OTHERS prende anche il compagno: e' il prezzo di Terremoto
    if ((t === "ALL_NEAR_OTHERS" || t === "ALL") && alleato) tutti.push(alleato);
    return tutti.filter(x => x && x !== principale && x !== actor && !x.fainted);
  }

  function pickFoeFor(f) {
    const lato = isEnemySide(f) ? alliesOnField() : enemiesOnField();
    return lato.length ? lato[Math.floor(Math.random() * lato.length)] : null;
  }
  /* Decide se questa ondata e' in doppio. */
  function rollDouble() {
    if (game.wave % 10 === 0) return false;              // niente doppie sui boss
    if (game.party.filter(p => !p.fainted).length < 2) return false;
    const div = Math.max(1, 8 - (game.charms.lure || 0) * 2);   // le Esche la alzano
    return Math.floor(Math.random() * div) === 0;
  }

  function deployEnemy(f, messages) {
    pulisciBallScena();      // via la ball rimasta dalla cattura precedente
    game.enemy = f;
    // oggetti tenuti: solo la prima volta che entra in campo
    if (!f._heldGiven) { f._heldGiven = true; giveEnemyHeldItems(f, !!f.trainerMon); }
    f.spr = null;
    loadFighterSprite(f, "front").then(s => { f.spr = s; redrawScene(); });
    applyOnSummon(game.player, f, messages);
    applyOnSummon(f, game.player, messages);
  }

  // Fa evolvere una specie "sulla carta" fino al livello dato (per squadre
  // avversarie coerenti: al crescere delle onde il Rivale ha forme evolute).
  function evolvedFormFor(speciesId, level) {
    let cur = speciesId;
    for (let step = 0; step < 3; step++) {
      const evo = (S[cur].evolutions || []).find(e => evoUsabile(e) && (
        (e.level && !e.item && !e.friendship && level >= e.level) ||
        ((e.item || e.friendship) && level >= 30)     // pietra/amicizia: dai livelli alti
      ));
      if (!evo) break;
      cur = evo.to;
    }
    return cur;
  }

  /* Squadra del Rivale: starter opposto + compagni, e CRESCE con te.
     🔴 ERA UNA SQUADRA NUOVA OGNI VOLTA. A ogni incontro si ripescava tutto da
     capo: lo starter opposto usciva da un sorteggio fra quattro e i compagni
     da `pickThemed`. Il risultato e' che il Rivale non era un personaggio ma
     un allenatore a caso col suo nome: lo battevi con Charmeleon e alla wave
     dopo aveva Totodile.
     Nell'originale la sua squadra e' STATICA (`.setStaticParty()` in
     `trainer-config.ts`): il seme di generazione non include il numero
     d'ondata, quindi lo slot 1 pesca sempre lo stesso, e i pool per incontro
     (SLOT_1_FIGHT_1 → SLOT_1_FIGHT_2 → SLOT_1_FINAL) sono la stessa linea
     evolutiva a stadi diversi. Cioe': gli stessi Pokemon, cresciuti.
     Da noi le radici stanno in `game.rivalRoster` — una lista di specie che
     nasce al primo incontro, si allunga di uno a ogni tappa e non cambia mai
     ordine. A ogni sfida si rifanno i combattenti da quelle radici, portate al
     livello del momento con `evolvedFormFor`. */
  function buildRival(eLevel) {
    const rivalStage = RIVAL_WAVES.indexOf(game.wave);       // 0..5
    const count = Math.min(6, rivalStage + 2);               // 2..6 Pokemon
    const r = game.rivalRoster = game.rivalRoster || [];
    if (!r.length) {
      // ASSO: lo starter opposto al tuo, deciso una volta sola per la run
      const counter = { GRASS: ["CHARMANDER", "CYNDAQUIL", "TORCHIC", "FENNEKIN"],
                        FIRE:  ["SQUIRTLE", "TOTODILE", "MUDKIP", "FROAKIE"],
                        WATER: ["BULBASAUR", "CHIKORITA", "TREECKO", "CHESPIN"] };
      const myType = game.starterSpecies && S[game.starterSpecies] ? S[game.starterSpecies].types[0] : null;
      const opts = (counter[myType] || ["PIKACHU", "EEVEE", "RIOLU"]).filter(k => S[k]);
      r.push({ sp: opts.length ? opts[Math.floor(Math.random() * opts.length)] : "PIKACHU" });
    }
    /* I compagni NUOVI entrano gia' all'altezza dell'ondata in cui li recluta
       (se no, aggiunti alla wave 195, sarebbero cuccioli); quelli che c'erano
       gia' non si toccano: crescono da soli con `evolvedFormFor`. */
    while (r.length < count) {
      let k = null;
      for (let t = 0; t < 25 && (!k || r.some(x => x.sp === k)); t++) k = pickThemed(null, eLevel);
      r.push({ sp: k || pickThemed(null, eLevel) });
    }
    const mons = [];
    for (let i = 0; i < count; i++) {
      const isAce = i === 0;                                 // r[0] e' l'asso
      const lv = eLevel + (isAce ? 2 : 0);
      /* ⚠️ Non basta la specie: senza fissare FORMA e SESSO, l'Alcremie del
         Rivale cambiava gusto da un incontro all'altro e i suoi Pokemon si
         invertivano il simbolo ♂/♀. Sono la stessa squadra: devono anche
         sembrarlo.
         ⚠️ La forma va però legata alla SPECIE DEL MOMENTO: evolvendo cambia
         specie, e la chiave di forma di Applin non vuol dire niente per
         Hydrapple. Si ricorda quindi anche PER CHI vale (`variantOf`), e alla
         prima evoluzione se ne pesca una nuova che resta da li' in poi.
         Il sesso invece attraversa le evoluzioni, ma si tramanda solo se la
         specie ne ha davvero uno: forzare ♂ su una specie tutta ♀ sarebbe
         peggio del difetto che stiamo togliendo. */
      const spOra = evolvedFormFor(r[i].sp, lv);
      const opt = { isTrainer: true };
      if (r[i].variantOf === spOra && r[i].variant != null) opt.variant = r[i].variant;
      if (r[i].gender && S[spOra] && S[spOra].malePercent != null) opt.gender = r[i].gender;
      const f = makeFighter(spOra, lv, opt);
      r[i].variantOf = spOra;
      r[i].variant = f.variant == null ? null : f.variant;
      if (f.gender && f.gender !== "GENDERLESS") r[i].gender = f.gender;
      f.trainer = game.rivalFemale ? "la Rivale" : "il Rivale"; f.rival = true;
      mons.push(f);
    }
    mons.push(mons.shift());          // ma scende in campo per ULTIMO
    return mons;
  }

  /* ---------------- MEGAEVOLUZIONE / GIGAMAX ----------------
     Servono l'oggetto (Megapolsiera / Dynamax Band) comprato al negozio, e la
     specie deve avere una forma. Dura per tutta la battaglia; una volta per
     lotta. Statistiche/tipi/abilità della forma sono quelli reali del gioco. */
  function formsFor(p, kind) {
    const list = FORMS[p.speciesId] || [];
    return list.filter(f => kind === "mega"
      ? (f.formKey.startsWith("mega") || f.formKey === "primal")
      : f.formKey === "gigantamax");
  }
  function canTransform(p) {
    if (!p || p.transformed) return null;
    if (game.hasMegaRing && formsFor(p, "mega").length) return "mega";
    if (game.hasDynamaxBand && formsFor(p, "gmax").length) return "gmax";
    return null;
  }

  // Applica la forma: nuove stat (mantiene la % di HP), tipi, abilità, sprite.
  function transform(p, kind, messages) {
    const opts = formsFor(p, kind);
    if (!opts.length) return false;
    const form = opts[Math.floor(Math.random() * opts.length)];
    const ratio = Math.max(0.05, p.hp / p.maxHp);
    p.preForm = { baseStats: p.baseStats, types: p.types, ability: p.ability, name: p.name };
    p.baseStats = Object.assign({}, form.baseStats);
    p.types = form.types.slice();
    if (form.ability && ABIL[form.ability]) p.ability = ABIL[form.ability];
    p.formKey = form.formKey;
    p.transformed = true;
    recomputeStats(p);
    p.hp = Math.max(1, Math.floor(p.maxHp * ratio));
    const label = kind === "mega" ? "Mega" : "Gigamax";
    p.name = `${label} ${p.preForm.name.replace(/^(Mega |Gigamax |✨|👑 )+/, "")}`;
    if (p.shiny) p.name = "✨" + p.name;
    // sprite della forma: ci pensa loadFighterSprite, che legge `formKey`
    // e sa già ricadere sulla specie se la forma non ha un file suo
    p.spr = null;
    const side = p === game.player ? "back" : "front";
    loadFighterSprite(p, side).then(s => { p.spr = s; redrawScene(); });
    messages.push(kind === "mega"
      ? `✨ ${p.preForm.name} sta megaevolvendo… è diventato ${p.name}!`
      : `🔴 ${p.preForm.name} si gigamaxizza… è diventato ${p.name}!`);
    return true;
  }
  // Ripristina la forma base a fine battaglia (come nei giochi veri).
  function revertForm(p) {
    if (!p || !p.transformed || !p.preForm) return;
    const ratio = Math.max(0.05, p.hp / p.maxHp);
    p.baseStats = p.preForm.baseStats; p.types = p.preForm.types;
    p.ability = p.preForm.ability; p.name = p.preForm.name;
    p.transformed = false; p.formKey = null; p.preForm = null;
    recomputeStats(p);
    p.hp = Math.max(1, Math.floor(p.maxHp * ratio));
    p.spr = null;
    loadFighterSprite(p, p === game.player ? "back" : "front").then(s => { p.spr = s; redrawScene(); });
  }

  // Squadra "élite": mix di specie forti (BST alto), l'ultimo è un boss.
  // Usata per Superquattro (monotipo) e Campione (qualsiasi tipo).
  function buildElite(types, eLevel, count, ownerName) {
    const mons = [];
    for (let i = 0; i < count; i++) {
      const isAce = i === count - 1;
      const key = evolvedFormFor(pickThemed(types, eLevel + 20), eLevel + 20);
      const f = makeFighter(key, eLevel + (isAce ? 4 : 0), { boss: isAce, isTrainer: true, trainerTypes: types });
      f.trainer = ownerName; f.elite = true;
      mons.push(f);
    }
    return mons;
  }

  // Boss finale: Eternatus (o il più forte disponibile) con scudi extra.
  /* Numero di scudi come `getEncounterBossSegments` dell'originale:
       2, +1 se il livello è almeno 100, +1 se il totale base è almeno 670,
       +1 ogni 250 ondate.
     Per Eternatus all'ondata 200 (totale base 690) fa 4. */
  function bossSegmentsFor(level, bst, wave) {
    let n = 2;
    if (level >= 100) n++;
    if (bst >= 670) n++;
    n += Math.floor(wave / 250);
    return n;
  }
  function setSegments(f, n) {
    f.segTotal = n;
    f.segBroken = 0;          // scudi gia' rotti: contatore, non si deduce dai PS
    f.segBounds = [];
    for (let i = n - 1; i >= 1; i--) f.segBounds.push(Math.floor(f.maxHp * i / n));
  }

  function setMoves(f, ids) {
    const usabili = (ids || []).filter(id => M[id]);
    if (usabili.length) f.moves = usabili.map(id => ({ id, pp: M[id].pp, maxPp: M[id].pp }));
  }
  /* Dati di una forma, cercando prima fra le potenziate (forms.json) e poi
     fra le normali (variants.json). */
  function datiForma(speciesId, key) {
    const f = (FORMS[speciesId] || []).find(x => x.formKey === key);
    if (f) return { baseStats: f.baseStats, types: f.types, ability: f.ability };
    const v = (VARIANTS[speciesId] || []).find(x => x.key === key);
    return v && v.baseStats ? { baseStats: v.baseStats, types: v.types, ability: v.ability } : null;
  }

  /* ======================================================================
     BOSS FINALI DELL'ONDATA 200
     ----------------------------------------------------------------------
     ⚠️ DEVIAZIONE VOLUTA DALL'ORIGINALE. In PokéRogue il boss finale è
     SEMPRE Eternatus: la partita finisce ogni volta allo stesso modo. Qui
     ce n'è una rosa e se ne estrae uno a inizio run (`game.finalBossIdx`),
     come già si fa per la Lega e per il team cattivo.

     Ogni boss ha 2 o 3 FASI. La prima ha gli scudi e **non può essere
     sconfitta** (il danno si ferma a 1 PS); rotto l'ultimo scudo si passa
     alla successiva. L'ultima fase è quella che si può battere.
     Queste specie restano nei pool delle ondate normali: la versione da
     boss si distingue per scudi, fasi e repertorio fisso.

     Campi di una fase:
       forma    chiave in forms.json/variants.json (sprite `<dex>-<chiave>`)
       boost    moltiplicatore sulle statistiche base — serve alle forme che
                nell'originale NON crescono (Giratina, Dialga e Palkia hanno
                680 in entrambe) e alle forme inventate da noi
       tipi     sovrascrive i tipi
       nome     come si chiama in questa fase
       filtro   classe CSS sullo sprite (le versioni Ombra, che non esistono
                nei dati: si ricolora lo sprite normale)
       fx       effetto permanente attorno allo sprite ("stelle")
       superEff le sue mosse sono SEMPRE superefficaci (Arceus Perfetto)
       grida    le battute alla trasformazione
     ====================================================================== */
  const FINAL_BOSSES = [
    { id: "MEWTWO", gen: 1,
      intro: ["Un'onda psichica piega l'aria.", "«Sono il più forte. Te lo dimostro.»"],
      fasi: [
        { mosse: ["PSYSTRIKE", "AURA_SPHERE", "ICE_BEAM", "RECOVER"] },
        // X o Y a caso: due scontri diversi dalla stessa specie
        { forma: () => Math.random() < 0.5 ? "mega-x" : "mega-y",
          mosse: ["PSYSTRIKE", "AURA_SPHERE", "PSYCHO_CUT", "NASTY_PLOT"],
          grida: ["«Non hai ancora visto niente.»", "«Ora conoscerai il mio vero potere.»"] },
      ] },

    { id: "LUGIA", gen: 2,
      intro: ["Il mare si ritira e il cielo si abbassa.", "«Chi disturba il custode degli abissi?»"],
      fasi: [
        { mosse: ["AEROBLAST", "HYDRO_PUMP", "PSYCHIC", "RECOVER"] },
        /* LUGIA OMBRA: non esiste nei dati (viene da Pokémon XD, uno spin-off).
           Lo costruiamo noi ricolorando lo sprite — vedi `.sprite.ombra`. */
        { boost: 1.22, nome: "Lugia Ombra", filtro: "ombra",
          mosse: ["AEROBLAST", "SHADOW_BALL", "DARK_PULSE", "RECOVER"],
          grida: ["Una macchia scura risale dal fondo e lo avvolge…",
                  "«…il custode non custodisce più niente.»"] },
      ] },

    { id: "HO_OH", gen: 2,
      intro: ["Un arcobaleno taglia il cielo, poi si spegne.", "«Rinasco da ogni cenere.»"],
      fasi: [
        { mosse: ["SACRED_FIRE", "BRAVE_BIRD", "EARTHQUAKE", "RECOVER"] },
        { boost: 1.22, nome: "Ho-Oh Ombra", filtro: "ombra",
          mosse: ["SACRED_FIRE", "SHADOW_BALL", "DARK_PULSE", "BRAVE_BIRD"],
          grida: ["Le piume si spengono una a una.",
                  "«…e stavolta rinasco in qualcosa di peggio.»"] },
      ] },

    { id: "RAYQUAZA", gen: 3,
      intro: ["Lo strato d'ozono si squarcia.", "«Scendo solo per chiudere le cose.»"],
      fasi: [
        { mosse: ["DRAGON_ASCENT", "EXTREME_SPEED", "EARTH_POWER", "DRAGON_DANCE"] },
        { forma: "mega", mosse: ["DRAGON_ASCENT", "EXTREME_SPEED", "OUTRAGE", "DRAGON_DANCE"],
          grida: ["Il meteorite dentro di lui si accende.", "«Ora sì che vale la pena.»"] },
      ] },

    { id: "GIRATINA", gen: 4,
      intro: ["Il mondo si rovescia come un guanto.", "«Questo posto è mio.»"],
      fasi: [
        { mosse: ["SHADOW_FORCE", "DRAGON_CLAW", "AURA_SPHERE", "WILL_O_WISP"] },
        /* Nell'originale la forma Originale ha lo STESSO totale base (680):
           senza un boost la seconda fase sarebbe più debole della prima. */
        { forma: "origin", boost: 1.18,
          mosse: ["SHADOW_FORCE", "DRAGON_PULSE", "AURA_SPHERE", "OMINOUS_WIND"],
          grida: ["Perde le zampe e diventa un'ombra lunghissima.",
                  "«Nel mio mondo non c'è sopra né sotto.»"] },
      ] },

    { id: "DIALGA", gen: 4,
      intro: ["Il tempo si inceppa.", "«Un istante o mille anni: decido io.»"],
      fasi: [
        { mosse: ["ROAR_OF_TIME", "FLASH_CANNON", "DRACO_METEOR", "AURA_SPHERE"] },
        { forma: "origin", boost: 1.18,
          mosse: ["ROAR_OF_TIME", "FLASH_CANNON", "DRACO_METEOR", "EARTH_POWER"],
          grida: ["Si ripiega su una forma più antica.", "«Torniamo all'inizio.»"] },
      ] },

    { id: "PALKIA", gen: 4,
      intro: ["Lo spazio si increspa.", "«La distanza fra te e me la scelgo io.»"],
      fasi: [
        { mosse: ["SPACIAL_REND", "HYDRO_PUMP", "DRACO_METEOR", "AURA_SPHERE"] },
        { forma: "origin", boost: 1.18,
          mosse: ["SPACIAL_REND", "HYDRO_PUMP", "DRACO_METEOR", "EARTH_POWER"],
          grida: ["Si ripiega su una forma più antica.", "«Non c'è più un posto dove andare.»"] },
      ] },

    { id: "ARCEUS", gen: 4,
      intro: ["Non c'è più cielo: solo una luce che guarda.", "«Ti ho fatto io. Posso disfarti.»"],
      fasi: [
        { mosse: ["JUDGMENT", "EXTREME_SPEED", "EARTH_POWER", "RECOVER"] },
        /* ARCEUS PERFETTO — forma inventata da noi. Prende spunto dalla
           **Lastra Legum** di Leggende: Arceus, che gli fa assumere il tipo
           che infligge più danno: in PokéRogue quell'oggetto esiste ma non fa
           niente (`LEGEND_PLATE, // TODO: Find a potential use for this`).
           Tipo ASTRALE: in difesa è neutro a tutto — niente debolezze, ma
           nemmeno resistenze. Sommato a `superEff` la regola diventa:
           non lo colpisci mai in super efficacia, e lui non è mai resistito. */
        { nome: "Arceus Perfetto", tipi: ["STELLAR"], boost: 1.15, superEff: true, fx: "stelle",
          mosse: ["JUDGMENT", "EXTREME_SPEED", "HYPER_VOICE", "RECOVER"],
          grida: ["Le diciotto lastre si fondono in una sola.",
                  "«Nessun tipo. Nessun riparo. Nessuna scusa.»"] },
      ] },

    { id: "KYUREM", gen: 5,
      intro: ["Il gelo arriva prima di lui.", "«…manca un pezzo. Lo prendo.»"],
      fasi: [
        { mosse: ["GLACIATE", "DRAGON_PULSE", "ICE_BEAM", "EARTH_POWER"] },
        // Nero (fisico, 170 Att) o Bianco (speciale, 170 Att.Sp), a caso
        { forma: () => Math.random() < 0.5 ? "black" : "white",
          mosse: ["ICE_BURN", "FREEZE_SHOCK", "FUSION_BOLT", "DRAGON_PULSE"],
          grida: ["Assorbe un'ombra di drago e si ricompone.", "«Ora sono intero.»"] },
      ] },

    { id: "ZYGARDE", gen: 6,
      intro: ["Il terreno si apre in migliaia di occhi verdi.", "«Ordine.»"],
      /* Tre fasi, ed è l'unico caso CANONICO: l'abilità Costruttore fa
         esattamente questo — sotto metà PS si passa alla Forma Perfetta e il
         massimo dei PS aumenta. Lo schema di Eternatus, scritto da Game Freak. */
      fasi: [
        { forma: "10", mosse: ["THOUSAND_ARROWS", "EXTREME_SPEED", "DRAGON_DANCE", "CORE_ENFORCER"] },
        { forma: "50", mosse: ["THOUSAND_ARROWS", "THOUSAND_WAVES", "COIL", "CORE_ENFORCER"],
          grida: ["Le cellule si richiamano da tutta la zona.", "«Non basta ancora.»"] },
        { forma: "complete", mosse: ["THOUSAND_ARROWS", "CORE_ENFORCER", "LANDS_WRATH", "DRAGON_DANCE"],
          grida: ["Si erge una muraglia di cellule alta come una montagna.",
                  "«ORDINE ASSOLUTO.»"] },
      ] },

    { id: "NECROZMA", gen: 7,
      intro: ["La luce viene risucchiata via.", "«Ho fame di luce.»"],
      fasi: [
        { mosse: ["PHOTON_GEYSER", "POWER_GEM", "METEOR_BEAM", "CALM_MIND"] },
        { forma: () => Math.random() < 0.5 ? "dusk-mane" : "dawn-wings",
          mosse: ["PHOTON_GEYSER", "SUNSTEEL_STRIKE", "MOONGEIST_BEAM", "POWER_GEM"],
          grida: ["Divora un leggendario e se lo cuce addosso.", "«Ancora.»"] },
        { forma: "ultra", mosse: ["PHOTON_GEYSER", "PRISMATIC_LASER", "SUNSTEEL_STRIKE", "POWER_GEM"],
          grida: ["Esplode in un prisma che acceca.", "«ORA SONO LA LUCE.»"] },
      ] },

    { id: "ETERNATUS", gen: 8,
      intro: ["«Sembra che sia arrivata nuovamente l'ora. Sai perché sei qui, non è vero?»",
              "«Sei stato portato qui, perché ci sei già stato. Numerose volte.»",
              "«E ad ogni ciclo, la tua mente si resetta. Tuttavia, in qualche modo, ricordi del te passato permangono.»",
              "«Sarai uno sfidante degno? Lo sfidante che ho atteso per millenni?»",
              "«Cominciamo.»"],
      fasi: [
        { mosse: ["ETERNABEAM", "SLUDGE_BOMB", "FLAMETHROWER", "COSMIC_POWER"] },
        { forma: "eternamax", buconero: true,
          mosse: ["DYNAMAX_CANNON", "CROSS_POISON", "FLAMETHROWER", "RECOVER"],
          grida: ["«Capisco. La presenza che avvertivo era reale.»",
                  "«Pare che non debba più trattenermi.»", "«Non deludermi.»"] },
      ] },

    { id: "TERAPAGOS", gen: 9,
      intro: ["Il terreno diventa cristallo.", "«…»"],
      fasi: [
        { mosse: ["TRI_ATTACK", "EARTH_POWER", "CALM_MIND", "RECOVER"] },
        { forma: "terastal", mosse: ["TERA_STARSTORM", "EARTH_POWER", "CALM_MIND", "HYPER_BEAM"],
          grida: ["Il guscio si apre in mille facce di cristallo."] },
        { forma: "stellar", mosse: ["TERA_STARSTORM", "EARTH_POWER", "HYPER_BEAM", "RECOVER"],
          grida: ["Ogni faccia riflette una stella diversa."] },
      ] },
  ];

  /* REGIGIGAS — l'unico con un PRELUDIO invece che con un cambio forma: prima
     va abbattuto uno dei cinque colossi, poi arriva lui a riprenderselo. Usa
     `enemyQueue`, che il motore ha già per le squadre degli allenatori.
     Non ha forme alternative, quindi le due fasi le giustifica la sua abilità:
     **Inizio Lento** lo tiene fiacco all'inizio, poi si scatena. */
  const REGI_MINORI = ["REGIROCK", "REGICE", "REGISTEEL", "REGIELEKI", "REGIDRAGO"];
  FINAL_BOSSES.push({
    id: "REGIGIGAS", gen: 4, preludio: REGI_MINORI,
    intro: ["Il suolo trema a intervalli regolari, come passi.",
            "Un colosso di pietra ti sbarra la strada."],
    fasi: [
      { boost: 0.85, nome: "Regigigas (torpido)",
        mosse: ["CRUSH_GRIP", "KNOCK_OFF", "THUNDER_PUNCH", "DRAIN_PUNCH"] },
      { boost: 1.3, nome: "Regigigas Scatenato",
        mosse: ["CRUSH_GRIP", "GIGA_IMPACT", "DRAIN_PUNCH", "THUNDER_PUNCH"],
        grida: ["I sigilli sulle sue braccia si spengono uno a uno.",
                "Adesso si muove alla velocità giusta."] },
    ],
  });

  // Boss della run: estratto una volta all'inizio e non cambia.
  function bossFinaleDellaRun() {
    const i = game.finalBossIdx;
    return FINAL_BOSSES[(i == null ? 0 : i) % FINAL_BOSSES.length];
  }

  /* Applica al combattente i dati di una fase. Torna il nome nuovo. */
  function applicaFase(f, boss, idx) {
    const fase = boss.fasi[idx];
    const sp = S[boss.id];
    const chiave = typeof fase.forma === "function" ? fase.forma() : fase.forma;
    const dati = chiave ? datiForma(boss.id, chiave) : null;
    const base = dati ? dati.baseStats : sp.baseStats;
    const boost = fase.boost || 1;
    f.baseStats = {};
    for (const k in sp.baseStats) {
      const v = base[k] != null ? base[k] : sp.baseStats[k];
      f.baseStats[k] = Math.round(v * boost);
    }
    f.types = fase.tipi ? fase.tipi.slice() : (dati ? dati.types.slice() : sp.types.slice());
    const ab = dati && dati.ability;
    if (ab && ABIL[ab]) f.ability = ABIL[ab];
    f.formKey = chiave || null;
    f.spriteFiltro = fase.filtro || null;
    f.spriteFx = fase.fx || null;
    f.superEff = !!fase.superEff;
    f.scalaSprite = (idx === boss.fasi.length - 1) ? BOSS_FINALE_SCALA : null;
    f.finalPhase = idx + 1;
    setMoves(f, fase.mosse);
    f.name = "👑 " + (fase.nome || sp.it);
    return f.name;
  }

  function buildFinalBoss(eLevel) {
    const boss = bossFinaleDellaRun();
    if (!S[boss.id] || S[boss.id].noSprite) {          // rete di sicurezza
      const f = makeFighter("MEWTWO", eLevel + 10, { boss: true });
      f.trainer = null; f.finalBoss = true; f.finalPhase = 1;
      setSegments(f, bossSegmentsFor(f.level, 680, game.wave));
      return f;
    }
    const f = makeFighter(boss.id, eLevel + 10, { boss: true });
    f.trainer = null; f.finalBoss = true;
    f.bossFasi = boss.fasi.length;
    applicaFase(f, boss, 0);
    recomputeStats(f); f.hp = f.maxHp;
    const bst = Object.values(f.baseStats).reduce((a, b) => a + b, 0);
    setSegments(f, bossSegmentsFor(f.level, bst, game.wave));
    /* PRELUDIO (Regigigas): scende in campo prima un guardiano, e il vero boss
       aspetta in `enemyQueue` — la stessa coda con cui gli allenatori mandano
       il Pokemon successivo. */
    if (boss.preludio && boss.preludio.length) {
      const gk = boss.preludio.filter(k => S[k] && !S[k].noSprite);
      if (gk.length) {
        const guardiano = makeFighter(gk[Math.floor(Math.random() * gk.length)], eLevel, { boss: true });
        guardiano.trainer = null;
        /* ⚠️ `makeFighter` dà gli scudi con `2 + livello/25`: all'ondata 200 il
           livello è oltre 350 e ne uscivano **sedici**. Il guardiano usa la
           formula vera dei boss, come il boss finale. */
        const gbst = Object.values(guardiano.baseStats).reduce((a, b) => a + b, 0);
        setSegments(guardiano, bossSegmentsFor(guardiano.level, gbst, game.wave));
        guardiano.arrivo = `Il colosso cade… ma qualcosa di piu' grande si sta alzando.`;
        game.enemyQueue = [f];
        return guardiano;
      }
    }
    return f;
  }

  /* PASSAGGIO ALLA FASE SUCCESSIVA — generalizza `initFinalBossPhaseTwo`
     dell'originale. Scatta quando cade l'ultimo scudo (vedi `afterTurn`).
     I PS non si riempiono: come in `calculateStats`, alla vita corrente si
     somma solo l'aumento del massimo. Alla PRIMA trasformazione la lotta
     passa anche in DOPPIO. */
  function avanzaFaseFinale(messages) {
    const e = game.enemy;
    const boss = bossFinaleDellaRun();
    const prossima = e.finalPhase;                 // finalPhase è 1-based
    const fase = boss.fasi[prossima];
    if (!fase) return false;
    for (const g of (fase.grida || [])) messages.push(g);
    const vecchioMax = e.maxHp;
    const nome = applicaFase(e, boss, prossima);
    recomputeStats(e);
    e.hp = Math.max(1, Math.min(e.maxHp, e.hp + (e.maxHp - vecchioMax)));
    // scudi solo se restano altre fasi dopo questa
    if (boss.fasi[prossima + 1]) {
      const bst = Object.values(e.baseStats).reduce((a, b) => a + b, 0);
      setSegments(e, bossSegmentsFor(e.level, bst, game.wave));
    } else { e.segTotal = 0; e.segBounds = []; e.segBroken = 0; }
    if (fase.buconero) { addHeld(e, "blackhole"); e._heldFisso = ["blackhole"]; }
    e.spr = null;
    loadFighterSprite(e, "front").then(s => { e.spr = s; redrawScene(); });
    messages.push(`${nome} si staglia sul campo!`);
    // alla prima trasformazione si passa in DOPPIO
    if (!game.double) {
      const secondo = game.party.find(p => !p.fainted && p !== game.player);
      if (secondo) {
        game.double = true;
        game.chooser = 0; game.queued = null;
        entraInCampo(secondo);
        game.player2 = secondo;
        loadFighterSprite(secondo, "back").then(s => { secondo.spr = s; redrawScene(); });
        messages.push(`Contro una cosa simile non basta uno: anche ${secondo.name} scende in campo!`);
      }
    }
    renderScene();
    return true;
  }

  // Squadra di un capopalestra: monotipo, con l'ultimo più forte (asso).
  function buildGymLeader(leader, eLevel) {
    const count = 3 + Math.floor(game.wave / 60);   // 3-5 Pokemon
    const mons = [];
    for (let i = 0; i < count; i++) {
      const isAce = i === count - 1;
      const key = evolvedFormFor(pickThemed([leader.type], eLevel + (isAce ? 8 : 0)), eLevel + (isAce ? 6 : 0));
      const f = makeFighter(key, eLevel + (isAce ? 3 : 0), { boss: isAce, isTrainer: true, trainerTypes: [leader.type] });
      f.trainer = leader.name; f.gym = true;
      mons.push(f);
    }
    return mons;
  }

  // Vassoio poké ball dell'allenatore: mostra la sua squadra (piene = da battere,
  // spente = sconfitte, cerchio giallo = in campo).
  function renderTrainerBalls() {
    const el = document.getElementById("trainer-balls");
    if (!el) return;
    /* ⚠️ Il vassoio e il riquadro PS del nemico stanno tutti e due in alto a
       sinistra e si sovrappongono (misurati 14 px di sconfinamento). La classe
       dice al CSS di abbassare il riquadro solo quando il vassoio c'è. */
    const cornice = document.getElementById("game");
    if (!game.trainerTotal) {
      el.hidden = true; el.innerHTML = "";
      if (cornice) cornice.classList.remove("con-vassoio");
      return;
    }
    if (cornice) cornice.classList.add("con-vassoio");
    let html = "";
    for (let i = 0; i < game.trainerTotal; i++) {
      const down = i < game.trainerDefeated;
      const active = i === game.trainerDefeated && game.enemy && !game.enemy.fainted;
      html += `<img class="tb ${down ? "down" : ""} ${active ? "active" : ""}" src="${ballIcon("pb")}" alt="">`;
    }
    el.innerHTML = html; el.hidden = false;
  }

  // Avvio lotta contro allenatore/rivale: prima il RITRATTO (in alto a dx, al
  // posto del nemico), poi manda in campo il primo Pokémon.
  /* ======================================================================
     DIALOGHI DEGLI ALLENATORI (testi italiani ufficiali, data/dialoghi.json)

     La chiave si ricava dallo SPRITE, che nell'originale ha lo stesso nome
     della voce di dialogo a meno del suffisso di sesso e del maiuscolo:
       youngster_m → youngster · black_belt_m → blackBelt
       hex_maniac  → hexManiac · rocket_grunt_f → rocketGrunt · brock → brock
     Il RIVALE ha un dialogo diverso a ogni incontro (rival, rival2 … rival6),
     e una versione femminile.
     ⚠️ Nel file `victory` è la vittoria del GIOCATORE, cioè cosa dice
     l'allenatore quando lo batti: è il dialogo che serve a noi.
     ====================================================================== */
  function chiaveDialogo() {
    if (game.trainerIsRival) {
      const tappa = RIVAL_WAVES.indexOf(game.wave);
      const base = "rival" + (tappa > 0 ? (tappa + 1) : "");
      const f = base + "Female";
      if (game.rivalFemale && DIAL[f]) return f;
      return DIAL[base] ? base : null;
    }
    const spr = game.trainerSprite || "";
    if (!spr) return null;
    const senzaSesso = spr.replace(/_(m|f)$/, "");
    const camel = senzaSesso.split("_")
      .map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join("");
    // se esiste la variante femminile e l'allenatore è donna, si preferisce
    if (/_f$/.test(spr) && DIAL[camel + "Female"]) return camel + "Female";
    return DIAL[camel] ? camel : null;
  }

  /* Le frasi che l'allenatore appena battuto dice, già pronte da accodare.
     Ogni schermata è un messaggio: si leggono una alla volta, col tocco. */
  function dialogoSconfitta() {
    const k = chiaveDialogo();
    const v = k && DIAL[k] && DIAL[k].victory;
    if (!v || !v.length) return [];
    const scelta = v[Math.floor(Math.random() * v.length)] || [];
    const chi = game.trainerName || "L'allenatore";
    return scelta.map(t => `${chi}: «${t}»`);
  }

  function startTrainerBattle(mons, portraitSprite, name, challengeMsgs) {
    // i Pokemon degli allenatori pescano dal pool oggetti dedicato
    for (const m of mons) m.trainerMon = true;
    game.trainerName = name;
    game.trainerRoster = mons.slice();      // serve alla Clepto Ball
    game.trainerIsRival = mons.some(m => m.rival);
    // chiave dei dialoghi ufficiali (vedi `chiaveDialogo`): serve a fargli dire
    // qualcosa quando lo batti
    game.trainerSprite = portraitSprite;
    game.trainerTotal = mons.length;
    game.trainerDefeated = 0;
    game.enemyQueue = mons.slice(1);
    game.enemy = null;                 // niente mon durante la sfida
    /* 🔴 RICHIAMO PRIMA DELLA SFIDA (scelta del proprietario): davanti a un
       allenatore la squadra rientra nelle ball, azzera gli stadi e si toglie la
       CONFUSIONE. Nient'altro: PS e problemi di stato restano come sono.
       ⚠️ Fino al 2 settembre qui si guariva anche da veleno & co.; la regola e'
       cambiata, adesso lo stato lo toglie solo la cura delle decine.
       Resta il momento in cui si VEDE il Pokemon rientrare e poi riuscire. */
    const attivo = game.player;
    const daCurare = game.party.filter(p =>
      (p.volatile && p.volatile.confusion) || Object.values(p.stages || {}).some(v => v)).length;
    for (const p of game.party) {
      richiamaNellaBall(p);
      if (p.volatile) p.volatile.confusion = 0;
    }
    const intro = [conBall(`Ritirati, ${attivo.name}!`, "ritiro", "player")];
    if (daCurare) stessoMomento(intro, "La squadra rientra nelle ball: sbalzi azzerati e testa sgombra.");
    renderScene();
    loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
    queueMessages(intro, () => {
      showTrainerPortrait(portraitSprite);
      renderTrainerBalls();
      renderScene();                   // enemy null → slot vuoto; portrait visibile
      queueMessages(challengeMsgs, () => {
        hideTrainerPortrait();
        const m = [];
        deployEnemy(mons[0], m);       // `m` raccoglie gli effetti d'ingresso
        renderTrainerBalls();
        renderScene();
        const testa = [conBall(`${name} manda in campo ${mons[0].name}!`, "uscita", "enemy"),
                       conBall(`Vai, ${attivo.name}!`, "uscita", "player")];
        queueMessages(testa.concat(m), () => { game.phase = "CHOICE"; showMainMenu(); });
      });
    });
  }

  function nextWave() {
    /* ⚠️ PRIMA del salvataggio: `salvaRun` sta poche righe sotto, e `fineBattaglia`
       (che rimette a posto) gira DOPO. Salvare adesso un Pokemon ancora
       trasformato lo bloccherebbe cosi' per sempre, e uno con gli oggetti
       messi da parte dalla Magicozona li perderebbe: nel salvataggio finirebbe
       `held: {}` e nessuno andrebbe piu' a ripescarli. */
    for (const p of game.party) { annullaTrasformazione(p); riaccendiOggetti(p); }
    pulisciBallScena();      // il campo riparte pulito
    liberaDallaBall();       // e nessuno resta chiuso dentro per un'animazione monca
    /* SALVATAGGIO AUTOMATICO (§26): si scrive PRIMA di incrementare, quindi lo
       slot contiene sempre "ondate completate". Riprendendo si rigioca da qui
       con un avversario nuovo. */
    salvaRun();
    game.wave++;
    // all'ondata 1 il tuo Pokemon e' ancora nella ball: lo si vede uscire
    if (game.wave === 1) { dentroLaBall.add("player"); applicaDentroLaBall(); }
    if (!game.biome) { game.biome = "TOWN"; applyBiomeBackground(); }
    hideTrainerPortrait();
    game.trainerTotal = 0; renderTrainerBalls();   // nascondi il vassoio
    game.trainerRoster = []; game.trainerIsRival = false; game.evilRank = null;
    game.capturedThisWave = false;
    // assicura un Pokemon attivo vivo (se l'attivo e' caduto vincendo l'ondata)
    if (game.player.fainted) {
      const idx = firstAliveIndex();
      if (idx < 0) return gameOver("KO");
      setActive(idx);
    }
    // ENDGAME (ha priorità su tutto): Superquattro, Campione, boss finale.
    // La Lega è quella della REGIONE estratta per questa run (game.league).
    const league = LEAGUES[game.leagueIdx || 0];
    const e4i = E4_WAVES.indexOf(game.wave);
    const e4 = e4i >= 0
      ? { name: league.e4[e4i][0], sprite: league.e4[e4i][1], type: league.e4[e4i][2] }
      : null;
    const isChampion = game.wave === CHAMPION_WAVE;
    const isFinal = game.wave === FINAL_WAVE;
    // capopalestra ogni 30 ondate (ha priorità sul boss selvatico)
    const isGymRaw = !e4 && !isChampion && !isFinal && game.wave % GYM_EVERY === 0;
    const bossRaw = !isGymRaw && !e4 && !isChampion && !isFinal && game.wave % BOSS_EVERY === 0;
    const isRival = !isFinal && RIVAL_WAVES.includes(game.wave);
    // team cattivo della run: reclute / admin / boss a onde fisse
    const evil = EVIL_TEAMS[game.evilIdx || 0];
    const evilKind = !isFinal && !e4 && !isChampion
      ? (EVIL_BOSS_WAVES.includes(game.wave) ? "boss"
        : EVIL_ADMIN_WAVES.includes(game.wave) ? "admin"
        : EVIL_GRUNT_WAVES.includes(game.wave) ? "grunt" : null)
      : null;
    const isGym = isGymRaw && !evilKind;
    const boss = bossRaw && !evilKind;
    const isTrainer = !boss && !isGym && !isRival && !e4 && !isChampion && !isFinal && !evilKind && (game.wave % 5 === 0 || game.wave === 5);
    const eLevel = enemyLevelFor(game.wave);
    /* La lotta precedente e' chiusa: via meteo, terreno e forme mega.
       ⚠️ Stato e stadi NON si azzerano: restano fra un'ondata e l'altra
       (vedi il riquadro sopra `entraInCampo`). A ripulirli e' solo il
       richiamo davanti a un allenatore, in `startTrainerBattle`. */
    fineBattaglia();
    entraInCampo(game.player);
    clearTimeout(game.timer); game.events = []; game.eventIndex = 0; game.afterEvents = null;
    game.enemyQueue = [];
    /* 🔴 Il SECONDO alleato esce dal campo qui: la doppia è finita e lui
       rientra nella ball. Va richiamato per davvero, o si porta dietro gli
       sbalzi — era la segnalazione «il mio secondo Pokemon è rientrato
       automaticamente ma i suoi debuff sono rimasti».
       ⚠️ Il PRIMO invece NON si richiama: lui in campo ci resta, ondata dopo
       ondata, ed è tutto il senso del modello (vedi il riquadro sopra
       `entraInCampo`). La differenza fra i due non è una svista. */
    richiamaNellaBall(game.player2);
    game.double = false; game.enemy2 = null; game.player2 = null;   // si riaccende sotto
    game.chooser = 0; game.queued = null;   // comandi del doppio

    // incontro misterioso al posto di una lotta selvatica (non su onde speciali)
    if (!boss && !isGym && !isRival && !isTrainer && !e4 && !isChampion && !isFinal
        && game.wave >= 3 && maybeMysteryEncounter()) {
      renderScene();
      showMysteryEncounter(pickEncounter());
      return;
    }

    if (isFinal) {
      const f = buildFinalBoss(eLevel);
      game.trainerTotal = 0; renderTrainerBalls();
      /* L'intro la porta il boss estratto per questa run (vedi FINAL_BOSSES).
         Quella di Eternatus sono i testi italiani ufficiali di
         `locales/it/dialogue-final-boss.json`, spezzati sui `$`. */
      const messages = [
        `⚠️⚠️ ONDATA ${FINAL_WAVE} — LA BATTAGLIA FINALE! ⚠️⚠️`,
        `Un'energia sconvolgente squarcia il cielo…`,
        ...(bossFinaleDellaRun().intro || []),
        `${f.name} appare! Ha ${f.segTotal} scudi!`,
      ];
      deployEnemy(f, messages);
      renderScene();
      loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
      queueMessages(messages, () => { game.phase = "CHOICE"; showMainMenu(); });
      return;
    }
    if (e4) {
      const mons = buildElite([e4.type], eLevel, 4, e4.name);
      startTrainerBattle(mons, e4.sprite, e4.name,
        [`👑 Ondata ${game.wave}: ${e4.name} dei Superquattro!`,
         `«Solo i più forti superano la Lega. Vediamo se lo sei.»`]);
      return;
    }
    if (isChampion) {
      const champName = "Campione " + league.champ[0];
      const mons = buildElite(null, eLevel, 6, champName);
      startTrainerBattle(mons, league.champ[1], champName,
        [`🏆 Ondata ${game.wave}: ${champName} della regione di ${league.region} ti attende!`,
         `«Sono il Campione. Mostrami tutto quello che hai imparato!»`]);
      return;
    }

    if (evilKind) {
      const lvl = eLevel + (evilKind === "boss" ? 4 : evilKind === "admin" ? 2 : 0);
      const count = evilKind === "boss" ? 5 : evilKind === "admin" ? 3 : 2;
      let who, sprite;
      if (evilKind === "boss") { who = `${evil.boss[0]} (${evil.name})`; sprite = evil.boss[1]; }
      else if (evilKind === "admin") { const a = evil.admins[Math.floor(Math.random() * evil.admins.length)]; who = `${a[0]} (${evil.name})`; sprite = a[1]; }
      else { who = `Recluta ${evil.name}`; sprite = evil.grunt[Math.floor(Math.random() * evil.grunt.length)]; }
      const mons = [];
      for (let i = 0; i < count; i++) {
        const isAce = i === count - 1;
        const key = evolvedFormFor(pickThemed(evil.types, lvl), lvl);
        const f = makeFighter(key, lvl + (isAce ? 2 : 0),
          { boss: isAce && evilKind === "boss", isTrainer: true, trainerTypes: evil.types });
        f.trainer = who; f.evil = true;
        mons.push(f);
      }
      game.evilRank = evilKind;    // serve al bottino Clepto Ball (recluta/admin/boss)
      const cry = evilKind === "boss"
        ? `«Il mio piano è perfetto! ${evil.name} dominerà!»`
        : evilKind === "admin" ? `«Sono un Admin di ${evil.name}. Non passerai!»`
        : `«${evil.name} non tollera intrusi!»`;
      startTrainerBattle(mons, sprite, who,
        [`💀 Ondata ${game.wave}: ${who} ti sbarra la strada!`, cry]);
      return;
    }
    if (isGym) {
      // capipalestra in ordine, ciclando se si va molto avanti
      const leader = GYM_LEADERS[(Math.floor(game.wave / GYM_EVERY) - 1) % GYM_LEADERS.length];
      const mons = buildGymLeader(leader, eLevel);
      game.gymLeader = leader;
      startTrainerBattle(mons, leader.sprite, leader.name,
        [`⭐ Ondata ${game.wave}: ${leader.name}, Capopalestra di tipo ${T[leader.type].it}!`,
         `«Ti mostro la vera forza dei Pokémon ${T[leader.type].it}!»`]);
      return;
    }
    if (isRival) {
      const mons = buildRival(eLevel);
      const rf = !!game.rivalFemale;
      startTrainerBattle(mons, rf ? "rival_f" : "rival_m", rf ? "la Rivale" : "il Rivale",
        [`Ondata ${game.wave}: ${rf ? "la tua Rivale" : "il tuo Rivale"} ti blocca la strada!`,
         rf ? "«Fatti sotto! Ti mostro quanto sono diventata forte!»" : "«Fatti sotto! Ti mostro quanto sono diventato forte!»"]);
      return;
    }
    if (isTrainer) {
      const count = game.wave >= 20 ? 3 : 2;
      const cls = TRAINER_CLASSES[Math.floor(Math.random() * TRAINER_CLASSES.length)];
      const mons = [];
      for (let i = 0; i < count; i++) {
        // squadra COERENTE col tema della classe (dex completa = varietà vera)
        const key = evolvedFormFor(pickThemed(cls.types, eLevel), eLevel);
        const f = makeFighter(key, eLevel, { shiny: rollShiny(), isTrainer: true, trainerTypes: cls.types });
        f.trainer = cls.name;
        mons.push(f);
      }
      startTrainerBattle(mons, cls.sprites[Math.floor(Math.random() * cls.sprites.length)], cls.name,
        [`Ondata ${game.wave}: ${cls.name} ti sfida!`]);
      return;
    }

    // selvatico / boss
    const messages = [];
    const eKey = (game.wave === 1 && overrideKey("e")) || biomePickLv(eLevel, boss);
    const f = makeFighter(eKey, eLevel, { boss, shiny: rollShiny() });
    // LOTTA IN DOPPIO: due selvatici contro i tuoi due Pokemon in campo
    if (!boss && rollDouble()) {
      game.double = true;
      const f2 = makeFighter(biomePickLv(eLevel), eLevel, { shiny: rollShiny() });
      game.enemy2 = f2;
      const secondo = game.party.find(p => !p.fainted && p !== game.player);
      if (secondo) { entraInCampo(secondo); game.player2 = secondo; }
      messages.push(`Ondata ${game.wave}: LOTTA IN DOPPIO! Appaiono ${f.name} e ${f2.name}!`);
      if (f.shiny || f2.shiny) messages.push("✨ Uno di loro è SHINY!");
      deployEnemy(f, messages);
      if (!f2._heldGiven) { f2._heldGiven = true; giveEnemyHeldItems(f2, false); }
      f2.spr = null; loadFighterSprite(f2, "front").then(s => { f2.spr = s; redrawScene(); });
      if (game.player2) loadFighterSprite(game.player2, "back").then(s => { game.player2.spr = s; redrawScene(); });
      renderScene();
      loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
      queueMessages(messages, () => { game.phase = "CHOICE"; showMainMenu(); });
      return;
    }
    messages.push(boss
      ? `⚠️ Ondata ${game.wave} — BOSS! ${f.name} sbarra la strada!`
      : `Ondata ${game.wave}: appare ${f.name} selvatico!`);
    if (f.shiny) messages.push(f.shinyVar
      ? `✨ È ${CROM_IT[f.shinyVar]}! Vale ${f.shinyVar + 1} punti di fortuna!`
      : "✨ È SHINY! Che fortuna!");
    deployEnemy(f, messages);
    /* PRIMA uscita della run: qui il tuo Pokemon esce davvero dalla ball.
       Dalla seconda ondata in poi NON deve succedere: chi non e' stato
       richiamato resta in campo, ed e' proprio questo che gli fa portare
       stato e stadi da un'ondata all'altra. */
    if (game.wave === 1) messages.push(conBall(`Vai, ${game.player.name}!`, "uscita", "player"));
    renderScene();
    loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
    queueMessages(messages, () => { game.phase = "CHOICE"; showMainMenu(); });
  }

  // Abilita' che scattano all'ingresso in campo (Prepotenza abbassa l'Attacco).
  function applyOnSummon(f, foe, messages) {
    /* INDAGINE: entrando, si vede cosa tiene l'avversario. */
    if (ha(f, "FRISK") && foe && !foe.fainted) {
      const roba = Object.keys(foe.held || {}).concat(Object.keys(foe.berries || {}));
      if (roba.length && messages) {
        messages.push(`${nomeAb(f, "FRISK")}: ${foe.name} tiene ${roba.map(nomeHeld).join(", ")}!`);
      }
    }
    /* AGITAZIONE: l'avversario non riesce piu' a mangiare le bacche. */
    if (ha(f, "UNNERVE") && foe && !foe.fainted && messages) {
      messages.push(`${nomeAb(f, "UNNERVE")}: ${foe.name} è troppo agitato per mangiare bacche!`);
    }
    // ABILITA' METEO (Siccità, Piovischio, Sabbiafiume, Nevischio): entrando in
    // campo chiamano il tempo, come nell'originale.
    for (const ab of [f.ability, f.passiveAbility]) {
      if (!ab) continue;
      const k = Object.keys(WEATHER_ABIL).find(key => ABIL[key] && ABIL[key].it === ab.it);
      if (k) { setWeather(WEATHER_ABIL[k], messages, ab.it); break; }
    }
    // ABILITA' che stendono un TERRENO entrando in campo
    for (const ab of [f.ability, f.passiveAbility]) {
      if (!ab) continue;
      const k = Object.keys(TERRAIN_ABIL).find(key => ABIL[key] && ABIL[key].it === ab.it);
      if (k) { setTerrain(TERRAIN_ABIL[k], messages, ab.it); break; }
    }
    const a = findAb(f, "onSummonStat");
    if (!a) return;
    const target = a.self ? f : foe;
    messages.push(`${f.name} ha ${f.ability.it}!`);
    for (const c of a.changes) applyStatStage(target, [c.stat], c.stages, messages, a.self);
  }

  /* ---------------- Level-up: evoluzioni + nuove mosse ---------------- */
  // Evolve il Pokemon nella specie `toId` mantenendo la percentuale di HP.
  /* ======================================================================
     ANIMAZIONE DI EVOLUZIONE — e si può interrompere, come nei giochi veri

     La sequenza: buio A PIENO SCHERMO, il Pokemon al centro, sagome bianche
     che si alternano sempre più in fretta fra la vecchia e la nuova forma,
     lampo, nuova forma. Un pulsante «✖ Interrompi» resta visibile per tutto
     il tempo: se lo premi, l'evoluzione si ferma e il Pokemon resta com'è
     (si riproporra' al prossimo livello, come nell'originale).
     ⚠️ Funziona anche per i membri in PANCHINA: lo sprite lo dipinge questa
     schermata, non si appoggia a quello in campo.

     🔴 Richiesta del proprietario (2026-08-14): l'evoluzione va vista con lo
     sprite FRONTALE e a PIENO SCHERMO. Prima stava dentro `#scene` (il 68%
     in alto) e usava lo sprite di SPALLE, quello della battaglia: il Pokemon
     si evolveva dandoti le spalle, dentro un riquadro. Ora l'overlay e' fisso
     su tutta la finestra, il Pokemon guarda chi gioca ed e' grande quanto lo
     schermo consente; il tasto per fermarla e' dentro l'overlay, perche' la
     fascia comandi ora ci sta sotto.
     ====================================================================== */
  function animaEvoluzione(p, toId, fine) {
    const radice = document.getElementById("game") || document.body;
    if (!radice) { fine(false); return; }
    const nsp = S[toId];
    const vecchio = p.name, nuovo = nsp.it;

    const ov = document.createElement("div");
    ov.id = "evo-overlay";
    ov.innerHTML = `<div class="evo-box" id="evoBox"><div class="evo-sprite" id="evoSprite"></div></div>
                    <div class="evo-testo">${vecchio} si sta evolvendo…</div>
                    <div class="evo-prompt">tocca per continuare <span class="cont pronto">▸</span></div>
                    <button class="btn back evo-stop">✖ Interrompi</button>`;
    radice.appendChild(ov);
    const el = ov.querySelector("#evoSprite");

    /* Dipinge un frame di sprite dentro l'elemento dell'overlay.
       La misura la detta la FINESTRA, non un tetto fisso di 150 px: a pieno
       schermo quel tetto lasciava il Pokemon minuscolo in mezzo al nero. */
    const lim = Math.min(window.innerWidth * 0.66, window.innerHeight * 0.42);
    const misura = (sp) => {
      const f = sp.frame, k = Math.min(4.5, lim / f.h, lim / f.w);
      return { k, w: f.w * k, h: f.h * k };
    };
    /* 🔴 La CORNICE non cambia mai misura.
       Prima ogni fotogramma scriveva width/height dello sprite, e siccome la
       forma vecchia e quella nuova hanno fotogrammi diversi, la colonna
       centrata dell'overlay si riassestava tredici volte: la scritta e i
       pulsanti ballavano sotto il dito. Ora la cornice si fissa una volta sola
       sul piu' grande dei due, e l'immagine ci sta dentro CENTRATA — quello
       che cambia e' solo il disegno, non lo spazio che occupa. */
    /* 🔴 DUE elementi, e servono tutti e due:
         · `.evo-box` e' la CORNICE, quadrata e grande quanto il limite. Si
           fissa SUBITO, prima ancora che le immagini arrivino, e non cambia
           mai: e' lei che tiene ferme la scritta e i pulsanti;
         · `.evo-sprite` e' l'IMMAGINE, grande quanto il fotogramma. Deve
           restare della sua misura, o dal foglio — che e' una griglia di
           fotogrammi — spuntano quelli vicini. (Ci sono cascato: allargando
           lo sprite alla cornice si vedevano mezzi Charmander di contorno.) */
    const cornice = ov.querySelector("#evoBox");
    cornice.style.width = lim + "px";
    cornice.style.height = lim + "px";
    const dipingi = (sp) => {
      if (!sp || !el) return;
      const f = sp.frame, m = misura(sp);
      el.style.width = m.w + "px";
      el.style.height = m.h + "px";
      el.style.backgroundImage = `url("${sp.sheet}")`;
      el.style.backgroundPosition = `-${f.x * m.k}px -${f.y * m.k}px`;
      el.style.backgroundSize = `${sp.sheet_w * m.k}px ${sp.sheet_h * m.k}px`;
    };

    let annullato = false, tmr = null;
    const pulisci = () => { clearTimeout(tmr); ov.remove(); };

    game.phase = "MESSAGE";
    ov.querySelector(".evo-stop").onclick = (ev) => {
      /* ⚠️ senza `stopPropagation` il clic sul tasto risale all'overlay e FA
         PARTIRE l'evoluzione che si stava rifiutando */
      ev.stopPropagation();
      if (annullato) return;
      annullato = true;
      pulisci();
      fine(false);
    };

    /* Sprite FRONTALI di entrambe le forme. Per il "dopo" si passa da un
       combattente finto con la specie e la forma di arrivo: cosi' valgono le
       stesse regole di `evolve` (forma ereditata per indice) e si prendono
       cromatico e sprite femminile giusti, invece del solo sprite base. */
    const formaDopo = formAt(toId, p.formIndex || 0);
    const finto = { dex: nsp.dex, speciesId: toId, shiny: p.shiny, shinyVar: p.shinyVar, gender: p.gender,
                    variant: formaDopo ? (formaDopo.key || null) : null, formKey: null };
    Promise.all([
      loadFighterSprite(p, "front"),
      loadFighterSprite(finto, "front"),
    ]).then(([sVecchio, sNuovo]) => {
      if (annullato) return;
      dipingi(sVecchio);
      // 8 alternanze che accelerano: 260 ms → 90 ms
      /* 13 alternanze che accelerano: 320 → 100 ms, cioè 2,4 s di
         trasformazione contro gli 1,6 di prima. ⚠️ Non basta rallentare i
         passi: rallentandoli e basta si perde l'ACCELERAZIONE, che è quello che
         fa sembrare l'evoluzione una cosa che sta succedendo invece di un
         lampeggio regolare. Se ne aggiungono, e si allunga la coda. */
      const passi = [320, 300, 280, 250, 220, 200, 180, 160, 140, 120, 110, 100, 100];
      let i = 0;
      const passo = () => {
        if (annullato) return;
        if (i >= passi.length) {
          // lampo finale e nuova forma
          el.classList.add("evo-lampo");
          dipingi(sNuovo);
          el.classList.remove("evo-sagoma");
          ov.querySelector(".evo-testo").textContent = `${nuovo}!`;
          tmr = setTimeout(() => { if (!annullato) { pulisci(); fine(true); } }, 1400);
          return;
        }
        // a sagoma bianca mostra la forma NUOVA, a colori quella vecchia
        const sagoma = i % 2 === 0;
        el.classList.toggle("evo-sagoma", sagoma);
        dipingi(sagoma ? sNuovo : sVecchio);
        tmr = setTimeout(passo, passi[i++]);
      };
      /* ⚠️ L'evoluzione NON parte da sola: esce l'annuncio e si aspetta il
         TOCCO. Nell'originale non è così (`doEvolution` usa
         `showText(..., 1000)`, che avanza da solo dopo un secondo): è una
         scelta nostra, e va nel verso dei giochi ufficiali. Un'evoluzione è
         irreversibile e c'è un tasto per rifiutarla: farla partire da sola
         toglie la scelta a chi ha guardato lo schermo un attimo dopo. */
      let partito = false;
      const parti = () => {
        if (partito || annullato) return;
        partito = true;
        /* 🔴 La riga «tocca per continuare» si NASCONDE, non si toglie.
           Con `remove()` spariva dal flusso: l'overlay e' una colonna
           centrata con gli spazi, quindi tutto si riassestava — il Pokemon
           scendeva e il tasto Interrompi saltava su di un pezzo, proprio
           mentre ci stavi per mettere il dito.
           `visibility: hidden` la fa sparire lasciando il suo posto. */
        const pr = ov.querySelector(".evo-prompt");
        if (pr) pr.style.visibility = "hidden";
        // un respiro prima del primo lampo: non deve cominciare nello stesso
        // istante in cui alzi il dito
        tmr = setTimeout(passo, 380);
      };
      ov.addEventListener("click", parti);
    }).catch(() => { if (!annullato) { pulisci(); fine(true); } });
  }

  /* Coda delle evoluzioni maturate: UNA alla volta, con la sua animazione. */
  function processEvos(done) {
    const item = (game.pendingEvos || []).shift();
    if (!item) { done(); return; }
    const { mon, to } = item;
    // nel frattempo potrebbe essere caduto o essere gia' cambiato
    if (!mon || mon.speciesId === to) { processEvos(done); return; }
    animaEvoluzione(mon, to, (proseguito) => {
      const msgs = [];
      if (proseguito) {
        evolve(mon, to, msgs);
      } else {
        mon.evoRifiutata = true;      // ci riproverà al prossimo livello
        msgs.push(`Cosa?! ${mon.name} ha smesso di evolversi!`);
      }
      queueMessages(msgs, () => processEvos(done));
    });
  }

  function evolve(p, toId, messages) {
    const from = p.name;
    const nsp = S[toId];
    p.speciesId = toId; p.dex = nsp.dex;
    /* La forma si porta dietro l'INDICE, come nell'originale (in `doEvolution`
       il formIndex resta lo stesso se l'evoluzione non ne impone un altro):
       Deerling Autunno diventa Sawsbuck Autunno, Scatterbug Savana diventa
       Vivillon Savana, Burmy Sabbia diventa Wormadam Sabbia — e quest'ultima
       ha davvero tipi e statistiche diversi. Se la nuova specie ha meno forme
       `formAt` ripiega sulla base, come la rete di sicurezza di getFormKey(). */
    const form = formAt(toId, p.formIndex || 0);
    p.variant = form ? (form.key || null) : null;
    p.formIndex = form ? formIndexOf(toId, form.key) : 0;
    p.formIt = form ? form.it : null;
    const suffix = (form && form.key && form.it && !FORM_BY_GENDER.has(toId)) ? ` (${form.it})` : "";
    // il ✨ va rimesso: prima si perdeva evolvendo, mentre lo sprite restava cromatico
    p.name = (p.boss ? "👑 " : "") + (p.shiny ? "✨" : "") + nsp.it + suffix;
    p.types = (form && form.types) ? form.types.slice() : nsp.types.slice();
    const ratio = Math.max(0.05, p.hp / p.maxHp);
    const srcStats = (form && form.baseStats) ? form.baseStats : nsp.baseStats;
    p.baseStats = {};
    for (const k in nsp.baseStats) p.baseStats[k] = srcStats[k] != null ? srcStats[k] : nsp.baseStats[k];
    recomputeStats(p);
    p.hp = Math.max(1, Math.floor(p.maxHp * ratio));
    p.ability = (form && form.ability && ABIL[form.ability]) ? ABIL[form.ability] : pickAbility(nsp);
    p.spr = null;
    loadFighterSprite(p, "back").then(s => { p.spr = s; redrawScene(); });
    messages.push(`✨ Cosa?! ${from} si sta evolvendo… si è evoluto in ${nsp.it}!`);
  }

  /* ----------------------------------------------------------------------
     MOMENTO DEL GIORNO — come `getTimeOfDay()` dell'originale: NON dipende
     dall'ora vera, ma dal numero d'ondata, con un ciclo di 40.
       ondate  0-14 → Giorno · 15-19 → Tramonto · 20-34 → Notte · 35-39 → Alba
     `game.cicloOffset` sposta il ciclo a ogni run, così due partite non hanno
     lo stesso orario alle stesse ondate. Il bioma ABISSO è sempre notte.
     ---------------------------------------------------------------------- */
  const TIME_IT = { DAY: "Giorno", DUSK: "Tramonto", NIGHT: "Notte", DAWN: "Alba" };
  const TIME_EMOJI = { DAY: "☀️", DUSK: "🌇", NIGHT: "🌙", DAWN: "🌄" };
  function timeOfDay() {
    if (game.biome === "ABYSS") return "NIGHT";
    const c = ((game.wave || 0) + (game.cicloOffset || 0)) % 40;
    if (c < 15) return "DAY";
    if (c < 20) return "DUSK";
    if (c < 35) return "NIGHT";
    return "DAWN";
  }

  /* ----------------------------------------------------------------------
     CONDIZIONI DI EVOLUZIONE (gli `EvoCondKey` dell'originale).
     Prima venivano ignorate del tutto e 81 evoluzioni non scattavano mai.
     Ritorna true se TUTTE le condizioni della voce sono soddisfatte.
     ---------------------------------------------------------------------- */
  function evoConditionOk(p, e) {
    // momento del giorno
    if (e.time && !e.time.includes(timeOfDay())) return false;
    // sesso
    if (e.gender && e.gender !== p.gender) return false;
    // conosce una mossa precisa, o una mossa di un certo tipo
    if (e.knowsMove && !p.moves.some(m => m.id === e.knowsMove)) return false;
    if (e.moveType && !p.moves.some(m => M[m.id] && M[m.id].type === e.moveType)) return false;
    // si trova in uno di questi biomi
    if (e.biome && !e.biome.includes(game.biome)) return false;
    // Tyrogue: il ramo dipende da QUALE delle tre mosse conosce
    if (e.tyrogue) {
      const TRE = ["LOW_SWEEP", "MACH_PUNCH", "RAPID_SPIN"];
      const sua = p.moves.map(m => m.id).find(id => TRE.includes(id));
      if (sua !== e.tyrogue) return false;
    }
    // tiene un oggetto legato alla specie (Dente Abissi / Squamabissi)
    if (e.heldItem) {
      const chiave = e.heldItem.toLowerCase().replace(/_/g, "");
      if (!p.held || !p.held[chiave]) return false;
    }
    // natura
    if (e.nature && !e.nature.includes(p.nature)) return false;
    // meteo in corso
    if (e.weather && !e.weather.includes(weatherKind())) return false;
    // hai gia' catturato quella specie (il dex persistente)
    if (e.speciesCaught && !meta.unlocked[e.speciesCaught]) return false;
    // hai in squadra un Pokemon di quel tipo (diverso da lui)
    if (e.partyType && !game.party.some(q => q !== p && q.types.includes(e.partyType))) return false;
    // forma casuale: 1 possibilita' su N, ma FISSA per quell'esemplare
    if (e.randomForm) {
      if (p._randomForm === undefined) p._randomForm = Math.floor(Math.random() * e.randomForm);
      if (p._randomForm !== 0) return false;
    }
    // contatore del tesoro (Gimmighoul): cresce catturando/vincendo
    if (e.treasure && (p.treasure || 0) < e.treasure) return false;
    // Shedinja non e' un'evoluzione normale: la gestisce checkLevelUps
    if (e.shedinja) return false;
    return true;
  }

  const FRIENDSHIP_LEVEL = 22;   // le evo per amicizia scattano a questo livello
  // Dopo un level-up: evoluzione a livello/amicizia + mosse appena imparate.
  // (le evo a PIETRA, che hanno level:1+item, NON scattano da sole)
  function checkLevelUps(p, messages) {
    // SHEDINJA: non trasforma, CREA un secondo Pokemon. Come nell'originale
    // serve posto in squadra e almeno una Poke Ball.
    const shed = (S[p.speciesId].evolutions || []).find(e => e.shedinja && evoUsabile(e) && p.level >= (e.level || 20));
    if (shed && game.party.length < PARTY_MAX && game.balls > 0) {
      game.balls--;
      const guscio = makeFighter(shed.to, p.level, {});
      game.party.push(guscio);
      if (!meta.unlocked[shed.to]) { meta.unlocked[shed.to] = 1; saveMeta(); }
      messages.push(`Il guscio abbandonato di ${p.name} si anima: ${guscio.name} si unisce alla squadra!`);
    }

    const evo = (S[p.speciesId].evolutions || []).find(e => evoUsabile(e)
      // tutte le condizioni speciali (momento del giorno, mosse, bioma, sesso…)
      && evoConditionOk(p, e) && (
      (e.friendship && p.level >= FRIENDSHIP_LEVEL) ||
      (!e.item && !e.friendship && e.level && p.level >= e.level)
    ));
    /* ⚠️ L'evoluzione NON avviene qui: si mette in coda. Qui siamo dentro la
       costruzione dei messaggi, mentre l'evoluzione ha un'animazione (e si può
       interrompere), quindi va gestita dopo, da `processEvos`. */
    if (evo) { game.pendingEvos = game.pendingEvos || []; game.pendingEvos.push({ mon: p, to: evo.to }); }
    const from = p.movesCheckedTo != null ? p.movesCheckedTo : p.level;
    const gained = (LEARN[p.speciesId] || []).filter(([lv, id]) => lv > from && lv <= p.level && M[id]);
    p.movesCheckedTo = p.level;
    for (const [, id] of gained) {
      if (p.moves.some(m => m.id === id)) continue;
      if (p.moves.length < 4) {
        p.moves.push({ id, pp: M[id].pp, maxPp: M[id].pp });
        messages.push(`${p.name} impara ${M[id].it}!`);
      } else {
        /* ⚠️ Il messaggio NON va nella narrazione insieme agli altri: se ne
           occupa `processLearns`, che lo mostra e SUBITO DOPO apre la
           schermata di quella mossa. Prima uscivano tutti i messaggi di fila
           e solo alla fine, tutte insieme, le schermate: non si capiva piu'
           quale scelta riguardasse chi. Uno alla volta. */
        game.pendingLearns.push({
          mon: p, moveId: id,
          testo: `${p.name} è salito al Lv.${p.level} e vorrebbe imparare ${M[id].it}!`,
        });
      }
    }
  }

  /* Coda "vuole imparare X ma ha 4 mosse". UNA alla volta e in ordine:
     prima il messaggio di quel Pokemon, poi subito la sua schermata, poi
     il prossimo. Non tutti i messaggi e poi tutte le schermate. */
  function processLearns(done) {
    const item = game.pendingLearns.shift();
    if (!item) { done(); return; }
    /* Voce di SOLO TESTO: non c'e' nessuna mossa da imparare, e' un annuncio
       (per ora lo usa la Menta, che sblocca una natura nel dex). */
    if (item.soloTesto) { queueMessages([item.soloTesto], () => processLearns(done)); return; }
    /* Voce di CURA: la barra deve salire, non comparire già piena. L'evento
       porta con sé il fotogramma di PRIMA (`pre`) e l'animazione di recupero:
       `nextEvent` disegna il prima, suona l'animazione e solo alla fine applica
       l'istantanea nuova — cioe' fa salire la barra sotto gli occhi. */
    if (item.cura) { suonaCure([item.cura], () => processLearns(done)); return; }
    if (item.testo) {
      const t = item.testo;
      item.testo = null;                       // gia' detto: non ripeterlo
      game.pendingLearns.unshift(item);        // rimettilo in testa
      queueMessages([t], () => processLearns(done));
      return;
    }
    learnInfo = null;                 // ogni Pokemon riparte coi riquadri chiusi
    renderLearnScreen(item, done);
  }

  /* ======================================================================
     «QUALE MOSSA DIMENTICA» — a schermo intero e CONSULTABILE

     Prima mostrava solo i nomi delle quattro mosse, nella fascia comandi: per
     decidere bisognava ricordarsi a memoria cosa facessero, e soprattutto se
     la mossa nuova fosse fisica o speciale rispetto all'Attacco del Pokemon.
     Ora c'è tutto: la ⓘ apre la scheda della mossa nuova e di ognuna delle
     quattro, e sopra ci sono le statistiche VERE di questo esemplare con
     Attacco e Att. Speciale in evidenza — è il confronto che serve davvero.

     ⚠️ Sta in `showMetaScreen` e non in `cmd()`: nella fascia comandi non ci
     stava (è già successo per Squadra, Ball e scheda Mosse).
     ⚠️ Lo stato del riquadro aperto è SUO (`learnInfo`), non `starterCfg`:
     quello appartiene alla scheda starter, un'altra schermata.
     ====================================================================== */
  let learnInfo = null;               // { tipo: "nuova" | "vecchia", id }
  const learnAperto = (tipo, id) => !!(learnInfo && learnInfo.tipo === tipo && learnInfo.id === id);
  function learnInfoTocca(tipo, id, item, done) {
    learnInfo = learnAperto(tipo, id) ? null : { tipo, id };
    renderLearnScreen(item, done);
  }

  function renderLearnScreen(item, done) {
    const { mon, moveId } = item;
    const nv = M[moveId];
    game.phase = "MESSAGE";           // nessun altro comando è valido adesso
    /* Statistiche VERE dell'esemplare (livello, IV, natura, vitamine), non
       quelle base della specie: è su queste che si decide. Le barre sono in
       scala sulla più alta delle sue, così il confronto si legge a colpo
       d'occhio anche su un Pokemon di primo livello. */
    const st = mon.stats || {};
    const maxSt = Math.max(1, ...["hp", "atk", "def", "spatk", "spdef", "spd"].map(k => st[k] || 0));
    const bar = (lab, k, spicca) => `<div class="stat-row${spicca ? " spicca" : ""}">
        <span class="stat-lab">${lab}</span>
        <div class="stat-track"><div class="stat-fill" style="width:${Math.round((st[k] || 0) / maxSt * 100)}%"></div></div>
        <span class="stat-val">${st[k] || 0}</span></div>`;
    // la categoria della mossa nuova decide quale statistica mettere in risalto
    const fisica = nv.category === "PHYSICAL", speciale = nv.category === "SPECIAL";

    const btns = mon.moves.map((mi, i) => {
      const mv = M[mi.id], ty = T[mv.type];
      return `<div class="learn-riga">
        <button class="btn move-btn" data-i="${i}" style="background:${ty.color};">
          <span class="move-name">${mv.it}</span>
          <span class="move-meta"><span class="ticon t-${mv.type}"></span><span class="cicon c-${mv.category}"></span><span>${mv.power > 0 ? "pot " + mv.power : ""}</span></span>
        </button>
        <button class="chip-i ${learnAperto("vecchia", mi.id) ? "on" : ""}" data-i-old="${mi.id}" title="cosa fa">ⓘ</button>
      </div>${learnAperto("vecchia", mi.id) ? snippetMossa(mi.id) : ""}`;
    }).join("");

    showMetaScreen(`
      <div class="learn-head">
        <span class="learn-sprite" id="learnSprite"></span>
        <div class="learn-nome">${mon.name} <span class="learn-lv">Lv.${mon.level}</span></div>
      </div>
      <div class="sd-stats learn-stats">
        ${bar("PS", "hp")}${bar("Att", "atk", fisica)}${bar("Dif", "def")}
        ${bar("A.Sp", "spatk", speciale)}${bar("D.Sp", "spdef")}${bar("Vel", "spd")}
      </div>
      <div class="learn-nuova">
        Vuole imparare <b>${nv.it}</b>
        <button class="chip-i ${learnAperto("nuova", moveId) ? "on" : ""}" data-i-new="1" title="cosa fa">ⓘ</button>
      </div>
      ${learnAperto("nuova", moveId) ? snippetMossa(moveId) : ""}
      <div class="meta-sub">Quale mossa dimentica?</div>
      <div class="learn-lista">${btns}</div>
      <div class="meta-actions">
        <button class="meta-btn ghost" data-act="skip">Rinuncia a ${nv.it}</button>
      </div>`);

    // mini sprite, per sapere di CHI si sta parlando senza leggere il nome
    loadFighterSprite(mon, "front").then(s => {
      const el = document.getElementById("learnSprite"); if (!el || !s) return;
      const k = Math.min(1.1, 56 / s.frame.h, 56 / s.frame.w);
      el.style.width = s.frame.w * k + "px"; el.style.height = s.frame.h * k + "px";
      el.style.background = `url("${s.sheet}") -${s.frame.x * k}px -${s.frame.y * k}px / ${s.sheet_w * k}px ${s.sheet_h * k}px no-repeat`;
      el.style.imageRendering = "pixelated";
    });

    const m = metaEl();
    m.querySelector("[data-i-new]").onclick = () => learnInfoTocca("nuova", moveId, item, done);
    m.querySelectorAll("[data-i-old]").forEach(b =>
      b.onclick = () => learnInfoTocca("vecchia", b.dataset.iOld, item, done));
    m.querySelectorAll(".move-btn").forEach(b => b.onclick = () => {
      const i = parseInt(b.dataset.i, 10);
      const old = M[mon.moves[i].id].it;
      mon.moves[i] = { id: moveId, pp: nv.pp, maxPp: nv.pp };
      hideMeta();
      queueMessages([`${mon.name} dimentica ${old} e impara ${nv.it}!`], () => processLearns(done));
    });
    m.querySelector('[data-act="skip"]').onclick = () => {
      hideMeta();
      queueMessages([`${mon.name} rinuncia a imparare ${nv.it}.`], () => processLearns(done));
    };
  }

  /* ---------------- Fine ondata ---------------- */
  /* Ondata superata: il corpo di sempre. */
  function onWaveCleared() {
    vittoriaOndata();
  }

  function vittoriaOndata() {
    // VITTORIA DELLA RUN: battuto il boss finale dell'ondata 200
    if (game.enemy.finalBoss) {
      meta.stats.wins = (meta.stats.wins || 0) + 1;
      if (FINAL_WAVE > meta.stats.bestWave) meta.stats.bestWave = FINAL_WAVE;
      saveMeta();
      // 🎀 IL FIOCCO si prende QUI, e solo qui: e' il premio della vittoria
      const fiocchi = [];
      assegnaFiocchi(fiocchi);
      queueMessages(fiocchi.concat([
        `${game.enemy.name} è stato sconfitto!`,
        `«…magnifico.»`,                       // `secondStageWin` dei testi ufficiali
        `🏆 HAI COMPLETATO LA MODALITÀ CLASSICA!`,
      ]), () => renderRunVictory());
      return;
    }
    const wasEvilBoss = !!game.enemy.evil && !!game.enemy.boss;
    const wasGym = !!game.enemy.gym;
    const wasBoss = game.enemy.boss || wasGym;
    const messages = [wasGym
      ? `Hai sconfitto ${game.gymLeader.name}! ⭐ Medaglia ottenuta!`
      : `Hai sconfitto ${game.enemy.name}!`];
    /* Se era un ALLENATORE, adesso parla: sono i testi italiani ufficiali, e
       il Rivale ne ha uno diverso per ognuno dei sei incontri. */
    if (game.enemy.trainer) {
      const battute = dialogoSconfitta();
      for (const riga of battute) messages.push(riga);
      /* Mentre PARLA si rivede: il ritratto torna in campo al posto del suo
         Pokémon (che è appena caduto) e resta finché ha finito. Senza, il
         dialogo arrivava da uno schermo vuoto. */
      if (battute.length && game.trainerSprite) showTrainerPortrait(game.trainerSprite);
    }
    // premio promesso da un incontro misterioso che finiva in lotta
    if (game.encReward) {
      const t = game.encReward();
      game.encReward = null;
      if (t) messages.push(t);
    }
    // soldi: piu' per boss e capipalestra. Il Monetamuleto da' +20% per pezzo.
    const base = (wasGym || wasEvilBoss ? 500 : wasBoss ? 260 : 90) + game.wave * 12;
    const money = Math.floor(base * (1 + 0.2 * (game.charms.amulet || 0)) * (game.cuccagna ? 2 : 1));
    game.money += money;
    stessoMomento(messages, `Ricevi ₽${money}!`);
    // i potenziamenti a tempo (Poteslot/Supercolpo) durano 5 ondate
    for (const k in game.tempBoost) if (--game.tempBoost[k] <= 0) { delete game.tempBoost[k]; if (game.tempBoostN) delete game.tempBoostN[k]; }
    // contatore del tesoro di Gimmighoul: cresce a ogni ondata vinta
    for (const p of game.party) if (p.speciesId === "GIMMIGHOUL") p.treasure = (p.treasure || 0) + 1;
    /* 🔴 RACCOLTA (Pickup). Anche questa aveva `attrs: []` e non faceva
       nulla, pur essendo su 35 specie. Nell'originale
       (`PostBattleLootAbAttr`) a lotta VINTA raccoglie UNO degli oggetti che
       gli avversari caduti stavano tenendo. Da noi il bottino è quello che
       teneva l'avversario appena battuto.
       ⚠️ Solo un oggetto e solo un raccoglitore per ondata: con sei Pokemon
       in squadra, altrimenti, si svuoterebbe l'inventario del nemico. */
    const bottino = game.enemy && game.enemy.held ? Object.keys(game.enemy.held) : [];
    if (bottino.length) {
      const chi = game.party.find(p => !p.fainted && p.ability && p.ability.id === "PICKUP");
      if (chi) {
        const preso = bottino[Math.floor(Math.random() * bottino.length)];
        addHeld(chi, preso);
        if (--game.enemy.held[preso] <= 0) delete game.enemy.held[preso];
        stessoMomento(messages, `🧹 ${chi.ability.it}: ${chi.name} raccoglie ${nomeHeld(preso)}!`);
      }
    }
    // record di ondate raggiunte con questo starter (statistica, non fiocchi)
    if (game.starterSpecies) {
      const cur = meta.starterBest[game.starterSpecies] || 0;
      if (game.wave > cur) { meta.starterBest[game.starterSpecies] = game.wave; saveMeta(); }
    }
    /* PREMI DELLE DECINE. Ogni ondata multipla di 10 e' un boss, e il boss gia'
       dava un voucher. Ci si aggiunge un pugno di CARAMELLE per tutta la
       squadra — poche all'inizio, di piu' andando avanti — e un voucher in
       piu' ogni 50 ondate, che sono i traguardi veri della run. */
    if (game.wave % 10 === 0 && !game.enemy.finalBoss) {
      const quante = 1 + Math.floor(game.wave / 50);
      const viste = new Set();
      for (const p of game.party) {
        const root = rootOf(p.speciesId);
        if (viste.has(root)) continue;
        viste.add(root);
        daiCaramelle(root, quante);
      }
      saveMeta();
      stessoMomento(messages, `🍬 Traguardo dell'ondata ${game.wave}: +${quante} caramell${quante === 1 ? "a" : "e"} a ogni specie in squadra!`);
      if (game.wave % 50 === 0) {
        meta.vouchers++; saveMeta();
        stessoMomento(messages, "🎟 Un Voucher Uovo in più per il traguardo!");
      }
    }
    // ESPERIENZA VERA (non piu' livelli regalati): la si guadagna dai nemici
    // battuti in questa ondata, con le quote dell'originale.
    assegnaEsperienza(messages);
    // apprendimento mosse + evoluzioni ai nuovi livelli
    for (const p of game.party) if (!p.fainted) checkLevelUps(p, messages);
    // le uova avanzano di 1 ondata (persistente tra le run)
    tickEggs(messages);
    // i boss danno un voucher per il gacha
    if (wasBoss) { meta.vouchers++; saveMeta(); messages.push("🎟 Ottieni un Voucher Uovo!"); }
    // dopo un boss: ci si ferma a riposare, squadra curata
    if (wasBoss) { healParty(); messages.push("Ti fermi a riposare: la squadra recupera le forze!"); }
    // THEFT BALL: bottino esclusivo dei team cattivi (più forte = più ball)
    if (game.enemy.evil) {
      // quantità dal RANGO dell'avversario: recluta 1 · admin 2 · boss 4
      game.pendingTheft = game.evilRank === "boss" ? 4 : game.evilRank === "admin" ? 2 : 1;
      messages.push(`🕶 Tra le cose di ${game.enemy.trainer} c'è un bottino speciale…`);
    }
    const wasTrainer = !!game.enemy.trainer;
    // premi fissi della run (Espamuleti sulle x10, Monetamuleto a 50/100/150)
    premiFissi(game.wave, messages);
    /* Il Rivale non dà oggetti in mano: rende RICCA la scelta premi che segue
       (vedi TIER_PREMI_RIVALE). Qui si segna a che incontro siamo. */
    if (game.trainerIsRival) {
      const tappa = RIVAL_WAVES.indexOf(game.wave) + 1;
      if (tappa > 1) {
        game.rivalBattuto = tappa;
        stessoMomento(messages, "🎁 Ti lascia degli strumenti prima di andarsene…");
      }
    }
    // prima le EVOLUZIONI (con la loro animazione), poi le mosse da imparare
    queueMessages(messages, () => { hideTrainerPortrait(); processEvos(() => processHatches(() => processLearns(() => {
      /* ULTIMA BALL (una sola) sul SELVATICO sconfitto e non gia' catturato.
         [ATTENZIONE] Prima c era anche !wasBoss, e cosi i Pokemon delle ondate
         multiple di 10 non la offrivano mai: sono proprio quelli che uno vuole
         prendere. Non c era una ragione dietro - durante la lotta erano gia
         catturabili (ballBlockReason blocca solo gli allenatori), quindi
         mancava soltanto il tiro di cortesia alla fine.
         I capipalestra restano fuori da soli: i loro Pokemon hanno .trainer,
         quindi li ferma wasTrainer. Il boss finale non arriva nemmeno qui: a
         200 la run finisce prima, con renderRunVictory. */
      if (!wasTrainer && !game.capturedThisWave) { offerCapture(); return; }
      // allenatore (NON il Rivale): con una Clepto Ball puoi rubargli un Pokémon
      if (wasTrainer && !game.trainerIsRival && (game.theftballs || 0) > 0 && game.trainerRoster.length) { offerSteal(); return; }
      openShop();
    }))); });
  }

  function gameOver(reason) {
    game.phase = "GAMEOVER";
    cancellaSlot(game.slot);      // la run è finita: lo slot torna libero (§26)
    clearTimeout(game.timer);
    renderScene();
    renderGameOver(reason);
  }

  /* ---------------- Cattura (formula Gen 6 di PokeRogue) ----------------
     Come nei giochi veri: contano gli HP CORRENTI e lo stato. Indebolire e
     addormentare l'avversario alza molto le probabilità.
     `useHp` forza un valore (a fine lotta il selvatico è ormai a 1 HP). */
  const STATUS_CATCH = { POISON: 1.5, PARALYSIS: 1.5, BURN: 1.5, SLEEP: 2.5, FREEZE: 2.5 };
  function modifiedCatchRate(enemy, ballMult, useHp) {
    const maxHp = enemy.maxHp, hp = useHp != null ? useHp : Math.max(1, enemy.hp);
    const catchRate = (S[enemy.speciesId] && S[enemy.speciesId].catchRate) || 45;
    const statusMult = enemy.status ? (STATUS_CATCH[enemy.status] || 1) : 1;
    // il boss finale è catturabile ma molto resistente (metà probabilità)
    const bossMult = enemy.finalBoss ? 0.5 : 1;
    const mcr = Math.round((((3 * maxHp - 2 * hp) * catchRate * (ballMult || 1)) / (3 * maxHp)) * statusMult * bossMult);
    return Math.min(255, Math.max(1, mcr));
  }
  function shakeProb(mcr) { return Math.round(65536 / Math.pow(255 / mcr, 0.1875)); }
  function captureChancePct(enemy, ballMult, useHp) {
    const p = shakeProb(modifiedCatchRate(enemy, ballMult, useHp)) / 65536;
    return Math.max(1, Math.min(100, Math.round(Math.pow(Math.min(1, p), 4) * 100)));
  }
  /* Tira la cattura E dice QUANTE scosse ha retto la ball: serve
     all'animazione, che deve dondolare esattamente quelle volte prima di
     aprirsi (o di chiudersi con lo scatto). */
  function rollCaptureDettaglio(enemy, ballMult, useHp) {
    const p = shakeProb(modifiedCatchRate(enemy, ballMult, useHp));
    // CATTURA CRITICA (esiste nell'originale): una sola scossa invece di quattro.
    // Il Catturamuleto la rende piu' probabile.
    const critPct = Math.min(0.25, 0.05 * ((game.charms && game.charms.catching) || 0));
    const critica = !!(critPct && Math.random() < critPct);
    const totale = critica ? 1 : 4;
    for (let i = 0; i < totale; i++) {
      if (Math.random() * 65536 >= p) return { preso: false, scosse: i, critica };
    }
    return { preso: true, scosse: totale, critica };
  }
  function rollCapture(enemy, ballMult, useHp) {
    return rollCaptureDettaglio(enemy, ballMult, useHp).preso;
  }

  /* ======================================================================
     ANIMAZIONE DEL LANCIO — la ball vola, risucchia, cade, DONDOLA, e poi
     o scatta chiusa o si apre e lascia libero il Pokemon.
     Il numero di dondolii NON e' decorativo: e' quello vero uscito dal tiro
     (`rollCaptureDettaglio`), come nei giochi. Una ball che dondola tre volte
     e poi si apre e' un'informazione, non un effetto.
     ⚠️ Vive sopra la scena ma SOTTO gli overlay meta (z-index 20).
     ====================================================================== */
  const BALL_IMG_KEY = { balls: "pb", greatballs: "gb", ultraballs: "ub", rogueballs: "rb", theftballs: "tb", masterballs: "mb" };

  /* Toglie dal campo la ball rimasta dopo una cattura riuscita e rimette a
     posto lo sprite avversario (che era stato "risucchiato"). Va chiamata
     quando entra un nuovo avversario o comincia una nuova ondata. */
  function pulisciBallScena() {
    document.querySelectorAll(".ball-lancio").forEach(b => b.remove());
    const s = document.getElementById("enemy-sprite");
    if (s) { s.style.transition = ""; s.style.transform = ""; s.style.opacity = ""; }
  }

  /* ======================================================================
     RITIRO E USCITA DALLA BALL

     Versione ridotta di `animaBall`: niente volo e niente dondolii — quelli
     raccontano un TIRO, e qui non si sta catturando nessuno. Restano il lampo
     della ball che si apre e il Pokemon che rientra (si rimpicciolisce) o esce
     (si materializza).

     ⚠️ Chi e' rientrato deve RESTARE invisibile anche se la scena si ridisegna:
     fra il richiamo e la riemissione, davanti a un allenatore, passano tutte le
     frasi della sfida e ognuna chiama `renderScene`. Per questo la sparizione
     non e' solo una `opacity` inline ma uno stato, `dentroLaBall`, riapplicato
     a ogni ridisegno da `applicaDentroLaBall()`.
     ====================================================================== */
  const SPRITE_SEL = { player: "#player-sprite", enemy: "#enemy-sprite",
                       player2: "#player2-sprite", enemy2: "#enemy2-sprite" };
  const dentroLaBall = new Set();      // slot il cui Pokemon e' dentro la ball
  let ballSlotTimers = [];
  let ballSlotFine = null;             // "concludi subito" dell'animazione in corso

  function applicaDentroLaBall() {
    for (const lato in SPRITE_SEL) {
      const el = document.querySelector(SPRITE_SEL[lato]);
      if (el) el.style.visibility = dentroLaBall.has(lato) ? "hidden" : "";
    }
  }
  /* Rimette in campo tutti: rete di sicurezza a inizio ondata, o un'animazione
     interrotta a meta' lascerebbe un Pokemon invisibile per sempre. */
  function liberaDallaBall() { dentroLaBall.clear(); applicaDentroLaBall(); }

  /* Chiude di colpo l'animazione in corso, applicandone lo stato finale.
     Serve quando si tocca per passare al messaggio dopo mentre e' a meta'. */
  function chiudiBallSlot() {
    ballSlotTimers.forEach(clearTimeout); ballSlotTimers = [];
    const f = ballSlotFine; ballSlotFine = null;
    if (f) f();
  }

  // verso: "ritiro" (rientra nella ball) | "uscita" (ne esce). Torna la durata.
  function animaBallSlot(verso, lato, onDone) {
    chiudiBallSlot();                       // mai due sovrapposte
    const scena = document.getElementById("scene");
    const sprite = document.querySelector(SPRITE_SEL[lato] || "#nessuno");
    const esce = verso === "uscita";
    let chiamata = onDone;
    // stato finale: vale sia a fine animazione sia se si tocca per saltarla
    const concludi = () => {
      if (sprite) {
        sprite.style.transition = "";
        sprite.style.transform = esce ? "" : "scale(.05)";
        sprite.style.opacity = esce ? "" : "0";
      }
      document.querySelectorAll(".ball-slot").forEach(b => b.remove());
      if (esce) dentroLaBall.delete(lato); else dentroLaBall.add(lato);
      applicaDentroLaBall();
      const cb = chiamata; chiamata = null;
      if (cb) cb();
    };
    const rs = scena && scena.getBoundingClientRect();
    const rb = sprite && sprite.getBoundingClientRect();
    if (!scena || !sprite || !rb.width || !rb.height) { concludi(); return 0; }

    const ball = document.createElement("div");
    ball.className = "ball-lancio ball-slot";
    ball.style.backgroundImage = `url('${ballIcon("pb")}')`;
    ball.style.left = (rb.left - rs.left + rb.width / 2) + "px";
    ball.style.top = (rb.top - rs.top + rb.height / 2) + "px";
    scena.appendChild(ball);
    ball.classList.add("aperta");           // il lampo: si apre in entrambi i versi
    sprite.style.transformOrigin = "center bottom";

    /* ⚠️ Niente `requestAnimationFrame` qui: nel pannello del browser a volte
       non scatta (§24). Con un timer breve la transizione parte comunque, e in
       ogni caso `concludi` mette lo stato finale anche se non partisse. */
    const dopo = (ms, fn) => ballSlotTimers.push(setTimeout(fn, ms));
    ballSlotFine = concludi;

    if (esce) {
      dentroLaBall.delete(lato);
      sprite.style.visibility = "";
      sprite.style.transition = "";
      sprite.style.transform = "scale(.05)";
      sprite.style.opacity = "0";
      dopo(20, () => {
        sprite.style.transition = "transform .34s cubic-bezier(.2,1.5,.5,1), opacity .22s ease-out";
        sprite.style.transform = "";
        sprite.style.opacity = "1";
      });
      dopo(300, () => ball.remove());
      dopo(400, concludi);
      return 420;
    }
    sprite.style.transition = "transform .3s ease-in, opacity .3s ease-in";
    dopo(20, () => { sprite.style.transform = "scale(.05)"; sprite.style.opacity = "0"; });
    dopo(340, () => ball.classList.remove("aperta"));
    dopo(420, () => ball.remove());
    dopo(440, concludi);
    return 460;
  }
  function animaBall(ballKey, esito, onDone) {
    const scena = document.getElementById("scene");
    const bersaglio = document.getElementById("enemy-sprite");
    if (!scena || !bersaglio) { onDone(); return; }
    const rs = scena.getBoundingClientRect();
    let rb = bersaglio.getBoundingClientRect();
    /* ⚠️ L'ULTIMA BALL si lancia su un Pokemon gia' a terra: il suo sprite puo'
       essere azzerato. In quel caso si mira alla PEDANA avversaria, se no la
       ball volerebbe nell'angolo in alto a sinistra. */
    if (!rb.width || !rb.height) {
      const slot = document.querySelector(".battler-slot.enemy");
      rb = slot ? slot.getBoundingClientRect() : rb;
    }
    const ax = (rb.width ? rb.left - rs.left + rb.width / 2 : rs.width * 0.72);
    const ay = (rb.height ? rb.top - rs.top + rb.height / 2 : rs.height * 0.35);
    // parte dal basso a sinistra, da dove sta il tuo Pokemon
    const px = rs.width * 0.18, py = rs.height * 0.82;

    const ball = document.createElement("div");
    ball.className = "ball-lancio";
    ball.style.backgroundImage = `url('${ballIcon(BALL_IMG_KEY[ballKey] || "pb")}')`;
    ball.style.left = px + "px";
    ball.style.top = py + "px";
    scena.appendChild(ball);

    /* ⚠️ Ripulire SEMPRE lo sprite: se restasse `scale(.05)`/`opacity:0` per
       un'interruzione, il Pokemon avversario sparirebbe dal campo e non
       tornerebbe piu'. Chi ha vinto lo toglie di scena per conto suo. */
    /* ⚠️ A CATTURA RIUSCITA la ball chiusa RESTA in campo e il Pokemon resta
       dentro: se togliessimo la ball e il Pokemon insieme, il campo tornerebbe
       vuoto e sembrerebbe scappato. La si toglie quando entra il prossimo
       avversario (`pulisciBallScena`, chiamata da `deployEnemy` e `nextWave`).
       A cattura FALLITA invece si rimette tutto a posto: il Pokemon riappare. */
    const finisci = () => {
      if (esito.preso) { ball.classList.add("rimane"); onDone(); return; }
      ball.remove();
      bersaglio.style.transition = "";
      bersaglio.style.transform = "";
      bersaglio.style.opacity = "";
      onDone();
    };
    const dopo = (ms, fn) => setTimeout(fn, ms);

    // 1. volo ad arco fino al bersaglio
    requestAnimationFrame(() => {
      ball.style.transition = "left .45s linear, top .45s cubic-bezier(.2,-.6,.6,1)";
      ball.style.left = ax + "px";
      ball.style.top = ay + "px";
    });
    dopo(470, () => {
      // 2. risucchio: il Pokemon si rimpicciolisce dentro la ball
      ball.classList.add("aperta");
      bersaglio.style.transition = "transform .28s ease-in, opacity .28s ease-in";
      bersaglio.style.transformOrigin = "center";
      bersaglio.style.transform = "scale(.05)";
      bersaglio.style.opacity = "0";
      dopo(300, () => {
        ball.classList.remove("aperta");
        // 3. la ball cade a terra
        ball.style.transition = "top .3s cubic-bezier(.5,0,.9,.6)";
        ball.style.top = (ay + rs.height * 0.10) + "px";
        dopo(320, () => {
          /* 4. I DONDOLII — è qui che sta la suspense.
             Il numero è quello vero uscito dal tiro, e varia già parecchio
             (misurato su un selvatico a piena vita: 34% zero · 26% uno ·
             22% due · 18% tre). Ma a schermo non si sentiva, per due motivi:
             la ball si apriva SUBITO quando le scosse erano zero, e tutte le
             oscillazioni erano identiche, così due o tre si somigliavano.

             Ora, come nell'originale (`shakeCounter` con `repeatDelay: 500`
             in `attempt-capture-phase.ts`): c'è un BEAT di attesa prima del
             primo controllo — anche il fallimento immediato ha il suo momento
             di sospensione — e più la ball ha dondolato più il verdetto si fa
             aspettare.

             🔴 LE OSCILLAZIONI DEVONO ESSERE CONTABILI.
             Erano pensate per CRESCERE: la prima piccola e lenta (15° in
             380ms), l'ultima larga. Sulla carta è tensione; a schermo era il
             difetto, perche' rendeva illeggibile proprio il caso piu' comune.
             Una scossa sola era un'ondeggiata appena accennata: chi guardava
             leggeva «non si è mossa», cioe' zero. E due scosse lente si
             confondevano con tre. Restavano due sole letture: «si apre
             subito» e «dondola un po' di volte».
             Nell'originale ogni scossa è invece un COLPO SECCO, uguale agli
             altri e staccato dal successivo da mezzo secondo di immobilita':
             e' la pausa che le rende numerabili, non l'ampiezza.
             Adesso: tutte larghe, tutte rapide, tutte separate. */
          const AMPIEZZA = [26, 28, 30, 32];   // gradi: gia' la prima si vede
          const DURATA   = [330, 340, 360, 380];   // colpo secco, non ondeggio
          const PAUSA    = 300;                    // il vuoto che separa una scossa dall'altra
          let n = 0;
          const dondola = () => {
            if (n >= esito.scosse) return attesaVerdetto();
            const amp = AMPIEZZA[Math.min(n, AMPIEZZA.length - 1)];
            const dur = DURATA[Math.min(n, DURATA.length - 1)];
            n++;
            ball.style.setProperty("--dondolo-amp", amp + "deg");
            ball.style.setProperty("--dondolo-dur", dur + "ms");
            ball.classList.add("dondola");
            dopo(dur, () => { ball.classList.remove("dondola"); dopo(PAUSA, dondola); });
          };
          /* Il silenzio prima del verdetto: cresce con le scosse. Una ball che
             si è fermata dopo la terza tiene col fiato sospeso; una che non ha
             dondolato affatto va liquidata in fretta. */
          /* ⚠️ Anche lo ZERO ha bisogno del suo tempo: se la ball si apre appena
             toccata terra non si legge «non ha resistito nemmeno una volta», si
             legge un difetto. Un attimo di immobilita' prima — lo stesso vuoto
             che separa due scosse — e la lettura arriva. */
          const attesaVerdetto = () => dopo((n ? 240 : PAUSA + 120) + 150 * n, chiusura);
          const chiusura = () => {
            if (esito.preso) {
              // scatto: la ball si chiude e lampeggia
              ball.classList.add("presa");
              dopo(650, finisci);
            } else {
              // si apre e il Pokemon torna fuori
              ball.classList.add("aperta");
              bersaglio.style.transition = "transform .3s ease-out, opacity .3s ease-out";
              bersaglio.style.transform = "";
              bersaglio.style.opacity = "1";
              dopo(420, finisci);
            }
          };
          dondola();
        });
      });
    });
  }

  const BALL_TYPES = [
    { key: "balls",       it: "Poké Ball",  mult: 1 },
    { key: "greatballs",  it: "Mega Ball",  mult: 1.5 },
    { key: "ultraballs",  it: "Ultra Ball", mult: 2 },
    { key: "rogueballs",  it: "Rogue Ball", mult: 3 },
    /* Clepto Ball: e' il nome ITALIANO UFFICIALE della Snag Ball, quella dei
       giochi GameCube (Pokemon Colosseum e XD), dove serviva proprio a rubare i
       Pokemon agli allenatori. Nella stessa famiglia stanno il Team Clepto
       (Team Snagem) e la Cleptatrice (Snag Machine).
       ⚠️ La chiave interna resta `theftballs`: sta dentro i salvataggi. */
    { key: "theftballs",  it: "Clepto Ball", mult: 2, theft: true },
    { key: "masterballs", it: "Master Ball", mult: 255 },
  ];
  function totalBalls() { return BALL_TYPES.reduce((s, b) => s + (game[b.key] || 0), 0); }

  /* ---- FURTO con Clepto Ball: scegli un Pokémon della squadra avversaria ----
     Meccanica esclusiva di questo gioco: nell'originale i Pokémon degli
     allenatori NON sono catturabili. Probabilità come Ultra Ball (x2), il
     Rivale è immune. */
  function offerSteal() {
    game.phase = "STEAL";
    clearTimeout(game.timer);
    const roster = game.trainerRoster.filter(m => !S[m.speciesId].noSprite);
    const rows = roster.map((m, i) => {
      const pct = captureChancePct(m, 2, 1);
      return `<button class="me-opt" data-i="${i}">
        <span class="me-opt-l">${miniIcon(m.dex, 1.1)}${m.name} Lv.${m.level}</span>
        <span class="me-opt-s">${m.types.map(t => T[t].it).join("/")} · riuscita ~${pct}%</span></button>`;
    }).join("");
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,29px)">🕶 Furto</div>
      <div class="me-text">Hai <b>${game.theftballs}</b> Clepto Ball. Quale Pokémon rubi a ${game.trainerName}?</div>
      <div class="me-opts">${rows}
        <button class="me-opt" data-act="skip"><span class="me-opt-l">Lascia stare</span></button></div>`);
    metaEl().querySelectorAll(".me-opt[data-i]").forEach(b => b.onclick = () => {
      const m = roster[parseInt(b.dataset.i, 10)];
      game.theftballs--;
      hideMeta();
      /* 🔴 Il furto si LEGGEVA soltanto: nessun lancio, nessun dondolio.
         E' l'unico modo di rubare un Pokemon a un allenatore, e passava come
         una riga di testo. Adesso il derubato torna in campo e la ball vola
         addosso a lui, con le scosse che ha retto davvero — la stessa
         animazione dell'ultima ball. */
      const esito = rollCaptureDettaglio(m, 2, 1);
      const caught = esito.preso;
      game.enemy = m;                       // torna in campo per farsi vedere
      m.spr = null;
      loadFighterSprite(m, "front").then(sp => { m.spr = sp; redrawScene(); });
      renderScene();
      const msgs = [`Lanci una Clepto Ball su ${m.name}…`];
      if (caught) {
        const mon = makeFighter(m.speciesId, m.level, { shiny: m.shiny, shinyVar: m.shinyVar, ivs: m.ivs, variant: m.variant, abilIndex: m.abilIndex, gender: m.gender });
        ereditaPs(mon, m);
        accogliPokemon(mon, msgs, "🕶 Rubato!");
        registerCaught(m.speciesId, m.shiny, m.ivs, msgs, m.variant, m.abilIndex, m.nature, m.shinyVar, m.gender, m.boss);
      } else msgs.push(`${m.name} è sfuggito alla Clepto Ball!`);
      game.phase = "MESSAGE";
      cmd().innerHTML = `<div class="msgbox"><div class="log-line">Lanci una Clepto Ball su ${m.name}…</div></div>`;
      animaBall("theftballs", esito, () => {
        renderScene();
        queueMessages(msgs, () => chiediPostoInSquadra(() => openShop()));
      });
    });
    metaEl().querySelector('[data-act="skip"]').onclick = () => { hideMeta(); openShop(); };
  }

  /* ======================================================================
     ARRIVO IN SQUADRA — con la squadra piena si SCEGLIE

     Prima il Pokemon appena preso finiva d'ufficio nel box e non c'era modo
     di metterlo in campo senza aspettare. Ora, se i sei posti sono occupati,
     dopo la narrazione si apre una schermata: chi cede il posto? Il
     sostituito va al PC (il box), non si perde.
     ⚠️ La scelta NON puo' avvenire subito: siamo dentro la costruzione dei
     messaggi. Si mette da parte in `game.nuovoArrivato` e la si fa dopo, con
     `chiediPostoInSquadra`, che va infilata nella continuazione.
     ====================================================================== */
  /* I PS di chi entra nella ball se li porta dietro. ⚠️ Si passa dalla
     FRAZIONE e non dal numero: l'esemplare che entra in squadra viene ricreato
     da zero (per non trascinarsi stadi, volatili e la bandierina "e' di un
     allenatore"), e un boss ha i PS moltiplicati — copiare il numero crudo
     darebbe un pieno o un quasi-morto a caso. Mai sotto 1: nella ball ci e'
     entrato vivo. */
  function ereditaPs(mon, da) {
    if (!mon || !da || !da.maxHp) return;
    mon.hp = Math.max(1, Math.min(mon.maxHp, Math.round(mon.maxHp * (da.hp / da.maxHp))));
  }

  function accogliPokemon(mon, msgs, preso) {
    if (game.party.length < PARTY_MAX) {
      game.party.push(mon);
      msgs.push(`${preso} ${mon.name} si unisce alla squadra!`);
      return;
    }
    game.nuovoArrivato = mon;
    msgs.push(`${preso} ${mon.name}! Ma hai già sei Pokémon con te…`);
  }

  /* Schermata di scelta. Se non c'e' nessun arrivato, prosegue e basta. */
  function chiediPostoInSquadra(poi) {
    const mon = game.nuovoArrivato;
    if (!mon) { poi(); return; }
    game.nuovoArrivato = null;
    const cards = game.party.map((p, i) => {
      const ratio = Math.max(0, p.hp / p.maxHp);
      const col = ratio > 0.5 ? "var(--hp-green)" : ratio > 0.2 ? "var(--hp-yellow)" : "var(--hp-red)";
      const types = p.types.map(t => `<span class="ticon t-${t}"></span>`).join("");
      return `<button class="pd-card sceglibile ${p.fainted ? "ko" : ""}" data-i="${i}">
          <div class="pd-top"><span class="pd-name">${miniIcon(p.dex, 1.1)}${p.shiny ? cromStella(p.shinyVar) : ""}${p.name.replace("✨", "")}</span><span class="pd-lv">Lv.${p.level}</span></div>
          <div class="pd-types">${types}${p.ability ? `<span class="pd-ab">${p.ability.it}</span>` : ""}</div>
          <div class="party-hp-track"><div class="party-hp-fill" style="width:${ratio * 100}%;background:${col};"></div></div>
          <div class="pd-hp">${Math.max(0, p.hp)}/${p.maxHp} PS</div>
        </button>`;
    }).join("");
    /* 🔴 Si sceglieva chi buttare fuori senza poter guardare chi ENTRA:
       solo il nome e il livello. Adesso c'e' la sua scheda in cima — sprite,
       tipi, abilita', natura e IV — perche' e' l'informazione che serve per
       decidere, ed era l'unica che mancava. */
    const tipiN = mon.types.map(t => `<span class="ticon t-${t}"></span>`).join("");
    const chipIvN = (mon.ivs ? IV_KEYS.filter(k => (mon.ivs[k] || 0) === IV_MAX) : [])
      .map(k => `<span class="iv-chip perfetto">${IV_SIGLA[k]}★</span>`).join("");
    const arrivato = `<div class="pd-card arrivato">
        <div class="pd-top">
          <span class="pd-name">${miniIcon(mon.dex, 1.5)}${mon.shiny ? cromStella(mon.shinyVar) : ""}${mon.name.replace("✨", "")}</span>
          <span class="pd-lv">Lv.${mon.level}</span>
        </div>
        <div class="pd-types">${tipiN}
          ${mon.ability ? `<span class="pd-ab">${mon.ability.it}</span>` : ""}
          ${mon.nature ? `<span class="pd-ab pd-nat">${natureLabel(mon)}</span>` : ""}
        </div>
        <div class="pd-types">${mon.moves.map(m => `<span class="pd-ab">${M[m.id].it}</span>`).join("")}</div>
        ${chipIvN ? `<div class="iv-badges">${chipIvN}</div>` : ""}
      </div>`;
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">Squadra al completo</div>
      <div class="meta-sub">è arrivato <b>${mon.name}</b>: chi gli cede il posto? Chi esce va al PC.</div>
      ${arrivato}
      <div class="meta-sub" style="margin:.6vh 0">la tua squadra</div>
      <div class="pd-list">${cards}</div>
      <div class="meta-actions"><button class="meta-btn ghost" data-act="pc">📦 Manda ${mon.name} al PC</button></div>`);
    const chiudi = (testo) => { hideMeta(); queueMessages([testo], poi); };
    metaEl().querySelectorAll(".pd-card[data-i]").forEach(b => b.onclick = () => {
      const i = parseInt(b.dataset.i, 10);
      const uscito = game.party[i];
      game.box.push(uscito);
      game.party[i] = mon;
      // se se n'e' andato quello in campo, scende subito il nuovo
      if (game.active === i) setActive(i);
      renderScene();
      chiudi(`${uscito.name} va al PC. ${mon.name} prende il suo posto!`);
    });
    metaEl().querySelector('[data-act="pc"]').onclick = () => {
      game.box.push(mon);
      chiudi(`${mon.name} è stato trasferito al PC.`);
    };
  }

  /* 🔴 QUANTE CARAMELLE. Prima era sempre +1 a cattura e +3 a schiusa, a
     prescindere da tutto. Nell'originale (`setPokemonSpeciesCaught`) la
     formula è `shinyBonus × eggOrBossBonus`:
       · normale                 → 1
       · CROMATICO                → 5, e la livrea raddoppia: 5 / 10 / 20
       · da UOVO o da BOSS        → ×2
     Quindi un cromatico epico da uovo vale 40 caramelle, non 3. È proprio
     quello che rende sensato dare la caccia ai cromatici invece di trattarli
     come una figurina.
     ⚠️ La schiusa normale scende da 3 a 2: leggermente meno di prima, ma
     tutto il resto sale moltissimo. */
  function caramelleDa(shiny, shinyVar, daUovoOBoss) {
    const bonusCrom = shiny ? 5 * Math.pow(2, shinyVar || 0) : 1;
    return bonusCrom * (daUovoOBoss ? 2 : 1);
  }
  function daiCaramelle(speciesId, quante, messages, coda) {
    meta.candy = meta.candy || {};
    meta.candy[speciesId] = (meta.candy[speciesId] || 0) + quante;
    const riga = `🍬 +${quante} Caramell${quante === 1 ? "a" : "e"} ${S[speciesId].it} (totale ${meta.candy[speciesId]})`;
    if (coda) coda.push(riga);
    else if (messages) stessoMomento(messages, riga);
    return quante;
  }

  // Registra una specie catturata nel meta: starter sbloccato, caramella, IV migliori.
  /* ⚠️ `variant` qui è la FORMA (Unown-B, Rotom Lavaggio…), `shinyVar` è la
     LIVREA cromatica. Due cose diverse con nomi vicini: attenzione. */
  function registerCaught(speciesId, shiny, ivs, messages, variant, abilIndex, nature, shinyVar, gender, boss) {
    if (variant && registerForm(S[speciesId].dex, variant) && messages) {
      const tot = collectableForms(speciesId);
      const got = Object.keys(meta.formsSeen[S[speciesId].dex]).length;
      messages.push(`🦋 Nuova forma: ${formNameOf(speciesId, variant)} (${got}/${tot} di ${S[speciesId].it})`);
    }
    const val = shiny ? 2 : 1;
    /* ⚠️ Cosa è DAVVERO nuovo va deciso prima di scrivere nel dex: altrimenti
       si annuncia «registrato nel dex!» anche alla decima cattura della stessa
       specie. Chi ce l'ha già deve sentirsi dire solo cosa ha guadagnato
       (caramelle, IV, abilità, natura). */
    const specieNuova = val > (meta.unlocked[speciesId] || 0);
    if (specieNuova) meta.unlocked[speciesId] = val;
    /* ...ma quello che si SCHIERA è il capostipite: prendendo un Venusaur si
       sblocca Bulbasaur, prendendone uno cromatico si sblocca Bulbasaur
       cromatico. Senza questo, catturare un evoluto non darebbe più nulla
       (gli evoluti non sono schierabili). */
    const root = rootOf(speciesId);
    const eraStarter = giaStarter(root);              // prima di scrivere!
    const eraCromatico = (meta.unlocked[root] || 0) >= 2;
    if (val > (meta.unlocked[root] || 0)) {
      meta.unlocked[root] = val;
      if (!eraStarter) {
        messages.push(root === speciesId
          ? `📖 ${S[root].it}${shiny ? " ✨" : ""} sbloccato come starter!`
          : `📖 ${S[speciesId].it}${shiny ? " ✨" : ""} nel dex — sbloccato ${S[root].it}${shiny ? " ✨" : ""} come starter!`);
      } else if (shiny && !eraCromatico) {
        // lo starter c'era gia': di nuovo c'e' solo la livrea
        messages.push(`✨ Primo ${S[root].it} cromatico: ora lo puoi schierare così!`);
      }
    } else if (specieNuova && root !== speciesId) {
      // il capostipite c'era già, ma questa forma evoluta no: vale dirlo
      messages.push(`📖 ${S[speciesId].it}${shiny ? " ✨" : ""} registrato nel dex!`);
    }
    /* LIVREA cromatica: si tiene la più alta mai vista, sulla specie E sul
       capostipite. È quella del capostipite a dare i punti di fortuna allo
       starter, quindi è quella che vale la pena annunciare. */
    if (shiny) {
      meta.shinyVar = meta.shinyVar || {};
      const sv = shinyVar || 0;
      if (sv > (meta.shinyVar[speciesId] || 0)) meta.shinyVar[speciesId] = sv;
      if (sv > (meta.shinyVar[root] || 0)) {
        meta.shinyVar[root] = sv;
        if (sv > 0) messages.push(`💠 Livrea ${CROM_IT[sv]} di ${S[root].it}: come starter ora vale ${sv + 1} punti di fortuna`);
      }
    }
    daiCaramelle(speciesId, caramelleDa(shiny, shinyVar, boss), messages);
    if (recordIVs(speciesId, ivs)) stessoMomento(messages, `📈 Nuovi IV migliori per ${S[speciesId].it}!`);
    /* L'abilità che AVEVA questo esemplare si sblocca per la specie: da qui in
       poi la puoi scegliere quando lo schieri come starter. La nascosta capita
       1 volta su 256, quindi vale la pena dirlo forte. */
    if (abilIndex != null) {
      const nuova = registraAbilita(rootOf(speciesId), abilIndex);
      if (nuova && messages) {
        stessoMomento(messages, nuova.nascosta
          ? `🔓✨ Abilità NASCOSTA sbloccata per ${S[rootOf(speciesId)].it}: ${nuova.it}!`
          : `🔓 Nuova abilità sbloccata per ${S[rootOf(speciesId)].it}: ${nuova.it}`);
      }
    }
    /* Anche la NATURA di questo esemplare entra nel dex: da qui in poi la puoi
       scegliere quando schieri quella specie. Come per l'abilità si registra
       sul CAPOSTIPITE, che è quello che si schiera. */
    const natNuova = registraNatura(rootOf(speciesId), nature);
    if (natNuova && messages) {
      stessoMomento(messages, `🌱 Nuova natura sbloccata per ${S[rootOf(speciesId)].it}: ${natNuova}`);
    }
    /* E il SESSO. Anche questo sul capostipite: prendere una Vespiquen (femmina
       al 100%) è il modo di sbloccare la Combee femmina, che è l'unica che poi
       ci evolve. */
    const sesNuovo = registraSesso(rootOf(speciesId), gender);
    if (sesNuovo && messages) {
      stessoMomento(messages, `${gender === "MALE" ? "♂" : "♀"} Ora puoi schierare ${S[rootOf(speciesId)].it} ${sesNuovo}`);
    }
    saveMeta();
  }

  function offerCapture() {
    if (totalBalls() <= 0) { openShop(); return; } // nessuna ball → salta
    game.phase = "CAPTURE";
    renderCaptureScreen();
  }

  /* PS da usare per l'ULTIMA BALL di fine lotta.
     ⚠️ Prima si passava 1, cioe' il minimo assoluto: e' il valore che da' il
     BONUS MASSIMO della formula, quindi una Poke Ball su una specie comune
     arrivava vicino al 100% e si comportava da Master Ball. Rendeva inutile
     tutto il resto (indebolire, addormentare, lanciare durante la lotta).
     Ora l'ultima occasione si calcola come se il Pokemon fosse INTEGRO: e' un
     ripiego, non una scorciatoia. Chi vuole le probabilita' alte deve
     catturarlo durante la lotta, indebolito e addormentato. */
  const psUltimaBall = (enemy) => enemy.maxHp;

  function attemptCapture(ballKey) {
    const ball = BALL_TYPES.find(b => b.key === ballKey);
    if (!ball || (game[ballKey] || 0) <= 0) return;
    game[ballKey]--;
    const enemy = game.enemy;
    const esito = ball.mult >= 255
      ? { preso: true, scosse: 1, critica: true }
      : rollCaptureDettaglio(enemy, ball.mult, psUltimaBall(enemy));
    // stessa animazione del lancio in battaglia (§ dondolio)
    game.phase = "MESSAGE";
    cmd().innerHTML = `<div class="msgbox"><div class="log-line">Lanci una ${ball.it} su ${enemy.name}…</div></div>`;
    animaBall(ballKey, esito, () => risolviUltimaBall(enemy, esito.preso));
  }

  function risolviUltimaBall(enemy, caught) {
    const messages = [];
    if (caught) {
      const mon = makeFighter(enemy.speciesId, enemy.level, { shiny: enemy.shiny, shinyVar: enemy.shinyVar, ivs: enemy.ivs, variant: enemy.variant, abilIndex: enemy.abilIndex, gender: enemy.gender });
      ereditaPs(mon, enemy);        // i PS che aveva quando la ball si e' chiusa
      accogliPokemon(mon, messages, "Preso!");
      // meta-progressione: starter sbloccato + caramella + IV migliori
      registerCaught(enemy.speciesId, enemy.shiny, enemy.ivs, messages, enemy.variant, enemy.abilIndex, enemy.nature, enemy.shinyVar, enemy.gender, enemy.boss);
    } else {
      messages.push(`Oh no! ${enemy.name} si è liberato!`);
    }
    queueMessages(messages, () => chiediPostoInSquadra(() => openShop()));
  }

  // Estrae frame 0 + dimensioni foglio da un atlas, gestendo i due formati
  // TexturePacker presenti negli asset: { textures:[...] } e { frames, meta }.
  function atlasFrame0(atlas) {
    let frames, size;
    if (atlas.textures) { frames = atlas.textures[0].frames; size = atlas.textures[0].size; }
    else { frames = atlas.frames; size = atlas.meta && atlas.meta.size; }
    const f0 = Array.isArray(frames) ? frames[0] : frames[Object.keys(frames)[0]];
    return { frame: f0.frame, size };
  }

  // Carica l'atlas e ne ricava il frame 0 (posa statica) per il ritaglio CSS.
  // shiny=true usa gli sprite shiny reali di PokeRogue.
  const spriteCache = {};
  /* `femmina` = usa lo sprite femminile dedicato (solo per le 98 specie che
     nell'originale hanno `genderDiffs`). */
  /* Prova una cartella sola. Torna null se lì lo sprite non c'è. */
  /* Misura VERA di un PNG (larghezza x altezza in pixel), una volta sola. */
  const pngMisure = {};
  function misuraPng(src) {
    if (pngMisure[src]) return pngMisure[src];
    return (pngMisure[src] = new Promise(res => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res(null);
      im.src = src;
    }));
  }

  function loadSpriteFrom(dir, name) {
    const key = dir + "/" + name;
    if (spriteCache[key] !== undefined) return Promise.resolve(spriteCache[key]);
    return fetch(`${dir}/${name}.json`)
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(atlas => {
        const { frame, size } = atlasFrame0(atlas);
        const sheet = `${dir}/${name}.png`;
        /* 🔴 La `size` scritta nell'ATLANTE non e' sempre quella vera del PNG:
           per 135 sprite su 3048 e' un quadrato di comodo (Yungoos dichiara
           61x61 ma il file e' 61x35). A Phaser non importa — indirizza i
           fotogrammi dentro la texture caricata — ma noi disegniamo con
           `background-size`, e con la misura sbagliata il browser STIRA
           l'immagine: si vedeva un Pokemon ingrandito e tagliato. Quindi la
           misura la prende dal file. Il caricamento non e' sprecato: scalda
           anche la cache del browser per l'immagine che stiamo per mostrare. */
        return misuraPng(sheet).then(vera => {
          const spr = { sheet, frame,
                        sheet_w: vera ? vera.w : size.w,
                        sheet_h: vera ? vera.h : size.h };
          spriteCache[key] = spr;
          return spr;
        });
      })
      // si ricorda anche i BUCHI: le forme che condividono lo sprite base
      // (Scatterbug, Pumpkaboo) sbagliano il primo tentativo a ogni incontro,
      // e senza questo si ripeterebbe la stessa 404 all'infinito.
      .catch(() => (spriteCache[key] = null));
  }
  /* Prima cartella che ha lo sprite, in ordine di preferenza. */
  function loadSpriteChain(dirs, name) {
    return dirs.reduce(
      (p, dir) => p.then(got => got || loadSpriteFrom(dir, name)),
      Promise.resolve(null));
  }
  /* ======================================================================
     LIVREE RARE ED EPICHE: come si disegnano (§33)

     Per la livrea COMUNE (0) non cambia niente: è il file della cartella
     `shiny/`, come da sempre. Per rara ed epica l'originale fa due cose
     diverse a seconda della specie (`pokemon-species.ts:410`):
       terna[v] === 2 → esiste un file dedicato, si carica e basta
       terna[v] === 1 → si prende lo sprite NORMALE e lo si RICOLORA con una
                        tabella colore→colore (lo shader di `sprite.ts:131`;
                        qui è un canvas, fatto una volta e tenuto in cache)
     Se la livrea non ha di che disegnarsi si torna alla cromatica classica —
     la stessa rete di sicurezza che ha `getSpriteId`.
     ====================================================================== */
  const cromChiave = (side, femmina) => (femmina ? "femmina/" : "") + side;
  const cromSheetCache = {};       // "front/25#1" -> Promise<spr|null>
  const cromDiagnosi = {};         // per la sonda __items.cromatico()

  function cromSprite(chiave, nome, sv) {
    const terna = CROMSET[`${chiave}/${nome}`];
    if (!terna) return Promise.resolve(null);
    const cacheKey = `${chiave}/${nome}#${sv}`;
    if (cromSheetCache[cacheKey] !== undefined) return cromSheetCache[cacheKey];
    const modo = terna[sv];
    let pr;
    if (modo === 2) {
      // file dedicato: è già della livrea giusta, si carica come ogni altro
      pr = loadSpriteFrom(`assets/pokemon/cromatico/${chiave}`, `${nome}_${sv + 1}`);
    } else if (modo === 1) {
      pr = cromColCarica().then(col => {
        const tab = col[`${chiave}/${nome}`];
        const mappa = tab && tab[String(sv)];
        if (!mappa) return null;
        // ⚠️ si ricolora il file NORMALE, non quello della cartella shiny
        return loadSpriteFrom(`assets/pokemon/${chiave}`, nome)
          .then(base => (base ? ricoloraSprite(base, mappa, cacheKey) : null));
      });
    } else {
      pr = Promise.resolve(null);    // livrea 0, o specie senza livree
    }
    cromSheetCache[cacheKey] = pr;
    return pr;
  }

  function ricoloraSprite(base, mappa, cacheKey) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          const cx = c.getContext("2d", { willReadFrequently: true });
          cx.drawImage(img, 0, 0);
          const d = cx.getImageData(0, 0, c.width, c.height), px = d.data;
          /* Indice intero r<<16|g<<8|b: un foglio di sprite ha ~200.000 pixel
             e confrontare stringhe esadecimali costerebbe decine di ms. */
          const tab = new Map();
          for (const da in mappa) tab.set(parseInt(da, 16), parseInt(mappa[da], 16));
          let toccati = 0;
          for (let i = 0; i < px.length; i += 4) {
            if (!px[i + 3]) continue;
            const v = tab.get((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
            if (v === undefined) continue;
            px[i] = (v >> 16) & 255; px[i + 1] = (v >> 8) & 255; px[i + 2] = v & 255;
            toccati++;
          }
          cromDiagnosi[cacheKey] = { colori: tab.size, pixel: toccati };
          /* ⚠️ Rete di sicurezza vera: se NESSUN pixel combacia, la tabella non
             sta parlando di questo file (o il browser ha applicato una
             correzione colore in fase di decodifica). Meglio la cromatica
             classica che un "cromatico" coi colori normali. */
          if (!toccati) return res(null);
          cx.putImageData(d, 0, 0);
          c.toBlob(b => res(b ? Object.assign({}, base, { sheet: URL.createObjectURL(b) }) : null));
        } catch (e) { console.warn("[cromatico] ricolore fallito:", e.message); res(null); }
      };
      img.onerror = () => res(null);
      img.src = base.sheet;
    });
  }

  function loadSprite(dex, side, shiny, femmina, shinyVar) {
    /* Catena di ripieghi, dal più giusto al meno peggio. L'ultimo anello serve
       a non mostrare MAI il segnaposto colorato: 4 specie (Koraidon, Miraidon,
       Poltchageist Autentica, Sinistcha Capolavoro) non hanno lo sprite
       cromatico nemmeno nell'originale, e il modello giusto coi colori normali
       è comunque meglio di un rettangolo tinta unita. */
    const classico = () => {
      const dirs = [];
      if (femmina && shiny) dirs.push(`assets/pokemon/femmina/shiny/${side}`);
      if (shiny) dirs.push(`assets/pokemon/shiny/${side}`);
      if (femmina) dirs.push(`assets/pokemon/femmina/${side}`);
      dirs.push(`assets/pokemon/${side}`);
      return loadSpriteChain(dirs, String(dex));
    };
    if (!shiny || !shinyVar) return classico();
    return cromSprite(cromChiave(side, femmina), String(dex), shinyVar).then(s => s || classico());
  }
  // Carica lo sprite giusto per un combattente: se ha una forma (estetica o di
  // battaglia) usa "<dex>-<forma>", altrimenti lo sprite base.
  function loadFighterSprite(f, side) {
    const form = f.formKey || f.variant;
    const sv = f.shiny ? (f.shinyVar || 0) : 0;
    const femmina = usaSpriteFemmina(f);
    const base = () => loadSprite(f.dex, side, f.shiny, femmina, sv);
    if (!form) return base();
    /* ⚠️ Anche le forme hanno il loro sprite CROMATICO: prima si prendeva
       sempre quello normale e un Unown cromatico usciva coi colori sbagliati.
       Se la forma non ha un file suo si ricade sulla specie — ed è giusto:
       nemmeno l'originale ne ha uno per le 20 fantasie di Scatterbug o per le
       taglie di Pumpkaboo, che sono identiche a vedersi. */
    const nome = `${f.dex}-${form}`;
    const classicoForma = () => {
      const dirs = [];
      if (f.shiny) dirs.push(`assets/pokemon/shiny/${side}`);
      dirs.push(`assets/pokemon/${side}`);
      return loadSpriteChain(dirs, nome);
    };
    /* Ordine: livrea della FORMA → forma classica → livrea della SPECIE →
       specie classica. La forma giusta viene sempre prima. */
    return (sv ? cromSprite(cromChiave(side, false), nome, sv) : Promise.resolve(null))
      .then(spr => spr || classicoForma())
      .then(spr => spr || base());
  }
  /* Va usato lo sprite femminile? Solo per le 98 specie che nell'originale
     hanno `genderDiffs` (le mega/gigamax usano sempre quello base). */
  const usaSpriteFemmina = f =>
    !!(f && f.gender === "FEMALE" && S[f.speciesId] && S[f.speciesId].genderDiffs && !f.formKey);

  // Comodita': accetta una lista di STRINGHE semplici (intro/vittoria/avvisi) e la
  // trasforma in eventi con l'istantanea corrente (HP fermi), poi la riproduce.
  function queueMessages(list, after) {
    playEvents(list.map(snapEvent), after);
  }

  /* Riproduce gli eventi UNO ALLA VOLTA, animando le barre HP in sincrono.
     ⚠️ Il ritmo lo detta CHI GIOCA: ogni messaggio resta finche' non si tocca,
     come nei giochi ufficiali. Prima scorrevano da soli ogni 780 ms e le mosse
     "si alternavano senza sosta", senza capire chi stesse facendo cosa.
     L'unica eccezione e' `?fast`, che serve ai test automatici. */
  function playEvents(events, after) {
    clearTimeout(game.timer);
    game.events = events;
    game.eventIndex = -1;
    game.afterEvents = after || null;
    game.phase = "MESSAGE";
    nextEvent();
  }

  function nextEvent() {
    clearTimeout(game.timer);
    game.eventIndex++;
    if (game.eventIndex >= game.events.length) {
      const cb = game.afterEvents;
      game.afterEvents = null; game.events = []; game.eventIndex = 0;
      game.curFrame = null;
      renderScene();          // stato finale: garantisce sprite/barre aggiornati
      if (cb) cb();
      return;
    }
    const e = game.events[game.eventIndex];
    stopMoveAnim();          // l'animazione precedente non deve accavallarsi
    chiudiBallSlot();        // idem per un ritiro/uscita ancora a meta'

    /* ⚠️ QUANDO SI VEDE IL DANNO. Ora un evento può raccontare più righe
       («X usa Y!» + «È superefficace!»), e la sua istantanea è quella DOPO il
       colpo. Se la disegnassimo subito, la barra dei PS calerebbe mentre
       l'animazione della mossa deve ancora partire — il difetto di prima, al
       contrario. Quindi: durante l'animazione si tiene il fotogramma
       PRECEDENTE, e quello di questo evento si applica quando l'animazione
       finisce, cioè al momento dell'impatto. */
    const prima = e.pre || (game.eventIndex > 0 ? game.events[game.eventIndex - 1] : null);
    const conAnim = !!(e.fx || e.anim);
    const differita = conAnim && !!prima;
    game.curFrame = differita ? prima : e;
    renderScene(game.curFrame);
    renderMessageBox(e.text);

    /* Applica l'istantanea vera di questo evento (barre, KO, scossone). */
    const applicaColpo = () => {
      if (game.events[game.eventIndex] !== e) return;   // narrazione già avanti
      game.curFrame = e;
      renderScene(e);
    };

    // Effetto visivo della mossa: l'animazione vera se c'e', altrimenti particelle.
    // e.fx.side e' il lato di CHI SUBISCE, quindi l'attaccante e' l'altro.
    // Effetti visivi dell'evento. Un evento puo' averne DUE: la carica di una
    // mossa a due turni e poi il colpo vero (Solarraggio). In quel caso si
    // riproducono in fila, non una sopra l'altra.
    let animMs = 0;
    /* Ritiro/uscita dalla ball: e' legato alla FRASE («Ritirati, X!»), non al
       momento in cui il motore ha cambiato Pokemon — quello succede molto
       prima, mentre si costruisce il log. Tenuto a parte da `animMs` perche'
       i rami qui sotto lo riassegnano. */
    const ballMs = e.ball ? animaBallSlot(e.ball.verso, e.ball.lato) : 0;
    const playFx = (poi) => animAvailable(e.fx.move)
      ? playMoveAnim(e.fx.move, e.fx.from || (slotNemico(e.fx.side) ? "player" : "enemy"),
                     e.fx.side, e.fx.type, poi)
      : (spawnMoveFx(e.fx.type, e.fx.side), setTimeout(poi, 240), 0);

    if (e.anim && e.fx) {
      // animazione comune/carica -> poi quella della mossa
      animMs = playMoveAnim(e.anim.key, e.anim.side, e.anim.side, null, () => playFx(applicaColpo))
             + animDuration(e.fx.move);
    } else if (e.fx) {
      animMs = playFx(applicaColpo);
    } else if (e.anim) {
      // animazione comune o di carica: si ancora a UN solo Pokemon, quindi
      // chi attacca e chi subisce sono lo stesso (come CommonBattleAnim).
      animMs = playMoveAnim(e.anim.key, e.anim.side, e.anim.side, null, applicaColpo);
    }

    /* Il triangolino "tocca per continuare" compare quando l'animazione della
       mossa ha finito: cosi' si vede a colpo d'occhio se il gioco sta ancora
       mostrando qualcosa o sta aspettando te. Toccare prima va bene lo stesso:
       taglia l'animazione e passa avanti. */
    mostraContinua(Math.min(Math.max(animMs || 0, ballMs), 2400));

    // ?fast: narrazione automatica, serve SOLO ai test (una run a mano sarebbe
    // impossibile da guidare a 40 ms per messaggio).
    if (NARRAZIONE_AUTO) {
      const isLast = game.eventIndex >= game.events.length - 1;
      let wait = isLast ? Math.max(TURN_DELAY, 300) : TURN_DELAY;
      game.timer = setTimeout(nextEvent, wait);
    }
  }

  /* Fa comparire il segnalino di continuazione dopo `ritardo` ms. */
  function mostraContinua(ritardo) {
    clearTimeout(game.contTimer);
    const mostra = () => {
      game.prontoAvanzare = true;      // da adesso il tocco avanza
      const c = cmd().querySelector(".msgbox .cont");
      if (c) c.classList.add("pronto");
    };
    game.prontoAvanzare = !ritardo;    // con un'attesa in corso si aspetta
    if (!ritardo) { mostra(); return; }
    game.contTimer = setTimeout(mostra, ritardo);
  }

  /* ---------------------------------------------------------------------- */
  /*  ANIMAZIONI DELLE MOSSE — i frame VERI estratti da PokeRogue           */
  /*                                                                        */
  /*  843 mosse hanno il loro file in data/anims/<MOSSA>.json.              */
  /*  Ogni frame e' una lista di sprite compattati in array di numeri:      */
  /*   [x, y, zoomX, zoomY, opacity, graphicFrame, target, focus,           */
  /*    blendType, angle, mirror, priority, visible]                        */
  /*  (i valori di default finali sono tagliati: vedi tools/extract-anims)  */
  /*                                                                        */
  /*  target: 0 = chi attacca · 1 = il bersaglio · 2 = la grafica           */
  /*  focus : 1 = ancorato al bersaglio · 2 = a chi attacca                 */
  /*          3 = lungo la linea fra i due · 4 = schermo (assoluto)         */
  /*                                                                        */
  /*  I file si caricano SU RICHIESTA: sono 4,7 MB in tutto, mai al boot.   */
  /* ---------------------------------------------------------------------- */
  const ANIM_FRAME_MS = 50;    // getFrameMs(3) dell'originale: 20 frame al secondo
  const ANIM_SPACE_W = 320;    // il campo logico dell'originale e' 320x180 (1920/6)
  const ANIM_TILE = 96;        // i fogli sprite sono griglie di celle 96x96
  // Ancore dell'editor delle animazioni (userFocus/targetFocus nell'originale)
  const UF_X = 106, UF_Y = 116, TF_X = 234, TF_Y = 52;
  // Valori di default, nello stesso ordine dell'array compatto
  const ANIM_DEF = [0, 0, 100, 100, 255, 0, 2, 1, 0, 0, 0, 1, 1];

  let ANIMS = null;              // indice: { sheets, moves }
  const animCache = new Map();   // MOSSA -> dati (o null se non disponibile)
  const animPending = new Map(); // MOSSA -> fetch ancora in volo
  const sheetCache = new Map();  // nome foglio -> Image
  let animRun = null;            // riproduzione in corso

  /* Esiste un'animazione con questa chiave? (mosse, comuni, cariche) */
  function animAvailable(key) {
    return !!(ANIMS && key && (ANIMS.moves[key] || ANIMS.common[key] || ANIMS.charge[key]));
  }

  /* Chiave dell'animazione di una mossa: la sua se ce l'ha, altrimenti il
     RIPIEGO dell'originale (attacco -> Azione, stato su se' -> Focalenergia,
     altro stato -> Colpocoda). Cosi' nessuna mossa resta senza animazione. */
  function animKeyForMove(id) {
    if (!ANIMS || !id) return null;
    return ANIMS.moves[id] ? id : (ANIMS.fallback[id] || null);
  }

  /* Animazione comune di uno stato (attenzione: FREEZE si chiama FROZEN). */
  const STATUS_ANIM = {
    BURN: "COMMON_BURN", PARALYSIS: "COMMON_PARALYSIS", SLEEP: "COMMON_SLEEP",
    POISON: "COMMON_POISON", TOXIC: "COMMON_POISON", FREEZE: "COMMON_FROZEN",
  };

  /* Lato di un combattente: serve per ancorare l'animazione al Pokemon giusto. */
  /* Lo SLOT in cui sta questo Pokemon. In doppio sono QUATTRO, non due.
     🔴 Prima tornava solo "enemy"/"player": tutto cio' che riguardava il
     SECONDO nemico — animazione della mossa compresa — finiva addosso al
     giocatore. Si notava solo su uno dei due avversari perche', quando il primo
     cade, il superstite viene PROMOSSO a `game.enemy` (vedi `enemyFaints`) e da
     quel momento l'animazione tornava al posto giusto. */
  function sideOf(f) {
    return f === game.enemy ? "enemy"
         : f === game.enemy2 ? "enemy2"
         : f === game.player2 ? "player2" : "player";
  }
  // Lo slot sta dalla parte dell'avversario? (verso dell'animazione e variante "_o")
  const slotNemico = s => s === "enemy" || s === "enemy2";
  /* Lo sprite di uno slot. Se il secondo slot non c'e' (lotta singola, oppure
     compagno appena caduto) si ripiega sul primario dello stesso lato: meglio
     un'animazione un po' spostata che nessuna animazione. */
  const SLOT_SPRITE = { player: "player-sprite", player2: "player2-sprite",
                        enemy: "enemy-sprite", enemy2: "enemy2-sprite" };
  function slotSpriteId(side) {
    const id = SLOT_SPRITE[side] || "player-sprite";
    const el = document.getElementById(id);
    // non basta che l'elemento esista: gli slot secondari restano nel DOM ma
    // `hidden`, e un elemento nascosto misura zero (l'animazione si ancorerebbe
    // all'angolo dello schermo)
    if (el && el.getBoundingClientRect().width) return id;
    return slotNemico(side) ? "enemy-sprite" : "player-sprite";
  }

  /* Carica il file di una mossa (una volta sola, poi resta in memoria). */
  function loadAnimData(key) {
    if (!animAvailable(key)) return Promise.resolve(null);
    if (animCache.has(key)) return Promise.resolve(animCache.get(key));
    if (animPending.has(key)) return animPending.get(key);
    const p = fetch(`data/anims/${key}.json?v=${DATA_V}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(d => {
        animCache.set(key, d);
        animPending.delete(key);
        // Avvia SUBITO il caricamento dei fogli sprite: un'animazione corta
        // (Graffio: 7 frame = 350 ms) finirebbe prima che il PNG sia pronto.
        if (d) {
          for (const a of [d, d.o]) {
            if (!a) continue;
            if (a.g) loadSheet(a.g);
            for (const e of a.bg || []) if (e[1] && e[2]) loadSheet(e[2]);
          }
        }
        return d;
      });
    animPending.set(key, p);
    return p;
  }
  /* Chiamato quando si risolve il turno: file e immagini arrivano prima che servano. */
  function prefetchAnim(key) { loadAnimData(key); }

  /* Foglio sprite dell'animazione (immagine condivisa fra molte mosse). */
  function loadSheet(name) {
    const meta = ANIMS && ANIMS.sheets[name];
    if (!meta) return null;
    if (sheetCache.has(name)) return sheetCache.get(name);
    const img = new Image();
    img.src = `assets/anims/${meta.n}.png`;
    sheetCache.set(name, img);
    return img;
  }

  /* Espande un array compatto rimettendo i default tagliati. */
  function unpackAnimFrame(a) {
    const v = ANIM_DEF.map((d, k) => (a[k] === undefined ? d : a[k]));
    return { x: v[0], y: v[1], zx: v[2], zy: v[3], op: v[4], gf: v[5],
             target: v[6], focus: v[7], blend: v[8], angle: v[9],
             mirror: v[10], pri: v[11], vis: v[12] };
  }

  /* Porta un punto dalla linea utente->bersaglio dell'editor a quella reale
     (transformPoint dell'originale: proporzione su x e y, poi riproiezione). */
  function animTransform(src, dst, px, py) {
    const dx = src[2] - src[0], dy = src[3] - src[1];
    const tx = dx === 0 ? 0 : (px - src[0]) / dx;
    const ty = dy === 0 ? 0 : (py - src[1]) / dy;
    return [dst[0] + tx * (dst[2] - dst[0]), dst[1] + ty * (dst[3] - dst[1])];
  }

  /* La linea utente->bersaglio va nel verso OPPOSTO a quella con cui
     l'animazione e' stata disegnata? (`isReversed` dell'originale,
     battle-anims.ts:715). Succede ogni volta che attacca l'avversario con
     un'animazione senza variante `.o`: i dati sono disegnati da sinistra a
     destra, ma sullo schermo il colpo parte da destra. */
  function lineaInvertita(src, dst) {
    if (src[0] === src[2]) return false;
    return src[0] < src[2] ? dst[0] > dst[2] : dst[0] < dst[2];
  }

  /* Posizione di uno sprite del frame, nello spazio-animazione.
     `kY` = quanto è più alto il nostro campo rispetto ai 180 dell'originale. */
  function animPos(f, U, Tg, src, dst, kY, invertita) {
    let x = f.x + UF_X, y = f.y + UF_Y;
    if (f.focus === 1)      { x += Tg.x - TF_X; y += Tg.y - TF_Y; }  // bersaglio
    else if (f.focus === 2) { x += U.x - UF_X;  y += U.y - UF_Y;  }  // chi attacca
    else if (f.focus === 3) {
      const p = animTransform(src, dst, x, y); x = p[0]; y = p[1];
      /* 🔴 IL VERSO. Solo le GRAFICHE (target 2) e solo su questo focus: se la
         linea e' invertita, la figura va specchiata, o la sabbia, il raggio o
         l'artiglio puntano dalla parte sbagliata. Era il pezzo che mancava. */
      if (f.target === 2 && invertita) return { x, y, flip: (f.mirror ? -1 : 1) * -1 };
    }
    else {
      /* focus 4 = ANCORATO ALLO SCHERMO. Nell'originale il campo è alto 180 e
         queste grafiche cadono a metà scena; il nostro è verticale e alto ~470
         in unità di animazione, quindi la stessa coordinata finiva nel quarto
         IN ALTO — dove stava il nemico PRIMA che lo abbassassimo. Da lì
         l'impressione che le immagini delle mosse non lo seguissero.
         Si riporta in scala sull'altezza vera del campo. */
      y *= (kY || 1);
    }
    return { x, y, flip: f.mirror ? -1 : 1 };
  }

  /* Centro di uno sprite del gioco, in coordinate dello spazio-animazione. */
  function animAnchor(id, rect, scale) {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width) return null;
    return { x: (r.left - rect.left + r.width / 2) / scale,
             y: (r.top - rect.top + r.height / 2) / scale };
  }

  /* Durata di un'animazione gia' in cache, senza riprodurla (0 se assente). */
  function animDuration(key) {
    const d = animCache.get(key);
    return d && d.f ? d.f.length * ANIM_FRAME_MS : 0;
  }

  /* Ferma l'animazione in corso e rimette a posto sprite e canvas. */
  function stopMoveAnim() {
    if (!animRun) return;
    clearTimeout(animRun.timer);
    animRun.cleanup();
    animRun = null;
  }

  /* Riproduce l'animazione della mossa. Ritorna la durata in ms (0 se non
     disponibile: in quel caso ricadiamo sulle particelle per tipo). */
  function playMoveAnim(key, userSide, targetSide, fallbackType, onDone) {
    // Il file sta ancora arrivando (capita al primissimo evento di una lotta):
    // si riparte appena c'e', invece di non mostrare nulla.
    if (!animCache.has(key) && animPending.has(key)) {
      animPending.get(key).then(() => playMoveAnim(key, userSide, targetSide, fallbackType, onDone));
      return 800;   // stima, serve solo a far attendere la narrazione
    }
    const data = animCache.get(key);
    const canvas = document.getElementById("anim-canvas");
    const canvasFront = document.getElementById("anim-canvas-front");
    const scene = document.getElementById("scene");
    // se non c'e' l'animazione: particelle per tipo (o nulla, per le comuni)
    const fallback = () => {
      if (fallbackType) spawnMoveFx(fallbackType, targetSide);
      if (onDone) onDone();
      return 0;
    };
    if (!data || !canvas || !scene) return fallback();

    /* 🔴 ANIMAZIONE "DELL'AVVERSARIO" (`isOppAnim` dell'originale).
       Vale solo se attacca l'avversario E la mossa ha una seconda variante
       (307 su 913). In quel caso l'originale non si limita a cambiare i
       fotogrammi: SCAMBIA anche utente e bersaglio, perche' quella variante e'
       disegnata sullo stesso schema dell'altra (chi usa la mossa in basso a
       sinistra), e sullo schermo l'avversario sta dall'altra parte.
       ⚠️ Noi cambiavamo i fotogrammi e basta: da li' "gli attacchi in verso
       sbagliato" — Turbosabbia nemico e le altre 306. */
    const animOpp = slotNemico(userSide) && !!data.o;
    const anim = animOpp ? data.o : data;
    const frames = anim.f;
    if (!frames || !frames.length) return fallback();

    stopMoveAnim();

    const rect = scene.getBoundingClientRect();
    const scale = rect.width / ANIM_SPACE_W;
    const uId = slotSpriteId(animOpp ? targetSide : userSide);
    const tId = slotSpriteId(animOpp ? userSide : targetSide);
    const U = animAnchor(uId, rect, scale), Tg = animAnchor(tId, rect, scale);
    if (!U || !Tg) return fallback();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const cv of [canvas, canvasFront]) {
      if (!cv) continue;
      cv.width = Math.round(rect.width * dpr);
      cv.height = Math.round(rect.height * dpr);
    }
    const ctx = canvas.getContext("2d");
    // canvas davanti ai combattenti: ci finiscono le grafiche a priority 1 e 3
    const ctxF = canvasFront ? canvasFront.getContext("2d") : ctx;

    const sheet = loadSheet(anim.g);
    const shMeta = ANIMS.sheets[anim.g] || {};
    const cols = shMeta.c || 1;
    const cells = shMeta.k || 1;
    const src = [UF_X, UF_Y, TF_X, TF_Y], dst = [U.x, U.y, Tg.x, Tg.y];
    const invertita = lineaInvertita(src, dst);
    /* Il campo dell'originale e' 320x180; il nostro e' verticale e in unita'
       di animazione risulta molto piu' alto. Serve alle grafiche ancorate
       allo SCHERMO (focus 4), che se no restano nel quarto in alto. */
    const kY = (rect.height / scale) / 180;
    const hue = anim.hue ? `hue-rotate(${anim.hue}deg)` : "";

    // eventi di sfondo, raggruppati per frame
    const bgAt = {};
    for (const e of anim.bg || []) (bgAt[e[0]] = bgAt[e[0]] || []).push(e);
    let bg = null;

    const uEl = document.getElementById(uId), tEl = document.getElementById(tId);
    const touched = new Set();   // sprite del gioco spostati dall'animazione

    const cleanup = () => {
      for (const c of new Set([ctx, ctxF])) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, canvas.width, canvas.height);
      }
      for (const el of touched) { el.style.transform = ""; el.style.opacity = ""; el.style.transition = ""; }
    };

    /* Identita' di QUESTA riproduzione. Serve perche' `step` puo' ripartire
       anche molto dopo, dal listener `load` del foglio sprite: se nel frattempo
       la narrazione e' andata avanti (`stopMoveAnim` azzera `animRun`) o e'
       partita un'altra animazione, questo `step` non deve piu' disegnare nulla.
       ⚠️ Senza il confronto qui sotto l'ultima riga faceva `animRun.timer` su
       `null` e lanciava «Cannot set properties of null»: si vedeva solo nelle
       partite lunghe, quando le animazioni si accavallano. */
    const run = { timer: null, cleanup };
    let i = 0;
    const step = () => {
      if (animRun !== run) return;       // riproduzione annullata o sostituita
      for (const c of new Set([ctx, ctxF])) {
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, rect.width, rect.height);
      }

      // sfondo dell'animazione (schermate nere, lampi, ecc.)
      for (const e of bgAt[i] || []) {
        if (e[1]) bg = { img: loadSheet(e[2]), op: e[5] / 255 };  // aggiungi
        else if (bg) bg.op = e[5] / 255;                          // aggiorna
      }
      if (bg && bg.img && bg.img.complete && bg.img.naturalWidth && bg.op > 0) {
        ctx.globalAlpha = Math.min(1, bg.op);
        ctx.drawImage(bg.img, 0, 0, rect.width, rect.height);
        ctx.globalAlpha = 1;
      }

      // gli sprite del frame, in ordine di priorita'
      const list = (frames[i] || []).map(unpackAnimFrame).sort((a, b) => a.pri - b.pri);
      for (const f of list) {
        const p = animPos(f, U, Tg, src, dst, kY, invertita);
        /* Davanti o dietro? Come `setSpritePriority` dell'originale:
           0 e 2 = sotto i Pokemon · 1 e 3 = sopra. */
        const cx = (f.pri === 0 || f.pri === 2) ? ctx : ctxF;

        if (f.target === 2) {
          // grafica dell'effetto: una cella 96x96 del foglio
          if (!f.vis || !sheet || !sheet.complete || !sheet.naturalWidth) continue;
          // Alcune animazioni chiedono una cella che il foglio non ha (succede
          // anche nell'originale: Phaser ripiega sul primo fotogramma).
          const gf = f.gf < cells ? f.gf : 0;
          const sx = (gf % cols) * ANIM_TILE, sy = Math.floor(gf / cols) * ANIM_TILE;
          cx.save();
          cx.globalAlpha = Math.max(0, Math.min(1, f.op / 255));
          cx.globalCompositeOperation =
            f.blend === 1 ? "lighter" : f.blend === 2 ? "difference" : "source-over";
          if (hue) cx.filter = hue;
          cx.translate(p.x * scale, p.y * scale);
          if (f.angle) cx.rotate((-f.angle * Math.PI) / 180);
          cx.scale((f.zx / 100) * p.flip * scale, (f.zy / 100) * scale);
          cx.drawImage(sheet, sx, sy, ANIM_TILE, ANIM_TILE,
                        -ANIM_TILE / 2, -ANIM_TILE / 2, ANIM_TILE, ANIM_TILE);
          cx.restore();
        } else {
          // muove uno dei due combattenti (slancio, rinculo, sparizione)
          const el = f.target === 0 ? uEl : tEl;
          const anchor = f.target === 0 ? U : Tg;
          if (!el) continue;
          const dx = (p.x - anchor.x) * scale, dy = (p.y - anchor.y) * scale;
          const zx = (f.zx / 100) * p.flip, zy = f.zy / 100;
          const atRest = Math.abs(dx) < 1 && Math.abs(dy) < 1 &&
                         Math.abs(zx - 1) < 0.02 && Math.abs(zy - 1) < 0.02 &&
                         !f.angle && f.vis && f.op >= 255;
          // i frame "a riposo" non toccano lo sprite: cosi' resta la scossa del colpo
          if (atRest && !touched.has(el)) continue;
          if (!touched.has(el)) { touched.add(el); el.style.transition = "none"; }
          el.style.transform = `translate(${dx}px, ${dy}px) scale(${zx}, ${zy})` +
                               (f.angle ? ` rotate(${-f.angle}deg)` : "");
          el.style.opacity = f.vis ? String(Math.max(0, Math.min(1, f.op / 255))) : "0";
        }
      }

      if (++i >= frames.length) { cleanup(); animRun = null; if (onDone) onDone(); return; }
      run.timer = setTimeout(step, ANIM_FRAME_MS);
    };

    animRun = run;
    // Se il foglio non e' ancora decodificato si aspetta il suo `load`: senza
    // questo le animazioni corte disegnavano il vuoto (capitava al primo uso).
    if (sheet && !sheet.complete) {
      sheet.addEventListener("load", step, { once: true });
      sheet.addEventListener("error", step, { once: true });
    } else {
      step();
    }
    return frames.length * ANIM_FRAME_MS;
  }

  /* Effetto visivo di ripiego: particelle colorate sul bersaglio, per TIPO.
     Usato per le mosse senza animazione (mosse Z/G-Max) o se il file manca. */
  const FX_CFG = {
    FIRE:{c:["#ff9c54","#ffcf4a","#eb4d2a"],glyph:"🔥",n:9}, WATER:{c:["#4d90d5","#7fc9ef","#a5e0ff"],glyph:"💧",n:10},
    ELECTRIC:{c:["#f3d23b","#fff2a0","#fff"],glyph:"⚡",n:8}, GRASS:{c:["#63bb5b","#a8e090","#3e7d4b"],glyph:"🍃",n:9},
    ICE:{c:["#a5e0ff","#d8f4ff","#74cec0"],glyph:"❄️",n:9}, PSYCHIC:{c:["#f97176","#f8a5d8","#c98cff"],glyph:"✦",n:9},
    FIGHTING:{c:["#ce4069","#ff8a5c","#fff"],glyph:"✊",n:7}, POISON:{c:["#ab6ac8","#c98cff","#7a3f9a"],glyph:"☠",n:8},
    GROUND:{c:["#d8b060","#b07850","#8f6030"],glyph:"⛰",n:8}, ROCK:{c:["#c7b78b","#8f7f50","#e0d0a0"],glyph:"🪨",n:7},
    FLYING:{c:["#8fa8dd","#cfe0ff","#fff"],glyph:"💨",n:9}, BUG:{c:["#90c12c","#c0e060","#5f8f20"],glyph:"✷",n:9},
    GHOST:{c:["#5269ac","#9080d0","#3a3060"],glyph:"👻",n:8}, DRAGON:{c:["#0b6dc3","#5aa0e8","#c98cff"],glyph:"✦",n:9},
    DARK:{c:["#5a5366","#8a80a0","#2a2438"],glyph:"✦",n:8}, STEEL:{c:["#b8b8d0","#e8e8ff","#8a8aa0"],glyph:"✧",n:8},
    FAIRY:{c:["#ec8fe6","#ffc0f0","#fff"],glyph:"✦",n:9}, NORMAL:{c:["#e0e0e0","#fff","#c0c0c0"],glyph:"✦",n:8},
  };
  function spawnMoveFx(type, side) {
    const sprite = document.getElementById(slotSpriteId(side));
    const scene = document.getElementById("scene");
    if (!sprite || !scene) return;
    const cfg = FX_CFG[type] || FX_CFG.NORMAL;
    const sr = sprite.getBoundingClientRect(), br = scene.getBoundingClientRect();
    const cx = sr.left - br.left + sr.width / 2, cy = sr.top - br.top + sr.height / 2;
    // flash colorato sullo sprite
    sprite.classList.remove("fx-flash"); void sprite.offsetWidth; sprite.classList.add("fx-flash");
    sprite.style.setProperty("--fxc", cfg.c[0]);
    // particelle
    for (let i = 0; i < cfg.n; i++) {
      const p = document.createElement("div");
      p.className = "fx-particle";
      const ang = Math.random() * Math.PI * 2, dist = 22 + Math.random() * 46;
      p.textContent = cfg.glyph;
      p.style.left = cx + "px"; p.style.top = cy + "px";
      p.style.color = cfg.c[i % cfg.c.length];
      p.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      p.style.setProperty("--dy", Math.sin(ang) * dist + "px");
      p.style.animationDelay = (Math.random() * 80) + "ms";
      scene.appendChild(p);
      setTimeout(() => p.remove(), 700);
    }
  }

  // Tap = vai subito al prossimo evento (salta l'attesa).
  function advanceMessages() {
    chiudiStadi();                     // non lasciare il riquadro sopra la scena
    if (game.phase !== "MESSAGE") return;
    /* 🔴 Finche' l'animazione della mossa e' in corso, il tocco NON avanza.
       Prima tagliava l'animazione e passava oltre: toccando in fretta si
       saltava tutto e si arrivava al comando dopo senza aver visto niente —
       e in doppio si finiva per far partire un'altra mossa sopra la prima.
       Il triangolino ▸ dice quando è il momento: adesso e' anche la regola,
       non solo un suggerimento. */
    if (!game.prontoAvanzare) return;
    nextEvent();
  }

  /* ---------------------------------------------------------------------- */
  /*  RISOLUZIONE DEL TURNO                                                  */
  /* ---------------------------------------------------------------------- */
  // L'IA nemica sceglie una mossa (a caso tra quelle con PP).
  /* ======================================================================
     🔴 LE MOSSE CHE VINCOLANO IL TURNO DOPO

     Tre famiglie, tre regole diverse, e nessuna delle tre c'era.

     FURIA (Colpo, Petalodanza, Oltraggio, Ira Furente) — `FrenzyAttr`
       nell'originale. Chi la usa la ripete per 1-2 turni in piu' senza poter
       scegliere altro, e quando finisce resta CONFUSO. Da noi erano quattro
       mosse da 120 di potenza senza contropartita: le migliori del gioco.

     ROTOLAMENTO (Rotolamento, Palla Gelo). Fino a CINQUE turni di fila, e la
       potenza RADDOPPIA ogni volta: 30 · 60 · 120 · 240 · 480 (il doppio
       ancora se prima hai usato Ricciolscudo). Basta un colpo a vuoto e
       riparte da 30. Nell'originale sono marcate `.partial()` — «non
       vincolano, e la potenza non cresce bene» — quindi qui la regola giusta
       e' quella dei giochi, non quella del codice sorgente.

     BARAONDA. Tre turni di fila, e mentre dura NESSUNO puo' addormentarsi.

     E due che crescono senza vincolare: Forbicidànza (×2 fino a tre volte) e
     Echeggiavoce (+40 fino a cinque).
     ====================================================================== */
  const FURIA = new Set(["THRASH", "PETAL_DANCE", "OUTRAGE", "RAGING_FURY"]);
  const ROTOLA = { ROLLOUT: 5, ICE_BALL: 5 };
  const CRESCE = { FURY_CUTTER: { max: 3, doppia: true }, ECHOED_VOICE: { max: 5, doppia: false } };
  const VINCOLO_IT = {
    charging: "si sta caricando",
    furia: "è in preda alla furia",
    rotola: "non riesce a fermarsi",
    baraonda: "sta facendo baraonda",
  };

  /* La mossa che quel Pokemon DEVE usare, se ne ha una imposta. Ritorna
     l'istanza (con i suoi PP) e il perche', che serve a scriverlo a schermo. */
  function mossaObbligata(chi) {
    if (!chi || chi.fainted || !chi.moves) return null;
    const v = chi.volatile || {};
    const quale = v.charging ? ["charging", v.charging.move]
      : v.furia ? ["furia", v.furia.id]
      : v.rotola ? ["rotola", v.rotola.id]
      : v.baraonda ? ["baraonda", v.baraonda.id]
      : null;
    if (!quale) return null;
    const inst = chi.moves.find(m => m.id === quale[1]);
    return inst ? { inst, perche: VINCOLO_IT[quale[0]], tipo: quale[0] } : null;
  }

  /* Il vincolo si SPEZZA: colpo a vuoto, bersaglio immune, o mossa finita.
     ⚠️ La confusione della furia arriva solo se il vincolo si rompe all'ultimo
     turno utile — nell'originale `FrenzyTag.onRemove` la mette se `turnCount`
     e' sceso sotto 2, cioe' se la furia era comunque agli sgoccioli. */
  function spezzaVincolo(chi, messages, naturale) {
    const v = chi.volatile;
    if (v.furia) {
      const agliSgoccioli = naturale || v.furia.turni <= 1;
      v.furia = null;
      if (agliSgoccioli && !chi.fainted) {
        stessoMomento(messages, `${chi.name} si placa…`);
        applyConfuse(chi, messages);
      }
    }
    if (v.rotola) v.rotola = null;
    if (v.baraonda) {
      v.baraonda = null;
      if (messages) stessoMomento(messages, `${chi.name} si è calmato.`);
    }
    v.consec = null;
  }

  /* Aggiorna i contatori DOPO che la mossa e' partita davvero (precisione
     superata). Va prima del danno, perche' la potenza di Rotolamento dipende
     da quanti colpi ha gia' messo a segno. */
  function aggiornaVincolo(actor, move, moveInst, messages) {
    const v = actor.volatile;
    if (FURIA.has(move.id)) {
      if (!v.furia) v.furia = { id: moveInst.id, turni: 1 + Math.floor(Math.random() * 2) };
      else if (--v.furia.turni <= 0) { v.furia = null; v._furiaFinita = true; }
    } else if (ROTOLA[move.id]) {
      v.rotola = (v.rotola && v.rotola.id === moveInst.id)
        ? { id: v.rotola.id, colpi: v.rotola.colpi + 1 }
        : { id: moveInst.id, colpi: 1 };
      if (v.rotola.colpi >= ROTOLA[move.id]) { v._rotolaFinita = v.rotola; }
    } else if (move.id === "UPROAR") {
      if (!v.baraonda) {
        // 3 turni IN TUTTO: questo piu' altri due, non questo piu' tre
        v.baraonda = { id: moveInst.id, turni: 2 };
        messages.push(`${actor.name} scatena una baraonda!`);
      } else if (--v.baraonda.turni <= 0) { v.baraonda = null; v._baraondaFinita = true; }
    } else {
      // una mossa qualunque azzera i contatori di quelle a raffica
      if (v.rotola) v.rotola = null;
    }
    // contatori delle mosse che crescono e basta
    if (CRESCE[move.id]) {
      v.consec = (v.consec && v.consec.id === moveInst.id)
        ? { id: v.consec.id, n: Math.min(CRESCE[move.id].max, v.consec.n + 1) }
        : { id: moveInst.id, n: 1 };
    } else if (v.consec) v.consec = null;
  }

  /* Le code dei vincoli: i messaggi di chiusura vanno DOPO il colpo, o si
     leggerebbe «si placa» prima ancora di vedere il danno. */
  function chiudiVincoli(actor, messages) {
    const v = actor.volatile;
    /* ⚠️ Qui la furia e' GIA' stata tolta da `aggiornaVincolo`: non si puo'
       passare da `spezzaVincolo`, che si regola su `v.furia` e non troverebbe
       piu' niente da chiudere. La confusione va messa a mano. */
    if (v._furiaFinita) {
      v._furiaFinita = false;
      if (!actor.fainted) {
        stessoMomento(messages, `${actor.name} si placa…`);
        applyConfuse(actor, messages);
      }
    }
    if (v._rotolaFinita) { v._rotolaFinita = null; v.rotola = null; }
    if (v._baraondaFinita) { v._baraondaFinita = false; stessoMomento(messages, `${actor.name} si è calmato.`); }
  }

  function enemyChooseMove() { return aiChooseMove(game.enemy); }
  /* Sceglie una mossa per un combattente guidato dal computer (vale sia per gli
     avversari sia per il secondo alleato nelle lotte in doppio). */
  function aiChooseMove(f) {
    if (!f || !f.moves || !f.moves.length) return null;
    const obb = mossaObbligata(f);       // furia, rotolamento, baraonda, carica
    if (obb) return obb.inst;
    const usable = f.moves.filter(m => m.pp > 0);
    return usable.length ? usable[Math.floor(Math.random() * usable.length)] : f.moves[0];
  }

  /* Turno con una MOSSA del giocatore. In doppio raccoglie fino a QUATTRO
     azioni (i due alleati e i due avversari) e le ordina tutte insieme.
     `target` = bersaglio scelto dal giocatore (in doppio); se manca, si pesca. */
  function playerChooseMove(moveIndex, target) {
    if (game.phase !== "CHOICE") return;
    const chi = currentChooser();
    if (!chi) return;
    const mossa = chi.moves[moveIndex];
    if (!mossa || mossa.pp <= 0) return;

    // In DOPPIO: il primo comando si mette in coda e si passa al secondo slot.
    if (serveSecondoComando()) {
      game.queued = { actor: chi, foe: target || pickFoeFor(chi), move: mossa };
      game.chooser = 1;
      showMainMenu();
      return;
    }

    const actions = [];
    if (game.queued) actions.push(game.queued);          // l'azione del primo
    actions.push({ actor: chi, foe: target || pickFoeFor(chi), move: mossa });
    risolviTurno(actions);
  }

  /* Risolve il turno a partire dalle azioni del GIOCATORE (una o due, o anche
     nessuna: chi cambia Pokemon non attacca). Aggiunge gli avversari, ordina e
     riproduce. Estratta da `playerChooseMove` perche' serve anche al cambio
     dal secondo slot in doppio. */
  /* ======================================================================
     DANNO SUBITO NEL TURNO — la memoria che mancava alle mosse "di rimando"

     Contrattacco, Specchiovelo, Metalscoppio e Ritorsione restituiscono un
     multiplo del danno appena incassato: senza tenerne conto restavano ferme
     a `POTENZA_RIPIEGO`. Si azzera all'INIZIO di ogni turno e si riempie in
     `doDamage` e nel ramo a danno fisso di `dannoSenzaPotenza`.
     ⚠️ Le prime due hanno priorità −5: agiscono per ultime, quindi quando
     tocca a loro il colpo avversario è già stato incassato. È esattamente il
     motivo per cui nei giochi funzionano.
     ====================================================================== */
  const dannoSubitoVuoto = () => ({ fisico: 0, speciale: 0, da: null });
  function azzeraDannoSubito() {
    for (const f of onField()) f.dannoSubitoTurno = dannoSubitoVuoto();
  }
  function segnaDannoSubito(vittima, attaccante, move, quanto) {
    if (!quanto || !vittima) return;
    if (!vittima.dannoSubitoTurno) vittima.dannoSubitoTurno = dannoSubitoVuoto();
    const d = vittima.dannoSubitoTurno;
    d[move.category === "SPECIAL" ? "speciale" : "fisico"] += quanto;
    d.da = attaccante;
    // PAZIENZA: mentre accumula, tutto quello che incassa fa massa
    if (vittima.volatile && vittima.volatile.bide) vittima.volatile.bide.danno += quanto;
  }
  function dannoSubito(f, quale) {
    const d = f.dannoSubitoTurno;
    if (!d) return 0;
    return quale === "tutto" ? d.fisico + d.speciale : d[quale];
  }

  /* 🔴 L'AVVERSARIO CHE CAMBIA POKEMON.
     Gli allenatori mandavano avanti i loro in fila e li lasciavano li' a
     prenderle: non esisteva il cambio, che nei giochi veri e' meta' del
     mestiere di un allenatore. Adesso i piu' bravi — Rivale, capipalestra,
     boss dei team, Superquattro, Campione — se stanno male di tipo tirano
     fuori chi risponde meglio.
     ⚠️ Il cambio COSTA IL TURNO, come per te: non attaccano e cambiano.
     ⚠️ Al massimo due per lotta e mai appena entrati, o si passerebbe la
     lotta a guardarli entrare e uscire. */
  const allenatoreBravo = e => !!(e && (e.gym || e.evil || e.e4 || e.champion
                                        || e.finalBoss || game.trainerIsRival));
  /* Quanto le prende `chi` dalle mosse di `da`: il moltiplicatore peggiore. */
  function quantoLePrende(chi, da) {
    const mosse = (da.moves || []).map(m => M[m.id]).filter(m => m && m.category !== "STATUS");
    if (!mosse.length) return 1;
    return Math.max(...mosse.map(m => typeMultiplier(m.type, chi.types)));
  }
  function aiCambioMigliore(e) {
    if (!e || e.fainted || !game.enemyQueue || !game.enemyQueue.length) return null;
    if (!allenatoreBravo(e)) return null;
    if ((e.volatile.turniInCampo || 0) < 1) return null;      // appena entrato: resta
    if ((game.cambiAi || 0) >= 2) return null;                 // due a lotta, basta
    const io = game.player;
    if (!io || io.fainted) return null;
    const adesso = quantoLePrende(e, io);
    if (adesso < 2) return null;                               // non sta male: resta
    /* Chi in panchina le prende meno E colpisce meglio? Se nessuno migliora
       davvero, cambiare sarebbe solo regalare un turno. */
    let meglio = null, punteggio = 0;
    for (const c of game.enemyQueue) {
      if (!c || c.fainted) continue;
      const prende = quantoLePrende(c, io);
      const da = quantoLePrende(io, c);          // quanto gliene fa lui a te
      const p = (adesso - prende) + (da - quantoLePrende(io, e));
      if (prende < adesso && p > punteggio) { meglio = c; punteggio = p; }
    }
    return meglio;
  }

  function risolviTurno(actions, logIniziale) {
    game.queued = null; game.chooser = 0;
    azzeraDannoSubito();
    // avversari
    const log0 = logIniziale || makeLog();
    /* Prima di scegliere le mosse: l'allenatore bravo valuta se cambiare.
       Chi cambia non attacca, quindi non entra nella coda delle azioni. */
    const cambiato = aiCambioMigliore(game.enemy);
    if (cambiato) {
      game.cambiAi = (game.cambiAi || 0) + 1;
      const uscito = game.enemy;
      richiamaNellaBall(uscito);
      game.enemyQueue.splice(game.enemyQueue.indexOf(cambiato), 1);
      game.enemyQueue.push(uscito);
      log0.push(conBall(`${game.trainerName || "L'allenatore"} richiama ${uscito.name}!`, "ritiro", "enemy"));
      deployEnemy(cambiato, log0);
      entraInCampo(cambiato, log0);
      log0.push(conBall(`Tocca a ${cambiato.name}!`, "uscita", "enemy"));
      if (typeof renderTrainerBalls === "function") renderTrainerBalls();
      renderScene();
    }
    for (const e of [game.enemy, game.enemy2]) {
      if (!e || e.fainted || e === cambiato) continue;   // chi e' appena entrato non attacca
      const mv = e === game.enemy ? enemyChooseMove() : aiChooseMove(e);
      if (mv) actions.push({ actor: e, foe: pickFoeFor(e), move: mv });
    }
    /* 🔴 IL VINCOLO VALE ANCHE SE LA SCELTA E' GIA' STATA FATTA.
       Chi è in furia, sta rotolando o è in piena baraonda non decide: il corpo
       ripete. I pulsanti già lo impediscono, ma la scelta può essere stata
       messa in coda PRIMA che il vincolo scattasse (in doppio il primo alleato
       sceglie, poi il turno si risolve) — qui è dove si fa valere davvero. */
    for (const act of actions) {
      const obb = mossaObbligata(act.actor);
      if (!obb) continue;
      act.move = obb.inst;
      /* Un turno obbligato non paga i PP: nell'originale è `MoveUseMode.IGNORE_PP`
         — il PP l'hai speso quando la mossa l'hai scelta tu, non ogni volta che
         il corpo la ripete. Si accredita adesso, così il consumo normale che
         arriva dopo torna a zero. */
      act.move.pp = Math.min(act.move.maxPp, act.move.pp + 1);
    }
    // Rapidartigli: 10% per pezzo di partire per primi comunque
    for (const act of actions) {
      const qc = act.actor.held && act.actor.held.quickclaw;
      act.quick = !!(qc && Math.random() < 0.1 * qc);
    }
    actions.sort((a, b) => {
      if (a.quick !== b.quick) return a.quick ? -1 : 1;
      /* BURLA: le mosse di STATO scattano prima. */
      const bonus = (act) => (ha(act.actor, "PRANKSTER") && M[act.move.id].category === "STATUS") ? 1 : 0;
      const pa = (M[a.move.id].priority || 0) + bonus(a);
      const pb = (M[b.move.id].priority || 0) + bonus(b);
      if (pa !== pb) return pb - pa;
      /* DISTORTOZONA: l'ordine si capovolge, i piu' lenti vanno per primi. */
      const va = velEff(a.actor), vb = velEff(b.actor);
      if (va !== vb) return game.distorto > 0 ? va - vb : vb - va;
      return Math.random() - 0.5;
    });

    const log = log0;
    for (const act of actions) if (act.quick) log.push(`I Rapidartigli di ${act.actor.name} scattano!`);
    /* Prendinota e Rinvio riordinano la coda MENTRE la si scorre: per farlo
       devono poterla vedere, e sapere a che punto siamo. */
    game._coda = actions;
    for (let i = 0; i < actions.length; i++) {
      game._codaI = i;
      const act = actions[i];
      if (act.actor.fainted) continue;                  // niente colpi post-KO
      // se il bersaglio e' caduto nel frattempo, si ripiega sull'altro
      /* ⚠️ Non basta «e' caduto»: se l'avversario ha CAMBIATO, il bersaglio
         scelto non e' piu' in campo pur essendo vivo. Colpirebbe un fantasma. */
      let foe = act.foe;
      if (!foe || foe.fainted || !onField().includes(foe)) foe = pickFoeFor(act.actor);
      if (!foe) continue;
      /* ATTIRASGUARDO / NUBEPOLLINE / SPLENDICALCIO: se sul lato del bersaglio
         qualcuno ha attirato l'attenzione, il colpo va addosso a lui. */
      const calamita = onField().find(x => x && !x.fainted && x.volatile.centro
                                        && isEnemySide(x) === isEnemySide(foe));
      if (calamita && calamita !== act.actor) foe = calamita;
      /* Mosse ad area: il bersaglio principale e poi gli altri, ognuno con il
         suo tiro di danno e i suoi effetti. Il colpo vale il 25% in meno per
         tutti quando sono piu' d'uno. */
      const altri = bersagliExtra(act.actor, M[act.move.id], foe);
      game._colpoLargo = altri.length > 0;
      resolveAction(act.actor, foe, act.move, log);
      for (const extra of altri) {
        if (act.actor.fainted || extra.fainted) continue;
        resolveAction(act.actor, extra, act.move, log, false, true);
      }
      game._colpoLargo = false;
    }
    game._coda = null;

    /* CAMBI FORZATI. Si eseguono QUI: dopo le mosse del turno e PRIMA dei danni
       residui — e' lo stesso punto dell'originale, che li mette in coda con
       `queueDeferred`. Chi entra adesso non prende le mosse di questo turno ma
       prende veleno, meteo e trappole, come nei giochi veri.
       ⚠️ Non si possono eseguire nell'istante in cui la mossa parte: le azioni
       ancora da risolvere tengono in mano il Pokemon in campo, e sostituirlo
       sotto i piedi le farebbe colpire un fantasma. */
    if (game.cambioForzato && game.cambioForzato.length) {
      const richieste = game.cambioForzato; game.cambioForzato = null;
      for (const r of richieste) eseguiCambioForzato(r, log);
      /* Il selvatico e' scappato e non c'e' nessun altro: la lotta finisce
         qui, SENZA premi — come `BattleEndPhase(false)` dell'originale. */
      if (game.fugaSelvatica) {
        game.fugaSelvatica = false;
        fineBattaglia();
        playEvents(log.events, nextWave);
        return;
      }
    }
    /* AUTO-CAMBIO del giocatore (Staffetta, Teletrasporto, Monito, Tagliacoda):
       il ricambio lo sceglie LUI, quindi il turno si ferma e riprende dopo.
       ⚠️ Il log va suonato adesso e il resto del turno riparte con un log
       NUOVO: `playEvents` riparte sempre dall'inizio dell'array che riceve, e
       riusare questo vorrebbe dire risentire tutto il turno da capo. */
    if (game.cambioScelto) {
      const r = game.cambioScelto; game.cambioScelto = null;
      const disponibili = game.party.some(p => !p.fainted && p !== game.player && p !== game.player2);
      if (disponibili && r.chi && !r.chi.fainted) {
        game.staffetta = r;
        playEvents(log.events, () => { game.phase = "STAFFETTA"; renderParty("staffetta"); });
        return;
      }
    }

    codaDelTurno(log);
  }

  /* La CODA del turno: danni residui, meteo, terreno, e tutto quello che dura
     un turno solo. Sta a parte perche' un auto-cambio la fa aspettare finche'
     il giocatore non ha scelto chi mandare. */
  function codaDelTurno(log) {
    for (const f of onField()) endOfTurnResidual(f, log);
    tickWeather(log);            // il meteo scade
    tickTerrain(log);            // e anche il terreno
    for (const f of onField()) {
      f.volatile.flinch = false;
      // la protezione dura un solo turno; il contatore degli usi di fila
      // si azzera solo quando NON la si e' usata (cosi' 1/3^usi funziona)
      if (!f.volatile.protect) f.volatile.protectUsi = 0;
      f.volatile.protect = null;
      // roba che vale un turno solo e va spenta comunque sia andata
      f.volatile.magiccoat = false; f.volatile.snatch = false;
      f.volatile.centro = false; f.volatile.elettro = false;
    }
    // le protezioni di squadra durano un turno; il vincolo fatato due
    if (game.lati) for (const c of ["mio", "suo"]) {
      const L = game.lati[c];
      L.wideguard = L.quickguard = L.craftyshield = L.matblock = 0;
      if (L.nocambio > 0) L.nocambio--;
    }
    playEvents(log.events, afterTurn);
  }

  /* ======================================================================
     LA FUGA 🔴

     Prima «Fuggi» chiamava `gameOver("RUN")`: si perdeva la RUN INTERA. Era
     una porta con su scritto «esci» in mezzo ai comandi di battaglia, e non
     e' quello che fa in nessun gioco Pokemon.
     Adesso fa quello che deve: il selvatico ti lascia andare, non prendi
     niente — niente premi, niente esperienza, niente cattura — e si passa
     all'incontro dopo. Dagli ALLENATORI e dai BOSS non si scappa affatto.

     La probabilita' e' quella dell'originale (`calculateEscapeChance`):
       rapporto = velocita' tua / velocita' sua, con tetto a 4
       pendenza = (95 − 5) / 4
       tiro     = pendenza × rapporto + 5 + 10 × (tentativi gia' falliti)
     cioe' da un minimo del 5% a un massimo del 95%, e ogni tentativo fallito
     rende il prossimo piu' facile. Un tentativo fallito COSTA IL TURNO. */
  function motivoNoFuga() {
    const e = game.enemy;
    if (!e) return "Non c'è nessuno da cui scappare.";
    if (e.trainer || e.trainerMon || (game.enemyQueue && game.enemyQueue.length))
      return "Non si scappa dalla sfida di un allenatore!";
    if (e.boss || e.finalBoss) return "Non si scappa da un boss!";
    return null;
  }
  function probabilitaFuga() {
    const miei = [game.player, game.player2].filter(p => p && !p.fainted);
    const loro = enemiesOnField();
    const vMia = miei.reduce((t, p) => t + p.stats.spd, 0) || 1;
    const vSua = loro.reduce((t, p) => t + p.stats.spd, 0) || 1;
    // FUGAFACILE: la fuga dai selvatici e' garantita, ed e' tutta la sua ragione d'essere
    if (miei.some(p => ha(p, "RUN_AWAY"))) return 100;
    const rapporto = Math.min(4, vMia / vSua);
    const pendenza = (95 - 5) / 4;
    const tentativi = game.tentativiFuga || 0;
    return Math.max(5, Math.min(95, Math.round(pendenza * rapporto + 5 + 10 * tentativi)));
  }
  function tentaFuga() {
    if (game.phase !== "CHOICE") return;
    const perche = motivoNoFuga();
    if (perche) { notAvailable(perche); return; }
    const log = makeLog();
    const scappato = Math.random() * 100 < probabilitaFuga();
    if (!scappato) {
      game.tentativiFuga = (game.tentativiFuga || 0) + 1;
      log.push("Non sei riuscito a fuggire!");
      // il tentativo fallito consuma il turno: gli avversari attaccano
      risolviTurno([], log);
      return;
    }
    const chi = enemiesOnField().map(e => e.name).join(" e ") || "l'avversario";
    log.push(`Sei fuggito da ${chi}! Nessuna ricompensa per questo incontro.`);
    fineBattaglia();
    playEvents(log.events, nextWave);
  }

  /* Turno in cui il giocatore CAMBIA Pokemon.
     ⚠️ In DOPPIO cambia lo slot di CHI STA SCEGLIENDO: prima si agiva sempre
     sul primo alleato e il secondo non si poteva cambiare affatto (i pulsanti
     Ball/Squadra/Fuggi erano perfino disabilitati sul secondo comando).
     Chi cambia non attacca: il turno si risolve con l'azione dell'altro
     alleato, se gia' scelta, piu' quelle avversarie. */
  function playerSwitch(index) {
    if (game.phase !== "CHOICE") return;
    const entrante = game.party[index];
    const uscente = currentChooser() || game.player;
    if (!entrante || entrante.fainted || entrante === game.player || entrante === game.player2) return;
    // chi e' intrappolato o radicato non puo' uscire dal campo
    if (uscente.volatile.trap) {
      notAvailable(`${uscente.name} è intrappolato e non può ritirarsi!`); return;
    }
    if (uscente.volatile.ingrain) {
      notAvailable(`${uscente.name} ha messo radici e non può ritirarsi!`); return;
    }
    if (game.lati && game.lati.mio.nocambio > 0) {
      notAvailable("Un vincolo fatato tiene tutti in campo!"); return;
    }
    const log = makeLog();

    if (game.double && uscente === game.player2) {
      // ---- SECONDO slot: si sostituisce `player2`, il primo ha gia' scelto --
      log.push(conBall(`Ritirati, ${game.player2.name}!`, "ritiro", "player2"));
      richiamaNellaBall(game.player2);
      game.player2 = entrante;
      entraInCampo(entrante, log);
      entrante.spr = null;
      loadFighterSprite(entrante, "back").then(s => { entrante.spr = s; redrawScene(); });
      log.push(conBall(`Vai, ${entrante.name}!`, "uscita", "player2"));
      applyOnSummon(entrante, game.enemy, log);
      renderScene();
      // il secondo non attacca: resta l'azione del primo (se c'e') + i nemici
      risolviTurno(game.queued ? [game.queued] : [], log);
      return;
    }

    doSwitch(index, log);

    /* PRIMO slot in doppio: il cambio e' la sua azione, ma il SECONDO deve
       ancora scegliere. Si narra il cambio e poi si passa a lui. */
    if (serveSecondoComando()) {
      game.queued = null;
      game.chooser = 1;
      renderScene();
      playEvents(log.events, () => { game.phase = "CHOICE"; showMainMenu(); });
      return;
    }
    if (game.double) { risolviTurno([], log); return; }

    azzeraDannoSubito();       // anche il cambio consuma un turno
    const enemyMove = enemyChooseMove();
    if (!game.enemy.fainted && !game.player.fainted) resolveAction(game.enemy, game.player, enemyMove, log);
    endOfTurnResidual(game.enemy, log);
    endOfTurnResidual(game.player, log);
    game.player.volatile.flinch = false;
    game.enemy.volatile.flinch = false;
    playEvents(log.events, afterTurn);
  }

  // Effettua il cambio (ritira l'attivo, manda il nuovo, abilita' d'ingresso).
  function doSwitch(index, log) {
    const outgoing = game.player;
    log.push(conBall(`Ritirati, ${outgoing.name}!`, "ritiro", "player"));
    richiamaNellaBall(outgoing);   // rientrando perde gli stadi (lo stato no)
    setActive(index);
    entraInCampo(game.player, log);   // al nuovo si azzerano i volatili, e le trappole mordono
    game.player.spr = null;
    loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
    log.push(conBall(`Vai, ${game.player.name}!`, "uscita", "player"));
    applyOnSummon(game.player, game.enemy, log);  // Prepotenza ecc. all'ingresso
  }

  /* Segna l'esperienza dei nemici appena caduti. Va chiamata PRIMA che
     `afterTurn` tolga dal campo i caduti, o si perde il riferimento (e con
     lui l'esperienza del secondo avversario in doppio). */
  function registraExpNemici() {
    for (const f of [game.enemy, game.enemy2]) {
      if (!f || !f.fainted || f._expDato) continue;
      f._expDato = true;
      // `getExpValue` dell'originale: baseExp × livello / 5 + 1
      let v = Math.floor((f.baseExp || 60) * f.level / 5) + 1;
      if (f.trainer || f.trainerMon) v = Math.floor(v * 1.5);   // gli allenatori ne danno di più
      game.expPending = (game.expPending || 0) + v;
    }
  }

  /* Distribuisce l'esperienza dell'ondata e fa salire chi arriva a livello.
     Quote dell'originale: chi era in campo se la divide, chi è in panchina
     prende il 20% (Esperienza Condivisa). Pokérus ×1,5, Esperienzamuleto +%. */
  function assegnaEsperienza(messages) {
    registraExpNemici();                       // rete di sicurezza per l'ultimo caduto
    const tot = game.expPending || 0;
    game.expPending = 0;
    if (tot <= 0) return;
    const inCampo = [game.player, game.player2].filter(p => p && !p.fainted);
    const quota = inCampo.length || 1;
    const boost = 1 + (game.charms.exp || 0) / 100;
    const tetto = livelloMassimo(game.wave);
    let saliti = 0;
    for (const p of game.party) {
      // chi ha raggiunto il tetto dell'ondata non prende esperienza: è il
      // freno che tiene la squadra al passo con gli avversari, non davanti
      if (p.fainted || p.level >= tetto || p.level >= LIVELLO_MAX) continue;
      let m = inCampo.includes(p) ? 1 / quota : EXP_QUOTA_PANCHINA / quota;
      if (p.pokerus) m *= 1.5;
      /* 🔴 RECUPERO RAPIDO. Chi e' molto sotto il tetto dell'ondata prende
         molta piu' esperienza, fino a cinque volte tanto. Serve a chi entra
         tardi — un nato dall'uovo arriva al livello 1 — e a chi è rimasto in
         panchina troppo a lungo: senza, sarebbero inutilizzabili per sempre.
         Il tetto resta invalicabile, quindi non si scavalca nessuno: si
         RAGGIUNGE il gruppo, non lo si supera. */
      const sotto = Math.max(0, tetto - p.level);
      if (sotto > 5) m *= Math.min(5, 1 + sotto / 8);
      const guadagno = Math.floor(tot * m * boost);
      if (guadagno <= 0) continue;
      // le partite salvate prima dell'esperienza vera non hanno questi campi
      if (!p.growthRate) p.growthRate = (S[p.speciesId] || {}).growthRate;
      if (!p.baseExp) p.baseExp = (S[p.speciesId] || {}).baseExp || 60;
      if (p.exp == null) p.exp = expTotalePerLivello(p.level, p.growthRate);
      p.exp += guadagno;
      const prima = p.level;
      p.level = livelloPerExp(p.exp, p.growthRate);
      if (p.level > prima) {
        recomputeStats(p);
        /* Tutti i passaggi di livello dell'ondata stanno INSIEME: sono un
           momento solo, e con sei membri in squadra sarebbero sei tocchi. */
        if (saliti++) stessoMomento(messages, `${p.name} è salito al Lv.${p.level}!`);
        else messages.push(`${p.name} è salito al Lv.${p.level}!`);
      }
    }
  }

  // Dopo un turno: KO? vittoria? cambio forzato?
  function afterTurn() {
    registraExpNemici();       // prima di togliere i caduti dal campo
    renderScene();
    /* BOSS FINALE: la fase finisce quando cade l'ULTIMO SCUDO — è la
       condizione di `initFinalBossPhaseTwo` (`bossSegmentIndex < 1`), non il
       numero di PS. ⚠️ Legarla ai PS non regge: gli oggetti tenuti dal boss
       possono curarlo (una bacca l'ha riportato a 451 PS in prova) e la fase
       non sarebbe mai cambiata. Si trasforma a turno concluso, così la
       narrazione del turno si vede tutta prima del cambio di forma (anche
       nell'originale il dialogo parte dopo l'animazione del danno). */
    if (game.enemy && game.enemy.finalBoss && !game.enemy.fainted
        && game.enemy.finalPhase < (game.enemy.bossFasi || 1)
        && game.enemy.segBroken >= game.enemy.segBounds.length) {
      const msgs = [];
      if (avanzaFaseFinale(msgs)) {
        queueMessages(msgs, () => { game.phase = "CHOICE"; showMainMenu(); });
        return;
      }
    }
    // --- LOTTA IN DOPPIO -------------------------------------------------
    if (game.double) {
      // il secondo avversario caduto sparisce dal campo
      if (game.enemy2 && game.enemy2.fainted) game.enemy2 = null;
      // il secondo alleato caduto viene rimpiazzato, se c'e' una riserva
      if (game.player2 && game.player2.fainted) {
        const riserva = game.party.find(p => !p.fainted && p !== game.player && p !== game.player2);
        richiamaNellaBall(game.player2);   // esce dal campo: via gli sbalzi
        game.player2 = riserva || null;
        if (game.player2) { entraInCampo(game.player2); loadFighterSprite(game.player2, "back").then(s => { game.player2.spr = s; redrawScene(); }); }
      }
      // se il PRIMO avversario cade ma il secondo e' vivo, la lotta continua:
      // il secondo prende il posto primario
      if (game.enemy && game.enemy.fainted && game.enemy2) {
        game.enemy = game.enemy2; game.enemy2 = null;
        renderScene();
      }
      // idem per l'alleato primario
      if (game.player && game.player.fainted && game.player2) {
        game.active = game.party.indexOf(game.player2);
        game.player = game.player2; game.player2 = null;
        renderScene();
      }
      // finita la lotta in doppio quando resta un solo avversario o nessuno
      if (!game.enemy2 && !game.player2) game.double = false;
      game.chooser = 0; game.queued = null;   // il prossimo turno riparte dal primo
      renderScene();
    }
    if (game.enemy.fainted) {
      if (game.trainerTotal) { game.trainerDefeated++; renderTrainerBalls(); }
      // allenatore: se ha altri Pokemon, manda il prossimo
      if (game.enemyQueue.length) {
        const next = game.enemyQueue.shift();
        const log = makeLog();
        log.push(conBall(next.trainer ? `${next.trainer} manda in campo ${next.name}!`
                                      : `${next.name} irrompe sul campo!`, "uscita", "enemy"));
        deployEnemy(next, log);
        /* 🔴 Il ricambio dell'allenatore dopo un KO non ENTRAVA davvero:
           `deployEnemy` lo mette sul campo e chiama le abilita' d'ingresso, ma
           saltava `entraInCampo` — che e' quella che azzera i volatili, fa
           mordere le TRAPPOLE (punte, punte velenose, rete vischiosa messe da
           te: se le passava indenne) e avvia i contatori d'ingresso
           `turniInCampo`/`usate`. Senza quei contatori Bruciapelo non partiva
           mai su chi entra a lotta in corso, e l'IA non lo considerava mai
           «appena entrato». Le altre due strade — cambio forzato e cambio
           dell'IA — lo facevano gia': era solo questa a mancare. */
        entraInCampo(next, log);
        renderTrainerBalls();
        renderScene();
        playEvents(log.events, () => {
          if (game.player.fainted) {
            if (firstAliveIndex() < 0) return gameOver("KO");
            return promptForceSwitch();
          }
          game.phase = "CHOICE"; showMainMenu();
        });
        return;
      }
      return onWaveCleared();          // vittoria (prevale)
    }
    if (game.player.fainted) {                                // l'attivo e' caduto
      if (firstAliveIndex() < 0) return gameOver("KO");       // tutta la squadra KO
      promptForceSwitch();                                    // manda il prossimo
      return;
    }
    game.phase = "CHOICE"; showMainMenu();
  }

  // Cambio obbligatorio dopo un KO: scegli il prossimo (nessun turno nemico gratis).
  function promptForceSwitch() {
    game.phase = "FORCESWITCH";
    renderParty("force");
  }
  function forceSwitchTo(index) {
    if (game.phase !== "FORCESWITCH") return;
    const target = game.party[index];
    if (!target || target.fainted) return;
    setActive(index);
    const log = makeLog();
    entraInCampo(game.player, log);   // anche qui le trappole mordono
    game.player.spr = null;
    // chi e' caduto non "rientra": il posto lo prende il nuovo, che esce dalla ball
    log.push(conBall(`Vai, ${game.player.name}!`, "uscita", "player"));
    applyOnSummon(game.player, game.enemy, log);
    loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
    playEvents(log.events, () => { game.phase = "CHOICE"; showMainMenu(); });
  }

  // Esegue una singola mossa: blocchi pre-mossa, PP, precisione, danno, effetti.
  function resolveAction(actor, foe, moveInst, messages, mossaChiamata, extra) {
    const move = M[moveInst.id];

    /* 1-zero-zero. SONNOLALIA si usa DORMENDO: se passasse dal controllo qui
       sotto verrebbe scartata sempre. Va intercettata prima.
       Stesso discorso per le mosse chiamate da un'altra mossa (Metronomo,
       Speculmossa…): il controllo l'ha già passato chi ha lanciato la prima,
       rifarlo vorrebbe dire tirare due volte i dadi di confusione e paralisi. */
    if (move.id === "SLEEP_TALK" && !mossaChiamata) {
      moveInst.pp = Math.max(0, moveInst.pp - 1);
      messages.push(`${actor.name} usa ${move.it}!`);
      if (actor.status !== "SLEEP") { stessoMomento(messages, "Ma non ha funzionato!"); return; }
      const dorm = actor.moves.filter(x => x.id !== "SLEEP_TALK" && M[x.id] && !M[x.id].charging);
      if (!dorm.length) { stessoMomento(messages, "Ma non ha funzionato!"); return; }
      usaAltraMossa(actor, foe, dorm[Math.floor(Math.random() * dorm.length)].id, messages);
      return;
    }

    // 1. l'attore riesce ad agire? (congelato/dorme/paralisi/tentennamento/confusione)
    if (!mossaChiamata && !canAct(actor, messages)) return;

    // 1-zero. mosse VIETATE da Provocazione / Attaccalite / Ripeti
    const veto = mossaChiamata ? null : mossaVietata(actor, move, moveInst);
    if (veto) { messages.push(veto); return; }
    actor.volatile.lastMove = moveInst.id;   // serve a Ripeti e Attaccalite
    // elenco di cosa ha usato da quando e' entrato: lo legge Ultimascelta
    if (actor.volatile.usate && !actor.volatile.usate.includes(moveInst.id)) actor.volatile.usate.push(moveInst.id);
    /* ⚠️ Copione deve vedere la mossa PRECEDENTE, non se stesso: la memoria
       si aggiorna solo dopo che la mossa è stata risolta (in fondo), non qui.
       Aggiornandola subito, Copione trovava sempre "COPIONE" e falliva sempre. */
    const mossaPrimaDiQuesta = game.ultimaMossa;

    /* 1-pre. PAZIENZA: due turni a incassare, poi restituisce il DOPPIO di
       tutto quello che ha preso. Non è una mossa a caricamento come Volo (che
       sceglie un bersaglio e poi colpisce): qui il Pokemon incassa e basta, e
       il contatore va avanti anche se in quei turni non lo tocca nessuno.
       Il totale lo riempie `segnaDannoSubito`, che vede la `volatile.bide`. */
    if (actor.volatile.bide) {
      const b = actor.volatile.bide;
      if (--b.turni > 0) { messages.push(`${actor.name} sta sopportando!`); return; }
      actor.volatile.bide = null;
      messages.push(`${actor.name} sfoga tutto in una volta!`);
      const reso = b.danno * 2;
      if (reso <= 0) { stessoMomento(messages, "Ma non ha funzionato!"); return; }
      const dato = bossClamp(foe, reso, messages);
      foe.hp = Math.max(0, foe.hp - dato); foe._justHit = true;
      segnaDannoSubito(foe, actor, move, dato);
      if (messages.snap) messages.snap();
      stessoMomento(messages, `${foe.name} perde ${dato} PS!`);
      if (foe.hp <= 0) { foe.fainted = true; messages.push(`${foe.name} è esausto!`); }
      segnaFx(messages, messages.length - 1, move.type, sideOf(foe), move.id, sideOf(actor));
      return;
    }
    /* RICCIOLSCUDO: oltre ad alzare la Difesa lascia un segno che raddoppia
       Rotolamento e Palla Gelo. Dura finche' resta in campo. */
    if (move.id === "DEFENSE_CURL") actor.volatile.arricciato = true;
    if (move.id === "BIDE") {
      moveInst.pp = Math.max(0, moveInst.pp - 1);
      actor.volatile.bide = { turni: 2, danno: 0 };
      messages.push(`${actor.name} si prepara a sopportare!`);
      return;
    }

    // 1-ter. MOSSE A DUE TURNI (Volo, Sub, Fossa, Rimbalzo…): il primo turno il
    // Pokemon sparisce dal campo e non e' colpibile, il secondo colpisce.
    if (move.charging && !actor.volatile.charging) {
      actor.volatile.charging = { move: moveInst.id, semiInvuln: !!SEMI_INVULN[move.id] };
      moveInst.pp = Math.max(0, moveInst.pp - 1);
      messages.push(CHARGE_TESTO[move.id]
        ? CHARGE_TESTO[move.id].replace("{n}", actor.name)
        : `${actor.name} si sta caricando!`);
      if (messages.anim) messages.anim("CHARGE_" + move.id, sideOf(actor));
      return;
    }
    // secondo turno: il Pokemon riappare e colpisce
    if (actor.volatile.charging) actor.volatile.charging = null;

    // 1-quater. il bersaglio e' IN VOLO / SOTT'ACQUA / SOTTOTERRA: non lo prendi
    if (foe.volatile.charging && foe.volatile.charging.semiInvuln && foe !== actor) {
      moveInst.pp = Math.max(0, moveInst.pp - 1);
      messages.push(`${actor.name} usa ${move.it}!`);
      messages.push(`Ma ${foe.name} è irraggiungibile!`);
      return;
    }

    // 1-bis. PROTEZIONE del bersaglio: para tutto per questo turno
    if (foe.volatile.protect && foe !== actor) {
      if (foe.volatile.protect === "endure") {
        // Resistenza non para: fa sopravvivere con 1 PS (gestito in doDamage)
      } else {
        moveInst.pp = Math.max(0, moveInst.pp - 1);
        messages.push(`${actor.name} usa ${move.it}!`);
        messages.push(`${foe.name} si è protetto!`);
        return;
      }
    }

    /* 1-bis-bis. PROTEZIONI DI SQUADRA. Non riparano chi le usa: riparano
       TUTTO il suo lato, e ognuna para una categoria diversa di colpo. */
    const Lg = (game.lati && foe !== actor) ? game.lati[latoDi(foe)] : null;
    if (Lg) {
      const paraSquadra =
          (Lg.wideguard > 0 && (move.target === "ALL_NEAR_ENEMIES" || move.target === "ALL_NEAR_OTHERS")) ? "Ampiaguardia"
        : (Lg.quickguard > 0 && (move.priority || 0) > 0) ? "Blocco"
        : (Lg.craftyshield > 0 && move.category === "STATUS") ? "Truccodifesa"
        : (Lg.matblock > 0 && move.category !== "STATUS") ? "Scudo Aureo" : null;
      if (paraSquadra) {
        moveInst.pp = Math.max(0, moveInst.pp - 1);
        messages.push(`${actor.name} usa ${move.it}!`);
        messages.push(`${paraSquadra} protegge la squadra ${nomeLato(foe)}!`);
        return;
      }
    }

    /* UMIDITÀ: finche' c'e' in campo, le mosse esplosive non partono. */
    if ((move.id === "SELF_DESTRUCT" || move.id === "EXPLOSION" || move.id === "MISTY_EXPLOSION")
        && onField().some(x => x && !x.fainted && ha(x, "DAMP"))) {
      moveInst.pp = Math.max(0, moveInst.pp - 1);
      messages.push(`${actor.name} usa ${move.it}!`);
      stessoMomento(messages, "L'umidità in campo impedisce l'esplosione!");
      return;
    }

    /* 1-sexies. POLVEPARA: chi ne è coperto e prova una mossa di Fuoco
       la fa esplodere addosso a sé. */
    if (actor.volatile.powder && move.type === "FIRE") {
      actor.volatile.powder = false;
      const scoppio = Math.max(1, Math.floor(actor.maxHp / 4));
      actor.hp = Math.max(0, actor.hp - scoppio); actor._justHit = true;
      messages.push(`La polvere su ${actor.name} prende fuoco ed esplode!`);
      if (actor.hp <= 0) { actor.fainted = true; messages.push(`${actor.name} è esausto!`); }
      return;
    }

    /* 1-septies. MAGICOSPECCHIO rimanda al mittente le mosse di STATO; FURTO
       ruba quelle che si usano su di sé (buff e cure). Sono le due mosse che
       trasformano il turno di un altro nel proprio. */
    if (move.category === "STATUS" && !mossaChiamata) {
      if (foe !== actor && foe.volatile.magiccoat && !foe.fainted) {
        foe.volatile.magiccoat = false;
        moveInst.pp = Math.max(0, moveInst.pp - 1);
        messages.push(`${actor.name} usa ${move.it}!`);
        messages.push(`Magicospecchio di ${foe.name} rimanda la mossa al mittente!`);
        usaAltraMossa(foe, actor, moveInst.id, messages, " ");
        return;
      }
      const ladro = BERSAGLIO_SU_DI_SE.has(move.target)
        ? onField().find(x => x && !x.fainted && x !== actor && x.volatile.snatch) : null;
      if (ladro) {
        ladro.volatile.snatch = false;
        moveInst.pp = Math.max(0, moveInst.pp - 1);
        messages.push(`${ladro.name} ruba la mossa di ${actor.name}!`);
        usaAltraMossa(ladro, actor, moveInst.id, messages, " ");
        return;
      }
    }

    /* ANTISUONO: le mosse sonore non lo toccano. TELEPATIA: gli attacchi
       dell'ALLEATO li vede arrivare e li schiva (vale solo in doppio). */
    if (foe !== actor && !foe.fainted) {
      const alleato = isEnemySide(foe) === isEnemySide(actor);
      const para = (move.sonora && ha(foe, "SOUNDPROOF")) ? nomeAb(foe, "SOUNDPROOF")
        : (alleato && move.category !== "STATUS" && ha(foe, "TELEPATHY")) ? nomeAb(foe, "TELEPATHY")
        : null;
      if (para) {
        moveInst.pp = Math.max(0, moveInst.pp - 1);
        messages.push(`${actor.name} usa ${move.it}!`);
        stessoMomento(messages, `${para} di ${foe.name} annulla il colpo!`);
        return;
      }
    }

    /* 1-octies. SOSTITUTO del bersaglio. Il fantoccio para TUTTO quello che
       arriva da fuori: danno, stati, cali di statistica. Lo attraversano solo
       le mosse SONORE (il fantoccio non tappa le orecchie) e quelle che per
       definizione lo ignorano — Turbine, Boato: non colpiscono, spingono.
       Sono i flag `sonora` e `bucaSub`, estratti da `MoveFlags.SOUND_BASED` e
       `MoveFlags.IGNORE_SUBSTITUTE` dell'originale (vedi `hitsSubstitute`). */
    const colpisceSub = foe !== actor && foe.volatile.sub > 0
      && !move.sonora && !move.bucaSub && !BERSAGLIO_SU_DI_SE.has(move.target);
    if (colpisceSub && move.category === "STATUS") {
      moveInst.pp = Math.max(0, moveInst.pp - 1);
      messages.push(`${actor.name} usa ${move.it}!`);
      messages.push(`Il sostituto di ${foe.name} para tutto!`);
      return;
    }

    /* 1-nonies. La mossa ha una CONDIZIONE? Se non e' soddisfatta fallisce,
       consumando il PP come nei giochi veri. */
    if (CONDIZIONI[move.id] && !CONDIZIONI[move.id](actor, foe, move)) {
      moveInst.pp = Math.max(0, moveInst.pp - 1);
      messages.push(`${actor.name} usa ${move.it}!`);
      stessoMomento(messages, "Ma non ha funzionato!");
      actor.volatile.fallita = true;        // lo legge Pestone
      return;
    }

    /* 2. consuma PP e annuncia.
       ⚠️ Sul bersaglio IN PIU' di una mossa ad area non si riconsuma il PP e
       non si riannuncia la mossa: e' lo stesso colpo, non un secondo colpo. */
    if (!extra) moveInst.pp = Math.max(0, moveInst.pp - 1);
    // PRESSIONE: chi attacca chi ce l'ha consuma un PP in piu'
    if (!extra && foe !== actor && ha(foe, "PRESSURE")) moveInst.pp = Math.max(0, moveInst.pp - 1);
    /* Indice dell'annuncio: e' QUI che va appesa l'animazione della mossa,
       perche' e' l'unico evento che fotografa il campo prima del colpo. */
    const iAnnuncio = messages.length;
    if (extra) messages.push(`…e colpisce anche ${foe.name}!`);
    else messages.push(`${actor.name} usa ${move.it}!`);
    // Mosse a due turni (Volo, Solarraggio...): da noi colpiscono subito, ma
    // l'animazione di CARICA si vede lo stesso, su chi la usa, prima del colpo.
    if (move.charging && messages.anim) messages.anim("CHARGE_" + move.id, sideOf(actor));

    // 3. precisione (stadi + abilita' di precisione/elusione). accuracy -1 = sempre a segno
    // Localizza e Leggimente: il colpo va a segno comunque, e la mira si consuma
    if (actor.volatile.mirino) { actor.volatile.mirino = false; }
    // NULLODIFESA: le mosse vanno sempre a segno, sue e di chi lo attacca
    else if (ha(actor, "NO_GUARD") || ha(foe, "NO_GUARD")) { /* colpo garantito */ }
    else if (move.accuracy !== -1) {
      // Grandelente: +5% di precisione per pezzo
      const lente = 1 + 0.05 * ((actor.held && actor.held.widelens) || 0);
      const chance = move.accuracy * accMult(actor.stages.acc + tempAccStages(actor) - foe.stages.eva)
        * abStatMult(actor, "ACC") * lente / abStatMult(foe, "EVA");
      if (Math.random() * 100 >= chance) {
        stessoMomento(messages, `${actor.name} ha mancato il bersaglio!`);
        /* Un colpo a vuoto SPEZZA il vincolo: la furia si placa (e chi si placa
           resta confuso), il rotolamento riparte da trenta. E' la regola dei
           giochi ed e' `frenzyMissFunc` nell'originale. */
        spezzaVincolo(actor, messages, false);
        return;
      }
    }

    /* Le tre immunita' che riguardano le mosse di STATO (vedi `statoImmune`).
       Non passano da `doDamage`, quindi senza questo controllo andavano a
       segno comunque: Spora addormentava gli Erba e Ondatrona paralizzava i
       Terra. */
    if (statoImmune(move, actor, foe)) {
      stessoMomento(messages, `Non ha effetto su ${foe.name}...`);
      actor.volatile.fallita = true;
      spezzaVincolo(actor, messages, false);
      return;
    }
    actor.volatile.fallita = false;   // e' partita: Pestone torna a potenza normale
    /* I VINCOLI (furia, rotolamento, baraonda) si contano da qui: la mossa e'
       partita e ha superato la precisione. Prima del danno, perche' la potenza
       di Rotolamento dipende da quanti colpi ha gia' messo a segno. */
    if (!extra) aggiornaVincolo(actor, move, moveInst, messages);
    /* 🔴 MOSSE ESPLOSIVE: chi le usa va KO, sempre, anche se il colpo non
       fa danno o il bersaglio e' immune. Nei dati non c'e' traccia del
       sacrificio (nell'originale e' `SacrificialAttr`, che l'estrattore non
       traduce): erano attacchi da 250 di potenza senza contropartita, cioe' la
       mossa migliore del gioco.
       ⚠️ Il KO si segna PRIMA del colpo e si applica DOPO: nell'originale chi
       esplode cade comunque, ma il danno lo fa lo stesso. */
    const sacrificio = ESPLOSIVE.has(move.id);
    // 4. danno (se e' una mossa d'attacco)
    let landed = true;
    if (move.category !== "STATUS" && move.power > 0) {
      landed = doDamage(actor, foe, move, messages);
      // effetto visivo sul bersaglio: l'animazione vera della mossa se esiste,
      // altrimenti le particelle per tipo. Il prefetch parte ora, cosi' al
      // momento di mostrarla il file e' gia' in memoria.
      // ⚠️ Se i colpi sono stati separati l'animazione ce l'ha gia' ognuno:
      // rimetterla sull'annuncio vorrebbe dire vederla una volta di troppo.
      if (landed && messages.fx && !messages._colpiSeparati) {
        const key = animKeyForMove(move.id);   // la sua, o quella di ripiego
        prefetchAnim(key);
        segnaFx(messages, iAnnuncio, move.type, sideOf(foe), key, sideOf(actor));
      }
    } else if (move.category !== "STATUS") {
      // mossa d'attacco senza potenza fissa nei dati (`power: -1`)
      landed = dannoSenzaPotenza(actor, foe, move, messages);
      if (landed && messages.fx) {
        const key = animKeyForMove(move.id);
        prefetchAnim(key);
        segnaFx(messages, iAnnuncio, move.type, sideOf(foe), key, sideOf(actor));
      }
    } else if (move.category === "STATUS" && messages.fx) {
      /* [ATTENZIONE] L animazione di una mossa di stato si ancora a CHI LA
         SUBISCE, e per le mosse su di se quello e chi la usa. Il commento di
         prima lo diceva, ma il codice passava sempre il nemico: Danzaspada,
         Agilita e tutti i buff si vedevano scoppiare addosso all avversario.
         E lo stesso equivoco di Gridodilotta (§44.1): la direzione la da il
         BERSAGLIO DELLA MOSSA, non il parametro foe, che per le mosse senza
         scelta resta l avversario di ufficio. */
      /* Maledizione e due mosse in una: da SPETTRO colpisce il bersaglio, da
         chiunque altro e un buff su di se. Anche l animazione va di conseguenza. */
      const suDiSe = BERSAGLIO_SU_DI_SE.has(move.target)
        || (move.id === "CURSE" && !actor.types.includes("GHOST"));
      const chiSubisce = suDiSe ? actor : foe;
      const key = animKeyForMove(move.id);
      prefetchAnim(key);
      segnaFx(messages, iAnnuncio, move.type, sideOf(chiSubisce), key, sideOf(actor));
    }

    // 4-bis. mosse che cambiano il METEO (l'estrattore non le marca: sono poche
    // e note per nome, come SUNNY_DAY/RAIN_DANCE/SANDSTORM/HAIL).
    if (WEATHER_MOVES[move.id]) {
      setWeather(WEATHER_MOVES[move.id], messages, actor.name);
      if (messages.anim) messages.anim("COMMON_" + WEATHER_ANIM[WEATHER_MOVES[move.id]], sideOf(actor));
    }

    /* 4-ter. ACCUMULO e INTROENERGIA. Nei dati sono mosse di stato senza
       mattoncini riconosciuti, quindi non facevano nulla — e senza Accumulo
       Sfoghenergia non poteva funzionare: le tre vanno tenute insieme. */
    if (move.id === "STOCKPILE") accumula(actor, messages);
    if (move.id === "SWALLOW") {
      const n = actor.volatile.accumulo || 0;
      if (!n) messages.push(`${actor.name} non ha accumulato energia!`);
      else if (actor.hp >= actor.maxHp) { scaricaAccumulo(actor, messages); stessoMomento(messages, "Ma i PS erano già pieni!"); }
      else {
        // 1 carica = 1/4 dei PS, 2 = metà, 3 = tutti
        const quota = n === 1 ? 0.25 : n === 2 ? 0.5 : 1;
        actor.hp = Math.min(actor.maxHp, actor.hp + Math.ceil(actor.maxHp * quota));
        scaricaAccumulo(actor, messages);
        stessoMomento(messages, `${actor.name} recupera energie!`);
        if (messages.anim) messages.anim("COMMON_HEALTH_UP", sideOf(actor));
      }
    }

    // 4-quater. le mosse che l'estrattore non sa tradurre (vedi MOSSE_SPECIALI)
    game.ultimaMossa = mossaPrimaDiQuesta;   // Copione guarda indietro, non a se'
    if (MOSSE_SPECIALI[move.id]) MOSSE_SPECIALI[move.id](actor, foe, move, messages);
    game.ultimaMossa = moveInst.id;

    // 5. effetti (mattoncini). Se la mossa da danno non e' andata a segno, niente effetti.
    // chi ha incassato e' il fantoccio: gli effetti secondari non passano
    if (landed && !colpisceSub) applyMoveAttrs(actor, foe, move, messages);
    if (sacrificio && !actor.fainted) {
      actor.hp = 0; actor.fainted = true; actor._justHit = true;
      if (messages.snap) messages.snap();
      messages.push(`${actor.name} si sacrifica nell'esplosione!`);
    }
    // la furia che si spegne, il rotolamento arrivato al quinto: si legge ORA,
    // dopo il colpo, non prima
    if (!extra) chiudiVincoli(actor, messages);
  }

  /* ======================================================================
     FRASI DELLO STESSO MOMENTO

     `messages.push` apre una schermata nuova (= un tocco). `stessoMomento`
     invece attacca la riga a quella appena detta, perché certe frasi non sono
     un momento a sé: «Zubat usa Velenospina!» e «È superefficace!» sono la
     stessa cosa vista da due lati, e leggerle in due tocchi spezza l'azione.

     La regola che ho seguito, guardando cosa si legge davvero:
       INSIEME  l'annuncio della mossa e com'è andata (efficacia, critico,
                mancata, immunità, colpi multipli), contraccolpo e
                assorbimento, la vittoria e i soldi, i passaggi di livello;
       A PARTE  il KO (è un momento suo), gli stati applicati e i danni di
                fine turno (hanno la loro animazione), evoluzioni e schiuse,
                e tutto ciò che chiede una decisione.
     ====================================================================== */
  function stessoMomento(messages, t) {
    if (!messages || !t) return;
    if (messages.add) { messages.add(t); return; }        // log di battaglia
    if (!messages.length) { messages.push(t); return; }
    const ultimo = messages[messages.length - 1];
    // il messaggio puo' essere un oggetto `{text, ball}` (vedi `conBall`)
    if (ultimo && typeof ultimo === "object") ultimo.text += "\n" + t;
    else messages[messages.length - 1] += "\n" + t;
  }

  /* ======================================================================
     MOSSE SENZA POTENZA FISSA (`power: -1` nei dati)

     Erano 75 e non facevano NIENTE: né danno né animazione, perché il motore
     entrava nel ramo del danno solo con `power > 0`. 36 sono mosse Z, che nel
     gioco non compaiono mai; le altre 39 sono mosse vere, e diverse sono
     classiche (Movimento Sismico, Superzanna, Colpo Basso, Flagello…).

     Due famiglie:
       DANNO FISSO      il danno è un numero, non passa dalla formula
                        (`FixedDamageAttr` e derivate dell'originale)
       POTENZA VARIABILE la potenza si calcola e poi il danno è quello normale

     ✅ **Le ultime 9 sono state chiuse il 2026-08-14** (§31): ora il motore
     tiene il danno subito nel turno (`dannoSubitoTurno`), l'energia accumulata
     con Accumulo (`volatile.accumulo`) e i due turni di Pazienza
     (`volatile.bide`). `POTENZA_RIPIEGO` resta solo come rete di sicurezza per
     una mossa che un domani arrivasse senza formula.
     ====================================================================== */
  const DANNO_FISSO = {
    /* MOSSE DI RIMANDO: restituiscono un multiplo del danno appena incassato.
       Se non hai preso niente falliscono (`d <= 0` più sotto), come nei giochi. */
    COUNTER:      (a) => 2 * dannoSubito(a, "fisico"),
    MIRROR_COAT:  (a) => 2 * dannoSubito(a, "speciale"),
    METAL_BURST:  (a) => Math.floor(1.5 * dannoSubito(a, "tutto")),
    COMEUPPANCE:  (a) => Math.floor(1.5 * dannoSubito(a, "tutto")),
    SONIC_BOOM:   () => 20,
    DRAGON_RAGE:  () => 40,
    SEISMIC_TOSS: (a) => a.level,
    NIGHT_SHADE:  (a) => a.level,
    PSYWAVE:      (a) => Math.max(1, Math.floor(a.level * (0.5 + Math.random()))),
    SUPER_FANG:      (a, d) => Math.max(1, Math.floor(d.hp / 2)),
    NATURES_MADNESS: (a, d) => Math.max(1, Math.floor(d.hp / 2)),
    RUINATION:       (a, d) => Math.max(1, Math.floor(d.hp / 2)),
    GUARDIAN_OF_ALOLA: (a, d) => Math.max(1, Math.floor(d.hp * 0.75)),
    // Rimonta: pareggia i PS, solo se chi la usa ne ha meno
    ENDEAVOR:     (a, d) => Math.max(0, d.hp - a.hp),
    // Azzardo: infligge i PS di chi la usa, che poi cade
    FINAL_GAMBIT: (a) => a.hp,
  };

  /* 🔴 MOSSE CON UNA CONDIZIONE. Certe mosse non funzionano sempre: hanno
     una regola sul QUANDO. Nell'originale e' un `.condition(...)` a parte dai
     mattoncini, e l'estrattore prende solo i `.attr(...)`: da noi arrivavano
     senza nessun vincolo e funzionavano ogni volta.
     Bruciapelo, per dirne una, si poteva usare a ogni turno: una mossa che fa
     tentennare a colpo sicuro con priorita' +3, per tutta la lotta.
     Ognuna risponde «si» o «no»; il «no» fa fallire la mossa consumandone il
     PP, come nei giochi veri. */
  const CONDIZIONI = {
    // solo al PRIMO turno da quando si e' entrati in campo
    FAKE_OUT:         a => a.volatile.turniInCampo === 0,
    FIRST_IMPRESSION: a => a.volatile.turniInCampo === 0,
    MAT_BLOCK:        a => a.volatile.turniInCampo === 0,
    /* Sbigattacco va a segno solo se il bersaglio sta per ATTACCARE: adesso
       che la coda del turno e' leggibile (`game._coda`) si puo' sapere. */
    SUCKER_PUNCH: (a, f) => {
      const q = game._coda || [];
      const az = q.find((x, k) => k > game._codaI && x.actor === f);
      return !!(az && M[az.move.id] && M[az.move.id].category !== "STATUS");
    },
    // Ultimascelta: solo dopo aver usato TUTTE le altre mosse
    LAST_RESORT: a => a.moves.length > 1
      && a.moves.every(m => m.id === "LAST_RESORT" || (a.volatile.usate || []).includes(m.id)),
    // Rutto: serve avere mangiato una bacca
    BELCH: a => !!a.volatile.bacciaFinita,
    // Mangiasogni: solo su chi dorme
    DREAM_EATER: (a, f) => f.status === "SLEEP",
    // Russare: si usa DORMENDO (e infatti non ci si arriva da svegli)
    SNORE: a => a.status === "SLEEP",
  };

  /* Le mosse che mettono KO CHI LE USA. Nell'originale sono `SacrificialAttr`
     (esplosive) e `SacrificialAttrOnHit`; da noi non arrivavano affatto. */
  const ESPLOSIVE = new Set(["EXPLOSION", "SELF_DESTRUCT", "MISTY_EXPLOSION",
                             "MEMENTO", "HEALING_WISH", "LUNAR_DANCE", "FINAL_GAMBIT"]);

  /* Potenza calcolata. Le formule sono quelle dei giochi. */
  const POTENZA_VARIABILE = {
    // per PESO del bersaglio (kg)
    LOW_KICK:   (a, d) => pesoPotenza(S[d.speciesId].weight),
    GRASS_KNOT: (a, d) => pesoPotenza(S[d.speciesId].weight),
    // per RAPPORTO di peso fra chi attacca e chi subisce
    HEAVY_SLAM: (a, d) => rapportoPeso(a, d),
    HEAT_CRASH: (a, d) => rapportoPeso(a, d),
    // per VELOCITÀ
    GYRO_BALL:    (a, d) => Math.max(1, Math.min(150, Math.floor(25 * d.stats.spd / Math.max(1, a.stats.spd)))),
    ELECTRO_BALL: (a, d) => { const r = a.stats.spd / Math.max(1, d.stats.spd);
      return r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40; },
    // per PS RIMASTI di chi la usa (più è ridotto, più fa male)
    FLAIL:    (a) => scalaHp(a.hp / a.maxHp),
    REVERSAL: (a) => scalaHp(a.hp / a.maxHp),
    // per PS RIMASTI del bersaglio
    WRING_OUT:   (a, d) => Math.max(1, Math.floor(120 * d.hp / d.maxHp)),
    CRUSH_GRIP:  (a, d) => Math.max(1, Math.floor(120 * d.hp / d.maxHp)),
    HARD_PRESS:  (a, d) => Math.max(1, Math.floor(100 * d.hp / d.maxHp)),
    // per quante volte il bersaglio si è potenziato
    PUNISHMENT: (a, d) => Math.min(200, 60 + 20 * Object.values(d.stages).filter(v => v > 0).reduce((s, v) => s + v, 0)),
    /* 🔴 Tre potenze che dipendono dal MOMENTO, non da un numero: nei dati
       hanno la potenza base e nessuno le raddoppiava mai. */
    // Contropiede: doppio se si agisce DOPO il bersaglio (l'ha gia' usata)
    PAYBACK: (a, d) => (d.volatile && d.volatile.lastMove ? 100 : 50),
    // Acrobazia: doppia se non si tiene niente
    ACROBATICS: a => (Object.keys(a.held || {}).length || Object.keys(a.berries || {}).length) ? 55 : 110,
    // Pestone: doppio se la mossa precedente e' fallita
    STOMPING_TANTRUM: a => (a.volatile && a.volatile.fallita ? 150 : 75),
    // per PP rimasti (l'ultimo colpo è devastante)
    TRUMP_CARD: (a, _d, m) => { const pp = (a.moves.find(x => x.id === m.id) || {}).pp || 0;
      return pp >= 4 ? 40 : pp === 3 ? 50 : pp === 2 ? 60 : pp === 1 ? 80 : 200; },
    MAGNITUDE: () => [10, 30, 50, 70, 90, 110, 150][Math.floor(Math.random() * 7)],
    PRESENT:   () => [40, 80, 120][Math.floor(Math.random() * 3)],
    // amicizia: non la teniamo, si usa il valore di una squadra affiatata
    RETURN: () => 102, PIKA_PAPOW: () => 102, VEEVEE_VOLLEY: () => 102,
    FRUSTRATION: () => 60,
    /* PICCHIADURO: colpisce una volta per ogni membro sano della squadra
       (`rollMultiHit` con mode BEAT_UP) e ogni colpo vale `Attacco base / 10 + 5`
       di QUEL membro. Il motore usa una potenza sola per tutti i colpi, quindi
       si passa la MEDIA: il totale è lo stesso, cambia solo che i colpi sono
       tutti uguali invece che uno per compagno.
       ⚠️ Qui NON si somma: il numero di colpi ce lo mette già il mattoncino
       multi-colpo, e sommare avrebbe contato la squadra due volte. */
    BEAT_UP: (a) => { const s = squadraDi(a);
      return s.reduce((t, p) => t + Math.floor((((S[p.speciesId] || {}).baseStats || {}).atk || 50) / 10) + 5, 0)
             / Math.max(1, s.length); },
  };
  /* Rete di sicurezza: nessuna mossa in gioco ci finisce più (§31), ma se un
     domani ne arrivasse una senza formula meglio un colpo che un buco. */
  const POTENZA_RIPIEGO = 60;

  /* La squadra di un combattente: la tua, o il roster dell'allenatore.
     Un selvatico è solo. Serve a Picchiaduro. */
  function squadraDi(f) {
    if (game.party.includes(f)) return game.party.filter(p => !p.fainted);
    const roster = (game.trainerRoster || []).filter(m => !m.fainted);
    return roster.includes(f) ? roster : [f];
  }

  /* DONONATURALE: la bacca tenuta diventa il colpo, e ne detta TIPO e potenza.
     Valori dei giochi per le 11 bacche che abbiamo. */
  const BACCA_DONO = {
    SITRUS: { tipo: "PSYCHIC",  pot: 80 },  LUM:    { tipo: "FLYING",   pot: 80 },
    LEPPA:  { tipo: "FIGHTING", pot: 80 },  ENIGMA: { tipo: "BUG",      pot: 100 },
    LIECHI: { tipo: "GRASS",    pot: 100 }, GANLON: { tipo: "ICE",      pot: 100 },
    PETAYA: { tipo: "POISON",   pot: 100 }, APICOT: { tipo: "GROUND",   pot: 100 },
    SALAC:  { tipo: "FIGHTING", pot: 100 }, LANSAT: { tipo: "FLYING",   pot: 100 },
    STARF:  { tipo: "PSYCHIC",  pot: 100 },
  };
  /* LANCIO: la potenza è quella dell'oggetto tirato, come nei giochi.
     Gli oggetti che non stanno in tabella valgono 30, il valore più comune. */
  const FLING_POT = {
    gripclaw: 90, quickclaw: 80, leek: 60, eviolite: 40, mysticalrock: 60,
    kingsrock: 30, toxicorb: 30, flameorb: 30, shellbell: 30, scopelens: 30,
    souldew: 30, blackhole: 30, reviverseed: 30,
    leftovers: 10, focusband: 10, widelens: 10, multilens: 10,
  };
  const primaBacca   = (f) => Object.keys(f.berries || {}).find(k => f.berries[k] > 0 && BACCA_DONO[k]);
  const primoOggetto = (f) => Object.keys(f.held || {}).find(k => k !== "typeboost" && f.held[k] > 0);

  const pesoPotenza = (kg) => !kg ? 40
    : kg >= 200 ? 120 : kg >= 100 ? 100 : kg >= 50 ? 80 : kg >= 25 ? 60 : kg >= 10 ? 40 : 20;
  function rapportoPeso(a, d) {
    const pa = S[a.speciesId].weight || 1, pd = S[d.speciesId].weight || 1;
    const r = pa / pd;
    return r >= 5 ? 120 : r >= 4 ? 100 : r >= 3 ? 80 : r >= 2 ? 60 : 40;
  }
  const scalaHp = (f) => f > 0.6875 ? 20 : f > 0.3542 ? 40 : f > 0.2083 ? 80
    : f > 0.1042 ? 100 : f > 0.0417 ? 150 : 200;

  /* Appende l'animazione della mossa all'evento dell'annuncio. Se il log non
     sa farlo (array semplice usati da qualche chiamante) si ripiega sull'ultimo. */
  /* `side` = slot di chi SUBISCE · `from` = slot di chi ATTACCA. Servono
     entrambi: in doppio il mittente non si puo' piu' dedurre ribaltando il
     destinatario, perche' i lati non sono due ma quattro. */
  function segnaFx(messages, i, type, side, key, from) {
    if (messages.fxAt) messages.fxAt(i, type, side, key, from);
    else messages.fx(type, side, key, from);
  }

  // Blocchi di stato prima della mossa. Ritorna false se l'attore non agisce.
  function canAct(actor, messages) {
    // RICARICA: dopo Iper Raggio & co. si salta il turno
    if (actor.volatile.recharge) {
      actor.volatile.recharge = false;
      messages.push(`${actor.name} deve ricaricarsi!`);
      return false;
    }
    // Nota: ogni blocco di stato mostra l'animazione comune di quello stato,
    // ancorata a chi lo subisce (vale per entrambi i lati).
    if (actor.status === "FREEZE") {
      if (Math.random() < 0.2) { actor.status = null; messages.push(`${actor.name} si è scongelato!`); }
      else {
        messages.push(`${actor.name} è congelato e non può muoversi!`);
        if (messages.anim) messages.anim("COMMON_FROZEN", sideOf(actor));
        return false;
      }
    }
    if (actor.status === "SLEEP") {
      if (actor.sleepTurns <= 0) { actor.status = null; messages.push(`${actor.name} si è svegliato!`); }
      else {
        // SVEGLIALAMPO: ci si sveglia il doppio piu' in fretta
        actor.sleepTurns -= ha(actor, "EARLY_BIRD") ? 2 : 1;
        if (actor.sleepTurns < 0) actor.sleepTurns = 0;
        messages.push(`${actor.name} sta dormendo.`);
        if (messages.anim) messages.anim("COMMON_SLEEP", sideOf(actor));
        return false;
      }
    }
    /* FORZA INTERIORE: non tentenna mai. */
    if (actor.volatile.flinch && ha(actor, "INNER_FOCUS")) actor.volatile.flinch = false;
    if (actor.volatile.flinch) { messages.push(`${actor.name} ha tentennato!`); return false; }
    // SBADIGLIO: al secondo turno si addormenta
    if (actor.volatile.drowsy > 0 && --actor.volatile.drowsy <= 0) {
      actor.volatile.drowsy = 0;
      applyStatus(actor, "SLEEP", messages);
    }
    // ATTRAZIONE: una volta su due non si agisce
    if (actor.volatile.infatuated) {
      messages.push(`${actor.name} è infatuato!`);
      if (Math.random() < 0.5) { messages.push(`${actor.name} è troppo preso e non attacca!`); return false; }
    }
    if (actor.status === "PARALYSIS" && Math.random() < 0.25) {
      messages.push(`${actor.name} è paralizzato e non può muoversi!`);
      if (messages.anim) messages.anim("COMMON_PARALYSIS", sideOf(actor));
      return false;
    }
    if (actor.volatile.confusion > 0) {
      actor.volatile.confusion--;
      if (actor.volatile.confusion === 0) messages.push(`${actor.name} è uscito dalla confusione!`);
      else {
        messages.push(`${actor.name} è confuso!`);
        if (messages.anim) messages.anim("COMMON_CONFUSION", sideOf(actor));
        if (Math.random() < 1 / 3) {
          const d = confusionDamage(actor);
          actor.hp = Math.max(0, actor.hp - d); actor._justHit = true;
          messages.push("Si è ferito da solo nella confusione!");
          if (actor.hp <= 0) { actor.fainted = true; messages.push(`${actor.name} è esausto!`); }
          return false;
        }
      }
    }
    return true;
  }

  // Numero di colpi per le mosse multi-colpo.
  function rollMultiHit(mode, actor) {
    if (mode === "TWO") return 2;
    if (mode === "THREE") return 3;
    /* PICCHIADURO: un colpo per ogni membro sano della squadra. Il dato lo
       marcava gia' come multi-colpo, ma `mode: "BEAT_UP"` non era gestito e
       finiva nella distribuzione casuale 2-5. */
    if (mode === "BEAT_UP") return actor ? Math.max(1, squadraDi(actor).length) : 1;
    const r = Math.random(); // distribuzione classica 2-5
    return r < 0.35 ? 2 : r < 0.70 ? 3 : r < 0.85 ? 4 : 5;
  }

  /* Danno delle mosse che nei dati non hanno potenza. Ritorna true se il colpo
     è andato a segno (serve a decidere se applicare gli effetti). */
  function dannoSenzaPotenza(actor, foe, move, messages) {
    // l'immunità di tipo vale anche per il danno fisso
    if (typeMultiplier(move.type, foe.types) === 0) {
      stessoMomento(messages, `Non ha effetto su ${foe.name}...`);
      return false;
    }
    const fisso = DANNO_FISSO[move.id];
    if (fisso) {
      const d = Math.max(0, Math.floor(fisso(actor, foe, move)));
      if (d <= 0) { stessoMomento(messages, "Ma non ha funzionato!"); return false; }
      const dato = bossClamp(foe, d, messages);      // gli scudi del boss valgono comunque
      foe.hp = Math.max(0, foe.hp - dato); foe._justHit = true;
      segnaDannoSubito(foe, actor, move, dato);
      if (messages.snap) messages.snap();
      stessoMomento(messages, `${foe.name} perde ${dato} PS!`);
      if (foe.hp <= 0) foe.fainted = true;
      // Azzardo: chi la usa ci rimette tutto
      if (move.id === "FINAL_GAMBIT") {
        actor.hp = 0; actor.fainted = true; actor._justHit = true;
        stessoMomento(messages, `${actor.name} ci ha messo tutto!`);
      }
      return true;
    }
    /* MOSSE CHE POSSONO NON PARTIRE: senza bacca, senza oggetto o senza
       energia accumulata nei giochi falliscono — non fanno 1 danno. */
    if (move.id === "NATURAL_GIFT" && !primaBacca(actor)) {
      stessoMomento(messages, `${actor.name} non ha bacche da usare!`); return false;
    }
    if (move.id === "FLING" && !primoOggetto(actor)) {
      stessoMomento(messages, `${actor.name} non ha niente da lanciare!`); return false;
    }
    if (move.id === "SPIT_UP" && !(actor.volatile.accumulo || 0)) {
      stessoMomento(messages, `${actor.name} non ha accumulato energia!`); return false;
    }

    // potenza calcolata: da qui in poi è un colpo normale
    let mossa = move, potenza;
    if (move.id === "NATURAL_GIFT") {
      const k = primaBacca(actor), b = BACCA_DONO[k];
      actor.berries[k]--; if (!actor.berries[k]) delete actor.berries[k];
      potenza = b.pot;
      /* ⚠️ Il Dononaturale PRENDE il tipo della bacca. `computeDamage` legge il
         tipo dall'oggetto mossa che gli si passa, quindi basta una copia: non
         si tocca `M[...]`, che è condiviso da tutti (§8). */
      mossa = { ...move, type: b.tipo };
      stessoMomento(messages, `La ${BERRY_DATA[k].it} si trasforma in un colpo di tipo ${T[b.tipo].it}!`);
    } else if (move.id === "FLING") {
      const k = primoOggetto(actor);
      potenza = FLING_POT[k] || 30;
      actor.held[k]--; if (!actor.held[k]) delete actor.held[k];
      recomputeStats(actor);                 // l'oggetto se n'è andato
      stessoMomento(messages, `${actor.name} scaglia il suo oggetto!`);
    } else if (move.id === "SPIT_UP") {
      potenza = 100 * actor.volatile.accumulo;
      scaricaAccumulo(actor, messages);
    } else {
      const f = POTENZA_VARIABILE[move.id];
      potenza = f ? Math.max(1, Math.floor(f(actor, foe, move))) : POTENZA_RIPIEGO;
    }
    return doDamage(actor, foe, mossa, messages, potenza);
  }

  /* ----------------------------------------------------------------------
     ACCUMULO / SFOGHENERGIA / INTROENERGIA — la tripletta va tenuta insieme.
     Accumulo sale fino a 3 e dà +1 Difesa e +1 Difesa Speciale per carica;
     scaricando (Sfoghenergia o Introenergia) si restituiscono gli stadi.
     ---------------------------------------------------------------------- */
  function accumula(f, messages) {
    if ((f.volatile.accumulo || 0) >= 3) {
      stessoMomento(messages, `${f.name} non può accumulare altro!`); return false;
    }
    f.volatile.accumulo = (f.volatile.accumulo || 0) + 1;
    f.stages.def = Math.min(6, f.stages.def + 1);
    f.stages.spdef = Math.min(6, f.stages.spdef + 1);
    messages.push(`${f.name} accumula energia! (${f.volatile.accumulo})`);
    return true;
  }
  function scaricaAccumulo(f, messages) {
    const n = f.volatile.accumulo || 0;
    if (!n) return 0;
    f.volatile.accumulo = 0;
    f.stages.def = Math.max(-6, f.stages.def - n);
    f.stages.spdef = Math.max(-6, f.stages.spdef - n);
    stessoMomento(messages, `${f.name} libera l'energia accumulata!`);
    return n;
  }

  /* ABILITÀ CHE SCATTANO DOPO UN KO (`PostVictoryStatStageChangeAbAttr`).
     Arroganza e Nitrito Bianco alzano l'Attacco, Nitrito Nero l'Att. Speciale,
     **Ultraboost** alza la statistica PIÙ ALTA di chi ha messo KO — ed è quella
     vera, calcolata sulle statistiche del momento, non su quelle base.
     Prima queste quattro abilità non facevano assolutamente nulla. */
  const STAT_PER_ABIL = ["atk", "def", "spatk", "spdef", "spd"];
  function applyPostVictory(vincitore, messages) {
    if (!vincitore || vincitore.fainted) return;
    const a = findAb(vincitore, "postVictoryStat");
    if (!a) return;
    if (a.piuAlta) {
      // la più alta fra Att, Dif, Att.Sp, Dif.Sp, Vel (i PS non contano)
      let migliore = STAT_PER_ABIL[0];
      for (const k of STAT_PER_ABIL) if (vincitore.stats[k] > vincitore.stats[migliore]) migliore = k;
      applyStatStage(vincitore, [migliore.toUpperCase()], a.stages || 1, messages, true);
    } else {
      for (const c of (a.changes || [])) applyStatStage(vincitore, [c.stat], c.stages, messages, true);
    }
  }

  // Applica il danno (gestisce OHKO, multi-colpo, critico, drain, contraccolpo).
  // Ritorna true se la mossa ha colpito (non immune).
  function doDamage(actor, foe, move, messages, potenza) {
    /* [ATTENZIONE] Si azzera QUI, non alla fine: il contrassegno vale per la
       singola mossa, ma il log e di tutto il turno. Lasciandolo acceso, dopo
       una mossa multi-colpo la mossa SEGUENTE restava senza animazione. */
    if (messages) messages._colpiSeparati = false;
    const attrs = move.attrs || [];
    const forceCrit = attrs.some(a => a.kind === "critOnly");
    const highCrit = attrs.some(a => a.kind === "highCrit");
    const multi = attrs.find(a => a.kind === "multiHit");

    // abilita' del difensore: immunita' a un tipo di mossa (Levitazione) o
    // assorbimento (Assorbivolt/Assorbacqua: immune + recupera HP).
    /* IMMUNITÀ DI TIPO CHE DANNO UN PREMIO: Fuocardore, Mangiaerba,
       Parafulmine, Assorbivolt d'acqua… Nell'originale sono classi a se';
       qui una tabella sola, perche' fanno tutte la stessa cosa: annullano il
       colpo e in cambio danno qualcosa. */
    const DONO_IMMUNITA = {
      FLASH_FIRE:    { tipo: "FIRE",     fai: (d) => { d.volatile.fuocardore = true; }, testo: "si infiamma: le sue mosse di Fuoco sono più forti!" },
      SAP_SIPPER:    { tipo: "GRASS",    stat: "ATK",   testo: "assorbe l'erba!" },
      LIGHTNING_ROD: { tipo: "ELECTRIC", stat: "SPATK", testo: "attira il fulmine!" },
      MOTOR_DRIVE:   { tipo: "ELECTRIC", stat: "SPD",   testo: "si carica!" },
      STORM_DRAIN:   { tipo: "WATER",    stat: "SPATK", testo: "raccoglie l'acqua!" },
      WELL_BAKED_BODY:{ tipo: "FIRE",    stat: "DEF",   stadi: 2, testo: "si cuoce a puntino!" },
    };
    for (const id in DONO_IMMUNITA) {
      const d = DONO_IMMUNITA[id];
      if (d.tipo !== move.type || !ha(foe, id)) continue;
      stessoMomento(messages, `${foe.name} è immune: ${d.testo}`);
      if (d.stat) applyStatStage(foe, [d.stat], d.stadi || 1, messages, true);
      if (d.fai) d.fai(foe);
      return false;
    }
    const imm = abAttrs(foe).find(a => (a.kind === "typeImmunity" || a.kind === "typeAbsorb") && a.moveType === move.type);
    if (imm) {
      stessoMomento(messages, `${foe.name} è immune grazie a ${foe.ability.it}!`);
      if (imm.kind === "typeAbsorb" && foe.hp < foe.maxHp) {
        foe.hp = Math.min(foe.maxHp, foe.hp + Math.max(1, Math.floor(foe.maxHp / 4)));
        messages.push(`${foe.name} ha recuperato energie!`);
      }
      return false;
    }

    if (attrs.some(a => a.kind === "ohko")) {
      if (typeMultiplier(move.type, foe.types) === 0) { messages.push(`Non ha effetto su ${foe.name}...`); return false; }
      if (foe.boss) { messages.push(`Gli scudi del boss annullano il colpo!`); return true; }
      if (ha(foe, "STURDY")) { messages.push(`${nomeAb(foe, "STURDY")}: il colpo da KO non funziona su ${foe.name}!`); return false; }
      foe.hp = 0; foe._justHit = true; foe.fainted = true;
      messages.push("KO in un colpo solo!"); messages.push(`${foe.name} è esausto!`);
      return true;
    }

    // Multilente: un colpo in piu' (a danno ridotto, come nell'originale)
    const lens = (actor.held && actor.held.multilens) || 0;
    const hits = (multi ? rollMultiHit(multi.mode, actor) : 1) + lens;
    const lensPenalty = lens ? 1 / (1 + lens) : 1;
    // Mirino / Baccalangsa / Supercolpo alzano la probabilita' di brutto colpo
    /* Focalenergia e Grido del Drago valgono DUE stadi di brutto colpo, come
       nell'originale; Concentrazione lo garantisce e si consuma al primo
       colpo utile. */
    const laserPronto = !!actor.volatile.laser;
    if (laserPronto) actor.volatile.laser = false;
    const critBonus = (ha(actor, "SUPER_LUCK") ? 1 : 0)      // SUPERSORTE
                    + (actor.volatile.focus ? 2 : 0)
                    + (actor.held && actor.held.scopelens ? 1 : 0)
                    + (actor.held && actor.held.leek && ["FARFETCHD", "SIRFETCHD"].includes(actor.speciesId) ? 2 : 0)
                    + (actor._lansat ? 2 : 0)
                    + (actor === game.player && game.tempBoost.crit > 0 ? 1 : 0);
    let total = 0, lastEff = 1, anyCrit = false, immune = false, done = 0;
    for (let h = 0; h < hits; h++) {
      /* 🔴 VIGORE guarda i PS QUI, PRIMA DI QUESTO COLPO — non prima
         dell'intera mossa. Con l'istantanea presa fuori dal ciclo restava
         «era a PS pieni» per tutti e cinque i colpi di Semitraglia, e il
         Pokemon si salvava OGNI VOLTA: invincibile ai colpi multipli, non
         aggirato. Con il controllo dal vivo il primo colpo lo lascia a 1 PS e
         dal secondo muore — che è esattamente cosa fa nei giochi veri
         (`PreDefendFullHpEndureAbAttr`: `pokemon.isFullHp()` al momento del
         singolo colpo). Vigore promette di non morire IN UN COLPO, non di non
         morire. */
      const daPsPieni = foe.hp >= foe.maxHp;
      if (foe.fainted) break;
      const res = computeDamage(actor, foe, move, { forceCrit: forceCrit || laserPronto, highCrit, critStage: critBonus, potenza });
      if (res.immune) { immune = true; break; }
      let raw = Math.max(1, Math.floor(res.damage * lensPenalty));
      /* Lo scudo lo rompe QUESTO colpo, quindi il messaggio dello scudo va
         DOPO quello del colpo: bossClamp scrive in un foglietto a parte e lo
         si svuota al momento giusto. Prima si leggeva «uno scudo si infrange»
         e solo dopo «Colpo 1: 5 PS», cioe al contrario di come e successo. */
      const scudoMsg = [];
      const dealt = bossClamp(foe, raw, scudoMsg);  // scudi del boss
      /* SOSTITUTO: il fantoccio incassa al posto suo finché regge. Il Pokemon
         vero non perde neanche un PS, quindi niente `_justHit` e niente
         bacche: per il motore è come se il colpo non fosse arrivato. */
      if (foe.volatile.sub > 0 && !move.sonora && !move.bucaSub) {
        foe.volatile.sub -= dealt; done++;
        for (const t of scudoMsg) messages.push(t);
        if (foe.volatile.sub <= 0) {
          foe.volatile.sub = 0;
          messages.push(`Il sostituto di ${foe.name} si sgretola!`);
          /* 🔴 QUANDO IL FANTOCCIO CADE, LA MOSSA FINISCE.
             Prima i colpi rimasti proseguivano sul Pokemon VERO: Semitraglia
             rompeva il sostituto al primo colpo e con gli altri quattro
             stendeva chi ci stava dietro — cioe' il Sostituto peggiorava la
             situazione invece di migliorarla.
             Nei giochi veri i colpi successivi di una mossa multipla non
             toccano il bersaglio: il fantoccio ha fatto il suo, e chi
             attacca ha finito. */
          break;
        }
        messages.push(`Il sostituto di ${foe.name} incassa il colpo!`);
        continue;
      }
      total += dealt; lastEff = res.effectiveness; if (res.crit) anyCrit = true; done++;
      foe.hp = Math.max(0, foe.hp - dealt); foe._justHit = true;
      /* 🔴 UN EVENTO PER COLPO, quando i colpi sono piu' d'uno.
         Ogni colpo puo' essere critico per conto suo e ogni colpo puo'
         rompere uno scudo del boss: riassumerli in un totale voleva dire
         non far vedere ne' l'uno ne' l'altro. Adesso la barra cala un pezzo
         alla volta e il messaggio dello scudo (che `bossClamp` ha appena
         messo in coda) sta nel punto giusto della sequenza.
         ⚠️ L'evento si crea DOPO aver tolto i PS: cosi' la sua
         istantanea ha gia' il valore nuovo, e la barra scende su di lui. */
      if (hits > 1) {
        /* Un colpo puo fare ZERO danni e rompere lo scudo lo stesso: succede
           quando i PS sono gia sul confine del segmento. Dirlo con un
           "0 PS!" sembrerebbe un colpo a vuoto, e invece e il colpo che
           rompe lo scudo. */
        messages.push(dealt === 0 && scudoMsg.length
          ? `Colpo ${done} di ${hits}: lo scudo assorbe tutto!`
          : `Colpo ${done} di ${hits}: ${dealt} PS!`);
        if (res.crit) stessoMomento(messages, "Colpo critico!");
        // e ogni colpo si vede: l'animazione della mossa, di nuovo
        if (messages.fx) {
          const chiave = animKeyForMove(move.id);
          prefetchAnim(chiave);
          segnaFx(messages, messages.length - 1, move.type, sideOf(foe), chiave, sideOf(actor));
        }
        messages._colpiSeparati = true;
      }
      for (const t of scudoMsg) messages.push(t);
      if (foe.hp <= 0) {
        // Resistenza (Protect in versione "endure") e Bandana: si sopravvive con 1 PS
        if (foe.volatile.protect === "endure") {
          foe.hp = 1; messages.push(`${foe.name} ha resistito al colpo!`);
        } else if (foe.hp <= 0 && ha(foe, "STURDY") && foe.maxHp > 1 && daPsPieni) {
          // VIGORE: da PS pieni non si va KO in un colpo solo
          foe.hp = 1; messages.push(`${nomeAb(foe, "STURDY")}: ${foe.name} resiste con 1 PS!`);
        } else if (foe.held && foe.held.focusband && Math.random() < 0.1 * foe.held.focusband) {
          foe.hp = 1; messages.push(`${foe.name} ha resistito grazie alla Bandana!`);
        } else { foe.fainted = true; break; }
      }
    }
    /* Altruismo: l'alleato che ha ricevuto la mano picchia il 50% in piu', per
       questo turno solo. Si spegne appena serve, o resterebbe acceso. */
    if (actor.volatile.helping) {
      actor.volatile.helping = false;
      const extra = Math.floor(total * 0.5);
      if (extra > 0 && !foe.fainted) {
        const dato = bossClamp(foe, extra, messages);
        foe.hp = Math.max(0, foe.hp - dato); total += dato;
        stessoMomento(messages, "L'aiuto dell'alleato rende il colpo più forte!");
        if (foe.hp <= 0) { foe.fainted = true; messages.push(`${foe.name} è esausto!`); }
      }
    }
    // Pugno dorato: il danno inflitto frutta soldi
    if (actor === game.player && game.charms.goldenPunch && total > 0) {
      const g = Math.floor(total * 0.5 * game.charms.goldenPunch);
      if (g > 0) { game.money += g; messages.push(`Il Pugno dorato frutta ₽${g}!`); }
    }
    // Roccia di re: 10% per pezzo di far tentennare
    if (actor.held && actor.held.kingsrock && total > 0 && !foe.fainted
        && Math.random() < 0.1 * actor.held.kingsrock) {
      foe.volatile.flinch = true;
      messages.push(`La Roccia di re fa tentennare ${foe.name}!`);
    }
    /* PRESTIGIATORE: colpendo si ruba l'oggetto del bersaglio — una volta
       sola, e solo se non si tiene gia' qualcosa. */
    if (ha(actor, "MAGICIAN") && total > 0 && !Object.keys(actor.held || {}).length) {
      rubaOggetto(actor, foe, messages, nomeAb(actor, "MAGICIAN"), "fa sparire");
    }
    // Presartigli: 10% per pezzo di RUBARE un oggetto tenuto, col contatto
    if (actor.held && actor.held.gripclaw && total > 0 && move.contact
        && Math.random() < 0.1 * actor.held.gripclaw) rubaOggetto(actor, foe, messages, "I Presartigli", "rubano");
    if (immune && total === 0) { stessoMomento(messages, `Non ha effetto su ${foe.name}...`); return false; }
    // memoria per Contrattacco/Specchiovelo/Metalscoppio/Ritorsione e Pazienza
    segnaDannoSubito(foe, actor, move, total);

    /* Il danno e' stato applicato: l'istantanea dell'evento della mossa va
       riallineata, cosi' la barra cala su QUELLA schermata (alla fine della
       sua animazione) e non su quella dopo. */
    if (messages.snap) messages.snap();

    // col colpo singolo il critico si dice qui; coi colpi separati e' gia' detto
    if (anyCrit && !messages._colpiSeparati) stessoMomento(messages, "Colpo critico!");
    if (lastEff > 1) stessoMomento(messages, "È superefficace!");
    else if (lastEff > 0 && lastEff < 1) stessoMomento(messages, "Non è molto efficace...");
    if (done > 1) stessoMomento(messages, `Colpito ${done} volte!`);

    const drain = attrs.find(a => a.kind === "drain");
    if (drain && total > 0 && actor.hp < actor.maxHp) {
      actor.hp = Math.min(actor.maxHp, actor.hp + Math.max(1, Math.floor(total * drain.ratio)));
      stessoMomento(messages, `${actor.name} ha assorbito energia!`);
      if (messages.anim) messages.anim("COMMON_HEALTH_UP", sideOf(actor));
    }
    // held: Conchinella — recuperi 1/8 del danno inflitto (impilabile)
    if (actor.held && actor.held.shellbell && total > 0 && actor.hp < actor.maxHp && !actor.fainted) {
      actor.hp = Math.min(actor.maxHp, actor.hp + Math.max(1, Math.floor(total * actor.held.shellbell / 8)));
      stessoMomento(messages, `La Conchinella ristora ${actor.name}!`);
    }
    const recoil = attrs.find(a => a.kind === "recoil");
    if (recoil && total > 0 && !actor.fainted && !findAb(actor, "noRecoil") && dannoIndirettoOk(actor)) {
      actor.hp = Math.max(0, actor.hp - Math.max(1, Math.floor(total * recoil.ratio))); actor._justHit = true;
      stessoMomento(messages, `${actor.name} è danneggiato dal contraccolpo!`);
      if (actor.hp <= 0) { actor.fainted = true; messages.push(`${actor.name} è esausto!`); }
    }

    /* ABILITA' CHE REAGISCONO AL COLPO SUBITO. */
    if (total > 0 && !foe.fainted) {
      // SOTTILGUSCIO: il fisico incrina la corazza ma libera le gambe
      if (move.category === "PHYSICAL" && ha(foe, "WEAK_ARMOR")) {
        applyStatStage(foe, ["DEF"], -1, messages, true);
        applyStatStage(foe, ["SPD"], 2, messages, true);
      }
      // PAURA: Buio, Spettro e Coleottero fanno scattare in avanti
      if (ha(foe, "RATTLED") && ["DARK", "GHOST", "BUG"].includes(move.type)) {
        applyStatStage(foe, ["SPD"], 1, messages, true);
      }
    }
    // effetti da CONTATTO: l'abilita' del difensore colpisce l'attaccante
    if (move.contact && total > 0) {
      const cs = findAb(foe, "contactStatus");
      if (cs && !actor.fainted && Math.random() * 100 < cs.chance) applyStatus(actor, cs.status, messages, foe.ability.it);
      /* ARRAFFALESTO: chi ti tocca ci rimette l'oggetto. */
      if (ha(foe, "PICKPOCKET") && !actor.fainted && !Object.keys(foe.held || {}).length) {
        rubaOggetto(foe, actor, messages, nomeAb(foe, "PICKPOCKET"), "sfila");
      }
      // INCANTEVOLE: chi tocca rischia di innamorarsi
      if (ha(foe, "CUTE_CHARM") && !actor.fainted && Math.random() < 0.3) {
        applyInfatuate(foe, actor, messages);
      }
      const cd = findAb(foe, "contactDamage");
      if (cd && !actor.fainted) {
        actor.hp = Math.max(0, actor.hp - Math.max(1, Math.floor(actor.maxHp / cd.fraction))); actor._justHit = true;
        messages.push(`${actor.name} è ferito da ${foe.ability.it}!`);
        if (actor.hp <= 0) { actor.fainted = true; messages.push(`${actor.name} è esausto!`); }
      }
    }

    // Revitalseme: rianima una volta sola, poi si consuma
    if (foe.fainted && foe.held && foe.held.reviverseed) {
      foe.held.reviverseed--;
      if (!foe.held.reviverseed) delete foe.held.reviverseed;
      foe.fainted = false; foe.hp = Math.floor(foe.maxHp / 2);
      messages.push(`Il Revitalseme riporta in forze ${foe.name}!`);
      if (messages.anim) messages.anim("COMMON_HEALTH_UP", sideOf(foe));
    }
    if (foe.fainted) {
      messages.push(`${foe.name} è esausto!`);
      /* ULTIMOTORTO: chi cade si porta dietro chi l'ha steso. */
      if (foe.volatile.destiny && !actor.fainted) {
        actor.hp = 0; actor.fainted = true;
        messages.push(`${foe.name} trascina con sé ${actor.name}!`);
      }
      /* RANCORE: la mossa che l'ha steso resta senza un PP. */
      if (foe.volatile.grudge) {
        const mi = actor.moves.find(x => x.id === move.id);
        if (mi && mi.pp > 0) { mi.pp = 0; messages.push(`Il rancore di ${foe.name} azzera i PP di ${move.it}!`); }
      }
      // Arroganza / Ultraboost / Nitriti: scattano su chi ha messo KO
      applyPostVictory(actor, messages);
    }
    else { checkEnigmaBerry(foe, lastEff, messages); checkBerries(foe, messages); }
    return true;
  }

  // Applica gli effetti-mattoncino (stato, statistiche, flinch, confusione, cura).
  // Su mossa STATUS: sempre. Su mossa d'attacco: solo con la chance secondaria
  // (tranne gli auto-effetti self, che sono garantiti).
  function applyMoveAttrs(actor, foe, move, messages) {
    const isStatus = move.category === "STATUS";
    /* FORZABRUTTA: in cambio del +30% di potenza, gli effetti aggiuntivi non
       partono affatto. E' il patto dell'abilita', non un effetto collaterale. */
    if (!isStatus && ha(actor, "SHEER_FORCE") && move.effectChance > 0) return;
    // LEGGIADRO: gli effetti aggiuntivi scattano il doppio delle volte
    const ch = ha(actor, "SERENE_GRACE") && move.effectChance > 0
      ? Math.min(100, move.effectChance * 2) : move.effectChance;
    const secondary = () => isStatus || (ch > 0 && Math.random() * 100 < ch);
    for (const a of move.attrs || []) {
      switch (a.kind) {
        case "status":    if (secondary()) { applyStatus(foe, a.status, messages); sincronizza(foe, actor, a.status, messages); } break;
        case "confuse":   if (secondary()) applyConfuse(foe, messages); break;
        case "flinch":    if (ch > 0 && Math.random() * 100 < ch && !foe.fainted) foe.volatile.flinch = true; break;
        case "statStage": {
          const suDiSe = statSuDiSe(move, a);
          const tgt = suDiSe ? actor : foe;
          /* 🔴 La percentuale vale ANCHE per gli effetti su di sé.
             Prima `suDiSe` scavalcava il tiro di dado e scattavano SEMPRE:
             Ventargenteo alzava tutte e cinque le statistiche a ogni colpo
             invece che una volta su dieci. Toccava 9 mosse (Alacciaio,
             Ferrartigli, Forzantica 10%, Meteorpugno 20%, Ventargenteo 10%,
             Raggioscossa 70%, Funestovento 10%, Voldifuoco 50%,
             Diamantempesta 50%): tutte troppo forti, alcune moltissimo.
             ⚠️ Il bypass serviva per un motivo vero, ma un altro: i cali
             GARANTITI che una mossa si autoinfligge (Vampata −2 A.Sp, Zuffa
             −1 Dif/D.Sp, Dragobolide...). Quelli nei dati hanno
             `effectChance: -1`, cioe' nessuna percentuale dichiarata — ed è
             esattamente li' che il bypass deve restare. */
          const passa = isStatus ? true
            : ch > 0 ? (Math.random() * 100 < ch)
            : suDiSe;
          if (passa) applyStatStage(tgt, a.stats, a.stages, messages, suDiSe);
          break;
        }
        case "protect":   applyProtect(actor, messages, a.endure); break;
        case "terrain":   setTerrain(a.terrain, messages, actor.name); break;
        case "infatuate": applyInfatuate(actor, foe, messages); break;
        case "encore":    if (!foe.fainted && foe.volatile.lastMove) { foe.volatile.encore = { id: foe.volatile.lastMove, turni: 3 }; messages.push(`${foe.name} deve ripetere ${M[foe.volatile.lastMove].it}!`); } break;
        case "taunt":     if (!foe.fainted) { foe.volatile.taunt = 3; messages.push(`${foe.name} è provocato!`); } break;
        case "torment":   if (!foe.fainted) { foe.volatile.torment = true; messages.push(`${foe.name} è tormentato!`); } break;
        case "drowsy":    if (!foe.fainted && !foe.status && !foe.volatile.drowsy) { foe.volatile.drowsy = 2; messages.push(`${foe.name} inizia a sonnecchiare…`); } break;
        case "nightmare": if (!foe.fainted && foe.status === "SLEEP") { foe.volatile.nightmare = true; messages.push(`${foe.name} è tormentato dagli incubi!`); } break;
        case "ingrain":   { const t = a.self ? actor : foe; t.volatile.ingrain = true; messages.push(`${t.name} mette radici!`); break; }
        case "aquaring":  { const t = a.self ? actor : foe; t.volatile.aquaring = true; messages.push(`${t.name} si avvolge in un velo d'acqua!`); break; }
        case "saltcure":  if (!foe.fainted) { foe.volatile.saltcure = true; messages.push(`${foe.name} è messo sotto sale!`); } break;
        case "curse":     if (!foe.fainted) { foe.volatile.curse = true; messages.push(`${foe.name} è maledetto!`); } break;
        // la presa e' lo SCOPO della mossa, non un effetto secondario:
        // si applica sempre quando la mossa va a segno
        case "trap":      applyTrap(foe, a.tag || "TRAPPED", messages); break;
        case "leechseed": applyLeechSeed(actor, foe, messages); break;
        case "perish":    applyPerish(actor, foe, messages); break;
        case "recharge":  actor.volatile.recharge = true; break;
        case "heal": {
          if (actor.hp < actor.maxHp) {
            actor.hp = Math.min(actor.maxHp, actor.hp + Math.max(1, Math.floor(actor.maxHp * a.ratio)));
            messages.push(`${actor.name} ha recuperato energie!`);
            if (messages.anim) messages.anim("COMMON_HEALTH_UP", sideOf(actor));
          } else messages.push(`Le energie di ${actor.name} sono già al massimo!`);
          break;
        }
      }
    }
  }

  /* SINCRONISMO: chi te lo ha dato se lo riprende. Si chiama DOPO che lo stato
     e' andato a segno, da chi conosce la sorgente. */
  function sincronizza(target, chi, status, messages) {
    if (!chi || chi === target || chi.fainted || chi.status) return;
    if (!ha(target, "SYNCHRONIZE")) return;
    if (status !== "BURN" && status !== "POISON" && status !== "PARALYSIS") return;
    messages.push(`${nomeAb(target, "SYNCHRONIZE")}: anche ${chi.name} ne è colpito!`);
    applyStatus(chi, status, messages, "sync");
  }

  function applyStatus(target, status, messages, sourceAbility) {
    if (target.fainted || target.status) return;
    // FOGLIAMANTO: col sole pieno non si prendono problemi di stato
    if (ha(target, "LEAF_GUARD") && weatherKind() === "SUN") {
      messages.push(`${nomeAb(target, "LEAF_GUARD")} protegge ${target.name} sotto il sole!`);
      return;
    }
    if ((STATUS_IMMUNE[status] || []).some(t => target.types.includes(t))) return;
    // TERRENI: il Nebbioso protegge da tutti gli stati, l'Elettrico dal sonno
    // (vale solo per chi tocca terra).
    if (isGrounded(target)) {
      const t = terrainKind();
      if (t === "MISTY") { messages.push(`Il Campo Nebbioso protegge ${target.name}!`); return; }
      if (t === "ELECTRIC" && status === "SLEEP") { messages.push(`Il Campo Elettrico tiene sveglio ${target.name}!`); return; }
    }
    // BARAONDA: finche' dura, il frastuono tiene sveglio chiunque
    if (status === "SLEEP" && baraondaInCorso()) {
      messages.push(`La baraonda tiene sveglio ${target.name}!`);
      return;
    }
    /* Salvaguardia: il lato protetto non prende problemi di stato.
       ⚠️ Non vale per quelli che uno si da' da solo (Riposo): li' `sourceAbility`
       manca e chi li subisce e' chi li ha voluti — il controllo sta in chi
       chiama, non qui. */
    if (game.lati && game.lati[latoDi(target)].safeguard > 0) {
      messages.push(`La Salvaguardia protegge ${target.name}!`);
      return;
    }
    // abilita' che immunizzano da uno stato (Insonnia, Immunita', Scioltezza...)
    const si = findAb(target, "statusImmunity");
    if (si && si.statuses.includes(status)) { messages.push(`${target.ability.it} protegge ${target.name}!`); return; }
    if (sourceAbility) messages.push(`${sourceAbility} è entrata in azione!`);
    target.status = status;
    if (status === "SLEEP") target.sleepTurns = 1 + Math.floor(Math.random() * 3); // 1-3 turni
    if (status === "TOXIC") target.toxicN = 0;    // il rosicchio parte dal primo scatto
    messages.push({
      BURN: `${target.name} è scottato!`, PARALYSIS: `${target.name} è paralizzato!`,
      SLEEP: `${target.name} si è addormentato!`, POISON: `${target.name} è avvelenato!`,
      TOXIC: `${target.name} è gravemente avvelenato!`,
      FREEZE: `${target.name} si è congelato!`,
    }[status]);
    if (messages.anim) messages.anim(STATUS_ANIM[status], sideOf(target));
  }

  /* 🔴 Lo sbalzo di statistica va a CHI USA LA MOSSA?

     Due strade, ed e' la seconda che mancava:
       1. l'attributo ha `self: true` (Danzaspada e compagnia);
       2. la MOSSA punta la propria parte del campo — USER, USER_AND_ALLIES,
          USER_SIDE, PARTY. Nell'originale la direzione viene da qui, e
          Gridodilotta e' esattamente questo caso: l'attributo non dichiara
          niente, ma la mossa ha `target: USER_AND_ALLIES`.
     Guardando solo la prima, cinque mosse regalavano il buff all'AVVERSARIO:
     Gridodilotta, Nebularoma, Controllo Polare, Marciainpiu' e Coaching.

     ⚠️ ALLY / NEAR_ALLY / USER_OR_NEAR_ALLY restano fuori di proposito: li'
     il bersaglio lo SCEGLI (§39) ed e' gia' l'alleato giusto, quindi vale
     quello scelto e non chi usa la mossa. */
  const BERSAGLIO_SU_DI_SE = new Set(["USER", "USER_AND_ALLIES", "USER_SIDE", "PARTY"]);
  const statSuDiSe = (mv, a) => !!(a.self || (mv && BERSAGLIO_SU_DI_SE.has(mv.target)));

  function applyStatStage(target, stats, delta, messages, isSelf) {
    if (target.fainted) return;
    // Nebbia: il lato protetto non subisce cali dall'avversario
    if (!isSelf && delta < 0 && game.lati && game.lati[latoDi(target)].mist > 0) {
      stessoMomento(messages, `La Nebbia protegge ${target.name} dai cali!`);
      return;
    }
    // abilita' che bloccano i cali di statistiche causati dall'avversario (Corpochiaro)
    if (!isSelf && delta < 0 && findAb(target, "protectStats")) {
      stessoMomento(messages, `${target.ability.it} impedisce il calo a ${target.name}!`);
      return;
    }
    let calato = false;      // e' cambiato qualcosa davvero? lo legge Agonismo
    for (const st of stats) {
      const k = st.toLowerCase();
      if (!(k in target.stages)) continue;
      const before = target.stages[k];
      target.stages[k] = Math.max(-6, Math.min(6, before + delta));
      const name = STAT_IT[k] || k;
      if (target.stages[k] === before) { stessoMomento(messages, `${name} di ${target.name} non può ${delta > 0 ? "salire" : "scendere"} oltre!`); continue; }
      const word = delta >= 2 ? "è aumentato molto" : delta === 1 ? "è aumentato" : delta === -1 ? "è diminuito" : "è diminuito molto";
      stessoMomento(messages, `${name} di ${target.name} ${word}!`);
      calato = true;
    }
    /* AGONISMO e Competizione: un calo causato dall'AVVERSARIO fa saltare la
       mosca al naso, e la statistica di attacco sale di due.
       ⚠️ Si guarda dopo, non prima: se il calo e' stato parato (Corpochiaro)
       o era gia' a −6, non e' successo niente di cui arrabbiarsi. */
    if (calato && !isSelf && delta < 0) {
      if (ha(target, "DEFIANT")) applyStatStage(target, ["ATK"], 2, messages, true);
      else if (ha(target, "COMPETITIVE")) applyStatStage(target, ["SPATK"], 2, messages, true);
    }
  }

  /* ----------------------------------------------------------------------
     EFFETTI VOLATILI (i BattlerTag dell'originale)
       protect  — para il colpo per un turno; usarla di fila riesce 1 volta su
                  3^usi (come `timesUsed` in move.ts)
       trap     — bloccato 4-5 turni, 1/8 dei PS max a fine turno, non puo' uscire
       seed     — 1/8 dei PS max a fine turno, curati a chi l'ha piantato
       perish   — dopo 3 turni va KO comunque
       recharge — dopo mosse come Iper Raggio salta il turno seguente
     Vivono in `f.volatile`, che si azzera a ogni lotta.
     ---------------------------------------------------------------------- */
  /* Mosse a due turni che rendono INTOCCABILI durante la carica (nell'originale
     sono i tag SEMI_INVULNERABLE: chi vola, chi si tuffa, chi scava). */
  const SEMI_INVULN = {
    FLY: 1, DIVE: 1, DIG: 1, BOUNCE: 1, PHANTOM_FORCE: 1, SHADOW_FORCE: 1, SKY_DROP: 1,
  };
  /* Testo del turno di carica, come nei giochi ({n} = nome). */
  const CHARGE_TESTO = {
    FLY: "{n} si alza in volo!", BOUNCE: "{n} balza in alto!",
    DIVE: "{n} si immerge!", DIG: "{n} scava sottoterra!",
    PHANTOM_FORCE: "{n} svanisce nel nulla!", SHADOW_FORCE: "{n} svanisce nell'ombra!",
    SOLAR_BEAM: "{n} assorbe la luce!", SKY_ATTACK: "{n} si avvolge di energia!",
    RAZOR_WIND: "{n} solleva un turbine!", SKULL_BASH: "{n} abbassa la testa!",
    ICE_BURN: "{n} si circonda di gelo!", FREEZE_SHOCK: "{n} si carica di elettricità!",
    METEOR_BEAM: "{n} raccoglie energia cosmica!", ELECTRO_SHOT: "{n} accumula elettricità!",
    GEOMANCY: "{n} assorbe energia!", SOLAR_BLADE: "{n} concentra la luce nella lama!",
  };

  const TRAP_IT = {
    BIND: "Legatutto", WRAP: "Avvolgibotta", FIRE_SPIN: "Turbofuoco", CLAMP: "Tenaglia",
    WHIRLPOOL: "Mulinello", SAND_TOMB: "Sabbiotomba", MAGMA_STORM: "Vortemagma",
    SNAP_TRAP: "Tagliola", THUNDER_CAGE: "Elettrogabbia", INFESTATION: "Assillo",
    TRAPPED: "Morsa",
  };
  function applyProtect(actor, messages, endure) {
    // piu' la usi di fila, meno funziona: 1 volta su 3^usi
    const usi = actor.volatile.protectUsi || 0;
    if (usi > 0 && Math.floor(Math.random() * Math.pow(3, usi)) !== 0) {
      actor.volatile.protectUsi = 0;
      messages.push(`${actor.name} ci riprova… ma la protezione fallisce!`);
      return;
    }
    actor.volatile.protect = endure ? "endure" : "protect";
    actor.volatile.protectUsi = usi + 1;
    messages.push(endure ? `${actor.name} si prepara a resistere!` : `${actor.name} si protegge!`);
  }
  function applyTrap(target, tag, messages) {
    if (target.fainted || target.volatile.trap) return;
    target.volatile.trap = { tag, turni: 4 + Math.floor(Math.random() * 2) };
    messages.push(`${target.name} è intrappolato da ${TRAP_IT[tag] || "una presa"}!`);
  }
  function applyLeechSeed(actor, target, messages) {
    if (target.fainted || target.volatile.seed) return;
    if (target.types.includes("GRASS")) { messages.push(`Non ha effetto su ${target.name}…`); return; }
    target.volatile.seed = true;
    target.volatile.seedBy = actor === game.enemy || actor === game.enemy2 ? "enemy" : "player";
    messages.push(`${target.name} viene seminato!`);
  }
  function applyPerish(actor, target, messages) {
    for (const f of onField()) if (!f.fainted && !f.volatile.perish) f.volatile.perish = 4;
    messages.push("Tutti i Pokémon in campo sentono l'Ultimocanto!");
  }
  /* Chi ha piantato il seme: prende lui i PS rubati. */
  function seedSource(f) {
    const lato = f.volatile.seedBy === "enemy" ? enemiesOnField() : alliesOnField();
    return lato[0] || null;
  }

  /* ATTRAZIONE: 50% di non agire. Come nell'originale funziona SOLO fra sessi
     opposti, e mai su chi non ha sesso. */
  function applyInfatuate(actor, target, messages) {
    if (target.fainted || target.volatile.infatuated) return;
    if (actor.gender === "GENDERLESS" || target.gender === "GENDERLESS"
        || actor.gender === target.gender) {
      messages.push(`Ma non ha effetto su ${target.name}…`);
      return;
    }
    target.volatile.infatuated = true;
    messages.push(`${target.name} si è infatuato di ${actor.name}!`);
  }

  /* Mosse vietate dagli effetti volatili. Ritorna il messaggio, o null. */
  function mossaVietata(actor, move, moveInst) {
    const v = actor.volatile;
    if (v.taunt > 0 && move.category === "STATUS")
      return `${actor.name} è provocato e non può usare ${move.it}!`;
    if (v.torment && v.lastMove === moveInst.id)
      return `${actor.name} è tormentato e non può ripetere ${move.it}!`;
    if (v.encore && v.encore.turni > 0 && v.encore.id !== moveInst.id)
      return `${actor.name} deve ripetere ${M[v.encore.id].it}!`;
    /* BLOCCO: una mossa sola, per qualche turno. */
    if (v.disable && v.disable.turni > 0 && v.disable.id === moveInst.id)
      return `${move.it} di ${actor.name} è bloccata!`;
    /* DIVIETO: chi l'ha usata sigilla le mosse che conosce ANCHE lui, e
       l'avversario non può più usarle. */
    const sigillo = onField().find(x => x && !x.fainted && x !== actor
      && x.volatile.imprison && isEnemySide(x) !== isEnemySide(actor)
      && x.moves.some(mm => mm.id === moveInst.id));
    if (sigillo) return `${move.it} è sigillata da ${sigillo.name}!`;
    return null;
  }

  /* Mentre c'e' una BARAONDA in corso nessuno dorme: e' la sua ragione
     d'essere, e senza questo era solo un attacco speciale da 90. */
  const baraondaInCorso = () => onField().some(f => f && !f.fainted && f.volatile.baraonda);

  function applyConfuse(target, messages) {
    if (target.fainted || target.volatile.confusion > 0) return;
    // MENTE LOCALE e Indifferenza: niente confusione
    if (ha(target, "OWN_TEMPO") || ha(target, "OBLIVIOUS")) {
      messages.push(`${target.name} non si confonde grazie a ${nomeAb(target, ha(target, "OWN_TEMPO") ? "OWN_TEMPO" : "OBLIVIOUS")}!`);
      return;
    }
    target.volatile.confusion = 2 + Math.floor(Math.random() * 4); // 2-5 turni
    messages.push(`${target.name} è confuso!`);
    if (messages.anim) messages.anim("COMMON_CONFUSION", sideOf(target));
  }

  /* ----------------------------------------------------------------------
     BACCHE — si tengono e si attivano DA SOLE quando serve, poi si consumano.
     La Porta bacche (BERRY_POUCH) da' il 30% di non consumarle, come l'originale.
     Va chiamata dopo ogni colpo e a fine turno, per entrambi i combattenti.
     ---------------------------------------------------------------------- */
  function useBerry(f, kind, messages) {
    const b = BERRY_DATA[kind];
    if (!(game.charms.berryPouch && Math.random() < 0.3 * Math.min(1, game.charms.berryPouch))) {
      f.berries[kind]--;
      if (f.berries[kind] <= 0) delete f.berries[kind];
      // se ne ricorda RICICLO, che e' l'unica mossa che la riporta indietro
      if (f.volatile) f.volatile.bacciaFinita = kind;
    }
    messages.push(`${f.name} usa la ${b.it}!`);
  }
  function checkBerries(f, messages) {
    if (!f || f.fainted || !f.berries) return;
    /* AGITAZIONE dell'avversario: le bacche non si toccano. */
    if (onField().some(x => x && !x.fainted && isEnemySide(x) !== isEnemySide(f) && ha(x, "UNNERVE"))) return;
    const has = k => (f.berries[k] || 0) > 0;
    // VORACITÀ: le bacche da un quarto si mangiano gia' a meta' PS
  const half = f.hp <= f.maxHp / 2, quarter = f.hp <= f.maxHp / (ha(f, "GLUTTONY") ? 2 : 4);
    // cura PS
    if (has("SITRUS") && half && f.hp < f.maxHp) {
      useBerry(f, "SITRUS", messages);
      f.hp = Math.min(f.maxHp, f.hp + Math.max(1, Math.floor(f.maxHp / 4)));
      messages.push(`${f.name} ha recuperato energie!`);
      if (messages.anim) messages.anim("COMMON_HEALTH_UP", sideOf(f));
      return;
    }
    // cura stato
    if (has("LUM") && (f.status || f.volatile.confusion > 0)) {
      useBerry(f, "LUM", messages);
      f.status = null; f.volatile.confusion = 0;
      messages.push(`${f.name} si è ripreso!`);
      return;
    }
    // PP esauriti
    if (has("LEPPA")) {
      const vuota = f.moves.find(m => m.pp <= 0);
      if (vuota) {
        useBerry(f, "LEPPA", messages);
        vuota.pp = Math.min(vuota.maxPp, 10);
        messages.push(`${M[vuota.id].it} ha recuperato PP!`);
        return;
      }
    }
    // bacche di statistica, sotto un quarto dei PS
    if (!quarter) return;
    const statBerry = { LIECHI: "atk", GANLON: "def", PETAYA: "spatk", APICOT: "spdef", SALAC: "spd" };
    for (const k in statBerry) {
      if (!has(k)) continue;
      useBerry(f, k, messages);
      applyStatStage(f, [statBerry[k].toUpperCase()], 1, messages, true);
      return;
    }
    if (has("LANSAT")) { useBerry(f, "LANSAT", messages); f._lansat = true; messages.push(`${f.name} è pronto al colpo critico!`); return; }
    if (has("STARF")) {
      useBerry(f, "STARF", messages);
      const s = VITS.filter(x => x !== "hp")[Math.floor(Math.random() * 5)];
      applyStatStage(f, [s.toUpperCase()], 2, messages, true);
      return;
    }
  }
  // Bacca Enigma: cura un quarto quando si viene colpiti superefficace
  function checkEnigmaBerry(f, eff, messages) {
    if (!f || f.fainted || !f.berries || eff <= 1) return;
    if (!(f.berries.ENIGMA > 0) || f.hp >= f.maxHp) return;
    useBerry(f, "ENIGMA", messages);
    f.hp = Math.min(f.maxHp, f.hp + Math.max(1, Math.floor(f.maxHp / 4)));
    messages.push(`${f.name} ha recuperato energie!`);
  }

  // Danni/cure di fine turno (scottatura, veleno, Avanzi).
  /* MAGICSCUDO: danni SOLO dagli attacchi diretti. Tutto il resto — trappole,
     semi, maledizione, sale, meteo, stato, contraccolpo — non lo tocca. */
  const dannoIndirettoOk = f => !ha(f, "MAGIC_GUARD");

  function endOfTurnResidual(f, messages) {
    /* ⚠️ Gli effetti di SQUADRA si scalano una volta sola per turno, e questa
       funzione gira su ogni combattente: ci si aggancia al giocatore, che c'e'
       in tutte le strade del turno (singolo, doppio, cambio, lancio di ball). */
    if (f === game.player) scalaLati(messages);
    /* 🔴 I contatori a TURNI stavano nella coda di `risolviTurno`, che pero'
       non e' l'unica strada: cambiare Pokemon o lanciare una ball consuma il
       turno passando altrove, e li' non scendevano affatto. Inibitore poteva
       cosi' restare acceso per sempre — bastava non attaccare.
       `endOfTurnResidual` invece la chiamano TUTTE le strade: e' qui che vanno. */
    if (f.volatile.turniInCampo != null) f.volatile.turniInCampo++;
    if (f.volatile.disable && --f.volatile.disable.turni <= 0) {
      const tornata = M[f.volatile.disable.id];
      f.volatile.disable = null;
      messages.push(`${f.name} può di nuovo usare ${tornata ? tornata.it : "quella mossa"}.`);
    }
    if (f.fainted) return;
    // TENTACOLOCK: ogni turno un pezzo di Difesa e Difesa Speciale in meno
    if (f.volatile.octolock > 0) applyStatStage(f, ["DEF", "SPDEF"], -1, messages, true);
    // ACCELERATORE: la Velocita' sale da sola a ogni turno
    if (ha(f, "SPEED_BOOST")) applyStatStage(f, ["SPD"], 1, messages, true);
    // MUTA: una volta su tre ci si libera del problema di stato
    if (f.status && ha(f, "SHED_SKIN") && Math.random() < 1 / 3) {
      messages.push(`${nomeAb(f, "SHED_SKIN")}: ${f.name} si libera facendo la muta!`);
      f.status = null; f.sleepTurns = 0;
    }
    // IDRATAZIONE: sotto la pioggia i problemi di stato passano da soli
    if (f.status && ha(f, "HYDRATION") && weatherKind() === "RAIN") {
      messages.push(`${nomeAb(f, "HYDRATION")}: la pioggia guarisce ${f.name}!`);
      f.status = null; f.sleepTurns = 0;
    }
    // CORPOGELO: con neve o grandine si recuperano PS invece di prenderne
    if (ha(f, "ICE_BODY") && weatherKind() === "HAIL" && f.hp < f.maxHp) {
      f.hp = Math.min(f.maxHp, f.hp + Math.max(1, Math.floor(f.maxHp / 16)));
      messages.push(`${nomeAb(f, "ICE_BODY")} ristora ${f.name}!`);
    }
    /* 🔴 COGLIBACCHE (Harvest). Nei dati ha `attrs: []` e non faceva
       assolutamente niente, come le mosse della §47. A fine turno rimette la
       bacca appena consumata: metà delle volte, ma SEMPRE col sole — la regola
       dell'originale (`PostTurnRestoreBerryAbAttr`, rate 1 col sole, 0.5 con
       tutto il resto).
       Si appoggia a `volatile.bacciaFinita`, la stessa memoria che serve a
       Riciclo: era gia' li', mancava solo chi la leggesse. */
    if (f.ability && f.ability.id === "HARVEST" && f.volatile.bacciaFinita) {
      const k = f.volatile.bacciaFinita;
      const certa = weatherKind() === "SUN";
      if (BERRY_DATA[k] && (certa || Math.random() < 0.5)) {
        f.volatile.bacciaFinita = null;
        f.berries = f.berries || {};
        f.berries[k] = (f.berries[k] || 0) + 1;
        messages.push(`${f.ability.it} di ${f.name} fa ricrescere la ${BERRY_DATA[k].it}!`);
      }
    }
    // held: Avanzi — rigenera 1/16 dei PS max a fine turno (impilabile)
    if (f.held && f.held.leftovers && f.hp < f.maxHp) {
      f.hp = Math.min(f.maxHp, f.hp + Math.max(1, Math.floor(f.maxHp * f.held.leftovers / 16)));
      messages.push(`Gli Avanzi ristorano ${f.name}!`);
      if (messages.anim) messages.anim("COMMON_HEALTH_UP", sideOf(f));
    }
    // Tossicsfera / Fiammosfera: si autoinfliggono lo stato a fine turno
    if (f.held && !f.status) {
      if (f.held.toxicorb) applyStatus(f, "POISON", messages);
      else if (f.held.flameorb) applyStatus(f, "BURN", messages);
    }
    // ATTENZIONE: qui NON si puo' uscire quando manca lo stato, altrimenti si
    // saltano prese, semi, Ultimocanto e meteo (che stanno in fondo).
    let dmg = 0, txt = "";
    /* VELENCURA: il veleno RISTORA invece di ferire — e' l'abilita' che rende
       il veleno un vantaggio. MAGICSCUDO: nessun danno che non venga da un
       attacco diretto, quindi nemmeno da stato. */
    // il contatore del veleno grave sale a ogni fine turno
    if (f.status === "TOXIC") f.toxicN = (f.toxicN || 0) + 1;
    if ((f.status === "POISON" || f.status === "TOXIC") && ha(f, "POISON_HEAL")) {
      if (f.hp < f.maxHp) {
        f.hp = Math.min(f.maxHp, f.hp + Math.max(1, Math.floor(f.maxHp / 8)));
        messages.push(`${nomeAb(f, "POISON_HEAL")}: il veleno ristora ${f.name}!`);
      }
    }
    else if (ha(f, "MAGIC_GUARD")) { /* niente danno da stato */ }
    else if (f.status === "BURN") { dmg = Math.floor(f.maxHp / 16); txt = `${f.name} soffre per la scottatura!`; }
    else if (f.status === "POISON") { dmg = Math.floor(f.maxHp / 8); txt = `${f.name} soffre per il veleno!`; }
    else if (f.status === "TOXIC") {
      /* ⚠️ Almeno 1: su un Pokemon con pochi PS massimi il primo scatto
         (1/16) arrotonda a zero, e il gate `if (dmg > 0)` qui sotto lo
         salterebbe del tutto — l'iperavvelenamento non farebbe niente proprio
         a chi sta gia' peggio. */
      dmg = Math.max(1, Math.floor(f.maxHp * Math.min(15, f.toxicN || 1) / 16));
      txt = `${f.name} soffre per l'iperavvelenamento!`;
    }
    if (dmg > 0) {
      f.hp = Math.max(0, f.hp - Math.max(1, dmg)); f._justHit = true; messages.push(txt);
      // il danno residuo mostra l'animazione dello stato, come nell'originale
      if (messages.anim) messages.anim(STATUS_ANIM[f.status], sideOf(f));
      if (f.hp <= 0) { f.fainted = true; messages.push(`${f.name} è esausto!`); }
    }
    // Piccolo buco nero: a ogni fine turno ruba un oggetto all'avversario
    if (f.held && f.held.blackhole) {
      const altro = f === game.enemy ? game.player : game.enemy;
      if (altro && !altro.fainted) rubaOggetto(f, altro, messages, "Il Piccolo buco nero", "ruba");
    }
    // PRESE: 1/8 dei PS max, finché durano
    if (f.volatile.trap) {
      const t = f.volatile.trap;
      const d = Math.max(1, Math.floor(f.maxHp / 8));
      f.hp = Math.max(0, f.hp - d); f._justHit = true;
      messages.push(`${f.name} soffre per ${TRAP_IT[t.tag] || "la presa"}!`);
      if (f.hp <= 0) { f.fainted = true; messages.push(`${f.name} è esausto!`); }
      if (--t.turni <= 0) { f.volatile.trap = null; messages.push(`${f.name} si libera!`); }
    }
    // SEMEBOMBA: 1/8 dei PS max rubati e passati a chi l'ha piantato
    if (f.volatile.seed && !f.fainted) {
      const d = Math.max(1, Math.floor(f.maxHp / 8));
      f.hp = Math.max(0, f.hp - d); f._justHit = true;
      const src = seedSource(f);
      if (src && !src.fainted && src.hp < src.maxHp) src.hp = Math.min(src.maxHp, src.hp + d);
      messages.push(`${f.name} viene prosciugato dal seme!`);
      if (f.hp <= 0) { f.fainted = true; messages.push(`${f.name} è esausto!`); }
    }
    // ULTIMOCANTO: alla fine del conto va KO comunque
    if (f.volatile.perish > 0 && !f.fainted) {
      f.volatile.perish--;
      if (f.volatile.perish <= 0) {
        f.hp = 0; f.fainted = true;
        messages.push(`Il conto dell'Ultimocanto di ${f.name} arriva a zero!`);
        messages.push(`${f.name} è esausto!`);
      } else messages.push(`Conto dell'Ultimocanto di ${f.name}: ${f.volatile.perish}`);
    }
    // Radicamento e Acquanello: rigenerano 1/16 a fine turno
    for (const k of ["ingrain", "aquaring"]) {
      if (f.volatile[k] && !f.fainted && f.hp < f.maxHp) {
        f.hp = Math.min(f.maxHp, f.hp + Math.max(1, Math.floor(f.maxHp / 16)));
        messages.push(k === "ingrain" ? `${f.name} assorbe nutrimento dalle radici!`
                                      : `${f.name} si ristora col velo d'acqua!`);
      }
    }
    // Incubo (solo se dorme), Maledizione e Sotto Sale: danni a fine turno
    const rosicchia = (frazione, testo) => {
      if (f.fainted) return;
      f.hp = Math.max(0, f.hp - Math.max(1, Math.floor(f.maxHp / frazione))); f._justHit = true;
      messages.push(testo);
      if (f.hp <= 0) { f.fainted = true; messages.push(`${f.name} è esausto!`); }
    };
    if (f.volatile.nightmare) {
      if (f.status === "SLEEP") rosicchia(4, `${f.name} è tormentato dagli incubi!`);
      else f.volatile.nightmare = false;      // svegliandosi finisce
    }
    if (f.volatile.curse) rosicchia(4, `${f.name} soffre per la maledizione!`);
    if (f.volatile.saltcure) {
      const doppio = f.types.some(t => t === "WATER" || t === "STEEL");
      rosicchia(doppio ? 4 : 8, `${f.name} soffre per il sale!`);
    }
    // durata di Provocazione e Ripeti
    if (f.volatile.taunt > 0 && --f.volatile.taunt <= 0) messages.push(`${f.name} non è più provocato.`);
    if (f.volatile.encore && --f.volatile.encore.turni <= 0) { f.volatile.encore = null; messages.push(`${f.name} può tornare a scegliere.`); }

    weatherResidual(f, messages);  // Tempesta/Grandine sferzano a fine turno
    terrainResidual(f, messages);  // il Campo Erboso rigenera
    checkBerries(f, messages);     // le bacche scattano anche a fine turno
  }

  /* ---------------------------------------------------------------------- */
  /*  RENDER — scena (schermo sopra)                                        */
  /* ---------------------------------------------------------------------- */
  const $ = sel => document.querySelector(sel);

  function primaryColor(fighter) { return (T[fighter.types[0]] || {}).color || "#888"; }

  // Calcola la scala effettiva: parte da base, ma non supera i tetti maxW/maxH
  // (frazioni della scena), cosi' i giganti restano dentro e senza collisioni.
  function spriteScale(frame, cfg) {
    const scene = $("#top-screen");
    const capW = (scene.clientWidth  * cfg.maxW) / frame.w;
    const capH = (scene.clientHeight * cfg.maxH) / frame.h;
    return Math.min(cfg.base, capW, capH);
  }
  /* In doppio nella stessa scena ci stanno QUATTRO Pokémon invece di due:
     con i tetti del singolo i due alleati si accavallavano. Si stringe tutto
     della stessa frazione, così le proporzioni fra i combattenti restano. */
  /* ⚠️ 0,62 e non 0,72: col vecchio valore l'alleato più largo arrivava a
     171 px su 384 di scena (misurato: Guzzlord), e due così affiancati non ci
     stanno insieme ai riquadri PS. Il numero è legato alle posizioni degli
     slot in pokerogue.css — se si cambia qui, va rifatto il conto là. */
  const DOUBLE_SHRINK = 0.62;
  /* L'ULTIMA forma del boss finale si ingrandisce: deve fare impressione.
     ⚠️ Va moltiplicata DOPO il restringimento del doppio, altrimenti si
     annullano a vicenda — la lotta finale e' sempre in doppio. Con 1.55 il
     boss resta piu' grande di un nemico normale mentre gli alleati stanno
     al 72%, e lo stacco si vede. I tetti restano dentro la fascia utile
     (0,38x1,12 + 0,42x0,72 = 0,73 su 0,90 disponibile: nessuna collisione). */
  const BOSS_FINALE_SCALA = 1.55;
  const spriteCfg = (cfg, f) => {
    let k = game.double ? DOUBLE_SHRINK : 1;
    if (f && f.scalaSprite) k *= f.scalaSprite;
    return k === 1 ? cfg
      : { base: cfg.base * k, maxW: cfg.maxW * k, maxH: cfg.maxH * k };
  };

  // ov (opzionale) = { fainted, hit } snapshot per la riproduzione scaglionata.
  function renderSprite(el, fighter, cfg, ov) {
    if (fighter.spr) {
      const s = fighter.spr, f = s.frame, k = spriteScale(f, cfg);
      el.textContent = "";
      el.style.width = (f.w * k) + "px";
      el.style.height = (f.h * k) + "px";
      el.style.border = "none";
      el.style.boxShadow = "none";
      el.style.borderRadius = "0";
      el.style.backgroundImage = `url("${s.sheet}")`;
      el.style.backgroundRepeat = "no-repeat";
      el.style.backgroundPosition = `-${f.x * k}px -${f.y * k}px`;
      el.style.backgroundSize = `${s.sheet_w * k}px ${s.sheet_h * k}px`;
      el.style.imageRendering = "pixelated";
    } else {
      // placeholder finche' lo sprite non e' caricato
      el.style.background = `radial-gradient(circle at 38% 32%, #ffffff55, ${primaryColor(fighter)} 62%)`;
      el.textContent = fighter.name;
    }
    /* Versioni "Ombra" (sprite ricolorato) ed effetti permanenti (stelline).
       ⚠️ Solo se lo sprite c'e' davvero: sul SEGNAPOSTO — che ha bordo, sfondo
       e box-shadow — il filtro disegnerebbe un rettangolo scuro. E la finestra
       esiste: al cambio forma `spr` torna null finche' il PNG non arriva. */
    const caricato = !!fighter.spr;
    el.classList.toggle("ombra", caricato && fighter.spriteFiltro === "ombra");
    el.classList.toggle("stelle", caricato && fighter.spriteFx === "stelle");
    /* CROMATICO: il ✨ nel nome non basta — per molte specie la livrea shiny
       somiglia a quella normale e davanti al Pokémon non si capisce. Qui le
       stelline stanno addosso allo sprite, così si vede a colpo d'occhio.
       ⚠️ Come per le Ombra: solo a sprite CARICATO, o il filtro disegnerebbe
       un rettangolo attorno al segnaposto. */
    el.classList.toggle("cromatico", caricato && !!fighter.shiny);
    /* Le tre livree hanno tinte diverse anche nell'originale (`getVariantTint`:
       oro · ciano · cremisi). Sono l'unico modo per accorgersi a colpo d'occhio
       di aver preso una rara: la livrea in sé può somigliare molto alla comune. */
    el.classList.toggle("crom-1", caricato && !!fighter.shiny && fighter.shinyVar === 1);
    el.classList.toggle("crom-2", caricato && !!fighter.shiny && fighter.shinyVar === 2);
    const fainted = ov ? ov.fainted : fighter.fainted;
    const hit = ov ? ov.hit : fighter._justHit;
    el.classList.toggle("faint", fainted);
    if (hit) {
      if (!ov) fighter._justHit = false;
      el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit");
    }
  }

  // ov (opzionale) = { hp, maxHp, status } snapshot.
  /* ======================================================================
     INDICATORE «CE L'HAI GIÀ» sui Pokemon avversari

     Nell'originale (`enemy-battle-info.ts`) accanto al nome del nemico c'è la
     pokéball `icon_owned`, visibile se la specie è nel dex, e **tinta di
     grigio** (`0x808080`) se quell'esemplare avrebbe ancora qualcosa da darti
     — forma o abilità che non possiedi. Stessa regola qui, con quello che il
     nostro dex tiene: abilità, natura e forma.

       nessuna icona → non ce l'hai: catturarlo lo sblocca come starter
       ball grigia   → ce l'hai, ma QUESTO ha ancora qualcosa di nuovo
       ball piena    → ce l'hai già tutto: è solo un avversario

     Vale per i selvatici **e** per quelli degli allenatori: con la Clepto Ball
     si rubano, quindi l'informazione serve lo stesso. */
  function statoDex(f) {
    if (!f || !isEnemySide(f) || !S[f.speciesId]) return null;
    const root = rootOf(f.speciesId);
    if (!meta.unlocked[root]) return "nuovo";
    // c'è ancora qualcosa da prendere da questo esemplare?
    const abilNuova = f.abilIndex != null
      && !((meta.abils && meta.abils[root]) & (f.abilIndex === 2 ? ABIL_H : (1 << f.abilIndex)));
    const natNuova = f.nature
      && !((meta.nature && meta.nature[root]) & (1 << NATURE_KEYS.indexOf(f.nature)));
    const formaNuova = f.variant
      && !((meta.formsSeen || {})[S[f.speciesId].dex] || {})[f.variant];
    const cromNuovo = f.shiny && meta.unlocked[root] < 2;
    return (abilNuova || natNuova || formaNuova || cromNuovo) ? "parziale" : "completo";
  }
  const iconaDex = (f) => {
    const s = statoDex(f);
    return s && s !== "nuovo"
      ? `<span class="dex-owned ${s === "parziale" ? "parziale" : ""}" title="${
          s === "parziale" ? "ce l'hai, ma questo ha qualcosa di nuovo" : "già disponibile come starter"}"></span>`
      : "";
  };

  /* ======================================================================
     SBALZI DI STATISTICA A SCHERMO

     Nell'originale gli stadi si guardano aprendo il riquadro delle statistiche
     accanto alla barra PS. Qui il dito prende il posto del tasto: sul riquadro
     PS compare un badge per ogni statistica ALTERATA (solo quelle: su un
     telefono sette voci sempre accese sarebbero rumore), e toccandolo si apre
     l'elenco completo con il moltiplicatore vero.
     ⚠️ Il tocco non deve arrivare alla scena, o farebbe anche avanzare la
     narrazione: da qui lo `stopPropagation`.
     ====================================================================== */
  const STAT_ORDINE = ["atk", "def", "spatk", "spdef", "spd", "acc", "eva"];
  const STAT_SIGLA = { atk: "ATT", def: "DIF", spatk: "A.SP", spdef: "D.SP",
                       spd: "VEL", acc: "PRE", eva: "ELU" };
  // moltiplicatore vero di uno stadio: le due scale sono diverse
  const moltStadio = (k, n) => (k === "acc" || k === "eva" ? accMult(n) : stageMult(n));
  // una freccia e il numero ("▲3"): le frecce ripetute erano da contare e
  // soprattutto larghe, e il riquadro PS di larghezza non ne ha
  const frecce = n => (n > 0 ? "▲" : "▼") + Math.abs(n);

  /* ⚠️ UNA riga sola, e deve starci: misurato a 384 px (la larghezza vera del
     telefono) il riquadro PS ha 122 px utili. Con tutti e sette gli stadi
     alterati su quattro combattenti, andando a capo i riquadri si allungavano
     fino a coprire i Pokemon.
     Tre chip ci stanno (116 px), tre PIU' il "+N" no (138): quindi o tre, o due
     con il "+N". Si mostrano gli sbalzi piu' GROSSI; il resto e' a un tocco. */
  const BADGE_MAX = 3;
  function badgeStadi(f, stages) {
    const st = stages || (f && f.stages);
    if (!f || !st) return "";
    const attivi = STAT_ORDINE.filter(k => (st[k] || 0) !== 0)
      .sort((a, b) => Math.abs(st[b]) - Math.abs(st[a])
                   || STAT_ORDINE.indexOf(a) - STAT_ORDINE.indexOf(b));
    if (!attivi.length) return "";
    const mostrati = attivi.slice(0, attivi.length > BADGE_MAX ? BADGE_MAX - 1 : BADGE_MAX);
    const resto = attivi.length - mostrati.length;
    return `<div class="stat-badges">` + mostrati.map(k => {
      const n = st[k];
      return `<span class="stat-badge ${n > 0 ? "su" : "giu"}"
        >${STAT_SIGLA[k]}<i>${frecce(n)}</i></span>`;
    }).join("") + (resto ? `<span class="stat-badge altri">+${resto}</span>` : "") + `</div>`;
  }

  /* Elenco completo degli stadi di UN combattente. Si chiude toccando ovunque. */
  function apriStadi(f) {
    chiudiStadi();
    const scena = document.getElementById("scene");
    if (!scena || !f) return;
    const righe = STAT_ORDINE.map(k => {
      const n = f.stages[k] || 0;
      const m = moltStadio(k, n);
      return `<div class="sp-riga ${n > 0 ? "su" : n < 0 ? "giu" : ""}">
        <span class="sp-nome">${STAT_IT[k]}</span>
        <span class="sp-stadio">${n > 0 ? "+" : ""}${n}</span>
        <span class="sp-molt">×${m.toFixed(2).replace(".", ",")}</span></div>`;
    }).join("");
    const pop = document.createElement("div");
    pop.id = "stat-pop";
    pop.innerHTML = `<div class="sp-tit">${f.name}</div>${righe}
      <div class="sp-nota">gli sbalzi si azzerano rientrando nella ball</div>`;
    pop.onclick = (e) => { e.stopPropagation(); chiudiStadi(); };
    scena.appendChild(pop);
    // il tocco SUCCESSIVO in scena lo chiude (in cattura: quello che l'ha
    // aperto ha gia' fermato la propagazione, quindi non si autochiude)
    scena.addEventListener("click", chiudiStadi, { once: true, capture: true });
  }
  function chiudiStadi() {
    const v = document.getElementById("stat-pop");
    if (v) v.remove();
  }

  /* ======================================================================
     SCANNER IV — passivo, sempre acceso

     🔴 Era un premio che non faceva NIENTE: `game.charms.ivScanner` veniva
     scritto in `startRun` e nella ricompensa, e non lo leggeva nessuno.

     Nell'originale (`ScanIvsPhase`) non mostra i numeri: accende le etichette
     delle statistiche sul riquadro dell'avversario, colorando quelle in cui il
     suo IV e' MIGLIORE del migliore che hai gia' registrato per quella specie
     (oro se e' un 31 perfetto). E' l'informazione che serve davvero, perche'
     catturando si aggiorna il tuo record (`recordIVs`): dice «vale la pena
     prenderlo?».

     Da noi e' la stessa cosa, senza la domanda che l'originale fa prima: entra
     l'avversario e l'informazione c'e' gia', in un angolo del suo riquadro.
     I numeri veri stanno a un tocco, come per gli sbalzi. */
  const IV_SIGLA = { hp: "PS", atk: "ATT", def: "DIF", spatk: "A.SP", spdef: "D.SP", spd: "VEL" };
  const IV_NOME  = { hp: "PS", atk: "Attacco", def: "Difesa", spatk: "Att. Speciale",
                     spdef: "Dif. Speciale", spd: "Velocità" };
  const IV_MAX = 31;

  // Le statistiche che vale la pena segnalare, gia' ordinate: prima i 31, poi
  // i miglioramenti piu' grossi.
  function ivNotevoli(f) {
    const mie = bestIVsFor(f.speciesId) || {};
    return IV_KEYS
      .map(k => ({ k, v: (f.ivs || {})[k] || 0, mio: mie[k] || 0 }))
      .filter(x => x.v === IV_MAX || x.v > x.mio)
      .sort((a, b) => (b.v === IV_MAX) - (a.v === IV_MAX) || (b.v - b.mio) - (a.v - a.mio));
  }

  // Lo scanner e' acceso? Va posseduto E non spento a mano dalla lente.
  const scannerOn = () => !!(game.charms && game.charms.ivScanner) && meta.ivOn !== false;
  // C'e' qualcosa che varrebbe la pena guardare, fra chi ho davanti?
  const ivInteressanti = () => enemiesOnField().some(f => f && f.ivs && ivNotevoli(f).length);

  /* `forza`: mostra i chip anche a lente SPENTA. Lo usa la schermata di
     cattura, dove l'informazione serve per decidere e non c'e' spazio per
     andarsela a cercare. Il possesso del Rilevatore resta obbligatorio: e' un
     oggetto che si compra, non un regalo. */
  function badgeIV(f, forza) {
    const acceso = forza ? !!(game.charms && game.charms.ivScanner) : scannerOn();
    if (!acceso || !f || !f.ivs || !isEnemySide(f)) return "";
    const notevoli = ivNotevoli(f).slice(0, 3);
    const chip = notevoli.length
      ? notevoli.map(x => `<span class="iv-chip ${x.v === IV_MAX ? "perfetto" : "meglio"}"
          >${IV_SIGLA[x.k]}${x.v === IV_MAX ? "★" : "▲"}</span>`).join("")
      : `<span class="iv-chip niente">niente di meglio</span>`;
    return `<div class="iv-badges">${chip}</div>`;
  }

  /* La LENTE: interruttore dello scanner, nella riga dei comandi accanto al
     menu. 🔴 Sta li' e non nella scena perche' e' un COMANDO, non
     un'informazione: nella scena rubava spazio ai Pokemon e ai riquadri, che
     agli angoli ci stanno gia' tutti.
     Spenta, il riquadro dell'avversario resta pulito. Ma se in campo c'e' un
     esemplare con IV che ti servono, la lente VIBRA: l'informazione non si
     perde, bussa e basta. */
  function bottoneLente() {
    if (!game.charms || !game.charms.ivScanner) return "";
    const on = scannerOn();
    const vibra = !on && ivInteressanti();
    const titolo = on ? "Scanner IV acceso — tocca per spegnerlo"
      : vibra ? "Questo ha IV che ti servono: tocca per vedere quali"
              : "Scanner IV spento — tocca per accenderlo";
    return `<button class="lente-btn${on ? " on" : ""}${vibra ? " vibra" : ""}"
      data-act="lente" title="${titolo}" aria-label="${titolo}">🔍</button>`;
  }

  /* Tutti e sei i valori, col numero. Stesso riquadro degli sbalzi. */
  function apriIV(f) {
    chiudiStadi();
    const scena = document.getElementById("scene");
    if (!scena || !f) return;
    const mie = bestIVsFor(f.speciesId) || null;
    const righe = IV_KEYS.map(k => {
      const v = (f.ivs || {})[k] || 0, mio = mie ? (mie[k] || 0) : null;
      const cls = v === IV_MAX ? "perfetto" : (mio !== null && v > mio) ? "su" : "";
      return `<div class="sp-riga ${cls}">
        <span class="sp-nome">${IV_NOME[k]}</span>
        <span class="sp-stadio">${v}</span>
        <span class="sp-molt">${mie ? "tuo " + mio : "—"}</span></div>`;
    }).join("");
    const pop = document.createElement("div");
    pop.id = "stat-pop";
    pop.innerHTML = `<div class="sp-tit">🔍 IV di ${f.name}</div>${righe}
      <div class="sp-nota">${mie ? "a destra il migliore che hai già registrato"
                                : "non hai mai catturato questa specie"}</div>`;
    pop.onclick = (e) => { e.stopPropagation(); chiudiStadi(); };
    scena.appendChild(pop);
    scena.addEventListener("click", chiudiStadi, { once: true, capture: true });
  }

  function renderHpPanel(el, fighter, ov) {
    const hp = ov ? ov.hp : fighter.hp;
    const maxHp = ov ? ov.maxHp : fighter.maxHp;
    const status = ov ? ov.status : fighter.status;
    const ratio = Math.max(0, hp / maxHp);
    const color = ratio > 0.5 ? "var(--hp-green)" : ratio > 0.2 ? "var(--hp-yellow)" : "var(--hp-red)";
    const badge = status
      ? `<span class="status-badge st-${status}">${STATUS_IT[status]}</span>` : "";
    el.innerHTML = `
      <div class="row1">
        <span class="name">${iconaDex(fighter)}${fighter.name}<span class="gen g-${fighter.gender}">${genderSymbol(fighter)}</span>${badge}</span>
        <span class="lvl"><span class="lvpfx">Lv.</span>${fighter.level}</span>
      </div>
      <div class="hp-bar-track">
        <div class="hp-bar-fill" style="width:${ratio * 100}%; background:${color};"></div>
        ${(fighter.segBounds || []).map(b => `<div class="seg-mark" style="left:${b / maxHp * 100}%"></div>`).join("")}
      </div>
      <div class="hp-text">${Math.max(0, hp)} / ${maxHp}</div>
      ${barraExp(fighter)}
      <div class="ability-line"><span class="tipi-mini">${fighter.types.map(t => `<span class="ticon t-${t}"></span>`).join("")}</span>${fighter.ability ? fighter.ability.it : ""}</div>
      ${badgeStadi(fighter, ov && ov.stages)}
      ${badgeIV(fighter)}`;
    /* Il bersaglio del dito e' la RIGA intera, non il singolo chip: i chip
       sono alti 18 px e da soli non si prendono. */
    const riga = el.querySelector(".stat-badges");
    if (riga) riga.onclick = (e) => {
      e.stopPropagation();            // non far avanzare anche la narrazione
      apriStadi(fighter);
    };
    const rigaIv = el.querySelector(".iv-badges");
    if (rigaIv) rigaIv.onclick = (e) => { e.stopPropagation(); apriIV(fighter); };
  }

  /* Barra dell'ESPERIENZA — solo per i TUOI Pokemon, come nei giochi veri.
     Ogni Pokemon ha la sua: l'esperienza e' condivisa, ma la curva di crescita
     e' la sua, quindi due membri della squadra non salgono insieme. */
  function progressoExp(f) {
    if (!f || f.exp == null) return null;
    const gr = f.growthRate || (S[f.speciesId] || {}).growthRate;
    const qui = expTotalePerLivello(f.level, gr);
    const poi = expTotalePerLivello(f.level + 1, gr);
    if (poi <= qui) return null;
    const fatto = Math.max(0, Math.min(poi - qui, f.exp - qui));
    return { frazione: fatto / (poi - qui), manca: Math.max(0, poi - f.exp) };
  }
  /* "manca X exp al livello" — o il perche' non sale piu' (tetto dell'ondata) */
  function expEtichetta(f) {
    if (f.level >= livelloMassimo(game.wave)) return " · tetto dell'ondata";
    const p = progressoExp(f);
    return p ? ` · mancano ${p.manca} exp` : "";
  }
  function barraExp(f) {
    if (isEnemySide(f)) return "";                   // gli avversari non ce l'hanno
    const p = progressoExp(f);
    if (!p) return "";
    const tetto = livelloMassimo(game.wave);
    if (f.level >= tetto) return `<div class="exp-track alcap"><div class="exp-fill" style="width:100%"></div><span class="exp-cap">MAX ondata</span></div>`;
    return `<div class="exp-track"><div class="exp-fill" style="width:${(p.frazione * 100).toFixed(1)}%"></div></div>`;
  }

  function clearSlot(spriteSel, panelSel) {
    const sp = $(spriteSel);
    sp.style.background = "none"; sp.style.width = "0"; sp.style.height = "0"; sp.textContent = "";
    // il riquadro va NASCOSTO, non solo svuotato: ora è un riquadro sovrapposto
    // alla scena, e da vuoto resterebbe comunque un rettangolo scuro appeso
    // (è il tipo di artefatto che si vedeva con gli slot della lotta in doppio)
    const p = $(panelSel);
    p.innerHTML = ""; p.hidden = true;
  }

  // Ridisegno "sicuro" per i caricamenti asincroni degli sprite: usa il frame
  // della narrazione in corso (se c'è), altrimenti lo stato attuale. Così uno
  // sprite che arriva tardi appare SEMPRE, senza sfalsare le barre HP.
  function redrawScene() { renderScene(game.curFrame || undefined); }

  // Rete di sicurezza contro le corse asincrone: se un combattente ha lo sprite
  // caricato ma a schermo si vede ancora il segnaposto colorato, ridisegna. Se
  // lo sprite non è ancora arrivato, riprova appena è pronto.
  function ensureSprites() {
    const pairs = [[game.enemy, "#enemy-sprite", "front"], [game.player, "#player-sprite", "back"]];
    let needRedraw = false;
    for (const [f, sel, side] of pairs) {
      if (!f) continue;
      const el = $(sel);
      /* ⚠️ Non basta più cercare "assets/pokemon": le livree rare ed epiche
         sono immagini ricolorate al volo e il loro indirizzo è un `blob:`,
         che di percorso non ne ha. Cercando la stringa vecchia il controllo
         diceva "non dipinto" a ogni giro e si ridisegnava all'infinito. */
      const painted = el && f.spr && el.style.backgroundImage.includes(f.spr.sheet);
      if (f.spr && !painted) needRedraw = true;
      else if (!f.spr) {
        // sprite mai risolto per questo oggetto: (ri)caricalo e dipingi
        loadFighterSprite(f, side).then(s => {
          if (!s) return;
          f.spr = s;
          if (game.enemy === f || game.player === f) redrawScene();
        });
      }
    }
    if (needRedraw) redrawScene();
  }

  // frame (opzionale) = evento con snapshot: se presente, le barre/sprite mostrano
  // lo stato di QUEL momento (riproduzione scaglionata), non lo stato finale.
  /* Disegna (o nasconde) uno dei due slot secondari della lotta in doppio. */
  function slot2(prefix, slotSel, f, cap, ov, sprOv) {
    const slot = document.querySelector(slotSel);
    if (!slot) return;
    // il riquadro PS non sta piu' dentro lo slot (sta agli angoli della scena):
    // va nascosto per conto suo, altrimenti resta appeso a mezz'aria
    const panel = $(prefix + "-hp-panel");
    if (!f) { slot.hidden = true; if (panel) panel.hidden = true; return; }
    slot.hidden = false;
    if (panel) panel.hidden = false;
    renderSprite($(prefix + "-sprite"), f, cap, sprOv || null);
    renderHpPanel(panel, f, ov || null);
  }

  function renderScene(frame) {
    applyAmbiente();          // luce dell'ora + effetto del meteo in corso
    const eOv = frame ? { hp: frame.ehp, maxHp: frame.emax, status: frame.est, stages: frame.estg } : null;
    const pOv = frame ? { hp: frame.php, maxHp: frame.pmax, status: frame.pst, stages: frame.pstg } : null;
    const eSprOv = frame ? { fainted: frame.efaint, hit: frame.ehit } : null;
    const pSprOv = frame ? { fainted: frame.pfaint, hit: frame.phit } : null;
    const e2Ov = frame ? { hp: frame.e2hp, maxHp: frame.e2max, status: frame.e2st, stages: frame.e2stg } : null;
    const p2Ov = frame ? { hp: frame.p2hp, maxHp: frame.p2max, status: frame.p2st, stages: frame.p2stg } : null;
    const e2SprOv = frame ? { fainted: frame.e2faint, hit: frame.e2hit } : null;
    const p2SprOv = frame ? { fainted: frame.p2faint, hit: frame.p2hit } : null;
    // chi finisce in campo e' "visto": basta questo punto solo, ci passano
    // selvatici, boss, squadre degli allenatori e incontri misteriosi
    if (game.enemy) registerSeen(game.enemy.speciesId);
    if (game.enemy2) registerSeen(game.enemy2.speciesId);
    /* QUALE Pokemon disegnare. Durante la narrazione e' quello che era in campo
       a quel momento (`frame.pmon`), non quello di adesso: al cambio il motore
       ha gia' sostituito `game.player` prima che le frasi vengano lette. */
    const E = frame && "emon" in frame ? frame.emon : game.enemy;
    const P = frame && "pmon" in frame ? frame.pmon : game.player;
    const E2 = frame && "e2mon" in frame ? frame.e2mon : game.enemy2;
    const P2 = frame && "p2mon" in frame ? frame.p2mon : game.player2;
    if (E) { $("#enemy-hp-panel").hidden = false; renderSprite($("#enemy-sprite"), E, spriteCfg(ENEMY_SPRITE, E), eSprOv); renderHpPanel($("#enemy-hp-panel"), E, eOv); }
    else clearSlot("#enemy-sprite", "#enemy-hp-panel");
    if (P) { $("#player-hp-panel").hidden = false; renderSprite($("#player-sprite"), P, spriteCfg(PLAYER_SPRITE, P), pSprOv); renderHpPanel($("#player-hp-panel"), P, pOv); }
    else clearSlot("#player-sprite", "#player-hp-panel");
    // SECONDI slot: presenti solo nelle lotte in doppio
    const gm = $("#game");
    if (gm) gm.classList.toggle("double", !!game.double);
    slot2("#enemy2", ".battler-slot.enemy2", E2, spriteCfg(ENEMY_SPRITE, E2), e2Ov, e2SprOv);
    slot2("#player2", ".battler-slot.ally2", P2, spriteCfg(PLAYER_SPRITE, P2), p2Ov, p2SprOv);
    // barre degli oggetti tenuti (giocatore e avversario)
    renderHeldBar("#held-ally", P);
    renderHeldBar("#held-enemy", E);
    // chi e' dentro la ball resta invisibile anche dopo il ridisegno
    applicaDentroLaBall();
    const wi = $("#wave-indicator");
    const bio = BIOMES[game.biome];
    const w = WEATHER[weatherKind()];
    const te = TERRAINS[terrainKind()];
    const od = timeOfDay();
    if (wi) wi.textContent = game.wave > 0
      ? `${bio ? bio.it + " · " : ""}Ondata ${game.wave} · ${TIME_EMOJI[od]} ${TIME_IT[od]}${w ? " · " + w.emoji + " " + w.it : ""}${te ? " · " + te.emoji + " " + te.it : ""}` : "";
  }

  /* Scelta del bersaglio: appare solo in doppio, quando i nemici in piedi
     sono due. Mostra nome, livello e PS di ciascuno. */
  /* ⚠️ ORDINE DEI PULSANTI: `enemiesOnField()` torna [enemy, enemy2], ma sullo
     schermo `enemy` sta a DESTRA ed `enemy2` a SINISTRA (vedi il CSS dei
     battler-slot). Messi in quell'ordine dentro `.grid2`, il Pokemon di destra
     si prendeva il pulsante di sinistra e viceversa. Qui si riordinano da
     SINISTRA a DESTRA, come si vedono in campo. */
  const ordineSchermo = (lista) => lista.slice().sort(
    (a, b) => (a === game.enemy2 ? 0 : 1) - (b === game.enemy2 ? 0 : 1));

  /* Rende toccabili gli sprite dei bersagli (oltre ai pulsanti) e li segnala
     con un anello pulsante. Con `lista` nulla si spegne tutto. */
  function evidenziaBersagli(lista, onPick) {
    [["#enemy-battler", game.enemy], ["#enemy2-battler", game.enemy2],
     ["#player-battler", game.player], ["#player2-battler", game.player2]].forEach(([sel, f]) => {
      const el = $(sel);
      if (!el) return;
      const attivo = !!(lista && f && lista.includes(f));
      el.classList.toggle("bersagliabile", attivo);
      el.onclick = attivo ? () => onPick(f) : null;
    });
  }

  function showTargetMenu(moveIndex, bersagli) {
    bersagli = ordineSchermo(bersagli);
    /* L'efficacia si ripete QUI su ogni bersaglio, e non e' un doppione: sul
       pulsante della mossa si vede il migliore dei due, ma se i due avversari
       hanno tipi diversi e' proprio la scelta del bersaglio a decidere. */
    const mvSel = M[(currentChooser() || game.player).moves[moveIndex].id];

    /* 🔴 CASELLE FISSE, nell'ordine in cui i Pokemon stanno in campo.
       Prima i pulsanti erano la lista dei bersagli VIVI: quando uno cadeva, il
       superstite scivolava nella casella dell'altro e il dito, che quella
       posizione l'aveva gia' imparata, colpiva quello sbagliato. Adesso ogni
       slot ha la sua casella: se e' vuoto resta una casella spenta.
       L'ordine e' quello dello SCHERMO (vedi `ordineSchermo`): a sinistra lo
       slot `enemy2`, a destra `enemy`. */
    const slotSinistra = game.enemy2 || null;
    const slotDestra = game.enemy || null;
    const disegna = (f) => {
      if (!f) return `<span class="btn move-btn tgt-vuoto"></span>`;
      const i = bersagli.indexOf(f);
      if (i < 0) return `<span class="btn move-btn tgt-vuoto"></span>`;
      const ratio = Math.max(0, f.hp / f.maxHp);
      const col = ratio > 0.5 ? "var(--hp-green)" : ratio > 0.2 ? "var(--hp-yellow)" : "var(--hp-red)";
      /* ⚠️ Il bersaglio dalla TUA parte va segnalato: adesso che si può
         scegliere, un tocco sbagliato vuol dire tirare una fiammata sul proprio
         compagno. Fondo diverso e la parola «alleato» scritta. */
      const mio = !isEnemySide(f);
      return `<button class="btn move-btn tgt-btn${mio ? " alleato" : ""}" data-i="${i}" style="background:${mio ? "#3a2f4d" : "#2c3444"};">
          <span class="move-name">${miniIcon(f.dex, 1)} ${f.name}</span>
          <span class="move-meta"><span>${mio ? "alleato · " : ""}Lv.${f.level}</span>
            ${chipEfficacia(mvSel, [f])}
            <span class="tgt-hp"><span style="width:${ratio * 100}%;background:${col}"></span></span></span>
        </button>`;
    };
    // le due caselle degli avversari, sempre e comunque due
    const righeNemici = bersagli.some(f => isEnemySide(f))
      ? `<div class="grid2 tgt-grid">${disegna(slotSinistra)}${disegna(slotDestra)}</div>` : "";
    // e sotto, a tutta larghezza, chi sta dalla tua parte (alleato o te stesso)
    const miei = bersagli.filter(f => !isEnemySide(f));
    const righeMie = miei.length
      ? `<div class="tgt-miei">${miei.map(disegna).join("")}</div>` : "";
    cmd().innerHTML = `
      <div class="prompt-line">Chi vuoi colpire? <span class="hud">· o toccalo in campo</span></div>
      ${righeNemici}${righeMie}
      <div class="back-row"><button class="btn back" data-act="back">Indietro</button></div>`;
    const scegli = (f) => { evidenziaBersagli(null); playerChooseMove(moveIndex, f); };
    cmd().querySelectorAll(".tgt-btn").forEach(b => b.onclick = () =>
      scegli(bersagli[parseInt(b.dataset.i, 10)]));
    cmd().querySelector('[data-act="back"]').onclick = () => { evidenziaBersagli(null); showMoves(); };
    // …e si può colpire anche toccando direttamente il Pokémon nella scena
    evidenziaBersagli(bersagli, scegli);
  }

  /* ---------------------------------------------------------------------- */
  /*  RENDER — comandi (schermo sotto)                                      */
  /* ---------------------------------------------------------------------- */
  const cmd = () => $("#commands");

  /* In DOPPIO comandi tutti e due i tuoi Pokemon: `game.chooser` dice chi sta
     scegliendo adesso (0 = primo slot, 1 = secondo) e `game.queued` conserva
     l'azione del primo finché non hai deciso anche per il secondo. */
  function currentChooser() {
    if (!game.double) return game.player;
    return game.chooser === 1 ? game.player2 : game.player;
  }
  /* Serve un secondo comando? (solo in doppio, col secondo alleato in campo) */
  const serveSecondoComando = () =>
    game.double && game.chooser === 0 && game.player2 && !game.player2.fainted;

  function showMainMenu() {
    ensureSprites();          // garantisce che gli sprite caricati siano dipinti
    hideTrainerPortrait();    // il ritratto si vede solo durante l'intro
    evidenziaBersagli(null);  // rete di sicurezza: nessun anello resta acceso
    const alive = aliveParty().length;
    const chi = currentChooser();
    if (!chi) { game.chooser = 0; game.queued = null; }
    const tf = canTransform(currentChooser() || game.player);   // mega/gigamax disponibile?
    const tfRow = tf
      ? `<div class="back-row"><button class="btn transform-btn" data-act="transform">${tf === "mega" ? "✨ MEGAEVOLVI" : "🔴 GIGAMAXIZZA"}</button></div>` : "";
    cmd().innerHTML = `
      <div class="prompt-line has-menu"><span class="pl-testo">Tocca a <b>${(chi || game.player).name}</b>${game.double ? ` (${game.chooser === 1 ? "2°" : "1°"})` : ""}</span><span class="hud">${alive}/${game.party.length} · 🔴${totalBalls()} · ₽${game.money} · 🍀<b style="color:${luckColor(runLuck())}">${LUCK_RANK[runLuck()]}</b></span><span class="pl-tasti">${bottoneLente()}<button class="menu-btn" data-act="menu" aria-label="Menu">☰</button></span></div>
      <div class="grid2">
        <button class="btn main-fight" data-act="fight">Lotta</button>
        <button class="btn main-bag"   data-act="ball">Ball</button>
        <button class="btn main-team"  data-act="team">Squadra</button>
        <button class="btn main-run"   data-act="run"
          title="${motivoNoFuga() || "probabilità ~" + probabilitaFuga() + "%"}">Fuggi</button>
      </div>${game.chooser === 1 ? `<div class="back-row"><button class="btn back" data-act="rifai">↩ Rifai la prima scelta</button></div>` : ""}${tfRow}`;
    if (game.chooser === 1) cmd().querySelector('[data-act="rifai"]').onclick = () => {
      game.chooser = 0; game.queued = null; showMainMenu();
    };
    if (tf) cmd().querySelector('[data-act="transform"]').onclick = () => {
      const log = makeLog();
      transform(game.player, tf, log);
      renderScene();
      // la trasformazione usa il turno: il nemico attacca
      const enemyMove = enemyChooseMove();
      if (!game.enemy.fainted && !game.player.fainted) resolveAction(game.enemy, game.player, enemyMove, log);
      endOfTurnResidual(game.enemy, log);
      endOfTurnResidual(game.player, log);
      game.player.volatile.flinch = false; game.enemy.volatile.flinch = false;
      playEvents(log.events, afterTurn);
    };
    cmd().querySelector('[data-act="fight"]').onclick = showMoves;
    cmd().querySelector('[data-act="ball"]').onclick  = showBallMenu;
    cmd().querySelector('[data-act="team"]').onclick = () => renderParty("switch");
    cmd().querySelector('[data-act="run"]').onclick  = tentaFuga;
    cmd().querySelector('[data-act="menu"]').onclick = showRunMenu;
    const lente = cmd().querySelector('[data-act="lente"]');
    if (lente) lente.onclick = () => {
      meta.ivOn = !scannerOn();     // acceso <-> spento, e si ricorda
      saveMeta();
      renderScene();                // i chip compaiono o spariscono
      showMainMenu();               // e la lente cambia stato
    };
  }

  /* 🔴 Dove eravamo arrivati nella lista squadra.
     Aprire la scheda di un Pokemon e tornare indietro RIDISEGNA la lista da
     zero, e il pannello (#meta, che e' lo scroller) ripartiva da capo: con sei
     Pokemon e le schede lunghe voleva dire riscorrere ogni volta per arrivare
     al quinto. Si segna la posizione all'andata e si rimette al ritorno.
     ⚠️ Va rimessa DOPO che il browser ha impaginato, non subito: appena
     riempito l'innerHTML l'altezza non c'e' ancora e lo scrollTop verrebbe
     tagliato a zero. Da qui il doppio colpo, subito e al fotogramma dopo. */
  let scrollSquadra = 0;        // l'ultima posizione vista
  let ripristinaScroll = null;  // valorizzata solo quando si TORNA da una scheda
  function rimettiScroll() {
    const y = ripristinaScroll; ripristinaScroll = null;
    const m = metaEl();
    if (y == null) { m.scrollTop = 0; return; }
    m.scrollTop = y;
    requestAnimationFrame(() => { m.scrollTop = y; });
  }

  // Lista squadra. mode "switch" (dal menu, con Indietro) o "force" (dopo un KO,
  // obbligatorio). Ogni voce mostra nome, Lv, barra HP, stato.
  /* Scelta del Pokemon da mandare in campo — A SCHERMO INTERO (overlay #meta).
     Prima stava nella sola fascia comandi (un quarto dello schermo) e le righe
     erano minuscole: per un menu che si apre a ogni cambio, e in cui bisogna
     confrontare PS, stato e mosse, era troppo poco. Ora e' una carta per
     Pokemon con tipi, abilita', oggetti tenuti e mosse coi PP. */
  /* ======================================================================
     SPOSTARE OGGETTI FRA POKÉMON (§36)

     Nell'originale è un modo del pannello squadra (`PartyUiMode.MODIFIER_TRANSFER`)
     e ha un pulsante suo nella riga in basso del negozio, accanto a
     «Rimescola», «Squadra» e «Blocca rarità». Il giro è di tre passi:
       1. scegli DA CHI  → 2. scegli QUALE oggetto (e quanti) → 3. scegli A CHI
     Da noi il pulsante sta dentro il pannello squadra invece che nel negozio:
     su un telefono la riga in basso del negozio non regge un quarto tasto, e il
     posto dove uno va a guardare gli oggetti è comunque la squadra.

     ⚠️ Differenza con l'originale che vale la pena sapere: là ogni oggetto ha un
     TETTO di pile per Pokémon (`getMaxHeldItemCount`) e il trasferimento viene
     rifiutato se il destinatario è già al massimo. Noi il tetto non ce l'abbiamo
     da nessuna parte — nemmeno sui premi — quindi metterlo solo qui sarebbe
     incoerente. È una scelta di bilanciamento da fare a parte.
     ====================================================================== */
  let ritornoSquadra = null;            // dove si torna uscendo dal pannello
  let trasf = null;                     // { da, voce, quanti } durante lo spostamento

  /* Gli oggetti tenuti di un Pokémon, in forma maneggiabile: chiave, nome,
     icona e quantità. Unisce i tre posti in cui li teniamo (`held`, il
     sotto-oggetto `typeboost`, e `berries`). */
  function heldElenco(p) {
    const out = [];
    for (const k in (p.held || {})) {
      if (k === "typeboost") {
        for (const t in p.held.typeboost) {
          out.push({ tipo: "typeboost", chiave: t, n: p.held.typeboost[t],
                     nome: nomeTypeBoost(t), icon: TYPEBOOST_ICON[t] || "silk_scarf" });
        }
        continue;
      }
      const b = SPECIE_BOOST[k];
      out.push({ tipo: "held", chiave: k, n: p.held[k],
                 nome: nomeHeld(k), icon: b ? b.icon : (HELD_ICON[k] || "leftovers") });
    }
    for (const k in (p.berries || {})) {
      out.push({ tipo: "berry", chiave: k, n: p.berries[k],
                 nome: BERRY_DATA[k].it, icon: BERRY_DATA[k].icon });
    }
    return out;
  }
  const haOggetti = p => heldElenco(p).length > 0;
  const puoSpostare = () => game.party.length > 1 && game.party.some(haOggetti);

  /* Toglie `quanti` pezzi a `da` e li dà a `a`. Le tre famiglie di oggetti
     stanno in posti diversi, quindi il travaso va scritto per ognuna. */
  function spostaOggetto(da, a, voce, quanti) {
    const n = Math.min(quanti, voce.n);
    if (voce.tipo === "berry") {
      da.berries[voce.chiave] -= n;
      if (da.berries[voce.chiave] <= 0) delete da.berries[voce.chiave];
      a.berries = a.berries || {};
      a.berries[voce.chiave] = (a.berries[voce.chiave] || 0) + n;
    } else if (voce.tipo === "typeboost") {
      da.held.typeboost[voce.chiave] -= n;
      if (da.held.typeboost[voce.chiave] <= 0) delete da.held.typeboost[voce.chiave];
      if (!Object.keys(da.held.typeboost).length) delete da.held.typeboost;
      a.held.typeboost = a.held.typeboost || {};
      a.held.typeboost[voce.chiave] = (a.held.typeboost[voce.chiave] || 0) + n;
    } else {
      da.held[voce.chiave] -= n;
      if (da.held[voce.chiave] <= 0) delete da.held[voce.chiave];
      a.held[voce.chiave] = (a.held[voce.chiave] || 0) + n;
    }
    /* ⚠️ Gli oggetti legati alla specie (Elettropalla, Osso spesso…) e l'Evolcondensa
       cambiano le STATISTICHE: dopo un travaso vanno ricalcolate su entrambi, o
       restano quelle di prima finché non succede altro. */
    recomputeStats(da); recomputeStats(a);
    salvaRun();
    return n;
  }

  /* Le tre schermate dello spostamento. `passo` null = scegli da chi. */
  function renderSposta(passo) {
    if (!passo) trasf = null;
    const da = trasf && game.party[trasf.da];

    if (!trasf) {                                  // 1. DA CHI
      const cards = game.party.map((p, i) =>
        cardCompatta(p, i, haOggetti(p) ? "vivo" : "spento",
          haOggetti(p) ? `<span class="pc-conta">🎒${heldElenco(p).reduce((x, o) => x + o.n, 0)}</span>` : `<span class="pc-conta vuoto">—</span>`)).join("");
      showMetaScreen(`
        <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">Sposta oggetti</div>
        <div class="meta-sub">da chi li prendi?</div>
        <div class="pd-list griglia2">${cards}</div>
        <div class="meta-actions"><button class="meta-btn ghost" data-act="back">↩ Squadra</button></div>`);
      metaEl().querySelectorAll(".pd-card[data-i]").forEach(b => b.onclick = () => {
        const i = parseInt(b.dataset.i, 10);
        if (!haOggetti(game.party[i])) { return; }
        trasf = { da: i, voce: null, quanti: 1 };
        renderSposta("oggetto");
      });
      metaEl().querySelector('[data-act="back"]').onclick = () => renderParty("check");
      return;
    }

    if (passo === "oggetto") {                     // 2. QUALE, e quanti
      const voci = heldElenco(da);
      const chips = voci.map((o, j) =>
        `<button class="chip og-chip" data-o="${j}">
           <span class="og-ic" style="background-image:url('${itemIcon(o.icon)}')"></span>${o.nome}${o.n > 1 ? ` ×${o.n}` : ""}</button>`).join("");
      showMetaScreen(`
        <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">${da.name.replace("✨", "")}</div>
        <div class="meta-sub">quale oggetto sposti?</div>
        <div class="og-lista">${chips}</div>
        <div class="meta-actions"><button class="meta-btn ghost" data-act="back">↩ Indietro</button></div>`);
      metaEl().querySelectorAll("[data-o]").forEach(b => b.onclick = () => {
        trasf.voce = voci[parseInt(b.dataset.o, 10)];
        trasf.quanti = 1;
        renderSposta(trasf.voce.n > 1 ? "quanti" : "a");
      });
      metaEl().querySelector('[data-act="back"]').onclick = () => renderSposta(null);
      return;
    }

    if (passo === "quanti") {                      // 2b. uno o tutti
      const o = trasf.voce;
      showMetaScreen(`
        <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">${o.nome}</div>
        <div class="meta-sub">${da.name.replace("✨", "")} ne ha ${o.n}: quanti ne sposti?</div>
        <div class="og-lista">
          <button class="chip og-chip" data-q="1">uno solo</button>
          <button class="chip og-chip" data-q="${o.n}">tutti e ${o.n}</button>
        </div>
        <div class="meta-actions"><button class="meta-btn ghost" data-act="back">↩ Indietro</button></div>`);
      metaEl().querySelectorAll("[data-q]").forEach(b => b.onclick = () => {
        trasf.quanti = parseInt(b.dataset.q, 10);
        renderSposta("a");
      });
      metaEl().querySelector('[data-act="back"]').onclick = () => renderSposta("oggetto");
      return;
    }

    // 3. A CHI
    const cards = game.party.map((p, i) =>
      cardCompatta(p, i, i === trasf.da ? "spento" : "vivo",
        i === trasf.da ? `<span class="pc-conta vuoto">da qui</span>` : "")).join("");
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">${trasf.voce.nome}${trasf.quanti > 1 ? ` ×${trasf.quanti}` : ""}</div>
      <div class="meta-sub">a chi lo dai?</div>
      <div class="pd-list griglia2">${cards}</div>
      <div class="meta-actions"><button class="meta-btn ghost" data-act="back">↩ Indietro</button></div>`);
    metaEl().querySelectorAll(".pd-card[data-i]").forEach(b => b.onclick = () => {
      const i = parseInt(b.dataset.i, 10);
      if (i === trasf.da) return;
      const a = game.party[i];
      const n = spostaOggetto(da, a, trasf.voce, trasf.quanti);
      const nome = trasf.voce.nome;
      trasf = null;
      showMetaScreen(`
        <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">Fatto</div>
        <div class="meta-sub">${nome}${n > 1 ? ` ×${n}` : ""}: da ${da.name.replace("✨", "")} a ${a.name.replace("✨", "")}</div>
        <div class="meta-actions two-col">
          <button class="meta-btn ghost" data-act="squadra">↩ Squadra</button>
          <button class="meta-btn gacha" data-act="ancora">🎒 Sposta ancora</button></div>`);
      metaEl().querySelector('[data-act="squadra"]').onclick = () => renderParty("check");
      metaEl().querySelector('[data-act="ancora"]').onclick = () => renderSposta(null);
    });
    metaEl().querySelector('[data-act="back"]').onclick = () => renderSposta(trasf.voce.n > 1 ? "quanti" : "oggetto");
  }

  function tornaAlNegozio() { const f = ritornoSquadra; ritornoSquadra = null; if (f) f(); }

  /* Una casella della griglia squadra. `stato` dice come deve comportarsi:
       "vivo"     → si può scegliere
       "spento"   → si vede ma non è una scelta valida (esausto, già in campo,
                    o — nello spostamento — non ha niente da dare)
     ⚠️ Non si usa mai `disabled`: un bottone disabilitato non riceve il tocco,
     e il tocco serve comunque per aprire la scheda o per dire perché no. */
  function cardCompatta(p, i, stato, tagExtra) {
    const ratio = Math.max(0, p.hp / p.maxHp);
    const col = ratio > 0.5 ? "var(--hp-green)" : ratio > 0.2 ? "var(--hp-yellow)" : "var(--hp-red)";
    const inCampo = p === game.player || (game.double && p === game.player2);
    const st = p.status ? `<span class="status-badge st-${p.status}">${STATUS_IT[p.status]}</span>` : "";
    const types = p.types.map(t => `<span class="ticon t-${t}"></span>`).join("");
    const tag = tagExtra != null ? tagExtra
      : inCampo ? '<span class="party-active">in campo</span>'
      : p.fainted ? '<span class="party-ko">KO</span>' : "";
    const pips = p.moves.map(m => {
      const mv = M[m.id];
      return `<i class="pc-pip${m.pp === 0 ? " vuota" : ""}" style="background:${T[mv.type].color}" title="${mv.it} ${m.pp}/${m.maxPp}"></i>`;
    }).join("");
    const nome = p.name.replace("✨", "").replace(/\s*\(.*\)\s*$/, "");
    return `<button class="pd-card compatta ${p.fainted ? "ko" : ""} ${inCampo ? "attiva" : ""} ${stato === "spento" ? "nonschierabile" : ""}" data-i="${i}" title="${p.name} · ${p.ability ? p.ability.it : ""}">
        <div class="pc-r1">${miniIcon(p.dex, 1.25)}<span class="pc-nome">${p.shiny ? cromStella(p.shinyVar) : ""}${nome}<span class="gen g-${p.gender}">${genderSymbol(p)}</span></span><span class="pc-lv">${p.level}</span></div>
        <div class="pc-r2">${types}${st}</div>
        <div class="party-hp-track"><div class="party-hp-fill" style="width:${ratio * 100}%;background:${col};"></div></div>
        <div class="pc-r3"><span class="pc-ps">${Math.max(0, p.hp)}/${p.maxHp}</span><span class="pc-pips">${pips}</span>${tag}</div>
      </button>`;
  }

  function renderParty(mode) {
    const cards = game.party.map((p, i) => {
      /* ⚠️ In doppio sono in campo DUE Pokemon: nessuno dei due può essere
         scelto come sostituto (prima si poteva toccare il secondo alleato e
         non succedeva nulla). */
      const inCampo = p === game.player || (game.double && p === game.player2);
      const selectable = !p.fainted && !inCampo;
      /* MOSSE ridotte a quattro pallini del colore del TIPO (§35): serve la
         copertura e quante sono cariche, non i nomi né i PP esatti. */
      return cardCompatta(p, i, selectable || mode === "check" ? "vivo" : "spento");
    }).join("");
    const boxLine = game.box.length ? `<div class="meta-sub">Box: ${game.box.length} Pokémon in deposito</div>` : "";
    /* Nel cambio FORZATO non si torna indietro: qualcuno deve scendere in campo.
       In «check» (dal negozio) si torna al negozio, e c'è lo spostamento oggetti. */
    const backRow = (mode === "force" || mode === "staffetta") ? ""
      : mode === "check"
        ? `<div class="meta-actions ${puoSpostare() ? "two-col" : ""}">
             ${puoSpostare() ? `<button class="meta-btn gacha" data-act="sposta">🎒 Sposta oggetti</button>` : ""}
             <button class="meta-btn ghost" data-act="back">↩ Indietro</button></div>`
        : `<div class="meta-actions"><button class="meta-btn ghost" data-act="back">↩ Indietro</button></div>`;
    const title = (mode === "force" || mode === "staffetta") ? "Chi mandi in campo?" : mode === "check" ? "La tua Squadra" : "Cambia Pokémon";
    const sub = mode === "staffetta" ? "chi entra si tiene gli sbalzi di statistica"
      : mode === "force" ? "il tuo Pokémon è esausto"
      : mode === "check" ? "tocca un Pokémon per vedere la sua scheda"
      : "tocca chi deve scendere in campo";
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">${title}</div>
      <div class="meta-sub">${sub}</div>
      ${luckBar()}
      <div class="pd-list griglia2">${cards}</div>${boxLine}${backRow}`);
    /* ⚠️ Toccare una casella apre la SCHEDA, non manda in campo. Prima il
       Pokémon scendeva in campo al primo tocco, senza che si potesse guardarlo:
       una scelta importante presa senza poter leggere niente. Ora il tocco
       serve a guardare, e a mandare in campo ci pensa un tasto dedicato dentro
       la scheda. Vale anche nel cambio FORZATO: è proprio lì che vuoi vedere
       chi stai mandando allo sbaraglio. */
    rimettiScroll();
    metaEl().querySelectorAll(".pd-card[data-i]").forEach(b => b.onclick = () => {
      scrollSquadra = metaEl().scrollTop;      // da qui si riprendera' al ritorno
      showMonScheda(parseInt(b.dataset.i, 10), mode);
    });
    if (mode === "switch") metaEl().querySelector('[data-act="back"]').onclick = () => { hideMeta(); showMainMenu(); };
    if (mode === "check") {
      metaEl().querySelector('[data-act="back"]').onclick = () => tornaAlNegozio();
      const sp = metaEl().querySelector('[data-act="sposta"]');
      if (sp) sp.onclick = () => renderSposta(null);
    }
  }

  // Offerta di cattura dopo aver sconfitto un selvatico: scegli quale ball usare.
  /* ======================================================================
     SCHEDA PERSONALE di un Pokémon in squadra (§35)

     Divisione del lavoro con la griglia: là c'è solo ciò che serve a decidere
     CHI guardare (identità, PS, tipi, stato, copertura delle mosse); qui c'è
     tutto il resto, che in una casella da 165 px non entrerebbe mai — mosse
     coi nomi e i PP, abilità, passiva, natura, oggetti tenuti, statistiche
     con gli IV, esperienza.
     ====================================================================== */
  /* Quale spiegazione e' aperta nella scheda: { i, tipo, id }. Una sola alla
     volta — su un telefono aprirle tutte vorrebbe dire scorrere all'infinito. */
  let schedaInfo = null;
  const schedaAperto = (i, tipo, id) =>
    !!schedaInfo && schedaInfo.i === i && schedaInfo.tipo === tipo && schedaInfo.id === id;

  /* Cosa fa un oggetto TENUTO. Le descrizioni ci sono gia': quelle dei premi
     (che iniziano con "held: "), quelle delle bacche, e per gli oggetti di
     specie si costruisce dalla tabella. */
  function snippetTenuto(voce) {
    let testo = "";
    if (voce.tipo === "berry") {
      testo = BERRY_DATA[voce.chiave].desc;
    } else if (voce.tipo === "typeboost") {
      testo = `Potenzia del 20% le mosse di tipo ${T[voce.chiave].it}. Si accumula.`;
    } else if (SPECIE_BOOST[voce.chiave]) {
      const b = SPECIE_BOOST[voce.chiave];
      testo = `Raddoppia ${b.stats.map(x => STAT_IT[x] || x).join(" e ")}, ma solo a `
            + b.specie.map(k => (S[k] || {}).it || k).join(" o ") + ".";
    } else {
      const it = REWARD_POOL.find(x => x.id === voce.chiave);
      const d = it ? (typeof it.desc === "function" ? it.desc() : it.desc) : "";
      testo = String(d || "");
      // via il prefisso "held: " delle descrizioni dei premi.
      // NIENTE espressione regolare qui: conterrebbe la coppia che chiude un
      // commento a blocco, e il guardiano della versione clear la conta come
      // tale (falso allarme, ma e' lui che protegge il file generato).
      if (testo.slice(0, 5) === "held:") testo = testo.slice(5).trim();
      if (testo) testo = testo.charAt(0).toUpperCase() + testo.slice(1);
    }
    return `<div class="snippet">
      <div class="snip-top"><b>${voce.nome}</b>${voce.n > 1 ? ` ×${voce.n}` : ""}</div>
      <div class="snip-testo">${testo || "Nessuna descrizione."}</div>
    </div>`;
  }

  function showMonScheda(i, mode) {
    const p = game.party[i];
    if (!p) { renderParty(mode); return; }
    const inCampo = p === game.player || (game.double && p === game.player2);
    const puoScendere = !p.fainted && !inCampo;
    const perche = p.fainted ? "è esausto" : inCampo ? "è già in campo" : "";
    const ratio = Math.max(0, p.hp / p.maxHp);
    const col = ratio > 0.5 ? "var(--hp-green)" : ratio > 0.2 ? "var(--hp-yellow)" : "var(--hp-red)";
    const types = p.types.map(t => `<span class="ticon t-${t}"></span>`).join("");
    const st = p.status ? `<span class="status-badge st-${p.status}">${STATUS_IT[p.status]}</span>` : "";
    const tenuti = heldElenco(p);
    const iv = p.ivs || {};
    const STAT_IT = { atk: "Att", def: "Dif", spatk: "A.Sp", spdef: "D.Sp", spd: "Vel" };
    const stats = Object.keys(STAT_IT).map(k =>
      `<div class="ms-stat"><span class="ms-k">${STAT_IT[k]}</span><b>${p.stats[k]}</b><span class="ms-iv">IV ${iv[k] != null ? iv[k] : "?"}</span></div>`).join("");
    const moves = p.moves.map(m => {
      const mv = M[m.id];
      const on = schedaAperto(i, "mv", m.id);
      return `<button class="ms-mossa${m.pp === 0 ? " vuota" : ""}${on ? " aperta" : ""}" data-info-mv="${m.id}">
          <span class="ticon t-${mv.type}"></span><span class="ms-mv-nome">${mv.it}</span>
          <b>${m.pp}/${m.maxPp}</b><span class="chip-i">ⓘ</span>
        </button>${on ? snippetMossa(m.id) : ""}`;
    }).join("");
    showMetaScreen(`
      <div class="sd-head">
        <div class="sd-sprite-box"><span class="sd-sprite" id="msSprite"></span></div>
        <div class="sd-id">
          <div class="sd-name">${p.shiny ? cromStella(p.shinyVar) : ""}${p.name.replace("✨", "")}<span class="gen g-${p.gender}">${genderSymbol(p)}</span></div>
          <div class="sd-types">${types}${st}</div>
          <div class="ms-lv">Lv.<b>${p.level}</b>${expEtichetta(p)}</div>
          ${barraExp(p)}
        </div>
      </div>
      <div class="ms-hp">
        <div class="party-hp-track"><div class="party-hp-fill" style="width:${ratio * 100}%;background:${col};"></div></div>
        <div class="ms-hp-num">${Math.max(0, p.hp)} / ${p.maxHp} PS</div>
      </div>
      <div class="sd-riga"><span class="sd-lab">Abilità</span><span class="sd-chips">
        ${p.ability ? `<button class="pd-ab ab-info${schedaAperto(i, "ab", p.ability.id) ? " aperta" : ""}" data-info-ab="${p.ability.id}">${p.ability.it}<span class="chip-i">ⓘ</span></button>` : `<span class="pd-ab">—</span>`}
        ${p.passiveAbility ? `<button class="pd-ab pd-pass ab-info${schedaAperto(i, "ab", p.passiveAbility.id) ? " aperta" : ""}" data-info-ab="${p.passiveAbility.id}">+${p.passiveAbility.it}<span class="chip-i">ⓘ</span></button>` : ""}</span></div>
      ${schedaInfo && schedaInfo.i === i && schedaInfo.tipo === "ab" ? snippetAbilita(schedaInfo.id) : ""}
      <div class="sd-riga"><span class="sd-lab">Natura</span><span class="sd-chips"><span class="pd-ab pd-nat">${natureLabel(p) || "—"}</span></span></div>
      ${tenuti.length ? `<div class="sd-riga"><span class="sd-lab">Tiene</span><span class="sd-chips">${tenuti.map((v, n) => `
        <button class="pd-held ab-info${schedaAperto(i, "held", n) ? " aperta" : ""}" data-info-held="${n}">
          <img class="item-icon tiny" src="${itemIcon(v.icon)}" alt="">${v.nome}${v.n > 1 ? ` ×${v.n}` : ""}<span class="chip-i">ⓘ</span></button>`).join("")}</span></div>
      ${schedaInfo && schedaInfo.i === i && schedaInfo.tipo === "held" && tenuti[schedaInfo.id] ? snippetTenuto(tenuti[schedaInfo.id]) : ""}` : ""}
      ${p.luck ? `<div class="sd-riga"><span class="sd-lab">Fortuna</span><span class="sd-chips"><span class="pd-luck">🍀 +${p.luck} alla squadra${p.fainted ? " — ma è esausto, quindi non contano" : ""}</span></span></div>` : ""}
      <div class="meta-sub">Mosse</div>
      <div class="ms-mosse">${moves}</div>
      <div class="meta-sub">Statistiche</div>
      <div class="ms-stats">${stats}</div>
      <div class="meta-actions ${mode === "check" ? "" : "two-col"} sd-azioni">
        <button class="meta-btn ghost" data-act="back">↩ Squadra</button>
        ${mode === "check" ? "" : `<button class="meta-btn primary" data-act="go" ${puoScendere ? "" : "disabled"}>${puoScendere ? "▶ Manda in campo" : perche}</button>`}
      </div>`);
    loadFighterSprite(p, "front").then(spr => {
      const el = document.getElementById("msSprite"); if (!el || !spr) return;
      const k = Math.min(1.7, 104 / spr.frame.h, 104 / spr.frame.w);
      el.style.width = spr.frame.w * k + "px"; el.style.height = spr.frame.h * k + "px";
      el.style.background = `url("${spr.sheet}") -${spr.frame.x * k}px -${spr.frame.y * k}px / ${spr.sheet_w * k}px ${spr.sheet_h * k}px no-repeat`;
      el.style.imageRendering = "pixelated";
    });
    /* Apri/chiudi la spiegazione. Toccando la stessa voce si richiude: e' un
       pannello a fisarmonica, non una finestra da chiudere a parte. */
    const info = (tipo, id) => {
      schedaInfo = schedaAperto(i, tipo, id) ? null : { i, tipo, id };
      showMonScheda(i, mode);
    };
    metaEl().querySelectorAll("[data-info-mv]").forEach(b => b.onclick = () => info("mv", b.dataset.infoMv));
    metaEl().querySelectorAll("[data-info-ab]").forEach(b => b.onclick = () => info("ab", b.dataset.infoAb));
    metaEl().querySelectorAll("[data-info-held]").forEach(b => b.onclick = () => info("held", parseInt(b.dataset.infoHeld, 10)));
    metaEl().querySelector('[data-act="back"]').onclick = () => {
      schedaInfo = null; ripristinaScroll = scrollSquadra; renderParty(mode);
    };
    const go = metaEl().querySelector('[data-act="go"]');
    /* ⚠️ Dal negozio non si schiera: non c'è una lotta in corso in cui mandare
       qualcuno. Il tasto non c'è proprio, invece di esserci spento. */
    if (puoScendere && go) go.onclick = () => {
      hideMeta();
      if (mode === "force") forceSwitchTo(i);
      else if (mode === "staffetta") staffettaVerso(i);
      else playerSwitch(i);
    };
  }

  /* 🔴 A SCHERMO INTERO, come il menu delle ball in lotta.
     Stava nella fascia comandi, che e' alta un quarto di schermo: con cinque
     tipi di ball le ultime finivano sotto il bordo, invisibili e non toccabili
     — identico al difetto gia' corretto per `showBallMenu`, e con la stessa
     cura. Niente scorrimento da inventare: qui lo spazio c'e' davvero, e la
     lotta e' finita, quindi non c'e' nulla da guardare dietro. */
  function renderCaptureScreen() {
    const BALL_IMG = { balls: "pb", greatballs: "gb", ultraballs: "ub", rogueballs: "rb", theftballs: "tb", masterballs: "mb" };
    const owned = BALL_TYPES.filter(b => (game[b.key] || 0) > 0);
    const btns = owned.map(b => {
      const pct = b.mult >= 255 ? 100 : captureChancePct(game.enemy, b.mult, psUltimaBall(game.enemy));
      return `<button class="btn ball-btn" data-b="${b.key}">
        <img class="ball-icon" src="${ballIcon(BALL_IMG[b.key])}" alt="">
        <span class="move-name">${b.it}</span>
        <span class="move-meta"><span>~${pct}%</span><span>· ×${game[b.key]}</span></span>
      </button>`;
    }).join("");
    /* 🔴 Non e' un vicolo cieco: qui si DECIDE se spendere l'ultima ball, e
       per decidere servono due cose — che roba è (gli IV, se hai lo scanner) e
       che squadra hai (un posto libero? uno da sostituire?). Prima o tiravi o
       lasciavi stare, senza poter guardare niente.
       Gli IV stanno QUI dentro invece che dietro un pulsante: la scena è
       coperta dall'overlay, quindi la riga sul riquadro PS non si vedrebbe. */
    /* 🔴 Per decidere se spendere l'ULTIMA ball non basta sapere la
       percentuale: serve sapere se è roba che ti manca. Tre righe, tutte e tre
       cose che il gioco già sa e non diceva:
         · se la specie è mai stata catturata (e cosa sbloccherebbe);
         · che abilità ha questo esemplare;
         · se quell'abilità ce l'hai già fra quelle scegliibili nello starter.
       L'ultima è la più utile delle tre: un doppione non vale una ball, una
       NASCOSTA (1 su 256) vale quasi sempre la pena. */
    const e = game.enemy;
    const radice = rootOf(e.speciesId);
    const maiPreso = !meta.unlocked[e.speciesId];
    const radiceNuova = !giaStarter(radice);
    const cromNuovo = e.shiny && (meta.unlocked[radice] || 0) < 2;
    const rigaDex = maiPreso
      ? `<div class="cap-riga nuovo">📖 Mai catturato${radiceNuova
           ? ` · sblocca <b>${S[radice].it}</b> come starter` : ""}</div>`
      : `<div class="cap-riga">📖 Già nel dex${cromNuovo ? "" : ""}</div>`;
    const rigaCrom = cromNuovo
      ? `<div class="cap-riga nuovo">✨ Prima livrea cromatica di ${S[radice].it}</div>` : "";
    /* L'abilità si confronta con quelle SCEGLIIBILI (`abilitaSbloccate`), non
       con la maschera grezza: e' quello che vedrai davvero nella schermata
       starter, ed e' la domanda a cui si vuole rispondere. */
    const ab = e.ability;
    const abGiaMia = ab && abilitaSbloccate(radice).includes(ab.id);
    const nascosta = e.abilIndex === 2;
    const rigaAb = ab
      ? `<div class="cap-riga ${abGiaMia ? "" : "nuovo"}">🧬 ${ab.it}${
          nascosta ? ' <span class="cap-hidden">NASCOSTA</span>' : ""} — ${
          abGiaMia ? "già disponibile nello starter" : "<b>nuova per lo starter</b>"}</div>`
      : "";
    // Qui lo scanner è SEMPRE acceso: la lente spenta non nasconde nulla.
    const chipIv = e.ivs ? badgeIV(e, true) : "";
    const ivRiga = `<div class="cap-info">${rigaDex}${rigaCrom}${rigaAb}${
      chipIv ? `<div class="cap-iv">${chipIv}</div>` : ""}</div>`;
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">Ultima ball!</div>
      <div class="meta-sub">${game.enemy.name} è a terra: hai un solo tiro per prenderlo</div>
      ${ivRiga}
      <div class="ball-list">${btns}</div>
      <div class="meta-actions two-col">
        <button class="meta-btn ghost" data-act="team">👥 Squadra</button>
        <button class="meta-btn ghost" data-act="skip">Lascia stare</button>
      </div>`);
    metaEl().querySelectorAll("[data-b]").forEach(b => b.onclick = () => {
      hideMeta();                       // il lancio si vede in scena, non qui
      attemptCapture(b.dataset.b);
    });
    /* Il pannello squadra in modo «check»: si guardano le schede e si spostano
       gli oggetti, non si schiera nessuno (la lotta è finita). E si TORNA qui,
       non al negozio: `ritornoSquadra` è la strada già usata dal negozio. */
    metaEl().querySelector('[data-act="team"]').onclick = () => {
      ritornoSquadra = () => { game.phase = "CAPTURE"; renderCaptureScreen(); };
      renderParty("check");
    };
    metaEl().querySelector('[data-act="skip"]').onclick = () => { hideMeta(); openShop(); };
  }

  /* ---------------- LANCIO BALL IN BATTAGLIA ----------------
     Come nei giochi veri: si lancia durante la lotta, consuma il turno, e si
     possono lanciare quante ball si vuole. Le ball normali funzionano solo sui
     SELVATICI; la Clepto Ball (nostra aggiunta) ruba anche agli allenatori, ma
     non al Rivale. Il boss finale non è catturabile. */
  function ballBlockReason(ball) {
    const e = game.enemy;
    if (!e) return "Nessun bersaglio.";
    // NB: il boss finale È catturabile (scelta del proprietario, diversa
    // dall'originale che lo blocca): tasso basso ma non impossibile.
    if (e.trainer) {
      if (!ball.theft) return `Non puoi catturare il Pokémon di un allenatore! Serve una Clepto Ball.`;
      if (game.trainerIsRival) return `Il tuo Rivale non ti lascerà rubare nulla!`;
    }
    return null;
  }

  function showBallMenu() {
    if (game.phase !== "CHOICE") return;
    const owned = BALL_TYPES.filter(b => (game[b.key] || 0) > 0);
    const BALL_IMG = { balls: "pb", greatballs: "gb", ultraballs: "ub", rogueballs: "rb", theftballs: "tb", masterballs: "mb" };
    if (!owned.length) { notAvailable("Non hai nessuna ball!"); return; }
    const btns = owned.map(b => {
      const blocked = ballBlockReason(b);
      const pct = b.mult >= 255 ? 100 : captureChancePct(game.enemy, b.mult);
      return `<button class="btn ball-btn" data-b="${b.key}" ${blocked ? "disabled" : ""}>
        <img class="ball-icon" src="${ballIcon(BALL_IMG[b.key])}" alt="">
        <span class="move-name">${b.it}</span>
        <span class="move-meta"><span>${blocked ? "non utilizzabile" : "~" + pct + "%"}</span><span>· ×${game[b.key]}</span></span>
      </button>`;
    }).join("");
    const hint = game.enemy && game.enemy.trainer
      ? `Solo la Clepto Ball funziona sugli allenatori`
      : `Indebolisci e addormenta per alzare le probabilità`;
    /* A SCHERMO INTERO. ⚠️ Nella fascia comandi non ci stava: con cinque tipi
       di ball il contenuto era alto 410 px in uno spazio di 224, e il tasto
       Indietro finiva 150 px sotto il bordo — invisibile e non toccabile. */
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">Quale ball lanci?</div>
      <div class="meta-sub">${hint}</div>
      <div class="ball-list">${btns}</div>
      <div class="meta-actions"><button class="meta-btn ghost" data-act="back">↩ Indietro</button></div>`);
    metaEl().querySelectorAll(".ball-btn").forEach(b => b.onclick = () => {
      if (b.disabled) return;
      hideMeta(); throwBall(b.dataset.b);
    });
    metaEl().querySelector('[data-act="back"]').onclick = () => { hideMeta(); showMainMenu(); };
  }

  // Lancia la ball: consuma il turno. Se cattura, la lotta si chiude (selvatico)
  // oppure il Pokémon viene rubato e l'allenatore manda il prossimo.
  function throwBall(ballKey) {
    if (game.phase !== "CHOICE") return;
    const ball = BALL_TYPES.find(b => b.key === ballKey);
    if (!ball || (game[ballKey] || 0) <= 0) return;
    const blocked = ballBlockReason(ball);
    if (blocked) { notAvailable(blocked); return; }
    /* La ball è un comando che chiude il turno per tutta la squadra: se in
       doppio il primo alleato aveva già scelto una mossa, quella salta. Si
       azzera la coda, o resterebbe appesa al turno dopo. */
    game.queued = null; game.chooser = 0;

    game[ballKey]--;
    const enemy = game.enemy;
    /* Il tiro si fa ORA, ma prima di raccontarlo si mostra l'animazione: la
       ball deve dondolare esattamente le volte che ha retto davvero. */
    const esito = ball.mult >= 255
      ? { preso: true, scosse: 1, critica: true }
      : rollCaptureDettaglio(enemy, ball.mult);
    game.phase = "MESSAGE";                    // niente comandi durante il lancio
    cmd().innerHTML = `<div class="msgbox"><div class="log-line">Lanci una ${ball.it} su ${enemy.name}…</div></div>`;
    animaBall(ballKey, esito, () => risolviLancio(ballKey, ball, enemy, esito.preso));
  }

  function risolviLancio(ballKey, ball, enemy, caught) {
    const log = makeLog();

    if (caught) {
      const mon = makeFighter(enemy.speciesId, enemy.level, { shiny: enemy.shiny, shinyVar: enemy.shinyVar, ivs: enemy.ivs, variant: enemy.variant, abilIndex: enemy.abilIndex, gender: enemy.gender });
      ereditaPs(mon, enemy);        // i PS che aveva quando la ball si e' chiusa
      const stolen = !!enemy.trainer;
      accogliPokemon(mon, log, stolen ? "🕶 Rubato!" : "Preso!");
      registerCaught(enemy.speciesId, enemy.shiny, enemy.ivs, log, enemy.variant, enemy.abilIndex, enemy.nature, enemy.shinyVar, enemy.gender, enemy.boss);
      enemy.fainted = true;                        // esce dal campo
      game.capturedThisWave = true;                // niente seconda offerta a fine lotta
      if (stolen) {
        // togli il Pokémon rubato dalla squadra dell'allenatore
        game.trainerRoster = game.trainerRoster.filter(m => m !== enemy);
        if (game.trainerTotal) { game.trainerDefeated++; renderTrainerBalls(); }
      }
      renderScene();
      playEvents(log.events, () => chiediPostoInSquadra(() => {
        if (stolen && game.enemyQueue.length) {   // l'allenatore manda il prossimo
          const next = game.enemyQueue.shift();
          const l2 = makeLog();
          l2.push(conBall(`${next.trainer} manda in campo ${next.name}!`, "uscita", "enemy"));
          deployEnemy(next, l2);
          entraInCampo(next, l2);        // vedi sopra: anche dopo un furto

          renderTrainerBalls(); renderScene();
          playEvents(l2.events, () => { game.phase = "CHOICE"; showMainMenu(); });
          return;
        }
        onWaveCleared();                           // cattura/furto finale: ondata superata
      }));
      return;
    }

    // fallita: il nemico agisce (il lancio è costato il turno)
    log.push(`Oh no! ${enemy.name} è sfuggito!`);
    const enemyMove = enemyChooseMove();
    if (!enemy.fainted && !game.player.fainted) resolveAction(enemy, game.player, enemyMove, log);
    endOfTurnResidual(enemy, log);
    endOfTurnResidual(game.player, log);
    game.player.volatile.flinch = false; enemy.volatile.flinch = false;
    playEvents(log.events, afterTurn);
  }

  /* ======================================================================
     EFFICACIA SCRITTA SUL PULSANTE DELLA MOSSA

     Dai giochi ufficiali di sesta generazione in poi il menu delle mosse dice
     se una mossa e' superefficace o poco efficace contro chi hai davanti; in
     Scarlatto/Violetto e' un segno accanto al nome. PokeRogue fa lo stesso
     tingendo il nome della mossa (`getMoveColor` in fight-ui-handler.ts) e i
     colori qui sotto sono i suoi (`getTypeDamageMultiplierColor`, lato
     offensivo).

     Le regole sono quelle dell'originale:
       · con piu' avversari in campo vale il MIGLIORE dei due;
       · le mosse di STATO non mostrano niente, tranne quando non hanno
         effetto per il tipo (×0);
       · a ×1 non si scrive nulla, come nei giochi.
     ⚠️ Si guardano solo i TIPI: le immunita' da abilita' (Levitazione,
     Assorbivolt...) non entrano nel conto. L'originale le include quando
     l'abilita' e' gia' stata rivelata; da noi le abilita' non hanno quel
     "rivelata", quindi dirlo prima sarebbe raccontare un segreto. */
  const EFF_COL = { 0: "#929292", 0.25: "#FF7400", 0.5: "#FE8E00",
                    2: "#4AA500", 4: "#4BB400", 8: "#52C200" };
  const effNumero = m => String(m).replace(".", ",");
  /* 🔴 LE MOSSE DI STATO E LA TABELLA DEI TIPI.
     Sembra ovvio che valga come per gli attacchi, e invece è quasi il
     contrario: nell'originale (`getMoveEffectiveness`) una mossa di STATO
     IGNORA l'efficacia di tipo — il moltiplicatore viene forzato a 1. Ruggito
     funziona benissimo su uno Spettro, anche se è di tipo Normale.
     Le uniche immunita' che la riguardano sono tre, e sono casi speciali
     scritti a mano (`Move.isTypeImmune`), non la tabella:
       · ONDATRONA (l'unica con `RespectAttackTypeImmunityAttr`) non tocca i Terra;
       · le mosse POLVERE non toccano gli Erba;
       · con BURLA, le mosse di stato non toccano i Buio.
     E nessuna delle tre vale se la mossa è su di sé: `isTypeImmune` esce
     subito quando il bersaglio è `USER`.
     ⚠️ Prima il motore non applicava NESSUNA di queste: Spora addormentava
     gli Erba e Ondatrona paralizzava i Terra. E il pulsante mostrava «✕ nulla»
     su qualunque mossa di stato di tipo sfavorevole, autopotenziamenti
     compresi — cioe' un avviso sbagliato sopra una mossa che funzionava. */
  const BERSAGLIA_NEMICO = new Set(["NEAR_OTHER", "NEAR_ENEMY", "ALL_NEAR_ENEMIES", "ALL_NEAR_OTHERS"]);
  function statoImmune(mv, chi, f) {
    if (!mv || !f || mv.category !== "STATUS") return false;
    if (!BERSAGLIA_NEMICO.has(mv.target)) return false;     // su di sé o sul campo: mai
    if (mv.id === "THUNDER_WAVE" && typeMultiplier(mv.type, f.types) === 0) return true;
    if (mv.polvere && f.types.includes("GRASS")) return true;
    if (chi && ha(chi, "PRANKSTER") && f.types.includes("DARK")) return true;
    return false;
  }

  function efficaciaMossa(mv, contro) {
    const nemici = (contro || enemiesOnField()).filter(Boolean);
    if (!nemici.length || !mv) return null;
    /* Una mossa di stato non fa danno: di moltiplicatori non ne ha. Si segnala
       solo quando NON FUNZIONA proprio, e solo se punta l'avversario. */
    if (mv.category === "STATUS") {
      const chi = currentChooser() || game.player;
      return nemici.every(f => statoImmune(mv, chi, f)) ? 0 : null;
    }
    const m = Math.max(...nemici.map(f => typeMultiplier(mv.type, f.types)));
    if (m === 1) return null;
    return m;
  }
  /* Il segno da mettere sul pulsante (vuoto se non c'e' niente da dire). */
  function chipEfficacia(mv, contro) {
    const m = efficaciaMossa(mv, contro);
    if (m === null) return "";
    const col = EFF_COL[m] || (m > 1 ? EFF_COL[2] : EFF_COL[0.5]);
    const segno = m === 0 ? "✕" : m > 1 ? "▲" : "▼";
    const testo = m === 0 ? "nulla" : "×" + effNumero(m);
    return `<span class="eff-chip" style="background:${col}">${segno} ${testo}</span>`;
  }

  function showMoves() {
    const chi = currentChooser() || game.player;
    /* Con un vincolo addosso la scelta non c'è: si lascia acceso solo quello
       che il corpo sta già facendo, e si dice perché. Meglio un pulsante
       spento con una spiegazione che un tocco che ti brucia il turno. */
    const obb = mossaObbligata(chi);
    const buttons = chi.moves.map((mi, i) => {
      const mv = M[mi.id];
      const ty = T[mv.type];
      const disabled = (mi.pp <= 0 && !(obb && obb.inst === mi)) || (obb && obb.inst !== mi) ? "disabled" : "";
      return `
        <button class="btn move-btn" data-i="${i}" ${disabled}
                style="background:${ty.color};">
          <span class="move-name">${mv.it}</span>
          <span class="move-meta">
            <span class="ticon t-${mv.type}"></span>
            <span class="cicon c-${mv.category}"></span>
            <span class="move-pp">${mv.power ? "P" + mv.power + " · " : ""}${mi.pp}/${mi.maxPp}</span>
            ${chipEfficacia(mv)}
          </span>
        </button>`;
    }).join("");

    cmd().innerHTML = `
      ${obb ? `<div class="vincolo-nota">${chi.name} ${obb.perche}: deve usare <b>${M[obb.inst.id].it}</b></div>` : ""}
      <div class="grid2">${buttons}</div>
      <div class="back-row two">
        <button class="btn back" data-act="desc">📖 Descrizioni</button>
        <button class="btn back" data-act="back">Indietro</button>
      </div>`;

    cmd().querySelectorAll(".move-btn").forEach(b => {
      b.onclick = () => usaMossa(parseInt(b.dataset.i, 10));
    });
    cmd().querySelector('[data-act="desc"]').onclick = () => showSchedaMosse();
    cmd().querySelector('[data-act="back"]').onclick = showMainMenu;
  }

  /* ======================================================================
     CHI PUO' ESSERE BERSAGLIO DI UNA MOSSA (§39)

     In doppio non si colpiscono solo i nemici: l'ALLEATO è un bersaglio valido
     per parecchie mosse, e per alcune è l'unico. Nell'originale lo dice il campo
     `MoveTarget` di ogni mossa (`getMoveTargets` in data/moves/move-utils.ts);
     ora ce l'abbiamo anche noi in `data/moves.json`, estratto da lì.

       NEAR_OTHER · OTHER · ALL_NEAR_OTHERS · ALL_OTHERS
           «chiunque non sia te»: nemici **e alleato**. Sono 677 mosse su 953,
           cioè quasi tutte quelle che fanno danno. Sì, nei giochi veri puoi
           tirare una fiammata sul tuo compagno.
       NEAR_ALLY · ALLY        solo l'alleato (Altruismo, Nebularoma, Coaching…)
       USER_OR_NEAR_ALLY       te o l'alleato (Acupressione)
       USER · PARTY · USER_SIDE · USER_AND_ALLIES
           nessuna scelta: agisce su di te o sulla tua squadra
       tutto il resto           i nemici

     ⚠️ Prima l'elenco era `enemiesOnField()` e basta: le mosse che curano o
     potenziano il compagno non avevano modo di raggiungerlo. */
  const BERSAGLIO_ALTRI = new Set(["NEAR_OTHER", "OTHER", "ALL_NEAR_OTHERS", "ALL_OTHERS"]);
  /* ⚠️ Anche le mosse AD AREA non danno una scelta: colpiscono tutti quelli
     che possono colpire, quindi chiedere «chi vuoi colpire?» per Terremoto è
     una domanda senza risposte diverse. Partono e basta (vedi `bersagliExtra`,
     che poi le porta su tutti). */
  const BERSAGLIO_SENZA_SCELTA = new Set(["USER", "PARTY", "USER_SIDE", "USER_AND_ALLIES",
                                          "ALL_NEAR_ENEMIES", "ALL_NEAR_OTHERS", "ALL",
                                          "BOTH_SIDES", "ENEMY_SIDE"]);
  function bersagliDiMossa(mv, chi) {
    const nemici = enemiesOnField();
    const alleato = game.double
      ? alliesOnField().find(f => f !== chi) || null
      : null;
    const t = (mv && mv.target) || "NEAR_OTHER";
    if (BERSAGLIO_SENZA_SCELTA.has(t)) return [];
    if (t === "NEAR_ALLY" || t === "ALLY") return alleato ? [alleato] : [];
    if (t === "USER_OR_NEAR_ALLY") return alleato ? [chi, alleato] : [];
    if (BERSAGLIO_ALTRI.has(t) && alleato) return nemici.concat([alleato]);
    return nemici;
  }

  /* Lancia la mossa scelta (in doppio passa prima dalla scelta del bersaglio). */
  function usaMossa(i) {
    const chi = currentChooser();
    const mv = chi && chi.moves[i] ? M[chi.moves[i].id] : null;
    const bersagli = bersagliDiMossa(mv, chi);
    /* Una sola scelta possibile non è una scelta: si tira e via. Vale anche per
       le mosse che puntano solo l'alleato quando l'alleato è uno solo. */
    if (game.double && bersagli.length > 1) showTargetMenu(i, bersagli);
    else if (game.double && bersagli.length === 1) playerChooseMove(i, bersagli[0]);
    else playerChooseMove(i);
  }

  /* SCHEDA DELLE MOSSE — a schermo intero (§ richiesta di Luca).
     Prima le descrizioni erano un "modo" che SOSTITUIVA i dati dentro i
     pulsanti: non si vedevano insieme, il testo lungo veniva tagliato dal
     bordo basso, e il modo restava acceso. Qui invece si vede tutto — tipo,
     categoria, potenza, precisione, PP, priorità, effetto e probabilità — in
     una schermata che può scorrere, e da cui si può anche far partire la
     mossa. Finita la scelta si torna alla lotta: niente da spegnere. */
  function showSchedaMosse() {
    const chi = currentChooser() || game.player;
    const cards = chi.moves.map((mi, i) => {
      const mv = M[mi.id], ty = T[mv.type];
      const senzaPp = mi.pp <= 0;
      const dato = (lab, val) => `<span class="ms-dato"><i>${lab}</i>${val}</span>`;
      const righe = [
        dato("Potenza", mv.power ? mv.power : "—"),
        dato("Precisione", mv.accuracy > 0 ? mv.accuracy + "%" : "sempre a segno"),
        dato("PP", `${mi.pp}/${mi.maxPp}`),
      ];
      if (mv.priority) righe.push(dato("Priorità", (mv.priority > 0 ? "+" : "") + mv.priority));
      if (mv.effectChance > 0) righe.push(dato("Effetto", mv.effectChance + "%"));
      const extra = effettiInParole(mv);
      return `<div class="ms-card ${senzaPp ? "vuota" : ""}" style="border-color:${ty.color}">
          <div class="ms-head" style="background:${ty.color}">
            <span class="ms-nome">${mv.it}</span>
            <span class="ms-badge"><span class="ticon t-${mv.type}"></span><span class="cicon c-${mv.category}"></span></span>
          </div>
          <div class="ms-dati">${righe.join("")}</div>
          <div class="ms-testo">${mv.effect || "Nessun effetto particolare."}</div>
          ${extra ? `<div class="ms-extra">${extra}</div>` : ""}
          <button class="meta-btn primary ms-usa" data-i="${i}" ${senzaPp ? "disabled" : ""}>${senzaPp ? "PP esauriti" : "▶ Usa " + mv.it}</button>
        </div>`;
    }).join("");
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">Mosse di ${chi.name}</div>
      <div class="ms-list">${cards}</div>
      <div class="meta-actions"><button class="meta-btn ghost" data-act="back">↩ Indietro</button></div>`);
    metaEl().querySelectorAll(".ms-usa").forEach(b => b.onclick = () => {
      if (b.disabled) return;
      hideMeta(); usaMossa(parseInt(b.dataset.i, 10));
    });
    metaEl().querySelector('[data-act="back"]').onclick = () => { hideMeta(); showMoves(); };
  }

  /* I "mattoncini" della mossa detti in italiano: sono gli effetti veri che il
     motore applica, non sempre chiari dal testo ufficiale. */
  function effettiInParole(mv) {
    const STAT_IT = { ATK: "Attacco", DEF: "Difesa", SPATK: "Att. Sp.", SPDEF: "Dif. Sp.", SPD: "Velocità", ACC: "Precisione", EVA: "Elusione" };
    const parti = [];
    for (const a of (mv.attrs || [])) {
      switch (a.kind) {
        case "status": parti.push(`può causare ${(STATUS_IT[a.status] || a.status).toLowerCase()}`); break;
        case "statStage": {
          const chi = statSuDiSe(mv, a) ? "a sé" : "al bersaglio";
          const q = Math.abs(a.stages) >= 2 ? "molto " : "";
          parti.push(`${a.stages > 0 ? "alza" : "abbassa"} ${q}${a.stats.map(s => STAT_IT[s] || s).join(", ")} ${chi}`);
          break;
        }
        case "flinch": parti.push("può far tentennare"); break;
        case "multiHit": parti.push(a.mode === "_2" ? "colpisce 2 volte" : "colpisce da 2 a 5 volte"); break;
        case "highCrit": parti.push("più facile fare brutto colpo"); break;
        case "critOnly": parti.push("sempre brutto colpo"); break;
        case "recoil": parti.push(`contraccolpo: ${Math.round(a.ratio * 100)}% del danno`); break;
        case "drain": parti.push(`assorbe il ${Math.round(a.ratio * 100)}% del danno`); break;
        case "heal": parti.push(`cura ${Math.round(a.ratio * 100)}% dei PS massimi`); break;
        case "confuse": parti.push("può confondere"); break;
        case "ohko": parti.push("KO in un colpo"); break;
        case "protect": parti.push(a.endure ? "resiste al colpo" : "protegge dagli attacchi"); break;
        case "trap": parti.push("intrappola il bersaglio"); break;
        case "leechseed": parti.push("semina il bersaglio"); break;
        case "recharge": parti.push("il turno dopo si deve riposare"); break;
        case "perish": parti.push("canto del destino: KO dopo 3 turni"); break;
        case "infatuate": parti.push("può infatuare"); break;
        case "encore": parti.push("costringe a ripetere la mossa"); break;
        case "taunt": parti.push("provoca: solo mosse d'attacco"); break;
        case "torment": parti.push("vieta di ripetere la stessa mossa"); break;
        case "drowsy": parti.push("fa addormentare il turno dopo"); break;
        case "nightmare": parti.push("incubo: danno mentre dorme"); break;
        case "ingrain": parti.push("radica e cura ogni turno"); break;
        case "aquaring": parti.push("velo d'acqua: cura ogni turno"); break;
        case "saltcure": parti.push("sotto sale: danno ogni turno"); break;
        case "curse": parti.push("maledizione"); break;
        case "terrain": parti.push("cambia il terreno"); break;
      }
    }
    if (mv.charging) parti.push("si carica un turno prima di colpire");
    return parti.length ? "▸ " + parti.join(" · ") : "";
  }

  // Mostra un messaggio "non disponibile" e torna al menu al tap/tempo.
  function notAvailable(text) {
    playEvents([snapEvent(text)], () => { game.phase = "CHOICE"; showMainMenu(); });
  }

  // Righe da evidenziare nel log (effetti notevoli).
  const ACCENT = /superefficace|critico|esausto|Non ha effetto|molto efficace|mancato|scottat|paralizz|addorment|avvelenat|congelat|BOSS/;

  /* Casella con UN messaggio. Il tocco AVANZA: la narrazione non scorre da
     sola, quindi ogni riga si legge con calma. Il triangolino compare quando
     l'animazione ha finito (`mostraContinua`) e dice "tocca per continuare". */
  function renderMessageBox(text) {
    /* Un evento può portare PIÙ RIGHE: sono le frasi dello stesso momento
       («X usa Y!» e subito sotto «È superefficace!»). Ognuna tiene il proprio
       risalto, così l'occhio trova le cose notevoli anche in mezzo. */
    const righe = String(text).split("\n").filter(r => r.length)
      .map(r => `<div class="log-line${ACCENT.test(r) ? " accent" : ""}">${r}</div>`).join("");
    cmd().innerHTML = `<div class="msgbox"><div class="msg-testo">${righe}</div><span class="cont">▸</span></div>`;
    const box = cmd().querySelector(".msgbox");
    box.onclick = advanceMessages;
    /* Se il testo è più alto della casella si può scorrere col dito: lo si
       segnala con la velatura in basso. Il tocco resta quello che avanza —
       trascinare scorre e basta, senza far passare il messaggio. */
    const testo = box.querySelector(".msg-testo");
    if (testo.scrollHeight > testo.clientHeight + 1) {
      box.classList.add("scorre");
      testo.addEventListener("scroll", () => {
        const infondo = testo.scrollTop + testo.clientHeight >= testo.scrollHeight - 2;
        box.classList.toggle("scorre", !infondo);
      });
    }
  }

  /* ====================================================================== */
  /*  SALVATAGGI — 3 SLOT (§26)                                             */
  /*                                                                        */
  /*  Come nell'originale, il progresso e' diviso in due:                   */
  /*   · `meta` (una sola copia, chiave META_KEY) = cio' che sopravvive alle */
  /*     run: starter sbloccati, caramelle, IV migliori, uova, voucher.      */
  /*   · gli SLOT (tre) = una PARTITA IN CORSO ciascuno, indipendenti.       */
  /*                                                                        */
  /*  Si salva da soli all'inizio di ogni ondata. Riprendendo si rigioca     */
  /*  l'ondata da capo con un avversario nuovo: cosi' non serve serializzare */
  /*  meta battaglia (turni, eventi, animazioni), che sarebbe fragile.       */
  /* ====================================================================== */
  const SLOT_V = 1;                       // se cambia la forma dei dati, si alza
  const SLOT_KEY = n => `pokerogue_clear_save_${n}`;

  /* Campi della run da salvare. Fuori restano: `player`/`enemy` (si ricreano),
     `events`/`timer`/`afterEvents` (roba di narrazione) e `encReward`, che e'
     una FUNZIONE e non sopravvive a JSON. */
  const CAMPI_RUN = ["balls", "greatballs", "ultraballs", "rogueballs", "theftballs",
    "pendingTheft", "money", "stones", "charms", "tempBoost", "tempBoostN", "shopMarkup", "lati", "cuccagna",
    "cicloOffset", "encSeen", "encTiersSeen", "leagueIdx", "evilIdx", "finalBossIdx",
    "rivalFemale", "rivalRoster", "hasMegaRing", "hasDynamaxBand", "active", "biome", "starterSpecies"];

  /* Un Pokemon e' gia' quasi tutto JSON. Le due eccezioni: `spr` (i dati
     dell'immagine, si ricaricano) e le abilita', che sono RIFERIMENTI dentro
     ABIL — si salva il loro id e si riaggancia al caricamento. */
  function monSalva(p) {
    const o = {};
    for (const k in p) {
      if (k === "spr") continue;
      /* 🔴 `dannoSubitoTurno.da` tiene un RIFERIMENTO all'attaccante. In doppio
         due Pokémon che si colpiscono a vicenda formano un anello
         (A.da → B, B.da → A) e `JSON.stringify` LANCIA: il salvataggio falliva
         e l'unico segno era un `console.warn` che il giocatore non vede mai.
         Trovato leggendo i log del telefono mentre lavoravo su altro — la run
         del proprietario stava girando senza salvare da chissà quando.
         È roba del TURNO (serve a Contatore, Specchiovelo, Vendetta): dopo una
         ripresa non vuol dire più niente, quindi non va salvata affatto. */
      if (k === "dannoSubitoTurno") continue;
      if (k === "ability" || k === "passiveAbility") { o[k] = p[k] ? p[k].id : null; continue; }
      o[k] = p[k];
    }
    return o;
  }
  function monCarica(o) {
    const p = Object.assign({}, o);
    p.spr = null;
    p.ability = o.ability ? (ABIL[o.ability] || null) : null;
    p.passiveAbility = o.passiveAbility ? (ABIL[o.passiveAbility] || null) : null;
    return p;
  }

  function salvaRun() {
    if (!game.slot || !game.party.length) return;
    const d = { v: SLOT_V, quando: Date.now(), wave: game.wave,
                party: game.party.map(monSalva), box: (game.box || []).map(monSalva) };
    for (const k of CAMPI_RUN) d[k] = game[k];
    try { localStorage.setItem(SLOT_KEY(game.slot), JSON.stringify(d)); }
    catch (e) {
      /* Rete di sicurezza: se un giorno un ALTRO campo dovesse tenere un
         riferimento circolare, il salvataggio non deve sparire in silenzio —
         si riprova buttando via i cicli, così la partita si salva comunque e
         l'anomalia resta scritta nel log. */
      console.warn("[salvataggio] primo tentativo fallito:", e.message);
      try {
        const visti = new WeakSet();
        const testo = JSON.stringify(d, (k, v) => {
          if (v && typeof v === "object") {
            if (visti.has(v)) return undefined;
            visti.add(v);
          }
          return v;
        });
        localStorage.setItem(SLOT_KEY(game.slot), testo);
        console.warn("[salvataggio] riuscito togliendo i riferimenti circolari");
      } catch (e2) { console.error("[salvataggio] NON RIUSCITO:", e2.message); }
    }
  }
  function leggiSlot(n) {
    try {
      const s = localStorage.getItem(SLOT_KEY(n));
      if (!s) return null;
      const d = JSON.parse(s);
      // formato di un'altra versione: si mostra come illeggibile, non si carica
      return (d && d.v === SLOT_V && d.party && d.party.length) ? d : { rotto: true };
    } catch (e) { return { rotto: true }; }
  }
  function cancellaSlot(n) { try { localStorage.removeItem(SLOT_KEY(n)); } catch (e) {} }

  function riprendiRun(n) {
    const d = leggiSlot(n);
    if (!d || d.rotto) return;
    game.slot = n;
    for (const k of CAMPI_RUN) game[k] = d[k];
    game.party = d.party.map(monCarica);
    game.box = (d.box || []).map(monCarica);
    game.wave = d.wave;
    // stato di battaglia: si riparte puliti, l'ondata si rigioca da capo
    clearTimeout(game.timer);
    game.enemy = null; game.enemy2 = null; game.player2 = null; game.double = false;
    game.enemyQueue = []; game.events = []; game.eventIndex = 0; game.afterEvents = null;
    game.pendingLearns = []; game.encReward = null; game.expPending = 0;
    game.weather = null; game.terrain = null;
    setActive(Math.min(game.active | 0, game.party.length - 1));
    if (game.player.fainted) {
      const i = firstAliveIndex();
      if (i < 0) { healParty(); }        // rete di sicurezza: mai una run gia' morta
      else setActive(i);
    }
    hideMeta();
    applyBiomeBackground();
    loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
    nextWave();
  }

  /* CONTROLLO GENERALE — passa in rassegna tutte le specie e tutte le mosse e
     verifica le regole che in gioco si romperebbero solo per caso (una specie
     su mille, in un bioma che si visita di rado). Vale piu' di una run lunga:
     una run tocca 40 specie, questo le tocca tutte e 1084.
       __audit.specie(25)   ogni specie: mosse, danno, statistiche, abilita', sprite
       __audit.mosse()      ogni mossa: dati minimi e animazione
       __audit.biomi()      ogni bioma: pool pescabile e collegamenti
       __audit.tutto()      i tre insieme, in breve */
  window.__audit = {
    specie: (livello) => {
      const r = { esaminate: 0, errori: [], senzaMosse: [], senzaDanno: [], statNonValide: [],
                  senzaAbilita: [], senzaTipi: [], spriteMancante: [] };
      for (const k of SPECIES_KEYS) {
        r.esaminate++;
        let f;
        try { f = makeFighter(k, livello || 25, {}); }
        catch (e) { r.errori.push(`${k}: ${e.message}`); continue; }
        if (!f.moves || !f.moves.length) r.senzaMosse.push(k);
        else if (!f.moves.some(m => M[m.id] && M[m.id].category !== "STATUS" && M[m.id].power))
          r.senzaDanno.push(k);                       // = softlock: non potrebbe attaccare
        if (!(f.maxHp > 0)) r.statNonValide.push(`${k}: maxHp ${f.maxHp}`);
        for (const s in f.stats) if (!(f.stats[s] > 0)) r.statNonValide.push(`${k}.${s}=${f.stats[s]}`);
        if (!f.ability) r.senzaAbilita.push(k);
        if (!f.types || !f.types.length) r.senzaTipi.push(k);
        if (S[k].noSprite) r.spriteMancante.push(k);
      }
      return r;
    },
    mosse: () => {
      const r = { esaminate: 0, senzaNome: [], senzaTipo: [], tipoIgnoto: [], senzaAnim: [], ppZero: [] };
      for (const id in M) {
        const m = M[id]; r.esaminate++;
        if (!m.it) r.senzaNome.push(id);
        if (!m.type) r.senzaTipo.push(id);
        else if (!T[m.type]) r.tipoIgnoto.push(`${id}: ${m.type}`);
        if (!(m.pp > 0)) r.ppZero.push(id);
        /* ⚠️ va chiesto sulla chiave RISOLTA, non sull'id: 109 mosse (Z/G-Max)
           non hanno un file proprio nemmeno nell'originale e usano il ripiego
           (`animKeyForMove`), esattamente come fa il motore in `resolveMove`.
           Chiedendolo sull'id crudo questa sonda gridava al lupo. */
        if (!animAvailable(animKeyForMove(id))) r.senzaAnim.push(id);
      }
      return r;
    },
    biomi: () => {
      const r = { esaminati: 0, vuoti: [], linkRotti: [], senzaNome: [], pescabili: {} };
      const prima = game.biome;
      for (const b in BIOMES) {
        r.esaminati++;
        if (!BIOMES[b].it) r.senzaNome.push(b);
        for (const l of (BIOMES[b].links || [])) if (!BIOMES[l]) r.linkRotti.push(`${b} -> ${l}`);
        game.biome = b;
        const visti = new Set();
        for (let i = 0; i < 150; i++) visti.add(biomePick(false));
        r.pescabili[b] = visti.size;
        if (visti.size <= 2) r.vuoti.push(`${b}: solo ${visti.size} specie`);
      }
      game.biome = prima;
      return r;
    },
    tutto: () => {
      const s = window.__audit.specie(), m = window.__audit.mosse(), b = window.__audit.biomi();
      const breve = o => { const x = {}; for (const k in o) if (Array.isArray(o[k]) && o[k].length) x[k] = o[k].length + " (" + o[k].slice(0, 4).join(", ") + ")"; return x; };
      return { specie: { esaminate: s.esaminate, ...breve(s) },
               mosse: { esaminate: m.esaminate, ...breve(m) },
               biomi: { esaminati: b.esaminati, ...breve(b) } };
    },
  };

  /* hook di debug per i salvataggi: provare "chiudi e riapri l'app" a mano
     vorrebbe dire ricaricare la pagina a ogni verifica.
       __save.stato()      cosa c'e' nei tre slot
       __save.salva()      forza il salvataggio adesso
       __save.riprendi(1)  ricarica lo slot 1 (come il tasto Riprendi)
       __save.peso()       quanti byte occupano gli slot
       __save.cancella(1)  svuota uno slot */
  window.__save = {
    stato: () => [1, 2, 3].map(n => {
      const d = leggiSlot(n);
      if (!d) return `${n}: vuoto`;
      if (d.rotto) return `${n}: ILLEGGIBILE`;
      return `${n}: ondata ${d.wave + 1} · ${d.biome} · ${d.party.length} mon · ₽${d.money}`;
    }),
    salva: () => { salvaRun(); return "slot " + game.slot; },
    riprendi: (n) => riprendiRun(n),
    cancella: (n) => cancellaSlot(n),
    peso: () => [1, 2, 3].map(n => {
      const s = localStorage.getItem(SLOT_KEY(n));
      return `${n}: ${s ? (s.length / 1024).toFixed(1) + " KB" : "—"}`;
    }),
    grezzo: (n) => leggiSlot(n),
  };

  /* Sottotitolo del tasto Gioca: quante partite ci sono da riprendere. */
  function slotOccupati() {
    const n = [1, 2, 3].filter(i => { const d = leggiSlot(i); return d && !d.rotto; }).length;
    return n ? `${n} partit${n > 1 ? "e" : "a"} in corso · 3 slot` : "3 slot liberi";
  }

  /* Riassunto di uno slot per la schermata di scelta. */
  function riassuntoSlot(d) {
    // al primissimo salvataggio il bioma non e' ancora assegnato: e' sempre TOWN
    const b = BIOMES[d.biome || "TOWN"];
    const vivi = d.party.filter(p => !p.fainted).length;
    return { ondata: d.wave + 1, bioma: (b && b.it) || "—", vivi, tot: d.party.length,
             soldi: d.money || 0, squadra: d.party };
  }

  /* Schermata di scelta dello slot. Uno slot pieno chiede conferma prima di
     essere sovrascritto: una run da 80 ondate non si butta con un tocco. */
  function showSlots() {
    game.phase = "SLOTS";
    const righe = [1, 2, 3].map(n => {
      const d = leggiSlot(n);
      if (!d) return `<button class="slot-card vuoto" data-n="${n}">
          <div class="slot-n">Slot ${n}</div>
          <div class="slot-info">vuoto · tocca per una nuova run</div></button>`;
      if (d.rotto) return `<button class="slot-card rotto" data-n="${n}">
          <div class="slot-n">Slot ${n}</div>
          <div class="slot-info">salvataggio illeggibile · tocca per ripartire</div></button>`;
      const r = riassuntoSlot(d);
      const icone = r.squadra.map(p =>
        `<span class="mini" style="${miniIconStyle(p.dex)}"></span>`).join("");
      return `<button class="slot-card pieno" data-n="${n}">
          <div class="slot-n">Slot ${n} · <b>Ondata ${r.ondata}</b></div>
          <div class="slot-team">${icone}</div>
          <div class="slot-info">${r.bioma} · squadra ${r.vivi}/${r.tot} · ₽${r.soldi}</div>
        </button>`;
    }).join("");
    showMetaScreen(`
      <div class="meta-title">Salvataggi</div>
      <div class="meta-sub">tre partite in corso, indipendenti fra loro</div>
      <div class="slot-list">${righe}</div>
      <div class="meta-actions">
        <button class="meta-btn ghost" data-a="back">↩ Indietro</button>
      </div>`);
    metaEl().querySelector('[data-a="back"]').onclick = showHome;
    metaEl().querySelectorAll(".slot-card").forEach(el => {
      el.onclick = () => {
        const n = +el.dataset.n;
        const d = leggiSlot(n);
        if (!d || d.rotto) { game.slot = n; cancellaSlot(n); hideMeta(); startRun(); return; }
        showSlotScelta(n, d);
      };
    });
  }

  /* Slot occupato: riprendi, oppure ricomincia da capo (con conferma). */
  function showSlotScelta(n, d) {
    const r = riassuntoSlot(d);
    showMetaScreen(`
      <div class="meta-title">Slot ${n}</div>
      <div class="meta-sub">Ondata <b>${r.ondata}</b> · ${r.bioma}<br>
        squadra ${r.vivi}/${r.tot} viva · ₽${r.soldi}</div>
      <div class="slot-team big">${r.squadra.map(p =>
        `<span class="mini" style="${miniIconStyle(p.dex)}" title="${p.name}"></span>`).join("")}</div>
      <div class="meta-actions">
        <button class="meta-btn primary" data-a="go">▶ Riprendi</button>
        <button class="meta-btn danger" data-a="new">✚ Nuova run (cancella questa)</button>
        <button class="meta-btn ghost" data-a="back">↩ Indietro</button>
      </div>`);
    metaEl().querySelector('[data-a="go"]').onclick = () => riprendiRun(n);
    metaEl().querySelector('[data-a="back"]').onclick = showSlots;
    metaEl().querySelector('[data-a="new"]').onclick = () => {
      showMetaScreen(`
        <div class="meta-title" style="color:#ff8a80">Cancellare lo slot ${n}?</div>
        <div class="meta-sub">Si perde la partita all'<b>ondata ${r.ondata}</b>.<br>
          Quello che hai sbloccato (starter, caramelle, uova) <b>resta</b>.</div>
        <div class="meta-actions">
          <button class="meta-btn primary" data-a="no">↩ No, torna indietro</button>
          <button class="meta-btn danger" data-a="si">Sì, nuova run</button>
        </div>`);
      metaEl().querySelector('[data-a="no"]').onclick = () => showSlotScelta(n, d);
      metaEl().querySelector('[data-a="si"]').onclick = () => {
        cancellaSlot(n); game.slot = n; hideMeta(); startRun();
      };
    };
  }

  /* ---------------------------------------------------------------------- */
  /*  SCHERMATE META (home / gacha / uova) — overlay #meta                  */
  /* ---------------------------------------------------------------------- */
  const metaEl = () => document.getElementById("meta");
  function showMetaScreen(html) { const m = metaEl(); m.innerHTML = html; m.hidden = false; }
  function hideMeta() { metaEl().hidden = true; }

  /* Quale REVISIONE sta girando, e se ce n'è una più nuova già scaricata che
     aspetta il riavvio. Serve davvero: l'aggiornamento a caldo si applica al
     riavvio SUCCESSIVO a quello che l'ha scaricato, quindi senza questa riga
     non c'è modo di sapere dal telefono se si sta giocando la versione nuova
     o quella di prima. */
  function etichettaRevisione() {
    const r = (window.PR && PR.rev) || 0;
    const dove = (window.PR && PR.daRete) ? "da rete" : "da APK";
    return `rev ${r} · ${dove}`;
  }

  /* ======================================================================
     MENU DELLA RUN

     Nell'originale c'e' un pulsante MENU sempre raggiungibile, e da li' si
     arriva anche alle Macchine Uova: le uova si comprano in qualsiasi momento,
     non solo dalla schermata iniziale. Da noi il pulsante sta nella riga della
     domanda («Cosa deve fare X?»), cioe' compare esattamente quando si puo'
     usare: e' l'unico momento in cui il gioco sta aspettando te.

     ⚠️ Uscendo dal menu va rimessa la fase a mano: le schermate meta la
     cambiano ("GACHA", "EGGS") e senza ripristinarla i comandi non rispondono
     piu'. */
  function chiudiMenuRun() {
    hideMeta();
    game.phase = "CHOICE";
    renderScene();
    showMainMenu();
  }

  function showRunMenu() {
    game.phase = "MENU";
    const eggs = meta.eggs.length;
    showMetaScreen(`
      <div class="meta-title">Menu</div>
      <div class="meta-stats"><span>Ondata ${game.wave}</span><span>🎟 ${meta.vouchers} voucher</span><span>🥚 ${eggs}</span></div>
      <div class="me-opts">
        <button class="me-opt" data-a="gacha"><span class="me-opt-l">🎰 Macchine Uova</span>
          <span class="me-opt-s">${meta.vouchers ? `${meta.vouchers} voucher da spendere` : "nessun voucher: li danno i boss"}</span></button>
        <button class="me-opt" data-a="uova"><span class="me-opt-l">🥚 Le mie Uova</span>
          <span class="me-opt-s">${eggs ? `${eggs} in incubazione` : "nessun uovo in incubazione"}</span></button>
        <button class="me-opt" data-a="esci"><span class="me-opt-l">💾 Salva ed esci</span>
          <span class="me-opt-s">la run resta nello slot ${game.slot} · si riprende dall'ondata ${game.wave}</span></button>
        <button class="me-opt" data-a="back"><span class="me-opt-l">↩ Torna alla lotta</span></button>
      </div>`);
    metaEl().querySelector('[data-a="gacha"]').onclick = () => showGacha(null, showRunMenu);
    metaEl().querySelector('[data-a="uova"]').onclick = () => showEggs(showRunMenu);
    metaEl().querySelector('[data-a="esci"]').onclick = () => {
      /* ⚠️ Il salvataggio automatico scrive PRIMA di incrementare l'ondata
         (§26), quindi lo slot contiene "ondate completate": uscendo di qui si
         riprende dall'ondata in corso, rigiocandola con un avversario nuovo.
         E' lo stesso avviso che da' l'originale. */
      clearTimeout(game.timer);
      showHome();
    };
    metaEl().querySelector('[data-a="back"]').onclick = chiudiMenuRun;
  }

  function showHome() {
    game.phase = "HOME";
    clearTimeout(game.timer);
    const eggs = meta.eggs.length;
    // starter davvero schierabili: i 27 di partenza piu' quelli catturati
    const unlocked = starterDex().filter(isSelectable).length;
    showMetaScreen(`
      <div class="meta-title">Poké<span class="accent2">Rogue</span></div>
      <div class="meta-sub">roguelite tascabile</div>
      <div class="meta-stats">
        <span>🎟 ${meta.vouchers}</span><span>🥚 ${eggs}</span>
        <span>⭐ ${unlocked}</span><span>🏆 ${meta.stats.bestWave}</span>
      </div>
      <div class="meta-actions">
        <button class="meta-btn primary" data-a="run">▶ Gioca<span class="sub">${slotOccupati()}</span></button>
        <button class="meta-btn gacha" data-a="gacha">🎰 Gacha Uova<span class="sub">${meta.vouchers} voucher disponibili</span></button>
        <button class="meta-btn eggs" data-a="eggs">🥚 Le mie Uova<span class="sub">${eggs} in incubazione · ${unlocked} starter sbloccati</span></button>
        <button class="meta-btn danger" data-a="reset">⚠️ Azzera tutto<span class="sub">cancella ogni progresso</span></button>
      </div>
      <div class="rev-line">${etichettaRevisione()}</div>`);
    metaEl().querySelector('[data-a="run"]').onclick = showSlots;
    metaEl().querySelector('[data-a="gacha"]').onclick = () => showGacha(null);
    metaEl().querySelector('[data-a="eggs"]').onclick = showEggs;
    metaEl().querySelector('[data-a="reset"]').onclick = showReset;
  }

  /* Azzeramento totale della meta-progressione. Si perde tutto quello che
     sopravvive alle run — starter sbloccati, caramelle, IV migliori, uova,
     voucher, record, forme e specie viste — quindi va confermato per bene:
     due tasti, e quello distruttivo NON è il primo né quello evidenziato. */
  function showReset() {
    const righe = [
      ["⭐", `${starterDex().filter(isSelectable).length} starter sbloccati`],
      ["🍬", `${Object.keys(meta.candy || {}).length} specie con caramelle`],
      ["📈", `${Object.keys(meta.ivs || {}).length} specie con IV salvati`],
      ["🥚", `${(meta.eggs || []).length} uova · 🎟 ${meta.vouchers} voucher`],
      ["🏆", `record: ondata ${meta.stats.bestWave} · ${meta.stats.runs} run giocate`],
      ["💾", `${[1,2,3].filter(i => { const d = leggiSlot(i); return d && !d.rotto; }).length} partite salvate nei 3 slot`],
    ].map(([e, t]) => `<div class="reset-row"><span>${e}</span><span>${t}</span></div>`).join("");
    showMetaScreen(`
      <div class="meta-title" style="color:#ff8a80">⚠️ Azzera tutto</div>
      <div class="meta-sub">Stai per cancellare <b>tutti</b> i progressi.<br>
        L'operazione <b>non si può annullare</b>.</div>
      <div class="reset-box">${righe}</div>
      <div class="meta-sub" style="opacity:.75">Vengono cancellati anche i <b>3 slot</b> con le partite in corso.</div>
      <div class="meta-actions">
        <button class="meta-btn primary" data-a="no">↩ No, torna indietro</button>
        <button class="meta-btn danger" data-a="si">Sì, cancella tutto</button>
      </div>`);
    metaEl().querySelector('[data-a="no"]').onclick = showHome;
    metaEl().querySelector('[data-a="si"]').onclick = () => {
      try { localStorage.removeItem(META_KEY); } catch (e) {}
      [1, 2, 3].forEach(cancellaSlot);      // anche le partite in corso (§26)
      meta = defaultMeta();
      saveMeta();
      showMetaScreen(`
        <div class="meta-title">Fatto</div>
        <div class="meta-sub">Tutti i progressi sono stati cancellati.<br>Si riparte dai 27 starter iniziali.</div>
        <div class="meta-actions"><button class="meta-btn primary" data-a="home">🏠 Home</button></div>`);
      metaEl().querySelector('[data-a="home"]').onclick = showHome;
    };
  }

  // Estrae il tier dell'uovo dal gacha (con pity: dopo 20 tiri, EPIC garantito).
  /* Tira un uovo dalla macchina scelta. Il TIPO resta appiccicato all'uovo:
     è alla SCHIUSA che fa effetto (cromatico, mossa da uovo, specie in
     evidenza), non al momento del tiro. */
  function pullEgg(tipo) {
    tipo = GACHA[tipo] ? tipo : "MOVE";
    let tier;
    // pietà: dopo 20 tiri senza niente di buono, uno EPICO garantito
    if (meta.pullsSinceEpic >= 20) tier = Math.random() < 0.15 ? "LEGENDARY" : "EPIC";
    else tier = rollEggTier(tipo);
    meta.pullsSinceEpic = (tier === "EPIC" || tier === "LEGENDARY") ? 0 : meta.pullsSinceEpic + 1;
    const egg = { tier, tipo, waves: EGG_TIERS[tier].hatch };
    // il gacha leggendario "fissa" la specie in evidenza del giorno del tiro
    if (tipo === "LEGENDARY") egg.evidenza = specieInEvidenza();
    meta.eggs.push(egg);
    return egg;
  }

  /* Le tre macchine dell'originale, una sotto l'altra. `result` è l'uovo
     appena uscito, se si arriva qui da un tiro. */
  /* `dove` = dove si torna con Indietro. Serve perche' ora il gacha si apre
     anche DA DENTRO una run (dal menu), e da li' bisogna rientrare in lotta,
     non finire sulla Home abbandonando la partita. */
  /* LE MACCHINE DEL GACHA, una per tipo, appiattite dai file dell'originale
     (`gacha_eggs` + `gacha_<tipo>` + `gacha_glass`, ritagliate a 106×131).
     ⚠️ Stanno qui come data URI e non in `assets/`: gli asset NON viaggiano
     con l'aggiornamento a caldo, e un file nuovo si vedrebbe solo rifacendo
     l'APK. Sono 5 KB l'una, un prezzo onesto per non dover ricompilare. */
  const GACHA_IMG = {
    MOVE: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGoAAACDCAYAAABlao7dAAAOJklEQVR42u2dX2xb1R3Hv05sp3Hs4tsGu0lIm0JLhkob1G1o/QMSqXhAwEPHQzShPpSH7WHaQxSIUo0itE1KFFQiwZCAB/aQIZQXeGBo2lg6oa1FE6hSmlZTaJc/dElrz62dOLXr66Teg32uz70+995zr6/ta+d+JSv2tX187u9zfn/OuX/iAkP9Lzyfg8Xq6Oy0tL2bKytl/yZPG7XQ+T994VJuc7MgPXfyJel1ZiNry5157If2aMMqtbg99MucElaTFiRHtdFzJ18qiWpNWl+wqzc1ovRs7Tbgjo5qqCbHBPUhmUc92ObHt3/9i2MVG+jBNj8b1MDAQG7kzBnHQvZSbmpqygUALiWkcCjkmMcGikSjAICx0VFMTU25XASSA8i+wMZGR9EUi8Uca9hcsVjMqfrqruojMdGRTedR09PTrleHhhxL2FSvDg1henraJS38nThxIueYxX6anp4uludER9+5KMH6riOHcy3F94YyQJe4HW+3APPpGQxltH/A+8Dekm37sxFc84QBAOLqQsn7e1v7ZK/j4SXdHUnFBUM7Tv/uno7iDi7dzGj2Xa0NAAj2BNX7dAvYvxGRvX81lVL9/UdR/O63v35e4lNy3OPoOxdz33XkedGg3k5uxw5xA68H8mntZGKG2Um6o/uz+Q4SOPRO+gP+ku+tJ9clYDSk9fi69Nwv+FV/r0vcrmnghfSM7DUx1NLNjAwO6Tcteh/ofWHtvxYsAkkJSgmLhqS5KCuuLkCk2lnIAKBGvFoHAcAnxPNPoqVtsgBJEArvLSRnEESQ20sIoEeEx7k+T4ARw+hBUkYDuefFVW0gwdoFXLtFvrsgA6OEZWj1nIz6PZ1yUgvpGaClD3fCS0AmP9LJCGeN+uWQV+qsHiQlsMRigjkY6N8UInsMAVJ+biE9oxvmeEKvNDBVBhAAgBzFoAb7QnpGFnJNHeZQI32HCkmsMKQ0phFI7qZmJizWYBAie7gBaQFbxlpJiOMNfVqwyCDS0t7WPiykZxDcoxiQSwaPR1khGlL/j3fK3jv/zW1NaErPoj3JKCTP3f8CADa9ftz3BIvA4lew7F3jhsIKiXngXiakHeJGwRCFge6Vm5xAWk8UB2EIAXOgllby7nnA50NXVMQ1TxipjDwe+wW/bMQDQGIxoQqJbNOCxQqDLEgEghIE6/1mcV32vhosVlWqVdl2RUUsh7xsSDqiIRkOfUs3M1gqRL8DPh8ONAM9QhA9LUCr14dwrljVRG6RUMhuiwWJpY37m7Lw525qxsb9TS5PoUE0i+vItj1kOgKoVaUlBl5dwNWCfcwoHlqCqQOHLB3w+dAbDqH3nrQrCItxwFOkEt7VJQEjsZr2JiMiYFj5am9rn8yblJDUtOn1o1nMj1oWwEeEx7Gw8rH0W/Rv031Sq1KvFqYVQSr8MfN7IewRT2OVIP6gH1g1CIpA0nR/T36nxOwmwru6ZLD0NL+c4gKm51V6uu8JloRDWn9b+Vgy+rPHHpG2//3rRe4qlQxOoXVPCZi8odTDoT/oN3/OBAtSJpvPiJcDD6sCC+/qKvEmFpD55RQWV9LcHuYP+EsmrFoepBUqm7IJXUgA8MyRHkMDQq+Py541zLalpEcqLkgPU6HvgM+HHqE4AjOiiExhHhDxyhsVs5sSJDUtrqS5oNC5TK/IIGGsKZuQwppaMSGNygIgZUGhDLVSW2JC05vp/moNvGXvGuABunfvltmNVuSmYrHASOjLiKK8Ma+ASEspfeWPWqGezlYuuHphTVlo0ND++r8vmHl0U0xw9Y/Ww10+LK6k816VnJHWLZe9a+ju3g2d9IVwRxcFLMEHaq37MC4DQHZe2nbZnw93h5L5bYcUE+qIVyjxNqOaX07h4S6fbMetEh3ulNBIHvzywn9KvERNpJ9a0w0JEqW+9SWZEygHf7ijC1hLGPMoOhcdihWgqSxNhcV42aAWV9JMA1ghGgwA/Hn1K8mb6PDGE3K5clVyBt27j2tCInYDwIxUhie84QxfFZfMXGEu2G7c3uDeSSsMZRfRuZsFSTbILQElaoO64MmHiP5j/WzjXzhvGBitpz79hHr1uSVGfI56/o+f/sySNtVCpZjdZAKC2TNljUoPkBS7C+/zApODASYmJio68gcHB2WvecDR+ZQO3WYKLZ6U4S4HkhYgr6LMESHKgLFgPfXpJ4jFYpiYnKxqiFIOBAJOCxjPlIOGFPEKupHJclAXPCn0/4gfEtkmFpaQ+4/1y2A99uG7aG9vr7jnGAV36tQptLe3mwqN/oAfN+b+ie7e47JiQQlLbcpjClTEKwCFgoJ40heZ8ozRf6wfN154EQAwaaEHnfvgMwDA0C9Olt0W6dfg4CBisRj+/fNfldVepIUPinlQLQIiGeB6bhm/18lHvLrxwouWAjo7nm8r+IBf9vq3w6cs9TAtWGQOVonKlbnWd2h9HofW52Vl+fXcsm7RQOcjrW1WQ6J1+OA+HD64ryJtT05O4rEP3+Wu+oI9QSQzV/KPe/lHRXIUqe+T965wQ9KCVSlI5z74DMEH/Dh8cB8uzV7Pj+7jT+DS7HWc++AzS8IgDUvNs0iB4d7pLq2Gb8mnKoFtj8vmqXTuumbVFYfxZBzxZBxz38/JHvFkXDfcvTY8XLEi4JmjB5nPrdZrw8OqnuXe6Ub/sX7VgU3eo72LpxrUBaX0prnv5xCNRxGNl56rHo1HdWFVKtwlVtdxdnxSCn1nxyeRWF2vWBjUgkQGs9YAVsIqC5RyIjb3/ZxugyyAlRbtPZdmr0vhr9KepQZJaQc1mxiBxcxRZKX8eq7oTTyQaqn+409IoOjXtYBkJKqQOeU+V5dmCHTz5iS7i3hOtTzI6qhCz7FacZU/9CUzRW+qRTirFym9iaWQENL1Kr0Q6FxxWAHRYEJCCEJAsPY+EyxvcmTcm4SAYBgOyVX0/KqiHqXn5o5qcDyKJSvcvF5UbtSZu1GspHu7e8vPUTxeEhJC6N3d6wx9k4on45pFhZvXS0LksEYqyoS4lTyJy1uU884IEArKC4tQMIRoIm/PaCKqaUO30ZDW2174m3FgcEMi86sCFGJLISBI26qeoxxIxlZw9HJTRUEpO2vVXMLuOYZnYUAvxFVtwssaUY2+ssELCVYd4R0YGHBuCmITKVk0MW+seKuynbg8O1u3BmT13Wpv8gYEjJw5I4NVEvree9qHI59PmoalnEs58yvFfDOoPSc98vkk3nvaxy4mBgYGcqdfecWyzjhgrFGBSW5qasrlNlswzGVQVmV3eXYWhw4eRL2HPS5Fit5ktvplVn0jZ84gPXIaF++XVjeqk7l4lOsEl3rNVVp95Vli6+3u1YWUHjkNtRswy0BFIhEZrD++nId18X6+wOCaJxhMrPUAS6+PQkBASAgxgfV6e7kmtUpINAspR01NTblisVjuteFhRCIRhMNhCdbYy6eLn/7lCC4+xBcajeQpYgi7hUIjg4heFuKtnNMjp2WOoYT01vi4dL8+Zo5SwiIaGx3FNxQ07RrTvGFqDYwbkInKWA2OmieVLCEVyOXICZLkCwQYC5pmh7bAPIs2Oq/UcpASEO1NXGt9dANq0Hg1NjqKP3z0kdHytGoy0rf29naU+58X1LyHpZI7YJ44cSLHc9oxDc2IjNwIX3klIKp8QRvPnf4rAUfpTUxQh48eyQmtPukcaytlFG61/7uBUeMb8QgevTU+np8GpVO4dPFr/VuV7n/ySdkXQZ0cXy1XrxY0Go7VhucFQ/Tokz8BAPzrq/PGjkcRYKyGK3lVBstw1TZiNeAo7QurDhzSDStHAzgvV2kkmbGBETiWHOE184NGd6zaYI32z6zRa3Jen7dF/3bQYiZjasfMjNhyVE3DVw0UDyDlZwmwRjAc6uGfURqBZMX3HJkAVa6xHVhVAGWVkR1Yzv/hxZa6mqO1cB/vNPWfWaz2Am9Li+HiolFF7I2cy5xHtfp8eH901NXq81Wsk++Pjrq2KhzysCz0TZw962pucmPbtm3Sw4FkHIhROKbmURNvvO4a/M3vcp7CTdfNwLp3T/p3BHjnzTddDROy7DbhnXjjdZlxh8fGuE+BHh8ZcRndYTpHNprhq7qEpGX8RjecU547QnDHDoOgci7Hao5HOXJAbRVQO0POTT1sD4okMgdWHYW+zq5Ox0JOjnJU03shmREdZtN370rPU9RzB5RCHZ21DXetbW3M55VQPQ2Khrhzy4Uvv0T8zp2KtS/s2IEf9PXZK0fdXFlx4ozjUY2tABWqkxaH0oYAdezZZ3GbcSWGVYdJeFbxAxXOpw3jUZWaoN+ORu05j6p11dcIA4AV9gJtbdLDyVE1lFZOsiIsOisTVSwwygHngIKz1md7pRnhKn33LnO7Vd7kgLIAFnle6aUrMxCbtrL3ECDEi1rb2qoCSQ9WgrEc1rRVIRFls9mKeJHVE+CmrQCG9hzl5zwej1NM2NWLahXqHFAax7SU29YSCeZn1CpAB1SNPMzj8ZRAUoZG2uMcUFXwKtrwWrmKBdRuIbGhPSqbzZbkIi0AlaoAjVaHxs89r+Mwp1fRsSa624PB+ikm6vlQPL38o1XR6U100zY80aWpkTxIDRDL8NlsFtlsVrWwqKUacmWChqBVliuhbg8G4fF4VL3Hbl7lbsQ5E+sza4mElLP0vkNXjNVYPgq0temeDLOl1vqUYVELmN3Kc/eWAVR4zQJgt8ntlivPeZaK6mWtz91oZyFpeUe5uadaYjGwhUe1uD1VLS7q0au23KF4u0KhK0XWosOWPGeikrAqdWqzLUBlNrJw5Fx2g3o799y2xYQjp5hoXFCJCl5i2ehhr5xCIrmecjyq3q6LYtUJ/weKYaD8xWAn6gAAAABJRU5ErkJggg==",
    SHINY: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGoAAACDCAYAAABlao7dAAAOiUlEQVR42u2db2wb5R3Hv3YdJzF252tau8VNk7QrEYSlYtqmQijS0vJiWpm0TVqY+DO6MfXFpILUP5SuL1E7UsFGpAlNaBNqi1CQxhtAk7Yu08TaoTEJJZShEkiakqRxSmo3SeP4kth7YT/n587P3T13Pp/t5PlKVuKzfffc7/P8/jzPcz57wNDJn2zIwmFtjUUd3d/4RLzkY/LsoxJ64a2bHu02HwvSyRMtyvPM7IJDh884fDqbHDjmpqqB410foJ9mtbC8RpCEKqOTJ1qKoprXsD865k1Cpr5vYmufBXcUqmRoFCaoDak8atjzMH52WhilKuS5C0B/Maienp7sieefEwaqLmX7+/s9AODRQopGI8I8VaB4fBoAcOr0i+jv7/d4CCQBqHqBnTr9IrwzMzeENapcMzM3RNVXc1UfiYlCVTqOunBhwHP4yBFhiSrV4SNHcOHCgEeZ+Nu3rzsrzFJ9unBhoFCeEz3Qd0mB9dmWLF6qp8imgZi8Hi/XAyOpQRxOGx/A/7W2om07l+IYrsstPci3Roteb2vcpXqeiI6ZnshCQrJ04vRxW7YUTnDsetqw7Xr7AIBwa1i/TVPAzmX1csonCwu6x78Lhc/+99ffV/gUrXs80Hcp+9mWHC8a1Mtz67FBXsbJUC6t/TA5yGwk3dCdS7kGEjj0SQZDwaLPzc/NK8BoSPOJeeX/oBTUPV5MXm9o4NHUoOo5MdTY9bQKDmk3Lfoc6HNhnb8RLAJJC0oLi4ZkOCkr3xqFTO1nNA2A6vF6DQSAgJTI/TNdvE8WIAVC/rXRuUGEEeb2EgJoh3Qv1/sJMGIYM0jaaKD2vISuDRRYm4HhKfLZURUYLSxLs+ek17fcqSY1mhoE6nfhZnQMSOd6OunhrF4/EfErjTWDpAWWvJpkdgb6mFK8xRIg7ftGU4OmYY4n9CodU6cDAQCW8n+pzj6aGlSFXFvLHHqkb1IhiRWGtMa0AsnnXceExeoMUryFG5ARsAnMFoU43tBnBIt0IiO1Ne7CaGoQ4RZNhxyzuB7lhGhI3d9uUr028OGMITStZ9GeZBVS3e1xAMCKP4hMXbgALHEZE/5ZbiiskJgD7mdC2iAv5w2R7+h+tckJpPlkoRNGELIHamwy554dgQBi0zKG66JYSKvjcVAKqno8ACSvJnUhkW1GsFhhkAWJQNCCYL2+Tp5Xva4Hi1WVGlW2sWkZExE/G5KJaEiWQ9/Y9TTG8tGvIxBAxzqgVQqjtR5o9AcQzRaqmvgUCYXsfbEgsbScWVGFP593HZYzK1yeQoNYJ89j6Y6ttiOAXlVaZOBbo/gkbx87SkTGYGvhkKWOQADt0QjaF5VTQVROAHUFKtHNMQUYidW0N1kRAcPKV22Nu1TepIWkpxV/EOvkXK9lAdwh3YvRyTeUY9HHptukV6V+kh9WhKnwx8zv+bBHPI1VggTDQeCWRVAEkqH71+VOSl5aQXRzTAXLTCMTC1zAzLzKTJm6cFE4VI3+J99QjP5w1w5l+z/+fZW7SiWdU2psKQKTM5R+OAyGg/avmWBBSi/lMuJQaLsusOjmWJE3sYCMTCzg6mSK28OCoWDRgNXIg4xCpXcpaQoJAL57f6ulDmHWxom6WXx8x4LyWEhIysNW6OsIBNAqFXpgWpaRzo8D4n71TuWlFQWSnq5Oprig0LnMrMggYcy7lFTCml4xofTKPCBtQaENtcq+5KShN9PtNep4E/5ZoA5o3rZNZTda8euayQIroS8ty+qd+SXE64vpaw/qhFrvbOSCaxbWtIUGDe2vN95j5tEVOcnVPlrbYwFcnUzlvGpuUJm3nPDPorl5G0zSF6JbYhSwJB+o2eZvYggAlkaUbUPBXLjrnMtt69QMqON+qcjbrGpkYgHbYwHViTslOtxpoZE8+LeLXxR5iZ5IO42GGwokSrvmx1ROoO380S0xYDZpzaPoXNT5VR6aztRUVE6UDOrqZIppACdEgwGAv9z6p+JNdHjjCblcuWpuEM3bHjSEROwGgBmpLA94o2m+Km4ufZk5Ybs8s8x9kk4YqlpE524WJFUndwSUbAzqYl0uRHR3dbONf3HAMjBae95+k3r2jiNG/B71//s/+qkj+9QLlfLSChMQ7F4pa1VmgJTYnX+dF5gaDPDK714qa89/5tnDquc84Oh8SoduO4UWT8rwlQLJCJBfU+bIkFXAWLD2vP0mZmZu4JVzZ10NUdqOQMAZAeMZctCQ4n7JNDI5Dupi3QK6v8UPiWyT81PI3V3dKlj3vNaHpqZNZfccq+Aef+JJNDVtshUag6EgvrzyLzS3P6gqFrSw9IY8tkDF/RKQLyiIJ72XLs0Y3V3dGH9kPwDgvIMeNPr+IbTt6VNtuz3cizt2HrO8L9KuZ549jJmZG/jfLw+V1LZ4PR8U21+7idfnxkhm4c6Kxh/Zj/PnzjoK6fZwL3bvvw+3h3tV4Oi/dj3s/LmzuOe1PtOZFd6VAkdAdc6PoHN+RFWWf56d4IZEQpzeNgLJaU1Pjav+AsCI9yCmp8Yx4j1Y8v7NYGmrvnBrGHPpy7nHYu5RlhxF6vu5xcuWPYkFq1yQaA/SbtvbdQx/v3gQe7s6HDnW+XNn8fgTTzLDICkwfE2+4mp4Sj1UCTXcqxqn0rlr2KliIjGXQCINTCfUlxlFpAikkGQY7o4dPeoopNH3D2H3/vty0zr5b7mT5wDwwbuHsHdPn6PHPHb0KHrPnGHC8jX5DDs1XfkSWDzVoCko4k2keLhy7UouvDCKCQLOCJbTGvEeBN79AwPQR8rrbS61hYaUmEso9ohIEUiQioDRsEoqJrQDMQLJME8k3P2ywd6uDox4D2LEe1CB88G7HynbnAp5ViBp7aBnk+6ubu68xfQoMlP+ebaQm3ggVUK3h3uxt+tYPgyqAaICnkS8ycowZeDiAL7uiRmGQC9vTqpGaUtv4lVOVHglVZ82okq8XsJQaDtz9dwQ1Fy64E1uhzMr+Ykuvfd2daBtT19FvYmliBQx9SqzEOhDDSsHpM+1YoFXESmiLiRCEnAbzs+e094kZN2bpJBkufI1qwK95ehNQmW+c4sTcnMMVWmVGnWufFmopNub20uflOXxkogUQfu2dtH1bSoxlzAsKny8XhIhMxEL00yIa8mTuLxFO+6MA5GweootEo5gOpmz53Ry2tCGPqshrX1j/m9awOCGRMZXSfUUmxSSlG2u5ygBydoMjlluKisobWPNZtVXS47hmRgwC3Gu3ViR1aOqdWbDbUhwaoW3p6dH3BSkSqRl4WXeWHGqvI0YGvq4Zg3IarvT3uQPSTjx/HMqWEWh79WHGnD/O+dsw9KOpcT4SjPeDBuPSe9/5xxefaiBXUz09PRkf/HzpxxrjADjjPJMsv39/R6f3YLhSholVXZDQx+js/MbNR/2uBQveJPd6pdZ9Z14/jmkjh/ApUxxdaM7mEtM48q1K5YWGWspVxm1lWeKrb253RRS6vgB6N2A2au+f2lcBev8YzlYlzK5AoNrnGAxsdYCLLM2SiEJESnCBNbub+ca1Goh0SyUHNXf3++ZmbmRPXb0KOLxOKLRqALr1GMHCu/+1XFc2soXGq3kKWKIaguFVjoRPS3EWzmnjh9QOYYWUu+ZM8r9+nzsOwOrYRGdOv0bfEhBM64x7Rum0sC4AdmojPXg6HlS0RRSnlyWXCBJPkCAsaAZNmgNjLNoo/NKLwdpAdHexDXXR+9ADxqvTp1+EX/80+tWy1PXZKVtTU2bUOovL+h5D0tFd8Dct687y3PZMQ3NiqzcCF/7TUC4/IU2njv9lwOO1puYoJ7qDmbHvd8BAMevE7cK1+1fN7BqfCsewaPeM2cAAFsz/8HrA/Pmtyp94dFPAQAn8x8EdXG8W67uFjQajtOG5wVDdPqZnN1//1uL61EEGBENzmlvMwPrthHdgKO1L5xaOKR3rPU2cH5dZTWp14YNrMBxZIXXzgGtwnUbrFXD2zV6Ra7ra2ww30VqcdnWidnx2lLkpuFdA8UDSPteAmw1GA618GOUViA58TkhG6BKNbaA5QIop4wsYInf4cWa+jbH+mAdAGB2fqlsXtDY4LNcXKxWEXt7Gm161PpgHXY/fd1DdlQO7X76umetwiEPx8rzex695vn0wras71ZhpwspWUCy4C2ujaPu3qeGFWi0voRLw931+JceAaFMA967911TGXf4zzu4L4He+eMvPFZPmM6Rq83wrk4hGRl/tRtOlOdC2LrRbw2UZ6MwmvAoIQFqzYDS/kCIUBWCIolMwKqh0Ne2sUlYSOQooYreCwk2f9SLKDm3TP2/JAjpgdoaiwLIVKxB4ZCP+X85VEudYlUstfb138T4dPnu+bM1Uo8f7Gmsrhw1PhEXcUZ41OqWp77wJYhsOi5AaXWoZwPzt5ycWibhmcWnIQmPsvBzqzmVnlec/OVSZ2cmYlERw0qcTmOFPU99VHmIHFVBGeUkJ8KimJlwscAoBZwABTHXV/WiZybobaztTnmTAOXINNKyK1NXdiB617L3ECDEi8IhnyuQzGCNfyWvTVBGoWxRzpTFi5weAHvXAhjac7Tva/B7RTFRrV5UqVAnQBmsaWm3Tc3IzPfoVYACVIU8rMHvLYKkDY20xwlQLngVbXijXMUCWm0hcVV71KKcKcpFRgDKVQFarQ4tX3tey2HOrKJjDXQ3N/lRMyu8uaX4TTVf6RmFORIW9cJcteWnVeNRWqPzVHSLcgaLcka3sKikVuXMBMuLjAxPoG5u8qPB79UtLKqpNF8VC4c8HhAO+TA1Iys5y+wzdMXoxvSRpz5qejHMmprr04ZFI2DVlqN8awWQUZFQbcXDmivPeaaKamWur+quPXcCkp7xS809rnlULArgZvV5lHd9wNXioha9as0txVcrFLpSZF3/vyavmSgnrHJd2lwVoDKzCxASX7tBrV17zrqsXFyAKS7AFCpv6PtKFlaxGfZKKiRCYq6v+nOT37xO+D83N8dwoyxqaAAAAABJRU5ErkJggg==",
    LEGENDARY: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGoAAACDCAYAAABlao7dAAAOrElEQVR42u2db2gb5x3Hv1IkOVLlTBfHUlLbidMkM6mbhIVtJE0amNu+GC0b2xszOrqGMfZi0DIc1yEL9E3J5qZpadgopQxK2lL8plBKGWzFY92SwDpaHCcLblL/i/9JbiLF8izrbEt7IT2n507P3T13Op1O9v1A2HeS7p77fZ7v7/d7nvsjDxh2duvOPCy21ljU0u1NxRMV75NnG7Wwl+9NepTrfCxIZ/c3Scu5b5as2Xsube3RNAcr3yfPNmwy77ZQaeEm8kpYXi1IrtXGzu5vKotqXs0OaZWaXNMXv46vfdxydK22odF1QX2YTFG3njyKX7g+cYa1AhiYLAfV3d2dP9PX5zrIWZYfGBjwAIBHCSkWjbrucYDFE4Ux3rn+fgwMDHg8BJILyLnAzvX3w3t3ft71hsPt7vy8W/XVXdVHYqJrDh1HfTo46Ok5dcr1hEOt59QpfDo46JEm/p7o6sq7bnGefTo4WCrPiT168YoE66sdeVxooMhmgRZxC15rAEYzQ+jJau8g8K3dZev2rcRxyx8DAIj3x8re3x08JFtOxiZ0D2QpKRg6cHq/u3aUDnBiNqvZdrVtAECkPaLepjlg32pc9v6NpSXV/X8bpe/+53dPSXzKzns8evFK/qsdBV40qNfSW7BVXMXZxkJa+0lqiNlIuqH7VgoNJHDogww3hsu+t5helIDRkBaTi9L/YSGsur8WcYumg8cyQ7Jl4qiJ2awMDmk3bfQx0MfCOn4tWASSEpQSFg1Jc1JWvD8GkdrOWBYA1ePVGggAISFZ+CdRvk0WIAlC8b2x9BAiiHCrhADaIzzC9XkCjDhGD5IyGsiVl1T1gQRrO3Brjnx3TAZGCcvQ7Dnp9bselJMaywwBDYdwLzYBZAs9nfRwVq+fjgakxupBUgJLjaeYnYHepxDfZQiQ8nNjmSHdMMcTeqWOqdKBAAArxb9UZx/LDMlCrqnTHGqk71EhiRWGlM40Asnn3cSExeoMQnwXNyAtYNNYKAtxvKFPCxbpRFq2O3gIY5khRHYpOuSEwfNRVhgNqet78rPHg5/f1YSmVBatJKOQ/P+bAgCsBcLI+SMlYMnrmA4scENhhcQC8AAT0lZxteiIYkcPyF1OIC2mSp0wikZzoCZmCvLsDIXQkhBxyx/DUlYej8NCWNbjASA1nlKFRNZpwWKFQRYkAkEJgvX+JnFR9r4aLFZVqlXZtiRETEcDbEg6RkMyHPomZrOYKEa/zlAInZuAdiGC9gYgGAghli9VNfE5EgrZ22JBYtlqbk0W/nzeTVjNrXEphQaxSVzEygOtpiOAWlVa5uD7Y7hR9I8ZS0YnYOrEIcs6QyF0xKLoWJYOBTExCfhLVGLbWyRgJFbTajJiBAwrX+0OHpKpSQlJzdYCYWwSC72WBXCP8AjGZt6X9kXvm26TWpV6ozisiFDhj5nfi2GPKI1VgoQjYeC+QVAEkqb8/YWDElfWENveIoOlZ6PTS1zA9FSlZzl/pCwcykb/M+9LTn/y2B5p/d+vjnNXqaRzCsFdZWAKjlIPh+FI2Pw1EyxI2ZVCRrzW+JAqsNj2ljI1sYCMTi9hfCbDrbBwY7hswKqlIK1Q6V1J6UICgB8cbTfUIfTaOO1fwPADS9JrKSlIL1OhrzMUQrtQ6oFZUUS2OA6IB+QbFVfWJEhqNj6T4YJC5zK9IoOEMe9KSgprasWE1CuLgJQFhTLUStsSU5pqptur1fGmAwuAH2jbuVPmN9ris4rJAiOhLyuK8o0FBMQbyukrd2qFtT8Y5IKrF9aUhQYN7a/znzDz6JqY4mofbQ+1hDA+kymoKj0kzVtOBxbQ1rYTOukLsR0tFLAUH6iFtsO4BgAro9K6a+FCuDuYLqw7qBhQxwNCmdqM2uj0Eh5qCckO3Cqjw50SGsmDf7v8dZlK1Iy0U2u4IUGi7NDihEwEys4f29ECLKSMKYrORQe/KUJTmZqKicmKQY3PZJgOsMJoMADwl/v/kNREhzeekMuVq9JDaNt5XBMS8RsAZqQyPOCNZfmquHT2OnPCdvXuKvdBWuEopxidu1mQZJ3cElCiNqjL/kKI6DrWxXb+5UHDwGh77MMPqKWPLXHiD6n///nTn1myTbVQKa6sMQHB7JWyRk0PkBS7i+/zApODAd64cKGqPf+Fnh7ZMg84Op/SodtMocWTMnyVQNICFFCUOSJEGTAWrMc+/AB35+fxxqVLtoYoZUcg4LSA8Qw5aEjxgKAbmSwHddm/hK7v8kMi68TiFHLXsS4ZrIffuoim5uaqK8couJ8/+yyamptNhcZwYxh3Rv6Fto7jsmJBCUttyGMKVDwgAMWCgijpk2xlzug61oWpp54GALxnkYLOv/0Ren/1Y9Vlo0ba9UJPD+7Oz+O/v36+ovbFG/igmAfVICCeBW7np/FHnXzEa1NPPV0VQOff/kgXYCUK04JFxmDVqFyZc30HF0dxcHFUVpbfzk/rFg10PtJaZyUkADh8YC8TEIF0+MBeS/bz3qVLePiti9xVX6Q9gnT2euG1XHhVJUeR+j69fJ0bkhasakACgC+Gb0vAyP/08hfDt/H4kU7LYKkpixQYviZfeTU8Jx+qNG5+RDZOpXPXLavuOEymk0imkxiZHJG9kumkbrh7sbfXsnBHA6GBsQCyvmfWXuztVVWWr8mHrmNdqh2bvEeri6ca1AWlVNPI5AgSyQQSyfJr1RPJhC6saoS7x490SjAOH9grvcgyUZOVYVALEunMWh1YCasiUMqB2MjkiO4GWQCrYTQcWj0k1NHLNFyrQqAWJKUf1HxiBBYzR5GZ8tv5kpp4INlttNN5qjq7IBmJKmRMudfTohkCfbw5yTV+MxNV6DFWEDf4Q186W1KTXeGsHk2pJpZFhaiuqvRCoHvHYRWMBhMVohAaBWufM8FSk2vG1SQ0CobhkFxFj6+qqig9mbtWg/NRLLNC5vVilUadkTulSrqjraPyHMWjkqgQRcfODrfrm7RkOqlZVPh4VRIlpzWWEkyIG0lJXGpRjjvjQDQiLyyikSgSqYI/E6mEpg99RkNax7bi36wLgxsSGV8VoRBfCo2CtM72HOVCMjaDo5ebqgpK2VirxhJOzzE8EwN6Ic62AS+rR633mQ1eSLDqDG93d7f7UBCHmJKFl/lgxbnqNuLa8HDdOpDVdqvVFGgUcKavTwarLPS9eXwzjn78rmlYyrGUO75SjDcj2mPSox+/izePb2YXE93d3flfPvecZY1xwVhjRSb5gYEBj89swTCSRUWV3bXhYRw8cKDuwx6XxUtqMlv9Mqu+M319yJw+iSu58upGdTCXTHBd4FKvuUqrrTxTbB1tHbqQMqdPQu0BzDJQ8XhcBuu9ZwqwruQKBQbXOMFgYq0HWHptFBoFRIUoE1hHoINrUKuERLOQctTAwIDn7vx8/sXeXsTjccRiMQnWuWdOlj79m9O40soXGo3kKeIIp4VCI52InhbirZwzp0/KhKGE9Mr589Lz+pg5SgmL2Ln+P+BzCpp2jWneMbUGxg3IRGWsBkdNSWVTSEVyeXKBJPkCAcaCptmgDTDOop3Oa2o5SAmIVhPXXB+9ATVovHauvx9/fucdo+WpbWakbU3Nzaj0lxfU1MOysidgPtHVlee57JiGZsSMPAhfeScgbL6hjedJ/9WAo1QTE9Rz4eb81PcPSNdYW2lG4dr96wZGnW9EETz2yvnzAIDWfw/jncV5/UeVvnzzJgDgbPGLoC6Ot0vqdkGj4VjteF4wxH4/X/D7n4yejyLAiNHgrFabHli7nWgHHKV/sQ3WnDikN6xUGzhvV1lP9ooJH5TBQZUvFzOzQ6Nw7QZr1PFmnV6T6/qCPv1NZFZXTR2YGdVWYnY63jZQPICUnyXA1oPjUA8/RmkEkhXfc80EqEqd7cKyIfRZ5eSgz8cdBl8/ccIWR/z2s8821k0CVhkBZMfvL8YTCZxzODAmqC1+PwBgYWWlaiFLS1WvnzgBO38gMxaN4o0LFyRgdsMi/i5dGLFqLEdt8ftxZHbWQzZUDTsyO+vZiDlni98vvSwrJh6enPQEtnkQCgSkV7Ug2a0mpbLO9PVZmhdpIEbhmMpR+7+c9Nz8zs68b6GwEzOwlqinQB66c8ezHlThyGJi/5eTMufe2rOH+xLofV9/7dE7YDonbjQQVa36tJxf745xUlsc/fiCWvwusFN+i7g1EDQGytNkfyNfunoVtfxd4J5Tp/DS1avugNdMD7djwIuN9vgCWHS6gajqwquv2uJIsr+Xb94EHJafVEG1B4MYz2RQy0ROTnHYFQbJ/rY4EBITFElk7cEgJpCpedVl1zkppwLiCn27Q00AJt0y2S3PXaurYqI9WBo3pKgZ9ZTDZiqclaNiUSCXrlmDItTplEiVzwbXU6dYF+fFL967h6ls9Z7509rQgB8Fg87KUVNx97GkrqLWuXmomyDyFl+CvS5APb91K3OAbtVpE54hgsfkbUgbTlHtrBxiQV6p5QyNZo5qjbnPhNXtADrGCnueWEx6uTmqhqaVk6wIi+7MhI0FRiXgXFBw5/ocbynGBaCp1VXmeqvU5IKyYhqp+H/EhhsZjEL0bmT1ECBERRGfzxZIerCmxMzGBKUVypZzuaqoyOoBsHcjgKGVo/zcZq/XLSacqqJahToXlMY5LeW6ueL178rPqFWALqgaKWyz11sGSRkaacW5oGxQFe14rVzFAuq0kLiuFbWcy5XlIi0A1aoAjVaHhq89r+cwp1fRsQa62y26Qc89Fc8JiKhCTRl6A10nFRHrSlF6gFiOX87lsJzLqRYWtbR1OTNBQ9Aqy5VQtwcC2Oz1qqrHaaryrofqTm/gGvH5MCeK3BVdpaoyOn3E8/kNNdenBKoHF+7lYvYDIsssAE4b3G648pxnqqhu5/rq/Sokutx2YkXHpSgGA0coyrstVNUJWd7TIO7sucNn1uGwq5VYkw4b8pqJasKq1qXNjgCV+2YJrrm33aDerj13bDHhmltMrOPQJ2Zcr5gMexUVEqtxV1GOz00B/Trh//DxEgCB2KVMAAAAAElFTkSuQmCC"
  };

  /* Quale macchina sta sul palco. Si ricorda l'ultima usata: dopo un tiro si
     torna a vedere QUELLA, non sempre la prima. */
  let gachaScelto = "MOVE";
  /* Quante uova per tiro. Nell'originale il gacha ha il tiro singolo e quello
     da dieci: con i voucher che si accumulano, tirare uno alla volta e' solo
     un tocco ripetuto trenta volte. */
  let gachaQuante = 1;

  function showGacha(result, dove) {
    game.phase = "GACHA";
    const canPull = meta.vouchers > 0;
    const evid = specieInEvidenza();
    if (result && result.tipo) gachaScelto = result.tipo;
    // il blocco da dieci si puo' scegliere solo se i voucher bastano
    if (gachaQuante > meta.vouchers) gachaQuante = 1;
    /* 🔴 Prima l'uovo appena preso RESTAVA sul palco fino al tiro dopo, e
       della macchina non c'era traccia: sembrava una schermata di inventario,
       non un gacha. Adesso la macchina c'è sempre, l'uovo esce da lei e con
       «Continua» sparisce, lasciando la macchina pronta per il prossimo. */
    // con un blocco appena tirato il palco mostra il MUCCHIO, non un uovo solo
    const blocco = result && Array.isArray(result.blocco) ? result.blocco : null;
    const tipoPalco = result ? result.tipo : gachaScelto;
    const macchina = `<div class="gacha-macchina${result ? " scuote" : ""}"
        style="background-image:url('${GACHA_IMG[tipoPalco] || GACHA_IMG.MOVE}')">
        ${result ? `<span class="gacha-uovo egg-sprite egg-${result.tier}"></span>` : ""}
      </div>`;
    /* Col blocco da dieci non ha senso una riga sola: si mostra il conto per
       qualita', che e' l'unica cosa che si vuole sapere davvero. */
    const riepilogo = () => {
      const conta = {};
      for (const u of blocco) conta[u.tier] = (conta[u.tier] || 0) + 1;
      return Object.keys(EGG_TIERS).filter(t => conta[t])
        .map(t => `<span class="tier-${t}">${conta[t]}× ${EGG_TIERS[t].it}</span>`).join(" · ");
    };
    const stage = blocco
      ? `${macchina}
         <div class="gacha-result">${blocco.length} uova!</div>
         <div class="meta-sub">${riepilogo()}</div>`
      : result
      ? `${macchina}
         <div class="gacha-result">È un <span class="tier-${result.tier}">Uovo ${EGG_TIERS[result.tier].it}</span>!</div>
         <div class="meta-sub">dal ${GACHA[result.tipo].emoji} ${GACHA[result.tipo].it} · si schiude superando ${result.waves} ondate</div>`
      : `${macchina}
         <div class="meta-sub">Scegli la macchina: cambia cosa è più probabile che l'uovo ti dia.</div>`;
    /* Col risultato a schermo non si rimostrano le tre macchine: si offre di
       rifare lo STESSO tiro, o di togliere l'uovo di mezzo. */
    const macchine = result
      ? `<button class="meta-btn gacha macchina" data-g="${result.tipo}" ${canPull ? "" : "disabled"}>
           <span class="mac-tit">🎰 Ancora ${GACHA[result.tipo].emoji}</span>
           <span class="mac-sub">${canPull ? "un altro tiro alla stessa macchina" : "non hai più voucher"}</span>
         </button>
         <button class="meta-btn ghost" data-a="chiudi">
           <span class="mac-tit">✓ Continua</span></button>`
      : `<div class="gacha-quante">
           ${[1, 10].map(n => `<button class="chip filtro-chip${gachaQuante === n ? " on" : ""}"
             data-q="${n}" ${meta.vouchers >= n ? "" : "disabled"}
             title="${meta.vouchers >= n ? "" : "servono " + n + " voucher"}">×${n}</button>`).join("")}
         </div>`
        + Object.keys(GACHA).map(k => {
        const sub = k === "LEGENDARY" && evid
          ? `in evidenza oggi: <b>${S[evid].it}</b>` : GACHA[k].sub;
        return `<button class="meta-btn gacha macchina" data-g="${k}" ${meta.vouchers >= gachaQuante ? "" : "disabled"}>
            <span class="mac-tit">${GACHA[k].emoji} ${GACHA[k].it}</span>
            <span class="mac-sub">${gachaQuante > 1 ? gachaQuante + " uova in un colpo · " : ""}${sub}</span>
          </button>`;
      }).join("");
    showMetaScreen(`
      <div class="meta-title">Gacha Uova</div>
      <div class="meta-stats"><span>🎟 ${meta.vouchers} voucher</span></div>
      <div class="gacha-stage">${stage}</div>
      <div class="macchine">${macchine}</div>
      <div class="meta-actions"><button class="meta-btn ghost" data-a="back">Indietro</button></div>`);
    metaEl().querySelectorAll("[data-q]").forEach(b => b.onclick = () => {
      if (b.disabled) return;
      gachaQuante = parseInt(b.dataset.q, 10);
      showGacha(null, dove);
    });
    metaEl().querySelectorAll(".macchina").forEach(b => b.onclick = () => {
      const quante = result ? 1 : gachaQuante;      // il tasto «Ancora» tira uno
      if (meta.vouchers < quante) return;
      gachaScelto = b.dataset.g;
      meta.vouchers -= quante;
      const usciti = [];
      for (let i = 0; i < quante; i++) usciti.push(pullEgg(b.dataset.g));
      saveMeta();
      const ultimo = usciti[usciti.length - 1];
      showGacha(quante > 1 ? Object.assign({}, ultimo, { blocco: usciti }) : ultimo, dove);
    });
    const chiudi = metaEl().querySelector('[data-a="chiudi"]');
    if (chiudi) chiudi.onclick = () => showGacha(null, dove);   // via l'uovo, torna la macchina
    metaEl().querySelector('[data-a="back"]').onclick = dove || showHome;
  }

  function showEggs(dove) {
    game.phase = "EGGS";
    const list = meta.eggs.length
      ? `<div class="egg-list">${meta.eggs.slice().sort((a, b) => a.waves - b.waves).map(e =>
          `<div class="egg-row"><span class="egg-sprite egg-${e.tier}" style="width:34px;height:36px;background-size:167px auto;"></span><span class="en tier-${e.tier}">${(GACHA[e.tipo] || GACHA.MOVE).emoji} Uovo ${EGG_TIERS[e.tier].it}</span><span class="ew">tra ${e.waves} ondate</span></div>`).join("")}</div>`
      : `<div class="meta-empty">Nessun uovo in incubazione.<br>Vai al Gacha per ottenerne!</div>`;
    const unlocked = Object.keys(meta.unlocked).filter(k => S[k]);
    showMetaScreen(`
      <div class="meta-title">Le mie Uova</div>
      <div class="meta-sub">le uova si schiudono superando le ondate (anche tra run diverse)</div>
      ${list}
      <div class="meta-sub" style="margin-top:2vh">Starter sbloccati (${unlocked.length})</div>
      <div class="unlock-grid">${unlocked.map(k => `<span class="unlock-chip">${meta.unlocked[k] === 2 ? "✨" : ""}${S[k].it}</span>`).join("")}</div>
      <div class="meta-actions"><button class="meta-btn ghost" data-a="back">Indietro</button></div>`);
    metaEl().querySelector('[data-a="back"]').onclick = showHome;
  }

  // Fa avanzare la schiusa di 1 ondata su tutte le uova; le schiuse sbloccano
  // una specie del loro tier come starter. Ritorna i messaggi di schiusa.
  /* ======================================================================
     SCHIUSA — l'uovo dondola, si crepa, lampo, e nasce il Pokémon.

     Prima era solo una riga di testo in mezzo alla narrazione: la cosa più
     rara del gioco passava inosservata. Ora è una schermata sua, con lo
     sprite del nato. Le notizie che seguono (caramella, mossa da uovo,
     abilità nascosta) restano nella narrazione, ma dopo la schiusa: prima
     l'evento, poi il bottino.
     ⚠️ Come per le evoluzioni, le schiuse si mettono in coda: `tickEggs` è
     chiamata mentre si costruiscono i messaggi, l'animazione arriva dopo.
     ====================================================================== */
  function animaSchiusa(nato, poi) {
    const scena = document.getElementById("scene");
    if (!scena) { poi(); return; }
    const sp = S[nato.sp];
    const ov = document.createElement("div");
    ov.id = "evo-overlay";              // stessa cornice buia dell'evoluzione
    ov.innerHTML = `<div class="hatch-egg egg-sprite big egg-${nato.tier}"></div>
                    <div class="evo-testo">Un uovo si sta schiudendo…</div>
                    <div class="evo-prompt" hidden>tocca per continuare <span class="cont pronto">▸</span></div>`;
    scena.appendChild(ov);
    const uovo = ov.querySelector(".hatch-egg");
    game.phase = "MESSAGE";
    cmd().innerHTML = `<div class="msgbox"><div class="log-line">Un uovo ${(GACHA[nato.tipo] || GACHA.MOVE).emoji} si muove…</div></div>`;

    let tmr = null;
    const chiudi = () => { clearTimeout(tmr); ov.remove(); poi(); };
    // tre dondolii che stringono, poi il lampo e il nuovo arrivato
    const scosse = [520, 420, 340];
    let i = 0;
    const scuoti = () => {
      if (i >= scosse.length) return nascita();
      uovo.classList.remove("scuote"); void uovo.offsetWidth; uovo.classList.add("scuote");
      tmr = setTimeout(scuoti, scosse[i++]);
    };
    const nascita = () => {
      loadSprite(sp.dex, "front", nato.shiny, false, nato.shinyVar).then(s => {
        uovo.classList.remove("scuote");
        uovo.classList.add("crepa");
        tmr = setTimeout(() => {
          if (s) {
            const k = Math.min(2.6, 150 / s.frame.h, 150 / s.frame.w);
            uovo.className = "hatch-nato";
            uovo.style.width = (s.frame.w * k) + "px";
            uovo.style.height = (s.frame.h * k) + "px";
            uovo.style.backgroundImage = `url("${s.sheet}")`;
            uovo.style.backgroundPosition = `-${s.frame.x * k}px -${s.frame.y * k}px`;
            uovo.style.backgroundSize = `${s.sheet_w * k}px ${s.sheet_h * k}px`;
          }
          ov.querySelector(".evo-testo").textContent =
            `È nato ${sp.it}${nato.shiny ? " ✨" : ""}!`;
          /* 🔴 IL TOCCO PER PROSEGUIRE VA DENTRO L'OVERLAY.
             Prima stava nella `msgbox` della fascia comandi — che è SOTTO
             `#evo-overlay` (`position: fixed; inset: 0; z-index: 40`). Il tocco
             finiva sull'overlay e non arrivava mai al bersaglio: chi faceva
             schiudere un uovo restava chiuso nella schermata «È nato X!» senza
             alcun modo di uscirne, e l'unica via era chiudere l'app.
             L'evoluzione non ne soffriva perché il suo tasto è già dentro
             l'overlay — ed è esattamente la stessa lezione, scritta nel CSS di
             `.evo-stop`: «il tasto vive DENTRO l'overlay, la fascia comandi ci
             sta sotto». Qui non era stata applicata.
             ⚠️ Regola: qualunque cosa da toccare, mentre `#evo-overlay` è a
             schermo, deve stare dentro `#evo-overlay`. */
          cmd().innerHTML = `<div class="msgbox"><div class="log-line">È nato ${sp.it}${nato.shiny ? " ✨CROMATICO" : ""}!</div></div>`;
          const pr = ov.querySelector(".evo-prompt");
          if (pr) pr.hidden = false;
          ov.addEventListener("click", chiudi);
        }, 420);
      }).catch(chiudi);
    };
    scuoti();
  }

  /* Coda delle schiuse: una alla volta, poi le notizie che ne conseguono. */
  function processHatches(done) {
    const nato = (game.pendingHatches || []).shift();
    if (!nato) { done(); return; }
    animaSchiusa(nato, () => {
      queueMessages(nato.extra || [], () => offriNato(nato, () => processHatches(done)));
    });
  }

  /* 🔴 Il nato può SCENDERE IN CAMPO, non solo finire nel dex.
     ⚠️ Qui si è scelto di allontanarsi dall'originale, dove una schiusa
     sblocca la specie come starter e basta: il Pokemon non entra nella run in
     corso. Il proprietario lo vuole utilizzabile subito, ed è una richiesta
     sua — se un giorno sembrasse troppo generoso, il punto da toccare è questo.
     Entra al livello dell'ondata, come farebbe un selvatico catturato adesso:
     al livello 1 dell'originale, a metà run, sarebbe solo un peso. */
  function offriNato(nato, poi) {
    if (!nato.nato || !game.player || !S[nato.sp]) { poi(); return; }
    /* 🔴 A squadra piena le uniche scelte erano «nel box» o «lascia
       stare»: non c'era modo di METTERLO IN SQUADRA al posto di qualcuno.
       Adesso si passa da `accogliPokemon`, la stessa strada di una cattura:
       se c'è posto entra, se non c'è si apre la schermata di chi cede il
       posto — che il PC ce l'ha già come alternativa. */
    const sp = S[nato.sp];
    const pieno = game.party.length >= PARTY_MAX;
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">${sp.it}${nato.shiny ? " ✨" : ""} è nato!</div>
      <div class="meta-sub">vuoi portarlo con te in questa run?</div>
      <div class="cap-info">
        <div class="cap-riga nuovo">🥚 IV da uovo: il meglio di due tiri</div>
        ${pieno ? `<div class="cap-riga">la squadra è al completo: sceglierai chi gli cede il posto</div>` : ""}
      </div>
      <div class="meta-actions two-col">
        <button class="meta-btn primary" data-act="si">➕ Portalo con te</button>
        <button class="meta-btn ghost" data-act="no">Lascia stare</button>
      </div>`);
    const chiudi = () => { hideMeta(); poi(); };
    metaEl().querySelector('[data-act="no"]').onclick = chiudi;
    metaEl().querySelector('[data-act="si"]').onclick = () => {
      /* ⚠️ LIVELLO 1, come nell'originale (`addPlayerPokemon(species, 1, ...)`).
         Da solo sarebbe un peso morto a meta' run: a compensare c'e' il
         recupero rapido in `assegnaEsperienza`, che da' molta piu' esperienza
         a chi e' molto sotto il tetto dell'ondata. */
      const mon = makeFighter(nato.sp, 1, {
        shiny: nato.shiny, shinyVar: nato.shinyVar,
        ivs: nato.nato.ivs, abilIndex: nato.nato.abilIndex,
      });
      if (nato.nato.nature) { mon.nature = nato.nato.nature; recomputeStats(mon); }
      const msgs = [];
      accogliPokemon(mon, msgs, "");
      hideMeta();
      // a squadra piena `accogliPokemon` mette in coda la scelta del posto
      queueMessages(msgs, () => chiediPostoInSquadra(poi));
    };
  }

  function tickEggs(messages) {
    if (!meta.eggs.length) return;
    const hatched = [];
    for (const egg of meta.eggs) { egg.waves--; if (egg.waves <= 0) hatched.push(egg); }
    if (hatched.length) {
      meta.eggs = meta.eggs.filter(e => e.waves > 0);
      game.pendingHatches = game.pendingHatches || [];
      for (const egg of hatched) {
        const tipo = egg.tipo || "MOVE";
        /* SPECIE: il gacha LEGGENDARIO, su un uovo di tier leggendario, ha il
           50% di dare la specie in evidenza di quel giorno (come `rollSpecies`). */
        let sp = null;
        if (tipo === "LEGENDARY" && egg.tier === "LEGENDARY" && egg.evidenza
            && S[egg.evidenza] && Math.random() < 0.5) {
          sp = egg.evidenza;
        } else {
          const pool = speciesOfTier(egg.tier);
          sp = pool[Math.floor(Math.random() * pool.length)];
        }
        // CROMATICO: 1/128, ma il gacha cromatico raddoppia (1/64)
        const tassoShiny = tipo === "SHINY" ? TASSO_SHINY_GACHA_SU : TASSO_SHINY_GACHA;
        const shiny = Math.floor(Math.random() * tassoShiny) === 0;
        // anche le uova possono dare una livrea rara o epica (60/30/10)
        const shinyVar = shiny ? rollShinyVar(S[sp].dex, null) : 0;
        /* ⚠️ Va deciso PRIMA di scrivere nel dex se questa nascita sblocca
           davvero qualcosa: se no ogni schiusa annunciava «è sbloccato come
           starter!» anche per una specie che avevi già da un pezzo.
           🔴 E va guardato `giaStarter`, non solo `meta.unlocked`: i 27 di
           partenza non stanno nel registro, quindi il controllo vecchio li
           dava per nuovi tutte le volte. */
        const eraNuovo = !giaStarter(sp);
        const primoCromatico = shiny && (meta.unlocked[sp] || 0) < 2;
        if (!meta.unlocked[sp] || shiny) meta.unlocked[sp] = shiny ? 2 : (meta.unlocked[sp] || 1);
        // livrea più alta vista: da qui prenderà i punti di fortuna come starter
        meta.shinyVar = meta.shinyVar || {};
        const livreaMigliore = shiny && shinyVar > (meta.shinyVar[sp] || 0);
        if (livreaMigliore) meta.shinyVar[sp] = shinyVar;
        meta.stats.hatched++;
        // stessa formula della cattura, col ×2 dell'uovo (vedi `caramelleDa`)
        const dolci = caramelleDa(shiny, shinyVar, true);
        daiCaramelle(sp, dolci);
        /* La NOTIZIA della nascita non va nella narrazione: se ne occupa
           `processHatches`, che le dà una schermata con l'uovo che si apre.
           Qui si prepara solo cosa dire DOPO. */
        const dolciTxt = `🍬 +${dolci} caramell${dolci === 1 ? "a" : "e"}`;
        const extra = [eraNuovo
          ? `${S[sp].it} è sbloccato come starter! ${dolciTxt}`
          : primoCromatico
            // lo starter c'era gia': di nuovo c'e' la LIVREA, non lo starter
            ? `${S[sp].it} ✨ è il tuo primo cromatico di questa specie! ${dolciTxt}`
            : `${dolciTxt} ${S[sp].it} (totale ${meta.candy[sp]})`];
        if (livreaMigliore && shinyVar > 0 && !primoCromatico) {
          stessoMomento(extra, `💠 Livrea ${CROM_IT[shinyVar]}: come starter ora vale ${shinyVar + 1} punti di fortuna`);
        }
        /* ABILITÀ NASCOSTA: 1 su 192, come `GACHA_EGG_HA_RATE`. È l'altra via
           per sbloccarla, oltre a catturare un esemplare che ce l'ha. */
        const conHA = S[sp].abilities.hidden && Math.floor(Math.random() * GACHA_EGG_HA_RATE) === 0;
        if (conHA) {
          const nuova = registraAbilita(rootOf(sp), 2);
          if (nuova) stessoMomento(extra, `🔓✨ È nato con l'abilità NASCOSTA: ${nuova.it} sbloccata per ${S[sp].it}!`);
        }
        /* Anche il nato ha la sua NATURA, e nascendo la sblocca per la specie:
           è l'altra via per riempire la scheda, oltre alle catture. */
        const natNata0 = rollNature();
        const natNata = registraNatura(rootOf(sp), natNata0);
        if (natNata) stessoMomento(extra, `🌱 È nato di natura ${natNata}: sbloccata per ${S[sp].it}!`);
        /* Anche il SESSO del nato entra nel dex: è l'altra via per sbloccare
           quello raro, oltre a catturarlo. */
        const sesNato = registraSesso(rootOf(sp), rollGender(S[sp]));
        if (sesNato) stessoMomento(extra, `${sesNato === "maschio" ? "♂" : "♀"} È nato ${sesNato}: ora puoi schierare ${S[sp].it} ${sesNato}`);
        /* Ogni schiusa sblocca UNA mossa da uovo della specie nata: e' l'unico
           modo di ottenerle, ed e' cio' che fa crescere le mosse iniziali
           selezionabili nel menu di partenza. Il gacha MOSSE rende molto piu'
           probabile che tocchi la RARA (`BOOSTED_RARE_EGGMOVE_RATES`). */
        const em = unlockEggMove(sp, egg.tier, tipo === "MOVE");
        if (em) {
          stessoMomento(extra, em.rara
            ? `🥚✨ ${S[sp].it} ha imparato la mossa da uovo RARA ${em.it}!`
            : `🥚 ${S[sp].it} ha imparato la mossa da uovo ${em.it}!`);
        }
        /* Chi è nato, per davvero: serve a costruirlo se lo si vuole in
           squadra (vedi `offriNato`). Gli IV sono il MEGLIO di due tiri, come
           nell'originale (`Math.max(ret.ivs[s], secondaryIvs[s])`): è il
           vantaggio vero delle uova rispetto a una cattura qualsiasi. */
        const a = rollIVs(), b = rollIVs(), ivsNato = {};
        for (const k in a) ivsNato[k] = Math.max(a[k], b[k]);
        recordIVs(sp, ivsNato);
        game.pendingHatches.push({ sp, shiny, shinyVar, tipo, tier: egg.tier, extra,
                                   nato: { ivs: ivsNato, nature: natNata0, abilIndex: conHA ? 2 : null } });
      }
    }
    saveMeta();
  }

  /* ---------------------------------------------------------------------- */
  /*  MYSTERY ENCOUNTER — NPC con scelte (stile PokeRogue)                  */
  /* ---------------------------------------------------------------------- */
  const ME_STATS = ["atk", "def", "spatk", "spdef", "spd", "hp"];
  const meRandStat = () => ME_STATS[Math.floor(Math.random() * ME_STATS.length)];

  /* ----------------------------------------------------------------------
     ATTREZZI PER GLI INCONTRI
     Servono a scrivere i 31 incontri in modo compatto e uniforme.
     ---------------------------------------------------------------------- */
  const rndOf = a => a[Math.floor(Math.random() * a.length)];

  // Il piu' veloce / il piu' forte / il piu' alto di livello della squadra
  function bestBy(stat) {
    const vivi = aliveParty();
    return vivi.reduce((a, b) => ((b.stats[stat] || 0) > (a.stats[stat] || 0) ? b : a), vivi[0]);
  }
  const fastest = () => bestBy("spd");
  const strongest = () => aliveParty().reduce((a, b) => (b.level > a.level ? b : a), aliveParty()[0]);

  /* 🔴 UN POKEMON CHE ARRIVA DA UN INCONTRO.
     Sette incontri (il Venditore, l'Allevatrice, la Zona Safari, Avarizia,
     Oricorio, Greedent...) ti regalavano o vendevano un Pokemon facendo due
     cose sbagliate:
       · a squadra piena finiva DRITTO NEL BOX, senza nemmeno fartelo vedere;
       · nel dex ci finiva a mano (`meta.unlocked[k] = 1`) o per niente, quindi
         niente messaggio «sbloccato come starter», niente caramella, niente
         abilita'/natura/sesso registrati, e soprattutto niente CAPOSTIPITE:
         prendere un evoluto non sbloccava lo starter da cui viene.
     Adesso passano tutti di qui, che fa esattamente quello che fa una
     cattura: `registerCaught` per il dex e `accogliPokemon` per il posto.
     I messaggi tornano indietro a chi chiama, che li accoda al suo. */
  function arrivaDaIncontro(mon, testo) {
    const msgs = [];
    registerCaught(mon.speciesId, mon.shiny, mon.ivs, msgs, mon.variant,
                   mon.abilIndex, mon.nature, mon.shinyVar, mon.gender, false);
    accogliPokemon(mon, msgs, "");
    saveMeta();
    return [testo].concat(msgs.map(m => (typeof m === "string" ? m : m.text))).join("\n");
  }

  // Un Pokemon avversario per l'incontro: livello dell'ondata, con moltiplicatore
  function encFoe(speciesId, mult, opts) {
    const lvl = Math.max(START_LEVEL, Math.round(enemyLevelFor(game.wave) * (mult || 1)));
    return makeFighter(speciesId || specieDaIncontro(null), lvl, opts || {});
  }

  /* Avvia una LOTTA nata da un incontro. `reward` viene eseguita quando la
     lotta e' vinta e il suo testo finisce nei messaggi di fine ondata. */
  function encBattle(fighter, introText, reward) {
    game.encReward = reward || null;
    hideMeta();
    const msgs = introText ? [introText] : [];
    deployEnemy(fighter, msgs);
    renderScene();
    loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
    queueMessages(msgs, () => { game.phase = "CHOICE"; showMainMenu(); });
  }

  // Dai un premio pescato dal pool vero, di un tier preciso
  function encReward(tier, quante) {
    const nomi = [];
    for (let i = 0; i < (quante || 1); i++) {
      const pool = REWARD_POOL.filter(x => x.tier === tier && x.weight > 0 && (!x.avail || x.avail()));
      const item = pool.length ? rndOf(pool) : REWARD_POOL.find(x => x.id === "balls");
      const pk = fillPick(item) || fillPick(REWARD_POOL.find(x => x.id === "balls"));
      pk.item.apply(bestBy("hp") || game.player, pk);
      nomi.push(pk.label);
    }
    return nomi.join(", ");
  }
  // Dai un oggetto preciso per id
  function encGive(id, quante) {
    const item = REWARD_POOL.find(x => x.id === id);
    if (!item) return "";
    for (let i = 0; i < (quante || 1); i++) {
      const pk = fillPick(item);
      if (pk) pk.item.apply(game.player, pk);
    }
    return item.label;
  }
  // Bacche a caso sparse nella squadra
  function encBerries(n) {
    for (let i = 0; i < n; i++) addBerry(rndOf(game.party), rndOf(BERRY_KEYS));
    return n;
  }
  function encDamageParty(frac) {
    for (const p of game.party) if (!p.fainted) p.hp = Math.max(1, p.hp - Math.floor(p.maxHp * frac));
  }
  function encEgg(n) { meta.vouchers += (n || 1); saveMeta(); }
  const encMoney = m => { const v = waveMoney(m); game.money += v; return v; };
  /* Soglia di "prova di statistica" per l'ondata corrente: gli incontri che
     mettono alla prova Velocita'/Attacco la confrontano con la stat del
     Pokemon scelto. Tarata sul livello dei nemici dell'ondata. */
  const encSoglia = (k) => Math.round(enemyLevelFor(game.wave) * (k || 2.2)) + 25;

  /* Gli incontri sono ricostruiti sui file reali di
     `src/data/mystery-encounters/encounters/` dell'originale: stessi prezzi
     (multipli del denaro d'ondata), stesse probabilita', stessi effetti.
     Dove una meccanica da noi non esiste (le NATURE) il resto e' invariato. */
  /* ----------------------------------------------------------------------
     I 31 INCONTRI MISTERIOSI
     Ricostruiti su `src/data/mystery-encounters/encounters/` dell'originale:
     stesso tier, stesse opzioni, stessi requisiti d'onda, e i TESTI ITALIANI
     UFFICIALI presi da `locales/it/mystery-encounters/`.
     Dove una meccanica da noi non esiste (nature, MT, mosse insegnabili) l'ho
     sostituita con l'equivalente piu' vicino: e' segnalato nei commenti.

     Campi: tier · waves [min,max] · cond() requisito · setup(enc) ·
            options / optionsFor(enc)
     ---------------------------------------------------------------------- */
  const MYSTERY_ENCOUNTERS = [

    /* ========================= COMMON (13) ========================= */
    {
      // shady-vitamin-dealer — 2 vitamine; l'offerta economica costa meta' PS max
      id: "dealer", tier: "COMMON", emoji: "💊", npc: "worker_m", title: "Il Commerciante di Vitamine",
      text: "Un tipo sospetto ti offre vitamine a poco prezzo… ma le fialette non sembrano sigillate.",
      cond: () => game.party.some(p => !p.fainted && p.hp / p.maxHp > 0.5) && game.money >= waveMoney(1.5),
      setup(e) { e._cheap = waveMoney(1.5); e._exp = waveMoney(5); },
      optionsFor(e) {
        const due = p => { boostBase(p, meRandStat()); boostBase(p, meRandStat()); };
        const sano = () => game.party.filter(p => !p.fainted && p.hp / p.maxHp > 0.5)[0];
        return [
          { label: "Accordo economico", sub: `₽${e._cheap} · 2 vitamine, ma ci sono effetti collaterali`,
            cond: () => game.money >= e._cheap,
            run() { game.money -= e._cheap; const p = sano(); due(p);
              p.hp = Math.max(1, p.hp - Math.floor(p.maxHp / 2));
              // come nell'originale la roba adulterata gli cambia anche la NATURA
              const vecchia = NATURES[p.nature].it;
              let n = rollNature(); while (n === p.nature) n = rollNature();
              p.nature = n; recomputeStats(p);
              return `${p.name} prende due vitamine e si potenzia… ma la roba era adulterata: perde metà dei PS e da ${vecchia} diventa ${NATURES[n].it}!`; } },
          { label: "Accordo costoso", sub: `₽${e._exp} · 2 vitamine, nessun rischio`,
            cond: () => game.money >= e._exp,
            run() { game.money -= e._exp; const p = sano(); due(p);
              return `${p.name} prende due vitamine di qualità e si potenzia!`; } },
          { label: "Vai via", run: () => "Meglio non fidarsi. Prosegui." },
        ];
      },
    },
    {
      // mysterious-chest — 30 trappola · 25 comune · 30 ultra · 10 rogue · 5 master
      id: "chest", tier: "COMMON", emoji: "🎁", title: "Il Forziere Misterioso",
      text: "Un forziere dorato brilla nell'erba alta. Potrebbe contenere un tesoro… o una trappola.",
      options: [
        { label: "Aprilo", sub: "30% qualcosa di terribile · 70% ricompense", run() {
            const roll = Math.floor(Math.random() * 100);
            if (roll < 30) {
              const vivi = aliveParty();
              if (!vivi.length) return "Il forziere era vuoto.";
              const v = strongest();
              v.hp = 0; v.fainted = true;
              return `Era una trappola! ${v.name} viene messo KO all'istante!`;
            }
            const tier = roll < 55 ? "COMMON" : roll < 85 ? "ULTRA" : roll < 95 ? "ROGUE" : "MASTER";
            return `Dentro c'è un tesoro: ${encReward(tier)}!`;
          } },
        { label: "Troppo rischioso, vai via", run: () => "Non ti fidi e prosegui." },
      ],
    },
    {
      // berries-abound — un guardiano sorveglia il cespuglio; opzione 2 = gara di velocita'
      id: "berries", tier: "COMMON", emoji: "🫐", npc: "breeder_f", title: "Bacche in Abbondanza",
      text: "Sembra che ci sia un Pokémon a fare la guardia al cespuglio di bacche.",
      setup(e) { e._n = 3 + Math.floor(Math.random() * 3); e._mon = encFoe(null, 1.15, { boss: false }); },
      optionsFor(e) {
        return [
          { label: "Affronta il Pokémon", sub: `combattimento difficile · ${e._n} bacche`,
            run() { const n = e._n;
              encBattle(e._mon, `${e._mon.name} difende il cespuglio!`, () => `Raccogli ${encBerries(n)} bacche dal cespuglio!`);
              return null; } },
          { label: "Corri verso il cespuglio", sub: `${fastest().name} usa la sua Velocità`, run() {
              const v = fastest();
              if (v.stats.spd / (e._mon.stats.spd * 1.1) >= 1) return `${v.name} è fulmineo: ${encBerries(e._n)} bacche rubate senza un graffio!`;
              v.hp = Math.max(1, v.hp - Math.floor(v.maxHp * 0.4));
              return `${v.name} viene beccato sul fatto! Scappa con ${encBerries(1)} bacca sola e qualche livido.`; } },
          { label: "Vai via", run: () => "Lasci le bacche agli altri viaggiatori." },
        ];
      },
    },
    {
      // department-store-sale — 4 reparti. Le MT da noi non esistono: quel
      // reparto vende bacche (l'unico consumabile equivalente che abbiamo).
      id: "store", tier: "COMMON", emoji: "🛍️", npc: "clerk_m", title: "Promozioni al Centro Commerciale",
      text: "C'è merce da ogni parte! Hai un coupon: puoi usarlo in uno solo dei reparti.",
      waves: [10, 100],
      options: [
        { label: "Negozio di MT", sub: "una MT scontata", cond: () => !!randomTm("GREAT"),
          run() { const tm = randomTm("GREAT"); insegnaTm(tm);
            return `Approfitti dell'offerta: MT ${M[tm].it}!`; } },
        { label: "Negozio di Vitamine", sub: "2 vitamine", run() {
            const p = rndOf(aliveParty()); boostBase(p, meRandStat()); boostBase(p, meRandStat());
            return `Due vitamine in saldo: ${p.name} si potenzia!`; } },
        /* 🔴 Diceva ancora «Poteslot»: e' il vecchio nome sbagliato degli
           STRUMENTI X, corretto ovunque tranne qui.
           ⚠️ E pescava da `meRandStat()`, che comprende i PS: un potenziamento
           ai PS non esiste (`stages` non ha `hp`) e quel ramo regalava un
           turno di niente. Gli strumenti X hanno le LORO statistiche, PS
           escluso e precisione compresa: `XITEM_KEYS`. */
        { label: "Negozio di strumenti per la Lotta", sub: "2 strumenti X", run() {
            const a = rndOf(XITEM_KEYS), b = rndOf(XITEM_KEYS);
            game.tempBoost[a] = 5; game.tempBoost[b] = 5;
            const nomi = a === b ? XITEMS[a].it : `${XITEMS[a].it} e ${XITEMS[b].it}`;
            return `Approfitti dell'offerta: ${nomi} per 5 ondate!`; } },
        { label: "Negozio di Pokéball", sub: "un bel po' di ball", run() {
            game.balls += 5; game.greatballs += 3; game.ultraballs += 2;
            return "Riempi lo zaino: 5 Poké Ball, 3 Mega Ball e 2 Ultra Ball!"; } },
      ],
    },
    {
      // field-trip — mostri una mossa alla maestra: se la categoria e' quella
      // che cercava, il premio e' ottimo; altrimenti e' di consolazione.
      id: "fieldtrip", tier: "COMMON", emoji: "🎒", npc: "breeder_f", title: "Gita Scolastica",
      text: "Una maestra ti chiede di mostrare una mossa ai suoi alunni. Quale gli fai vedere?",
      waves: [10, 100],
      setup(e) { e._cerca = rndOf(["PHYSICAL", "SPECIAL", "STATUS"]); },
      optionsFor(e) {
        const prova = (cat, nome) => ({
          label: nome, sub: "mostra una mossa " + nome.toLowerCase(),
          cond: () => game.player.moves.some(m => M[m.id].category === cat),
          run() {
            const mossa = game.player.moves.find(m => M[m.id].category === cat);
            if (cat === e._cerca) return `${M[mossa.id].it} è esattamente quello che cercava! Ricevi: ${encReward("ULTRA")}!`;
            return `${M[mossa.id].it} non era quello che si aspettava… ma ti ringrazia lo stesso: ${encReward("COMMON")}.`;
          },
        });
        return [prova("PHYSICAL", "Mossa Fisica"), prova("SPECIAL", "Mossa Speciale"),
                prova("STATUS", "Mossa di Stato"),
                { label: "Vai via", run: () => "Saluti la classe e prosegui." }];
      },
    },
    {
      // fiery-fallout — due Volcarona scatenano un'ondata di calore
      id: "fiery", tier: "COMMON", emoji: "🔥", mon: "VOLCARONA", title: "Passione Ardente",
      text: "Un caldo innaturale avvolge la zona. Qualcosa, poco più avanti, sta bruciando.",
      waves: [40, 180],
      setup(e) { e._mon = encFoe("VOLCARONA", 1.2, { boss: true }); },
      optionsFor(e) {
        const fuoco = () => aliveParty().filter(p => p.types.includes("FIRE"));
        return [
          { label: "Trova la Fonte", sub: "combattimento difficile · strumento da tenere",
            run() { encBattle(e._mon, `${e._mon.name} è la fonte di tutto quel calore!`,
              () => `Fra le braci trovi: ${encGive("charcoal") || encReward("ULTRA")}!`); return null; } },
          { label: "Accovacciati", sub: "subisci il meteo, ma impari qualcosa", run() {
              encDamageParty(0.2);
              const p = rndOf(aliveParty());
              const sp = S[p.speciesId];
              const cand = (sp.abilities.normal || []).filter(a => ABIL[a]);
              if (cand.length) p.ability = ABIL[rndOf(cand)];
              return `Il calore vi sfianca (tutti perdono PS), ma ${p.name} impara ad adattarsi: ora ha ${p.ability ? p.ability.it : "una nuova abilità"}!`; } },
          { label: "I tuoi Pokémon di Fuoco aiutano", sub: "serve un Pokémon di tipo Fuoco",
            cond: () => fuoco().length > 0,
            run() { const p = rndOf(fuoco()); addHeld(p, "leftovers");
              return `${p.name} assorbe le fiamme e placa l'incendio! Fra i resti trovi degli Avanzi.`; } },
        ];
      },
    },
    {
      // fight-or-flight — un Pokemon forte custodisce un oggetto
      id: "fightflight", tier: "COMMON", emoji: "⚔️", monGenerato: true, title: "Lotta o Scappa",
      text: "Un Pokémon dall'aria minacciosa sorveglia qualcosa di luccicante.",
      setup(e) { e._mon = encFoe(null, 1.25, { boss: true }); },
      optionsFor(e) {
        const v = fastest();
        return [
          { label: "Affronta il Pokémon", sub: "combattimento difficile · nuovo strumento",
            run() { encBattle(e._mon, `${e._mon.name} non ha nessuna intenzione di cederlo!`,
              () => `Il tesoro è tuo: ${encReward("ULTRA")}!`); return null; } },
          { label: "Ruba l'oggetto", sub: `${v.name} usa la sua Velocità`, run() {
              if (v.stats.spd / (e._mon.stats.spd * 1.1) >= 1) return `${v.name} lo afferra e scappa: ${encReward("GREAT")}!`;
              v.hp = Math.max(1, v.hp - Math.floor(v.maxHp * 0.5));
              return `${e._mon.name} lo vede arrivare e lo respinge! ${v.name} se la vede brutta.`; } },
          { label: "Vai via", run: () => "Meglio non rischiare." },
        ];
      },
    },
    {
      // global-trade-system — scambi alla GTS
      id: "gts", tier: "COMMON", emoji: "🌐", npc: "clerk_m", title: "La GTS",
      text: "Un terminale della GTS è ancora acceso. Puoi ancora fare uno scambio.",
      cond: () => game.party.length > 1,
      options: [
        { label: "Controlla le offerte di scambio", sub: "scambia un tuo Pokémon con uno migliore", run() {
            const i = Math.floor(Math.random() * game.party.length);
            const vecchio = game.party[i];
            const nuovo = makeFighter(specieDaIncontro(vecchio.speciesId), vecchio.level, { shiny: rollShiny() });
            game.party[i] = nuovo;
            if (game.active >= game.party.length) game.active = 0;
            game.player = game.party[game.active];
            if (!meta.unlocked[nuovo.speciesId]) { meta.unlocked[nuovo.speciesId] = nuovo.shiny ? 2 : 1; saveMeta(); }
            return `Scambio concluso: ${vecchio.name} parte, arriva ${nuovo.name}!`; } },
        { label: "Scambio Prodigioso", sub: "un Pokémon a caso, in cambio di uno a caso", run() {
            const i = Math.floor(Math.random() * game.party.length);
            const vecchio = game.party[i];
            const nuovo = makeFighter(specieDaIncontro(null), vecchio.level + 3, { shiny: Math.random() < 0.05 || rollShiny() });
            game.party[i] = nuovo;
            game.player = game.party[game.active] || game.party[0];
            if (!meta.unlocked[nuovo.speciesId]) { meta.unlocked[nuovo.speciesId] = nuovo.shiny ? 2 : 1; saveMeta(); }
            return `Scambio Prodigioso! ${vecchio.name} vola via… e arriva ${nuovo.name}!`; } },
        { label: "Scambia un oggetto", sub: "un tuo strumento per uno migliore", run() {
            const p = aliveParty().find(x => Object.keys(x.held || {}).length);
            if (!p) return "Non hai strumenti da scambiare: il terminale si spegne.";
            const k = Object.keys(p.held)[0];
            delete p.held[k];
            return `Cedi ${nomeHeld(k)} e in cambio ricevi: ${encReward("ROGUE")}!`; } },
        { label: "Vai via", run: () => "Spegni il terminale." },
      ],
    },
    {
      // lost-at-sea — serve un Pokemon d'Acqua o Volante per uscirne
      id: "lostsea", tier: "COMMON", emoji: "🌊", mon: "LAPRAS", title: "Perso nel Mare",
      text: "La nebbia si è alzata e hai perso l'orientamento. L'acqua è ovunque.",
      optionsFor() {
        const acqua = aliveParty().filter(p => p.types.includes("WATER"));
        const volo = aliveParty().filter(p => p.types.includes("FLYING"));
        const o = [];
        if (acqua.length) o.push({ label: `${acqua[0].name} potrebbe aiutare`, sub: "ti guida a riva · guadagna livelli",
          run() { const p = acqua[0]; addLevels(p, 1); return `${p.name} nuota davanti alla barca e ti riporta a riva! Guadagna esperienza.`; } });
        if (volo.length) o.push({ label: `${volo[0].name} potrebbe aiutare`, sub: "vola in ricognizione · guadagna livelli",
          run() { const p = volo[0]; addLevels(p, 1); return `${p.name} si alza in volo e trova la rotta! Guadagna esperienza.`; } });
        o.push({ label: "Vaga senza meta", sub: "tutta la squadra perde il 25% dei PS",
          run() { encDamageParty(0.25); return "Vaghi per ore prima di ritrovare la costa: tutti sono sfiniti."; } });
        return o;
      },
    },
    {
      // part-timer — tre lavoretti, pagati in base a una statistica
      id: "parttimer", tier: "COMMON", emoji: "📦", npc: "worker_m", title: "Lavoro Part-Time",
      text: "Un magazziniere cerca una mano per la giornata. Che lavoro ti prendi?",
      optionsFor() {
        const paga = (p, stat, soglia) => {
          const v = p.stats[stat] || 0;
          const bene = v >= soglia;
          const s = encMoney(bene ? 2.5 : 1);
          return { bene, s, p };
        };
        const soglia = encSoglia();
        return [
          { label: "Fare consegne", sub: `${fastest().name} usa la sua Velocità`, run() {
              const r = paga(fastest(), "spd", soglia);
              return r.bene ? `${r.p.name} vola di consegna in consegna! Guadagni ₽${r.s}.`
                            : `${r.p.name} arranca un po'… paga base: ₽${r.s}.`; } },
          { label: "Lavoro in magazzino", sub: `${bestBy("atk").name} usa la sua Forza`, run() {
              const r = paga(bestBy("atk"), "atk", soglia);
              return r.bene ? `${r.p.name} sposta casse come niente! Guadagni ₽${r.s}.`
                            : `${r.p.name} fatica con le casse pesanti. Paga base: ₽${r.s}.`; } },
          { label: "Assistente alle vendite", sub: `${bestBy("spatk").name} ci mette il carisma`, run() {
              const r = paga(bestBy("spatk"), "spatk", soglia);
              return r.bene ? `${r.p.name} incanta i clienti! Guadagni ₽${r.s}.`
                            : `${r.p.name} è un po' timido col pubblico. Paga base: ₽${r.s}.`; } },
        ];
      },
    },
    {
      // teleporting-hijinks — un macchinario che teletrasporta in un altro bioma
      id: "teleport", tier: "COMMON", emoji: "🌀", title: "Avventure con il Teletrasporto",
      text: "Uno strano macchinario ronza in mezzo al nulla. Sembra un teletrasporto a gettoni.",
      setup(e) { e._costo = waveMoney(0.75); },
      optionsFor(e) {
        const cambiaBioma = () => {
          const chiavi = Object.keys(BIOMES).filter(k => k !== game.biome && BIOMES[k]);
          game.biome = rndOf(chiavi); applyBiomeBackground();
          return BIOMES[game.biome].it;
        };
        return [
          { label: "Inserisci il denaro", sub: `₽${e._costo} · destinazione ignota`,
            cond: () => game.money >= e._costo,
            run() { game.money -= e._costo; return `Il macchinario ronza… e ti ritrovi in un posto diverso: ${cambiaBioma()}!`; } },
          { label: "Un Pokémon aiuta", sub: `${bestBy("spatk").name} alimenta la macchina`, run() {
              const p = bestBy("spatk"); addLevels(p, 1);
              return `${p.name} alimenta il macchinario e guadagna esperienza! Ti ritrovi in: ${cambiaBioma()}!`; } },
          { label: "Ispeziona il Macchinario", sub: "combattimento", run() {
              const m = encFoe(null, 1.1, {});
              encBattle(m, `Il macchinario si apre di scatto: ${m.name} era nascosto dentro!`,
                () => `Fra i circuiti trovi: ${encReward("GREAT")}!`);
              return null; } },
        ];
      },
    },
    {
      // the-strong-stuff — lo Shuckle offre il suo "succo"
      id: "strongstuff", tier: "COMMON", emoji: "🧃", mon: "SHUCKLE", title: "La Roba Forte",
      text: "Uno Shuckle enorme ti fissa. Accanto a lui, una boccia di liquido denso e dorato.",
      setup(e) { e._mon = encFoe("SHUCKLE", 1.3, { boss: true }); },
      optionsFor(e) {
        return [
          { label: "Avvicinati allo Shuckle", sub: "potrebbe accadere qualcosa di meraviglioso… o di terribile", run() {
              const p = rndOf(aliveParty());
              // come nell'originale: PS travasati nelle difese
              p.vits.def = (p.vits.def || 0) + 3; p.vits.spdef = (p.vits.spdef || 0) + 3;
              p.vits.hp = Math.max(0, (p.vits.hp || 0) - 2);
              recomputeStats(p);
              return `${p.name} beve il succo: le difese salgono moltissimo, ma i PS calano…`; } },
          { label: "Affronta lo Shuckle", sub: "combattimento difficile · ricompense speciali",
            run() { encBattle(e._mon, "Lo Shuckle difende la sua riserva!",
              () => `Nella boccia trovi: ${encReward("ROGUE")}!`); return null; } },
        ];
      },
    },
    {
      // uncommon-breed — un esemplare raro con una mossa particolare
      id: "uncommon", tier: "COMMON", emoji: "✨", monGenerato: true, title: "Una forma non comune",
      text: "Questo Pokémon ha qualcosa di diverso dagli altri della sua specie.",
      setup(e) { e._mon = encFoe(null, 1.2, { shiny: Math.random() < 0.25 }); },
      optionsFor(e) {
        const v = bestBy("spatk");
        return [
          { label: "Affronta il Pokémon", sub: "combattimento difficile · è catturabile",
            run() { encBattle(e._mon, `${e._mon.name} ti sfida!`, () => ""); return null; } },
          { label: "Dagli del cibo", sub: "offri 4 bacche · gli piacerai",
            cond: () => game.party.some(p => Object.keys(p.berries || {}).length),
            run() {
              let tolte = 0;
              for (const p of game.party) for (const k in p.berries) {
                while (p.berries[k] > 0 && tolte < 4) { p.berries[k]--; tolte++; }
                if (p.berries[k] <= 0) delete p.berries[k];
              }
              return arrivaDaIncontro(e._mon, `Offri ${tolte} bacche: ${e._mon.name} decide di seguirti!`); } },
          { label: "Fattelo amico", sub: `${v.name} prova a comunicare`, run() {
              if (v.stats.spatk >= e._mon.stats.spatk) {
                return arrivaDaIncontro(e._mon, `${v.name} lo tranquillizza: ${e._mon.name} si fida di te!`);
              }
              return `${e._mon.name} non si fida e scappa via.`; } },
        ];
      },
    },

    /* ========================= GREAT (9) ========================= */
    {
      // absolute-avarice — il Greedent ti ruba TUTTE le bacche
      id: "avarice", tier: "GREAT", emoji: "🐿️", mon: "GREEDENT", title: "Cupidigia Assoluta",
      text: "Un Greedent ti coglie di sorpresa: tutte le tue bacche sono sparite!",
      waves: [20, 180],
      setup(e) {
        e._rubate = 0;
        for (const p of game.party) for (const k in p.berries) { e._rubate += p.berries[k]; delete p.berries[k]; }
        e._mon = encFoe("GREEDENT", 1.3, { boss: true });
      },
      optionsFor(e) {
        return [
          { label: "Affrontalo", sub: "combattimento difficile · riprendi tutto",
            run() { const n = Math.max(4, e._rubate + 2);
              encBattle(e._mon, "Il Greedent gonfia le guance, pronto a difendere il bottino!",
                () => `Riprendi la scorta: ${encBerries(n)} bacche!`);
              return null; } },
          { label: "Ragiona con lui", sub: "riottieni alcune bacche", run() {
              const n = Math.max(1, Math.floor(e._rubate / 2));
              return `Il Greedent ci pensa su e te ne restituisce ${encBerries(n)}.`; } },
          { label: "Lasciagli le Bacche", sub: "gli piacerai…", run() {
              return arrivaDaIncontro(e._mon, "Il Greedent è commosso dalla tua generosità e ti segue!"); } },
        ];
      },
    },
    {
      // an-offer-you-cant-refuse — ti comprano un Pokemon
      id: "offer", tier: "GREAT", emoji: "🤝", npc: "rich_m", title: "Un'offerta che non puoi rifiutare",
      text: "Un ragazzino ben vestito ha adocchiato uno dei tuoi Pokémon e apre il portafoglio.",
      cond: () => game.party.length > 1,
      setup(e) { e._i = Math.floor(Math.random() * game.party.length); e._prezzo = waveMoney(4); },
      optionsFor(e) {
        const mon = game.party[e._i] || game.party[0];
        const v = fastest();
        return [
          { label: "Accetta l'offerta", sub: `cedi ${mon.name} · ₽${e._prezzo} + uno strumento`, run() {
              game.party.splice(game.party.indexOf(mon), 1);
              if (game.active >= game.party.length) game.active = 0;
              game.player = game.party[game.active];
              game.money += e._prezzo;
              return `${mon.name} parte col ragazzino. Ricevi ₽${e._prezzo} e ${encReward("ULTRA")}!`; } },
          { label: "Deruba il ragazzino", sub: `${v.name} usa la sua Velocità`, run() {
              if (v.stats.spd >= encSoglia(2.4)) {
                const s = encMoney(3);
                return `${v.name} sfila il portafoglio senza farsi vedere: ₽${s}!`;
              }
              return "Il ragazzino se ne accorge e scappa gridando. Niente da fare."; } },
          { label: "Vai via", run: () => "Declini l'offerta." },
        ];
      },
    },
    {
      // bug-type-superfan — l'allenatrice fissata coi Coleottero
      id: "bugfan", tier: "GREAT", emoji: "🐛", npc: "beauty", title: "La Fan n.1 del tipo Coleottero",
      text: "Un'allenatrice ti blocca parlando a raffica di Pokémon Coleottero.",
      waves: [30, 180],
      setup(e) { e._mon = encFoe("SCIZOR", 1.2, { boss: true }); },
      optionsFor(e) {
        const bug = () => aliveParty().filter(p => p.types.includes("BUG"));
        return [
          { label: "Offriti di sfidarla", sub: "combattimento difficile · impari una mossa Coleottero",
            run() { encBattle(e._mon, "« Ti mostro io cosa sanno fare i Coleottero! »", () => {
                // come nell'originale: insegna una mossa di tipo Coleottero
                const bugTm = Object.keys(TMS.tier).filter(mv => M[mv] && M[mv].type === "BUG" && chiPuoImparare(mv).length);
                if (bugTm.length) { const tm = rndOf(bugTm); insegnaTm(tm); return `Ti insegna la sua mossa preferita: MT ${M[tm].it}!`; }
                return `Sei stato bravissimo! Ricevi: ${encReward("ROGUE")}!`;
              }); return null; } },
          { label: "Mostra i tuoi Pokémon Coleottero", sub: "serve un tipo Coleottero · strumento in regalo",
            cond: () => bug().length > 0,
            run() { const p = rndOf(bug()); addHeld(p, "leftovers");
              return `Va in estasi davanti a ${p.name}! Ti regala degli Avanzi.`; } },
          { label: "Dona uno strumento Coleottero", sub: "cedi uno strumento di tipo · ricevi di meglio",
            cond: () => aliveParty().some(p => p.held && p.held.typeboost && Object.keys(p.held.typeboost).length),
            run() {
              const p = aliveParty().find(x => x.held && x.held.typeboost && Object.keys(x.held.typeboost).length);
              const t = Object.keys(p.held.typeboost)[0];
              p.held.typeboost[t]--; if (!p.held.typeboost[t]) delete p.held.typeboost[t];
              return `Le doni ${nomeTypeBoost(t)}. In cambio: ${encReward("ULTRA")}!`; } },
          { label: "Vai via", run: () => "Riesci a svignartela mentre parla ancora." },
        ];
      },
    },
    {
      // dancing-lessons — l'Oricorio che vuole ballare
      id: "dancing", tier: "GREAT", emoji: "💃", mon: "ORICORIO", title: "Lezioni di danza",
      text: "Un Oricorio si muove a tempo, come se cercasse qualcuno con cui danzare.",
      waves: [30, 180],
      setup(e) { e._mon = encFoe("ORICORIO", 1.2, { boss: true }); },
      optionsFor(e) {
        return [
          { label: "Affrontalo", sub: "combattimento difficile · ottieni una Staffetta",
            run() { encBattle(e._mon, "L'Oricorio accetta la sfida con un piroetta!",
              () => `Ricevi: ${encReward("ROGUE")}!`); return null; } },
          { label: "Impara la sua Danza", sub: "insegna una mossa di danza", run() {
              // nell'originale insegna Mutadanza; qui una mossa "di danza" fra le MT
              const danze = ["QUIVER_DANCE", "DRAGON_DANCE", "SWORDS_DANCE", "FEATHER_DANCE", "TEETER_DANCE", "PETAL_DANCE"]
                .filter(mv => M[mv] && chiPuoImparare(mv).length);
              if (!danze.length) { const p = rndOf(aliveParty()); p.vits.spd = (p.vits.spd || 0) + 3; recomputeStats(p);
                return `Nessuno riesce a seguire i passi… ma ${p.name} ci prova e diventa più veloce!`; }
              const tm = rndOf(danze);
              insegnaTm(tm);
              return `Impari i passi dell'Oricorio: ${M[tm].it}!`; } },
          { label: "Mostragli una Danza", sub: "gli piacerai", run() {
              return arrivaDaIncontro(e._mon, "L'Oricorio è entusiasmato dalla tua danza e ti segue!"); } },
        ];
      },
    },
    {
      // delibirdy — dai qualcosa ai Delibird, ricevi di meglio
      id: "delibirdy", tier: "GREAT", emoji: "🎁", mon: "DELIBIRD", title: "Gruppo di Delibird",
      text: "Un gruppo di Delibird ti guarda trepidante, come se aspettasse un regalo.",
      setup(e) { e._costo = waveMoney(2); },
      optionsFor(e) {
        return [
          { label: "Dagli dei soldi", sub: `₽${e._costo} · ricevi uno strumento`,
            cond: () => game.money >= e._costo,
            run() { game.money -= e._costo; return `I Delibird sono felicissimi! Ti lasciano: ${encReward("ULTRA")}!`; } },
          { label: "Dagli del cibo", sub: "cedi una bacca · ricevi uno strumento",
            cond: () => game.party.some(p => Object.keys(p.berries || {}).length),
            run() {
              const p = game.party.find(x => Object.keys(x.berries || {}).length);
              const k = Object.keys(p.berries)[0];
              p.berries[k]--; if (!p.berries[k]) delete p.berries[k];
              return `Offri una ${BERRY_DATA[k].it}. In cambio ricevi: ${encReward("ULTRA")}!`; } },
          { label: "Dagli uno strumento", sub: "cedi un oggetto tenuto · ricevi di meglio",
            cond: () => aliveParty().some(p => Object.keys(p.held || {}).length),
            run() {
              const p = aliveParty().find(x => Object.keys(x.held || {}).length);
              const k = Object.keys(p.held)[0]; delete p.held[k];
              return `Cedi ${nomeHeld(k)}. In cambio ricevi: ${encReward("ROGUE")}!`; } },
          { label: "Vai via", run: () => "I Delibird ti guardano andare via, delusi." },
        ];
      },
    },
    {
      // fun-and-games — il Colpisci-o-matic di Wobbuffet
      id: "funandgames", tier: "GREAT", emoji: "🎪", mon: "WOBBUFFET", title: "Divertimento e Giochi!",
      text: "Una bancarella con un Wobbuffet imbottito: colpiscilo più forte che puoi!",
      setup(e) { e._costo = waveMoney(1); },
      optionsFor(e) {
        return [
          { label: "Partecipa al Gioco", sub: `₽${e._costo} · premio in base alla forza`,
            cond: () => game.money >= e._costo,
            run() {
              game.money -= e._costo;
              const p = bestBy("atk");
              const q = p.stats.atk / encSoglia(2.2);
              if (q >= 1.3) return `${p.name} manda il Wobbuffet fuori dalla bancarella! Primo premio: ${encReward("ROGUE")}!`;
              if (q >= 0.9) return `${p.name} colpisce forte! Secondo premio: ${encReward("ULTRA")}!`;
              return `${p.name} ci prova… premio di consolazione: ${encReward("COMMON")}.`; } },
          { label: "Vai via", run: () => "Passi oltre la bancarella." },
        ];
      },
    },
    {
      // mysterious-challengers — tre livelli di sfidante
      id: "challengers", tier: "GREAT", emoji: "🥊", npc: "ace_trainer_m", title: "Sfidanti Misteriosi",
      text: "Tre allenatori incappucciati ti sbarrano la strada. Quale accetti di affrontare?",
      optionsFor() {
        const sfida = (nome, mult, tier, testo) => ({
          label: nome, sub: testo,
          run() {
            const m = encFoe(null, mult, { boss: mult > 1.2 });
            encBattle(m, `Lo sfidante manda in campo ${m.name}!`, () => `Ricompensa: ${encReward(tier)}!`);
            return null;
          },
        });
        return [
          sfida("Un avversario intelligente", 1.0, "GREAT", "combattimento normale · buone ricompense"),
          sfida("Un avversario forte", 1.2, "ULTRA", "combattimento tosto · ottime ricompense"),
          sfida("L'avversario più potente", 1.45, "ROGUE", "combattimento brutale · ricompense eccellenti"),
        ];
      },
    },
    {
      // safari-zone — paghi ed entri: catture facilitate
      id: "safari", tier: "GREAT", emoji: "🏕️", title: "La Zona Safari",
      text: "L'ingresso della Zona Safari è aperto. Dentro, Pokémon più rari del solito.",
      setup(e) { e._costo = waveMoney(2.75); },
      optionsFor(e) {
        return [
          { label: "Entra", sub: `₽${e._costo} · ball e Pokémon rari`,
            cond: () => game.money >= e._costo,
            run() {
              game.money -= e._costo;
              game.balls += 10;
              const preso = makeFighter(specieDaIncontro(null), Math.max(START_LEVEL, enemyLevelFor(game.wave)), { shiny: rollShiny() });
              return arrivaDaIncontro(preso, `Giornata proficua: 10 Poké Ball e ${preso.name} catturato nella Zona Safari!`); } },
          { label: "Vai via", run: () => "Il biglietto è troppo caro per oggi." },
        ];
      },
    },
    {
      // slumbering-snorlax — lo Snorlax che blocca la strada
      id: "snorlax", tier: "GREAT", emoji: "😴", mon: "SNORLAX", title: "Snorlax assopito",
      text: "Uno Snorlax enorme dorme di traverso sul sentiero, russando come un tuono.",
      waves: [15, 150],
      setup(e) { e._mon = encFoe("SNORLAX", 1.35, { boss: true }); e._mon.status = "SLEEP"; e._mon.sleepTurns = 3; },
      optionsFor(e) {
        const v = fastest();
        return [
          { label: "Affrontalo", sub: "lo affronti mentre dorme · ricompensa speciale",
            run() { encBattle(e._mon, "Lo Snorlax dorme profondamente… è il momento!",
              () => `Ricompensa: ${encReward("ROGUE")}!`); return null; } },
          { label: "Aspetta che si sposti", sub: "perdi tempo · la squadra si riposa", run() {
              healParty(); return "Aspetti per ore. Quando finalmente si sposta, la squadra è riposatissima!"; } },
          { label: "Ruba il suo Strumento", sub: `${v.name} usa la sua Velocità`, run() {
              if (v.stats.spd / (e._mon.stats.spd * 1.1) >= 1) {
                addHeld(rndOf(aliveParty()), "leftovers");
                return `${v.name} sfila gli Avanzi da sotto lo Snorlax senza svegliarlo!`;
              }
              v.hp = Math.max(1, v.hp - Math.floor(v.maxHp * 0.4));
              return `Lo Snorlax si gira nel sonno e schiaccia ${v.name}! Niente strumento.`; } },
        ];
      },
    },

    /* ========================= ULTRA (5) ========================= */
    {
      // the-pokemon-salesman — 1 su 100 e' un Magikarp cromatico
      id: "salesman", tier: "ULTRA", emoji: "🧑‍🌾", npc: "clerk_m", title: "Il Venditore di Pokémon",
      text: "« Psst! Ho un Pokémon raro per te, a un prezzo d'occasione. Che ne dici? »",
      cond: () => game.money >= waveMoney(2),
      setup(e) {
        e._karp = Math.floor(Math.random() * 100) === 0 && !!S.MAGIKARP;
        e._mon = e._karp ? "MAGIKARP" : specieDaIncontro(null);
        const costo = S[e._mon].starterCost || 3;
        e._price = waveMoney(e._karp ? 4 : 4 * (Math.max(costo, 2.5) / 5));
      },
      optionsFor(e) {
        return [
          { label: `Accetta — ${S[e._mon].it}${e._karp ? " ✨" : ""}`, sub: `₽${e._price}`,
            cond: () => game.money >= e._price,
            run() {
              game.money -= e._price;
              /* 🔴 «Pokemon RARO a un prezzo d'occasione»: prima era un
                 esemplare qualunque, e per quel prezzo non aveva senso.
                 Adesso ha SEMPRE qualcosa che non troveresti in giro — uno dei
                 tre, pescato a caso: cromatico, abilità nascosta, o una mossa
                 da uovo già imparata. */
              const dono = e._karp ? 0 : Math.floor(Math.random() * 3);
              const nascosta = dono === 1 && S[e._mon].abilities.hidden;
              const mon = makeFighter(e._mon, Math.max(START_LEVEL, enemyLevelFor(game.wave) - 2),
                                      { shiny: e._karp || dono === 0 || rollShiny(),
                                        abilIndex: nascosta ? 2 : undefined });
              let bonus = "";
              if (nascosta) bonus = `Ha l'abilità nascosta ${mon.ability.it}!`;
              else if (dono === 2) {
                const em = (EGGM[e._mon] || []).filter(id => M[id] && !mon.moves.some(x => x.id === id));
                if (em.length) {
                  const id = rndOf(em);
                  if (mon.moves.length >= 4) mon.moves[3] = { id, pp: M[id].pp, maxPp: M[id].pp };
                  else mon.moves.push({ id, pp: M[id].pp, maxPp: M[id].pp });
                  bonus = `Conosce già la mossa da uovo ${M[id].it}!`;
                }
              }
              if (!bonus && mon.shiny) bonus = "Ed è pure cromatico!";
              return arrivaDaIncontro(mon, `Affare fatto! ${bonus}`); } },
          { label: "Vai via", run: () => "Rifiuti l'offerta." },
        ];
      },
    },
    {
      // training-session — tre difficolta'. Le nature non esistono da noi:
      // al loro posto il livello intermedio potenzia una statistica base.
      id: "training", tier: "ULTRA", emoji: "🏋️", npc: "black_belt_m", title: "Sessione di Allenamento",
      text: "Un vecchio maestro ti propone un allenamento mirato. Quanto vuoi spingere?",
      options: [
        { label: "Facile", sub: "migliora 2 IV di un membro", run() {
            const p = rndOf(aliveParty());
            const bassi = VITS.filter(s => (p.ivs[s] || 0) < 31);
            if (!bassi.length) return `${p.name} ha già dato il massimo: nessun margine.`;
            const scelti = [];
            while (scelti.length < Math.min(2, bassi.length)) { const s = rndOf(bassi); if (!scelti.includes(s)) scelti.push(s); }
            for (const s of scelti) {
              const iv = p.ivs[s] || 0;
              p.ivs[s] = Math.min(31, iv + (iv < 10 ? 10 : iv <= 20 ? 5 : 3));
            }
            recomputeStats(p);
            return `${p.name} si allena: ${scelti.map(s => VIT_IT[s]).join(" e ")} ${scelti.length > 1 ? "migliorano" : "migliora"}!`; } },
        { label: "Intermedio", sub: "cambia la natura di un membro", run() {
            const p = rndOf(aliveParty());
            const vecchia = NATURES[p.nature].it;
            p.nature = rndOf(NATURE_KEYS.filter(k => NATURES[k].su && k !== p.nature));
            recomputeStats(p);
            return `Allenamento mirato: ${p.name} passa da ${vecchia} a ${natureLabel(p)}!`; } },
        { label: "Pesante", sub: "cambia abilità a un membro", run() {
            const p = rndOf(aliveParty()); const sp = S[p.speciesId];
            const scelte = (sp.abilities.normal || []).concat(sp.abilities.hidden ? [sp.abilities.hidden] : [])
              .filter(a => ABIL[a] && (!p.ability || ABIL[a].it !== p.ability.it));
            if (!scelte.length) return `${p.name} non ha altre abilità da provare.`;
            p.ability = ABIL[rndOf(scelte)];
            return `Allenamento estremo! ${p.name} sviluppa una nuova abilità: ${p.ability.it}!`; } },
        { label: "Vai via", run: () => "Ringrazi e prosegui." },
      ],
    },
    {
      // trash-to-treasure — il cumulo di rifiuti col Garbodor
      id: "trash", tier: "ULTRA", emoji: "🗑️", mon: "GARBODOR", title: "Da Monnezza a Meraviglia",
      text: "Una montagna di rifiuti alta come un palazzo. Qualcosa luccica là in mezzo.",
      waves: [100, 180],
      setup(e) { e._mon = encFoe("GARBODOR", 1.4, { boss: true }); },
      optionsFor(e) {
        return [
          { label: "Indaga più a fondo", sub: "scopri l'origine della spazzatura",
            run() { encBattle(e._mon, "Il cumulo si muove… era un Garbodor gigante!",
              () => `Sotto la spazzatura trovi: ${encReward("MASTER")}!`); return null; } },
          { label: "Scava cercando Strumenti", sub: "strumenti incredibili · ma il negozio raddoppia i prezzi", run() {
              game.shopMarkup = 2;
              return `Scavi a mani nude e trovi: ${encReward("ROGUE", 2)}! Ma ora puzzi: i negozianti ti raddoppiano i prezzi.`; } },
        ];
      },
    },
    {
      // clowning-around — il clown Mr. Mime
      id: "clown", tier: "ULTRA", emoji: "🤡", mon: "MR_MIME", title: "Pagliacciate",
      text: "Un clown ti sbarra la strada facendo smorfie. Qualcosa non torna in questo incontro.",
      waves: [80, 180],
      setup(e) { e._mon = encFoe("MR_MIME", 1.3, { boss: true }); },
      optionsFor(e) {
        return [
          { label: "Affronta il Clown", sub: "combattimento strano · cambia un'abilità",
            run() { encBattle(e._mon, "« E allora si balla! » Il clown manda in campo Mr. Mime!", () => {
                const p = rndOf(aliveParty()); const sp = S[p.speciesId];
                const scelte = (sp.abilities.normal || []).filter(a => ABIL[a]);
                if (scelte.length) p.ability = ABIL[rndOf(scelte)];
                return `Lo scherzo finisce: ${p.name} si ritrova con l'abilità ${p.ability ? p.ability.it : "di sempre"}!`;
              }); return null; } },
          { label: "Resta impassibile", sub: "cambia gli strumenti di un Pokémon", run() {
              const p = rndOf(aliveParty());
              p.held = {};
              addHeld(p, rndOf(["leftovers", "shellbell", "focusband", "scopelens", "widelens"]));
              return `Il clown si annoia e per dispetto rimescola lo zaino di ${p.name}: ora tiene ${heldSummary(p)}.`; } },
          { label: "Restituisci gli insulti", sub: "cambia i tipi di un Pokémon", run() {
              const p = rndOf(aliveParty());
              const tipi = Object.keys(T).filter(t => t !== "UNKNOWN");
              p.types = [rndOf(tipi)];
              return `Il clown esplode in una nuvola colorata: ${p.name} diventa di tipo ${T[p.types[0]].it}!`; } },
        ];
      },
    },
    {
      // the-expert-pokemon-breeder — scegli quale allevare
      id: "breeder", tier: "ULTRA", emoji: "🥚", npc: "breeder_f", title: "L'Allevatrice di Pokémon Esperta",
      text: "Un'allevatrice ti propone di prenderti cura di uno dei suoi cuccioli.",
      waves: [25, 180],
      setup(e) { e._scelte = [specieDaIncontro(null), specieDaIncontro(null), specieDaIncontro(null)]; },
      optionsFor(e) {
        return e._scelte.map(k => ({
          label: S[k].it, sub: "allevalo e ricevi un uovo",
          run() {
            const mon = makeFighter(k, Math.max(START_LEVEL, enemyLevelFor(game.wave) - 4), { shiny: rollShiny() });
            encEgg(1);
            return arrivaDaIncontro(mon, `Ti prendi cura di ${mon.name}! L'allevatrice ti regala anche un buono uovo.`);
          },
        })).concat([{ label: "Vai via", run: () => "Non è il momento di allevare cuccioli." }]);
      },
    },

    /* ========================= ROGUE (4) ========================= */
    {
      // a-trainers-test — uovo raro se vinci, uovo normale se rifiuti
      id: "trainerstest", tier: "ROGUE", emoji: "🎖️", npc: "ace_trainer_f", title: "La prova di un allenatore",
      text: "« Ti darò un Uovo comunque. Ma se mi batti, sarà un Uovo molto più raro. »",
      waves: [100, 180],
      setup(e) { e._mon = encFoe(null, 1.5, { boss: true }); },
      optionsFor(e) {
        return [
          { label: "Accetta la sfida", sub: "lotta estrema · uovo molto raro",
            run() { encBattle(e._mon, `L'allenatore manda in campo ${e._mon.name}!`,
              () => { encEgg(5); return "Ti sei guadagnato un Uovo molto raro! (+5 buoni uovo)"; }); return null; } },
          { label: "Rifiuta la sfida", sub: "squadra curata · uovo normale", run() {
              healParty(); encEgg(1);
              return "L'allenatore ti cura la squadra e ti consegna comunque un Uovo. (+1 buono uovo)"; } },
        ];
      },
    },
    {
      // dark-deal — 5 Rogue Ball, ma un tuo Pokemon viene "modificato"
      id: "darkdeal", tier: "ROGUE", emoji: "🧪", npc: "scientist", title: "Offerta Oscura",
      text: "« Ne varrà la pena! Puoi avere queste potenti Poké Ball come compenso. »",
      waves: [30, 180],
      cond: () => game.party.length > 1,
      options: [
        { label: "Accetta", sub: "5 Rogue Ball · un tuo Pokémon viene 'potenziato'", run() {
            game.rogueballs = (game.rogueballs || 0) + 5;
            const i = Math.floor(Math.random() * game.party.length);
            const vecchio = game.party[i];
            const nuovo = makeFighter(specieDaIncontro(vecchio.speciesId), vecchio.level + 5, { shiny: rollShiny() });
            game.party[i] = nuovo;
            if (game.active >= game.party.length) game.active = 0;
            game.player = game.party[game.active];
            if (!meta.unlocked[nuovo.speciesId]) { meta.unlocked[nuovo.speciesId] = nuovo.shiny ? 2 : 1; saveMeta(); }
            return `Ricevi 5 Rogue Ball. Poi la macchina si accende: ${vecchio.name} sparisce e al suo posto compare ${nuovo.name}!`; } },
        { label: "Rifiuta", run: () => "Non ti piace il modo in cui ti guarda. Prosegui." },
      ],
    },
    {
      // the-winstrate-challenge — 5 allenatori di fila
      id: "winstrate", tier: "ROGUE", emoji: "👨‍👩‍👧‍👦", npc: "ace_trainer_m", title: "La Sfida della Famiglia Vinci",
      text: "Una famiglia intera ti sfida: cinque allenatori, uno dopo l'altro.",
      waves: [100, 180],
      options: [
        { label: "Accetta la sfida", sub: "5 avversari di fila · oggetto speciale", run() {
            const squadra = [];
            for (let i = 0; i < 5; i++) squadra.push(encFoe(null, 1 + i * 0.12, { boss: i === 4 }));
            game.encReward = () => `La famiglia Vinci si complimenta: ${encReward("MASTER")}!`;
            hideMeta();
            startTrainerBattle(squadra, "ace_trainer_m", "la Famiglia Vinci",
              ["« Siamo la famiglia Vinci! Vediamo se resisti a tutti e cinque! »"]);
            return null; } },
        { label: "Rifiuta la sfida", sub: "squadra curata · Caramella rarissima", run() {
            healParty();
            return `Declini cortesemente. Ti offrono da bere e ti regalano: ${encGive("rarercandy")}!`; } },
      ],
    },
    {
      // weird-dream — i tuoi Pokemon vengono trasformati in specie simili
      id: "weirddream", tier: "ROGUE", emoji: "💭", title: "???",
      text: "Una voce che non senti con le orecchie: « Li vedo. Li vedo tutti. »",
      waves: [30, 140],
      options: [
        { label: "« Li vedo. »", sub: "la squadra viene trasformata", run() {
            const nomi = [];
            const bst = k => { const b = S[k].baseStats; return b.hp + b.atk + b.def + b.spatk + b.spdef + b.spd; };
            for (let i = 0; i < game.party.length; i++) {
              const v = game.party[i];
              const target = bst(v.speciesId);
              // una specie di forza simile (+10%), come fa l'originale
              const cand = SPECIES_KEYS.filter(k => Math.abs(bst(k) - target * 1.1) < 40);
              if (!cand.length) continue;
              const nuovo = makeFighter(rndOf(cand), v.level, { ivs: v.ivs, shiny: v.shiny });
              nuovo.vits = v.vits; nuovo.held = v.held; nuovo.berries = v.berries;
              recomputeStats(nuovo);
              game.party[i] = nuovo; nomi.push(`${v.name} → ${nuovo.name}`);
            }
            game.active = 0; game.player = game.party[0];
            return `Il mondo si increspa… ${nomi.join(", ")}.`; } },
        { label: "« Mostrameli. »", sub: "combattimento difficile · ottime ricompense", run() {
            const m = encFoe(null, 1.5, { boss: true });
            encBattle(m, `Dal nulla si materializza ${m.name}!`, () => `Ricompensa: ${encReward("MASTER")}!`);
            return null; } },
        { label: "Allontanati rapidamente", sub: "la squadra ne esce scossa", run() {
            encDamageParty(0.3);
            return "Corri via senza voltarti. La squadra è scossa e provata."; } },
      ],
    },
  ];

  function maybeMysteryEncounter() {
    // peso base 3/256, cresce di 3 a ogni onda senza incontro (come l'originale)
    game.meMisses = (game.meMisses || 0);
    const chance = (3 + game.meMisses * 3) / 256;
    if (Math.random() < chance) { game.meMisses = 0; return true; }
    game.meMisses++;
    return false;
  }

  /* Sceglie l'incontro: prima il TIER coi pesi dell'originale
     (`mystery-encounter-tier.ts`: COMMON 66 · GREAT 40 · ULTRA 19 · ROGUE 3),
     poi uno di quel tier fra quelli ammessi da onde e requisiti.
     Come nell'originale, un tier gia' visto in questa run pesa meno. */
  const ENC_TIER_W = { COMMON: 66, GREAT: 40, ULTRA: 19, ROGUE: 3 };
  function encAllowed(e) {
    if (e.waves && (game.wave < e.waves[0] || game.wave > e.waves[1])) return false;
    if (e.cond && !e.cond()) return false;
    if (game.encSeen && game.encSeen.includes(e.id)) return false;   // non ripeterlo
    return true;
  }
  function pickEncounter() {
    const W = Object.assign({}, ENC_TIER_W);
    for (const t of (game.encTiersSeen || [])) {
      if (t === "COMMON") W.COMMON = Math.max(6, W.COMMON - 6);
      else if (t === "GREAT") W.GREAT = Math.max(4, W.GREAT - 4);
    }
    const perTier = {};
    for (const t in W) perTier[t] = MYSTERY_ENCOUNTERS.filter(e => (e.tier || "COMMON") === t && encAllowed(e));
    // se un tier non ha candidati, il suo peso non conta
    let tot = 0;
    for (const t in W) if (perTier[t].length) tot += W[t];
    if (!tot) {   // tutti gia' visti: si riparte da capo
      game.encSeen = [];
      for (const t in W) perTier[t] = MYSTERY_ENCOUNTERS.filter(e => (e.tier || "COMMON") === t && encAllowed(e));
      for (const t in W) if (perTier[t].length) tot += W[t];
    }
    let r = Math.random() * tot, tier = "COMMON";
    for (const t in W) { if (!perTier[t].length) continue; r -= W[t]; if (r <= 0) { tier = t; break; } }
    const lista = perTier[tier].length ? perTier[tier]
      : MYSTERY_ENCOUNTERS.filter(e => encAllowed(e));
    const scelto = lista[Math.floor(Math.random() * lista.length)] || MYSTERY_ENCOUNTERS[0];
    game.encSeen = (game.encSeen || []).concat(scelto.id);
    game.encTiersSeen = (game.encTiersSeen || []).concat(scelto.tier || "COMMON");
    return scelto;
  }

  function showMysteryEncounter(enc) {
    game.phase = "MYSTERY";
    clearTimeout(game.timer);
    if (enc.setup) enc.setup(enc);
    const opts = enc.optionsFor ? enc.optionsFor(enc) : enc.options;
    const avail = opts.filter(o => !o.cond || o.cond());
    const btns = avail.map((o, i) =>
      `<button class="me-opt" data-i="${i}"><span class="me-opt-l">${o.label}</span>${o.sub ? `<span class="me-opt-s">${o.sub}</span>` : ""}</button>`).join("");
    /* 🔴 L'EMOJI AL POSTO DEL POKEMON.
       In «Cupidigia Assoluta» compariva uno scoiattolo 🐿️: l'incontro
       parla di un Greedent, lo fa combattere, te lo fa perfino guadagnare — e
       in cima alla schermata c'era un'emoji generica. Vale per tutti gli
       incontri che hanno un protagonista preciso: nell'originale ognuno porta
       il suo `spriteKey`, e per questi e' il Pokemon stesso.
       Adesso: se l'incontro ne ha uno (`mon`, oppure quello appena generato in
       `setup` quando è lui il soggetto), si mostra la sua icona vera; se no
       resta l'allenatore, e l'emoji e' l'ultima spiaggia. */
    const specie = enc.mon || (enc.monGenerato && enc._mon && enc._mon.speciesId);
    const dexEnc = specie && S[specie] ? S[specie].dex : null;
    const npc = dexEnc
      ? `<div class="me-mon">${miniIcon(dexEnc, 4.4)}</div>`
      : enc.npc
      ? `<span class="me-npc" id="meNpc"></span>`
      : `<div class="me-emoji">${enc.emoji}</div>`;
    showMetaScreen(`
      ${npc}
      <div class="meta-title" style="font-size:clamp(20px,6vw,30px)">${enc.title}</div>
      <div class="me-text">${enc.text}</div>
      <div class="me-opts">${btns}</div>`);
    if (enc.npc) paintAtlasSprite(document.getElementById("meNpc"), `assets/trainer/${enc.npc}`, metaEl().clientHeight * 0.32, 3);
    metaEl().querySelectorAll(".me-opt").forEach(b => b.onclick = () => {
      const result = avail[parseInt(b.dataset.i, 10)].run();
      // `null` = l'opzione ha avviato una lotta: la schermata l'ha gia' chiusa lei
      if (result !== null && result !== undefined) meResult(result);
    });
  }

  function meResult(text) {
    showMetaScreen(`
      <div class="me-emoji">❗</div>
      <div class="me-text" style="margin-top:auto;margin-bottom:auto;font-size:clamp(15px,4.2vw,20px)">${text}</div>
      <div class="meta-actions"><button class="meta-btn primary" data-act="ok">Continua</button></div>`);
    metaEl().querySelector('[data-act="ok"]').onclick = () => {
      hideMeta(); renderScene(); tickEggs(null);
      /* ⚠️ `chiediPostoInSquadra` mancava del tutto in questa strada: un
         Pokemon ottenuto da un incontro con la squadra piena finiva nel box
         senza dire niente. Ora la schermata di scelta compare anche qui. */
      processLearns(() => chiediPostoInSquadra(nextWave));
    };
  }

  /* ---------------------------------------------------------------------- */
  /*  SCELTA STARTER — schermo intero: dex, fiocchi, shiny, pokérus, dettaglio */
  /* ---------------------------------------------------------------------- */
  const STAT_MAX = 180;   // riferimento per le barre delle statistiche base

  /* ---- MINI ICONA (atlas pokemon_icons_N) — usata in tutti i menu ---------- */
  // Ritorna lo stile inline per un <span class="mini-icon"> del dex dato.
  function miniIconStyle(dex, scale) {
    const ic = ICONS[dex];
    if (!ic) return "";
    const k = scale || 1.35;
    // NB: apici SINGOLI dentro url(): questo stile finisce in un attributo
    // style="..." e le doppie apici lo chiuderebbero.
    return `width:${ic.w * k}px;height:${ic.h * k}px;` +
      `background-image:url('assets/ui/icons/pokemon_icons_${ic.a}.png');` +
      `background-position:-${ic.x * k}px -${ic.y * k}px;` +
      `background-size:${ic.sw * k}px ${ic.sh * k}px;background-repeat:no-repeat;` +
      `image-rendering:pixelated;`;
  }
  const miniIcon = (dex, scale) => `<span class="mini-icon" style="${miniIconStyle(dex, scale)}"></span>`;

  /* ---- SISTEMA A PUNTI (come PokeRogue) ----------------------------------
     Budget di 10 punti; ogni specie costa `starterCost` (1-10). All'inizio sono
     disponibili TUTTI gli starter base di ogni regione; catture e schiuse
     aggiungono altre specie. Si compone una squadra iniziale finché il budget
     lo consente. */
  const STARTER_BUDGET = 10;
  let starterTeam = [];     // [{k, ability, nature, moves, shiny, pkrs}]

  // Costo effettivo: base meno le riduzioni comprate con le caramelle (min 1).
  const baseCost = k => (S[k] && S[k].starterCost) ? S[k].starterCost : 3;
  /* ======================================================================
     PREZZI IN CARAMELLE — la tabella vera dell'originale
     (`allStarterCandyCosts`, data/balance/starters.ts), indicizzata dal costo
     in punti dello starter.

     🔴 Va nel verso OPPOSTO a quello che avevamo. Noi facevamo
     `passiva = 10 × costo` e `riduzione = 5 × costo × (fatte+1)`, cioè più il
     Pokémon è pregiato più costa. L'originale fa il contrario: la passiva
     costa **40** caramelle per uno starter da 1-2 punti e **10** per uno da
     8-10. Ha senso, ed è il motivo per cui è così: un Pokémon comune lo
     incontri di continuo e le caramelle si accumulano da sole, un leggendario
     lo vedi una volta ogni tanto. Col nostro conto la passiva di un comune
     costava 20 invece di 40 (metà prezzo) e quella di un leggendario 100
     invece di 10 (dieci volte tanto): il progresso era storto in entrambe le
     direzioni.
     ====================================================================== */
  const CANDY_COSTS = [
    { passive: 40, cut: [25, 60] },   // costo 1
    { passive: 40, cut: [25, 60] },   // 2
    { passive: 35, cut: [20, 50] },   // 3
    { passive: 30, cut: [15, 40] },   // 4
    { passive: 25, cut: [12, 35] },   // 5
    { passive: 20, cut: [10, 30] },   // 6
    { passive: 15, cut: [8, 20] },    // 7
    { passive: 10, cut: [5, 15] },    // 8
    { passive: 10, cut: [5, 15] },    // 9
    { passive: 10, cut: [5, 15] },    // 10
  ];
  const CUT_MAX = 2;                  // `valueReductionMax` dell'originale
  const candyRow = k => CANDY_COSTS[Math.min(10, Math.max(1, baseCost(k))) - 1];
  /* Ogni riduzione toglie 1 punto, e sotto l'1 DIMEZZA
     (`getSpeciesStarterValue`): un costo 1 diventa 0,5 e poi 0,25. È così che
     a gioco avanzato ci stanno sei Pokémon buoni dentro i 10 punti.
     ⚠️ Le riduzioni sono al massimo DUE, non infinite come prima. */
  function starterCost(k) {
    let v = baseCost(k);
    const cut = Math.min(CUT_MAX, (meta.costCut && meta.costCut[k]) || 0);
    for (let i = 0; i < cut; i++) v = v > 1 ? v - 1 : v / 2;
    return v;
  }
  // numeri come li scrive un italiano: 2 · 1,5 · 0,25
  const costoIt = v => String(Math.round(v * 100) / 100).replace(".", ",");
  function candyOf(k) { return (meta.candy && meta.candy[k]) || 0; }
  /* null quando le due riduzioni sono già state prese: non c'è più niente da
     comprare, e il pulsante lo dice invece di restare acceso a vuoto. */
  function costCutPrice(k) {
    const done = (meta.costCut && meta.costCut[k]) || 0;
    return done >= CUT_MAX ? null : candyRow(k).cut[done];
  }
  function passivePrice(k) { return candyRow(k).passive; }
  function teamCost() { return starterTeam.reduce((s, e) => s + starterCost(e.k), 0); }
  function budgetLeft() { return STARTER_BUDGET - teamCost(); }

  /* Preevoluzione di ogni specie: si costruisce una volta sola dalle catene
     evolutive. Serve a sapere chi è la RADICE della propria famiglia. */
  let PRE_EVO = null;
  function preEvoMap() {
    if (PRE_EVO) return PRE_EVO;
    PRE_EVO = {};
    for (const id in S) for (const e of S[id].evolutions || []) {
      if (S[e.to] && !PRE_EVO[e.to]) PRE_EVO[e.to] = id;
    }
    return PRE_EVO;
  }
  const isRoot = k => !preEvoMap()[k];
  // Capostipite della famiglia: Venusaur → Bulbasaur, Raichu → Pichu.
  /* Era GIA' schierabile come starter, prima di questa registrazione?
     ⚠️ Non basta `meta.unlocked`: i 27 di partenza non ci stanno dentro, sono
     schierabili per conto loro (DEFAULT_STARTER_SET). Senza questo controllo
     catturare o far schiudere uno di loro annunciava «sbloccato come starter!»
     per un Pokemon che avevi dal primo giorno. */
  const giaStarter = k => DEFAULT_STARTER_SET.has(k) || !!meta.unlocked[k];

  function rootOf(k) {
    const pre = preEvoMap();
    let cur = k, guard = 0;
    while (pre[cur] && guard++ < 10) cur = pre[cur];
    return cur;
  }

  /* I 27 starter di partenza: i tre di ogni regione, come `defaultStarterSpecies`
     in `src/constants.ts` dell'originale. Sono gli unici schierabili all'inizio;
     tutti gli altri capostipiti si sbloccano catturandoli. */
  const DEFAULT_STARTERS = [
    "BULBASAUR", "CHARMANDER", "SQUIRTLE", "CHIKORITA", "CYNDAQUIL", "TOTODILE",
    "TREECKO", "TORCHIC", "MUDKIP", "TURTWIG", "CHIMCHAR", "PIPLUP",
    "SNIVY", "TEPIG", "OSHAWOTT", "CHESPIN", "FENNEKIN", "FROAKIE",
    "ROWLET", "LITTEN", "POPPLIO", "GROOKEY", "SCORBUNNY", "SOBBLE",
    "SPRIGATITO", "FUECOCO", "QUAXLY",
  ];
  const DEFAULT_STARTER_SET = new Set(DEFAULT_STARTERS);

  /* Chi si può schierare: dev'essere il CAPOSTIPITE della catena — niente
     Venusaur né Wartortle, nemmeno dopo averli catturati — e va sbloccato,
     cioè o è uno dei 27 di partenza o l'hai catturato almeno una volta.

     ⚠️ SCELTA DEL PROPRIETARIO, DIVERSA DALL'ORIGINALE. In PokéRogue i baby
     sono un'eccezione: `speciesStarterCosts` dà un costo sia a Pichu sia a
     Pikachu e li puoi schierare entrambi. Qui vale solo il baby, cioè Pichu.
     La regola "è radice" lo ottiene da sola: nei dati **l'unica specie evoluta
     con un costo starter è proprio Pikachu**. */
  function isSelectable(k) {
    return !!(S[k] && !S[k].noSprite && isRoot(k)
      && (DEFAULT_STARTER_SET.has(k) || meta.unlocked[k]));
  }
  /* Stato di un capostipite nella griglia:
       "libero" = sbloccato → a colori, si schiera
       "visto"  = incontrato ma mai catturato → grigio
       "ignoto" = mai incontrato → sagoma nera
     Ricalca il dex dell'originale (clearTint / setTint(0x808080) / setTint(0)
     in starter-select-ui-handler.ts). */
  function starterState(k) {
    if (isSelectable(k)) return "libero";
    return (meta.seen && meta.seen[k]) ? "visto" : "ignoto";
  }

  /* Nella scelta della squadra compaiono SOLO i capostipiti (544): gli evoluti
     non ci sono nemmeno come sagoma, perché non sono schierabili e basta —
     riempivano la griglia di 485 caselle che non si potevano toccare.
     Il loro posto è semmai un dex vero e proprio, che qui non c'è. */
  function starterDex() {
    return SPECIES_KEYS.filter(k => !S[k].noSprite && isRoot(k));
  }

  // ---- FILTRI (come la barra dell'originale, ridotta a ciò che serve su un
  // telefono: generazione, tipo, stato, ordinamento e ricerca per nome).
  /* Lo stato parte su "Schierabili": all'inizio i capostipiti sbloccati sono 27
     su 544, quindi di norma si vuole vedere solo quelli — le sagome servono
     quando si ha voglia di guardare quanto manca, non ogni volta che si compone
     la squadra. Con "Tutto" tornano tutte e 544. */
  const starterFilters = { gen: 0, type: "", stato: "libero", sort: "dex", q: "",
                           soloPkrs: false, senzaFiocco: false,
                           passiva: "", scontabile: false };
  const SORT_IT = { dex: "Num. Dex", cost: "Costo", name: "Nome", candy: "Caramelle" };
  const STATO_IT = { libero: "Schierabili", tutto: "Tutto", visto: "Visti", ignoto: "Mancanti" };
  /* Le caramelle si spendono in due cose sole — sbloccare la PASSIVA e ridurre
     il COSTO — ma per sapere su chi si poteva spendere bisognava aprire le
     schede una per una. Questi due filtri rispondono alla domanda vera:
     «su chi posso spendere ADESSO?».
       · sbloccata   = la passiva ce l'hai già
       · sbloccabile = non ce l'hai ma le caramelle bastano
       · bloccata    = non ce l'hai e non bastano */
  const PASSIVA_IT = { "": "Passiva: tutte", ok: "✅ sbloccata",
                       pronta: "🍬 sbloccabile", no: "🔒 bloccata" };
  const passivaStato = k => (meta.passiveOn && meta.passiveOn[k]) ? "ok"
    : (candyOf(k) >= passivePrice(k) ? "pronta" : "no");
  // il costo si può ridurre ancora, e le caramelle bastano?
  const costoScontabile = k => {
    const p = costCutPrice(k);
    return p != null && candyOf(k) >= p;
  };
  function starterFiltered() {
    const f = starterFilters;
    const q = f.q.trim().toLowerCase();
    // ⚠️ fuori dal ciclo: `pokerusToday` rifa' il conto a ogni chiamata, e qui
    // le chiamate sarebbero mille e passa
    const pkrs = f.soloPkrs ? pokerusToday() : null;
    let list = starterDex().filter(k => {
      const sp = S[k];
      if (f.gen && sp.gen !== f.gen) return false;
      if (f.type && !sp.types.includes(f.type)) return false;
      if (f.stato !== "tutto" && starterState(k) !== f.stato) return false;
      /* I due filtri di chi colleziona: il Pokerus del giorno dura un giorno
         solo, e il fiocco dice «questo l'ho gia' portato all'ondata 30».
         Servono a rispondere a due domande diverse: «cosa conviene giocare
         OGGI?» e «chi non ho ancora fatto?». */
      if (pkrs && !pkrs.includes(k)) return false;
      if (f.senzaFiocco && hasRibbon(k)) return false;
      /* ⚠️ Passiva e sconto valgono solo su chi puoi davvero schierare: su una
         sagoma mai incontrata non ha senso parlare di caramelle da spendere. */
      if (f.passiva && (starterState(k) !== "libero" || passivaStato(k) !== f.passiva)) return false;
      if (f.scontabile && (starterState(k) !== "libero" || !costoScontabile(k))) return false;
      // La ricerca per nome vale solo su chi il nome ce l'ha scoperto: cercare
      // fra le sagome direbbe come si chiama un Pokémon che non hai ancora
      // incontrato, e la griglia il nome non lo mostra apposta.
      if (q && (starterState(k) !== "libero" || !sp.it.toLowerCase().includes(q))) return false;
      return true;
    });
    const by = {
      dex:   (a, b) => S[a].dex - S[b].dex,
      cost:  (a, b) => starterCost(a) - starterCost(b) || S[a].dex - S[b].dex,
      name:  (a, b) => S[a].it.localeCompare(S[b].it),
      candy: (a, b) => candyOf(b) - candyOf(a) || S[a].dex - S[b].dex,
    };
    return list.sort(by[f.sort] || by.dex);
  }

  /* 🔴 Dove eravamo arrivati nella griglia degli starter.
     Aprire la scheda di un Pokemon e tornare indietro ridisegna la lista da
     zero, e con oltre mille caselle voleva dire riscorrere tutto ogni volta.
     Si segna la posizione all'andata e la si rimette al ritorno.
     ⚠️ Solo tornando da una SCHEDA: cambiando filtro o ricerca la lista è
     un'altra, e ripartire da metà non avrebbe senso.
     ⚠️ Lo scroller e' `.starter-dex`, che ha un `overflow-y` suo — non `#meta`.
     E si rimette DOPO l'impaginazione: appena riempito l'innerHTML l'altezza
     non c'e' ancora e lo scrollTop verrebbe tagliato a zero. */
  let scrollStarter = 0;
  let ripristinaStarter = false;
  function tornaAllaGrigliaStarter() { ripristinaStarter = true; renderStarterSelect(); }

  function renderStarterSelect() {
    const pool = starterFiltered();
    const pkrs = pokerusToday();
    const left = budgetLeft();
    const f = starterFilters;
    const cells = pool.map(k => {
      const sp = S[k], stato = starterState(k);
      /* ⚠️ Di un Pokémon non ancora sbloccato non si svela nulla: né nome, né
         costo, né tipo. Solo la sagoma e il numero, come nell'originale. */
      if (stato !== "libero") {
        return `<span class="starter-cell ${stato}" title="#${sp.dex}">
          ${miniIcon(sp.dex, 1.15)}<span class="sc-name">#${sp.dex}</span></span>`;
      }
      const cost = starterCost(k);
      const shiny = meta.unlocked[k] === 2;
      const chosen = starterTeam.some(e => e.k === k);
      const tooExpensive = !chosen && cost > left;
      const badges = `${shiny ? '<span class="sb-shiny">✨</span>' : ""}${hasRibbon(k) ? '<span class="sb-ribbon">🎀</span>' : ""}${pkrs.includes(k) ? '<span class="sb-pkrs">💜</span>' : ""}`;
      return `<button class="starter-cell${chosen ? " chosen" : ""}${tooExpensive ? " tooexp" : ""}" data-k="${k}" style="border-color:${T[sp.types[0]].color}">
        ${miniIcon(sp.dex, 1.15)}
        <span class="sc-name">${sp.it}</span>
        <span class="sc-cost">${"●".repeat(Math.min(cost, 10))}</span>${badges}
        ${candyOf(k) ? `<span class="sc-candy">🍬${candyOf(k)}</span>` : ""}</button>`;
    }).join("");
    const teamRow = starterTeam.length
      ? starterTeam.map((e, i) => `<button class="team-slot" data-rm="${i}">${miniIcon(S[e.k].dex, 1.1)}<span>${S[e.k].it}</span><span class="ts-cost">${costoIt(starterCost(e.k))}</span></button>`).join("")
      : `<div class="meta-sub" style="margin:0">Nessun Pokémon scelto — toccane uno sotto</div>`;
    // conteggio del dex, il numero che interessa davvero a chi colleziona
    // conta gli SBLOCCATI, non i catturati: i 27 di partenza sono giocabili
    // pur non essendo in `meta.unlocked`
    const tot = starterDex().length;
    const presi = starterDex().filter(isSelectable).length;
    const opt = (v, cur, label) => `<option value="${v}"${v == cur ? " selected" : ""}>${label}</option>`;
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,29px)">Componi la Squadra</div>
      <div class="budget-bar"><span>Punti: <b>${costoIt(teamCost())}</b> / ${STARTER_BUDGET}</span>
        <span class="budget-left">${left} disponibili</span></div>
      <div class="starter-team">${teamRow}</div>
      <div class="filter-bar">
        <input id="fq" class="filter-q" type="search" placeholder="🔎 Nome…" value="${f.q.replace(/"/g, "&quot;")}">
        <select id="fgen" class="filter-sel">${opt(0, f.gen, "Gen: tutte")}${[1,2,3,4,5,6,7,8,9].map(g => opt(g, f.gen, "Gen " + g)).join("")}</select>
        <select id="ftype" class="filter-sel">${opt("", f.type, "Tipo: tutti")}${Object.keys(CHART).map(t => opt(t, f.type, T[t].it)).join("")}</select>
        <select id="fstato" class="filter-sel">${Object.keys(STATO_IT).map(s => opt(s, f.stato, STATO_IT[s])).join("")}</select>
        <select id="fsort" class="filter-sel">${Object.keys(SORT_IT).map(s => opt(s, f.sort, "↕ " + SORT_IT[s])).join("")}</select>
        <select id="fpassiva" class="filter-sel">${Object.keys(PASSIVA_IT).map(v => opt(v, f.passiva, PASSIVA_IT[v])).join("")}</select>
        <button class="chip filtro-chip${f.soloPkrs ? " on" : ""}" data-fx="soloPkrs"
          title="mostra solo chi ha il Pokérus di oggi">💜 solo Pokérus</button>
        <button class="chip filtro-chip${f.senzaFiocco ? " on" : ""}" data-fx="senzaFiocco"
          title="nascondi quelli che hanno già il fiocco">🎀 senza fiocco</button>
        <button class="chip filtro-chip${f.scontabile ? " on" : ""}" data-fx="scontabile"
          title="hai abbastanza caramelle per abbassargli il costo">🍬 costo riducibile</button>
      </div>
      <div class="meta-sub" style="margin:.4vh 0">Sbloccati ${presi}/${tot} · ${pool.length} mostrati · 💜 Pokérus · 🎀 fiocco · ● = costo</div>
      <div class="starter-dex">${cells || '<div class="meta-sub">Nessun Pokémon con questi filtri.</div>'}</div>
      <div class="meta-actions two-col">
        <button class="meta-btn ghost" data-act="home">🏠 Home</button>
        <button class="meta-btn primary" data-act="start" ${starterTeam.length ? "" : "disabled"}>▶ Inizia (${starterTeam.length})</button>
      </div>`);
    // i filtri ridisegnano la sola griglia
    const bind = (id, campo, conv) => {
      const el = metaEl().querySelector("#" + id);
      if (el) el.onchange = () => { starterFilters[campo] = conv ? conv(el.value) : el.value; renderStarterSelect(); };
    };
    metaEl().querySelectorAll("[data-fx]").forEach(b => b.onclick = () => {
      starterFilters[b.dataset.fx] = !starterFilters[b.dataset.fx];
      renderStarterSelect();
    });
    bind("fgen", "gen", v => parseInt(v, 10));
    bind("ftype", "type");
    bind("fstato", "stato");
    bind("fsort", "sort");
    bind("fpassiva", "passiva");
    const q = metaEl().querySelector("#fq");
    if (q) {
      // si ridisegna quando si smette di scrivere, non a ogni tasto: con 1000
      // celle il ridisegno a ogni lettera si sente
      let t = null;
      q.oninput = () => { clearTimeout(t); t = setTimeout(() => {
        starterFilters.q = q.value; renderStarterSelect();
        const nq = metaEl().querySelector("#fq"); if (nq) { nq.focus(); nq.selectionStart = nq.value.length; }
      }, 250); };
    }
    const dex = metaEl().querySelector(".starter-dex");
    if (dex) {
      if (ripristinaStarter) {
        const y = scrollStarter;
        dex.scrollTop = y;
        requestAnimationFrame(() => { dex.scrollTop = y; });
      }
      ripristinaStarter = false;
    }
    metaEl().querySelectorAll(".starter-cell[data-k]").forEach(b => b.onclick = () => {
      scrollStarter = dex ? dex.scrollTop : 0;   // da qui si riprende al ritorno
      const k = b.dataset.k;
      const idx = starterTeam.findIndex(e => e.k === k);
      if (idx >= 0) { starterTeam.splice(idx, 1); renderStarterSelect(); return; }   // toggle off
      if (starterCost(k) > budgetLeft() || starterTeam.length >= PARTY_MAX) return;
      showStarterDetail(k);      // configura abilità/mosse, poi aggiunge
    });
    metaEl().querySelectorAll(".team-slot").forEach(b => b.onclick = () => {
      starterTeam.splice(parseInt(b.dataset.rm, 10), 1); renderStarterSelect();
    });
    metaEl().querySelector('[data-act="home"]').onclick = showHome;
    metaEl().querySelector('[data-act="start"]').onclick = () => { if (starterTeam.length) beginRunWithTeam(); };
  }

  // Stato temporaneo della configurazione starter in corso.
  let starterCfg = null;
  function showStarterDetail(k) {
    const sp = S[k];
    const shiny = meta.unlocked[k] === 2;
    const pkrs = pokerusToday().includes(k);
    /* Pool mosse selezionabili — la regola dell'originale (`setSpeciesDetails`):
       SOLO le mosse imparate entro il livello 5, piu' le mosse da uovo che hai
       gia' sbloccato facendo schiudere le uova. Prima arrivavamo al livello 20
       e le mosse disponibili erano il doppio del dovuto (media 8 invece di 3,7),
       il che rendeva la partenza molto piu' forte del normale. */
    const learnPool = [...new Set((LEARN[k] || []).filter(([lv]) => lv > 0 && lv <= 5).map(x => x[1]).filter(id => M[id]))];
    const eggPool = unlockedEggMoves(k).filter(id => !learnPool.includes(id));
    /* Solo le abilità SBLOCCATE: le altre si vedono ma grigie e non si possono
       scegliere, così si capisce che esistono e che vanno conquistate. */
    const abilPool = abilitaSbloccate(k);
    const abilTutte = [...(sp.abilities.normal || []), ...(sp.abilities.hidden ? [sp.abilities.hidden] : [])];
    const natPool = natureSbloccate(k);
    /* SESSO e LIVREA sono scelte come le altre: si parte da quella di default
       (il sesso comune, la livrea più alta che hai) e si cambia dalla scheda. */
    const sessoPool = sessiSbloccati(k);
    /* ⚠️ Il tetto non e' solo quello che hai sbloccato: 340 specie non hanno
       livree rare nell'originale (Combee fra queste), e offrire una "rara" che
       poi si disegna identica alla comune sarebbe una bugia. */
    const haLivree = !!cromTerna("front", S[k].dex, null);
    const livreaMax = haLivree ? ((meta.shinyVar && meta.shinyVar[k]) || 0) : 0;
    const formePool = formeSbloccate(k);
    const formeTutte = (VARIANTS[k] && !FORM_BY_GENDER.has(k) && k !== "TOXTRICITY")
      ? VARIANTS[k].slice(0, Math.max(1, collectableForms(k))) : [];
    starterCfg = {
      k, shiny, pkrs,
      formePool, formeTutte,
      formKey: formePool.length ? (formePool[0].key || null) : null,
      gender: sessoPool[0],
      sessoPool,
      shinyVar: livreaMax,
      livreaMax,
      ability: abilPool[0],
      nature: natPool[0],
      natPool,
      /* selezione di partenza: come nell'originale, le prime 4 dell'elenco
         "mosse di livello, poi mosse da uovo" (`speciesStarterMoves`) */
      moves: [...learnPool, ...eggPool].slice(0, 4),
      learnPool, eggPool, abilPool, abilTutte,
    };
    renderStarterDetail();
  }

  /* ======================================================================
     SNIPPET "cosa fa" — nella scheda starter si vedevano solo i NOMI di
     abilità e mosse. Ogni chip ha adesso una ⓘ che apre (e richiude, al
     secondo tocco) un riquadro con la descrizione e i dati veri.
     Ne resta aperto UNO alla volta: su un telefono, aprirli tutti insieme
     farebbe scorrere la pagina all'infinito.
     ====================================================================== */
  const aperto = (tipo, id) => !!(starterCfg && starterCfg.info
    && starterCfg.info.tipo === tipo && starterCfg.info.id === id);
  function apriInfo(tipo, id) {
    starterCfg.info = aperto(tipo, id) ? null : { tipo, id };
    renderStarterDetail();
  }
  /* Riquadro della mossa: gli stessi dati della scheda in lotta, in piccolo. */
  function snippetMossa(id) {
    const mv = M[id]; if (!mv) return "";
    const extra = effettiInParole(mv);
    const dati = [
      `<span class="ms-dato"><i>Potenza</i>${mv.power || "—"}</span>`,
      `<span class="ms-dato"><i>Precisione</i>${mv.accuracy > 0 ? mv.accuracy + "%" : "sempre"}</span>`,
      `<span class="ms-dato"><i>PP</i>${mv.pp}</span>`,
      mv.effectChance > 0 ? `<span class="ms-dato"><i>Effetto</i>${mv.effectChance}%</span>` : "",
    ].join("");
    return `<div class="snippet" style="border-color:${T[mv.type].color}">
      <div class="snip-top"><b>${mv.it}</b> <span class="ticon t-${mv.type}"></span><span class="cicon c-${mv.category}"></span></div>
      <div class="ms-dati">${dati}</div>
      <div class="snip-testo">${mv.effect || "Nessun effetto particolare."}</div>
      ${extra ? `<div class="ms-extra">${extra}</div>` : ""}
    </div>`;
  }
  function snippetAbilita(a) {
    const ab = ABIL[a]; if (!ab) return "";
    return `<div class="snippet">
      <div class="snip-top"><b>${ab.it}</b></div>
      <div class="snip-testo">${ab.description || "Nessuna descrizione."}</div>
    </div>`;
  }

  function renderStarterDetail() {
    const c = starterCfg, sp = S[c.k];
    /* Per Meowstic, Indeedee, Basculegion e Oinkologne il sesso È una forma
       diversa, con tipi e statistiche sue: la scheda deve mostrare quelle
       dell'esemplare che schiererai, non quelle del maschio per tutti. */
    const forma = FORM_BY_GENDER.has(c.k) ? formAt(c.k, c.gender === "FEMALE" ? 1 : 0) : null;
    const cutPrice = costCutPrice(c.k);
    const bs = (forma && forma.baseStats) ? forma.baseStats : sp.baseStats;
    /* ⚠️ I tipi seguono la FORMA scelta, non solo quella legata al sesso:
       un Tauros di Paldea Acquatica è Lotta/Acqua, e la scheda deve dirlo
       mentre lo scegli, non dopo averlo schierato. */
    const formaScelta = c.formKey ? formByKey(c.k, c.formKey) : null;
    const formaMostrata = forma || formaScelta;
    const tipi = (formaMostrata && formaMostrata.types) ? formaMostrata.types : sp.types;
    const statBar = (lab, v) => `<div class="stat-row"><span class="stat-lab">${lab}</span><div class="stat-track"><div class="stat-fill" style="width:${Math.min(100, v / STAT_MAX * 100)}%"></div></div><span class="stat-val">${v}</span></div>`;
    /* Tutte e tre le abilità sono in elenco, ma quelle non ancora sbloccate
       sono chiuse col lucchetto: si vede cosa c'è da conquistare. */
    const abils = (c.abilTutte || c.abilPool).map(a => {
      const libera = c.abilPool.includes(a);
      const nascosta = sp.abilities.hidden === a;
      return `<span class="chip-wrap">
        <button class="chip ab-chip ${c.ability === a ? "on" : ""} ${libera ? "" : "chiusa"}" data-ab="${a}" ${libera ? "" : "disabled"}>${libera ? "" : "🔒 "}${(ABIL[a] || {}).it || a}${nascosta ? " (H)" : ""}</button>
        <button class="chip-i ${aperto("ab", a) ? "on" : ""}" data-i-ab="${a}" title="cosa fa">ⓘ</button>
      </span>`;
    }).join("");
    /* NATURE: come le abilità, si vedono TUTTE e 25 ma quelle non ancora
       incontrate sono chiuse col lucchetto — così si sa cosa c'è da
       conquistare. Sotto il nome c'è l'effetto, che è l'unica cosa che serve
       davvero per scegliere. */
    /* ⚠️ Le nature sono VENTICINQUE: metterle tutte in elenco come le tre
       abilità riempiva mezza schermata e spingeva le mosse fuori campo (visto
       a schermo). Di base si vedono solo quelle che hai, più un chip che dice
       quante ne restano; toccandolo si apre l'elenco completo col lucchetto,
       che è il punto — sapere cosa c'è da conquistare. */
    const natChiuse = NATURE_KEYS.filter(n => !c.natPool.includes(n));
    const natVisibili = c.natTutte ? NATURE_KEYS : c.natPool;
    const nature = natVisibili.map(n => {
      const libera = c.natPool.includes(n);
      return `<button class="chip nat-chip ${c.nature === n ? "on" : ""} ${libera ? "" : "chiusa"}"
        data-nat="${n}" ${libera ? "" : "disabled"} title="${naturaEffetto(n)}">${libera ? "" : "🔒 "}${NATURES[n].it}
        <span class="nat-eff">${naturaEffetto(n)}</span></button>`;
    }).join("")
    + (natChiuse.length ? `<button class="chip nat-chip nat-piu" data-nat-tutte="1">${c.natTutte ? "− nascondi" : "🔒 +" + natChiuse.length}
        <span class="nat-eff">${c.natTutte ? "le bloccate" : "da scoprire"}</span></button>` : "");
    /* Le mosse da uovo si mostrano in fondo e marcate: sono la ricompensa delle
       schiuse, non qualcosa che hai per diritto. La 4a e' la RARA. */
    const chip = (id, uovo) => {
      const mv = M[id], on = c.moves.includes(id);
      const raro = uovo && isRareEggMove(c.k, id);
      return `<span class="chip-wrap">
        <button class="chip move-chip ${on ? "on" : ""} ${uovo ? "egg" : ""} ${raro ? "rara" : ""}" data-mv="${id}" style="${on ? "background:" + T[mv.type].color : ""}">
          <span class="ticon t-${mv.type}"></span>${uovo ? (raro ? "🥚✨ " : "🥚 ") : ""}${mv.it}</button>
        <button class="chip-i ${aperto("mv", id) ? "on" : ""}" data-i-mv="${id}" title="cosa fa">ⓘ</button>
      </span>`;
    };
    const moves = c.learnPool.map(id => chip(id, false)).join("")
                + c.eggPool.map(id => chip(id, true)).join("");
    /* Quante mosse da uovo restano da scoprire: dice a colpo d'occhio che il
       gacha serve a questo. */
    const eggTot = (EGGM[c.k] || []).length;
    const eggNote = eggTot
      ? `<div class="sd-eggnote">🥚 Mosse da uovo: <b>${c.eggPool.length}/${eggTot}</b> sbloccate${c.eggPool.length < eggTot ? " · si sbloccano facendo schiudere le uova" : ""}</div>`
      : "";
    /* SESSO — si vedono tutti quelli che la specie può avere, chiuso col
       lucchetto quello che non hai ancora trovato. Per le specie a sesso unico
       (Vespiquen) e per quelle senza sesso la riga non ha scelte da offrire:
       si mostra come semplice etichetta, non come pulsantiera finta. */
    const sessiTutti = sessiPossibili(c.k);
    const sessoRiga = sessiTutti[0] === "GENDERLESS"
      ? `<span class="sd-fisso">⚲ senza sesso</span>`
      : sessiTutti.length === 1
        ? `<span class="sd-fisso">${sessiTutti[0] === "MALE" ? "♂ solo maschio" : "♀ solo femmina"}</span>`
        : sessiTutti.map(g => {
            const libera = c.sessoPool.includes(g);
            const m = g === "MALE";
            return `<button class="chip sesso-chip ${m ? "m" : "f"} ${c.gender === g ? "on" : ""} ${libera ? "" : "chiusa"}"
              data-sex="${g}" ${libera ? "" : "disabled"}
              title="${libera ? "" : "trovane uno per sbloccarlo"}">${libera ? "" : "🔒 "}${m ? "♂ maschio" : "♀ femmina"}</button>`;
          }).join("")
          + (c.sessoPool.length < 2 ? `<span class="sd-nota">l'altro si sblocca trovandolo (anche una sua evoluzione)</span>` : "");
    /* FORMA — solo per le specie che ne hanno più d'una e non legata al sesso.
       Quelle non ancora incontrate stanno col lucchetto, come sesso e natura:
       si vede che esistono e che vanno conquistate. */
    const formaRiga = (c.formeTutte && c.formeTutte.length > 1)
      ? c.formeTutte.map(f => {
          const key = f.key || null;
          const libera = c.formePool.some(x => (x.key || null) === key);
          return `<button class="chip forma-chip ${(c.formKey || null) === key ? "on" : ""} ${libera ? "" : "chiusa"}"
            data-forma="${key || ""}" ${libera ? "" : "disabled"}
            title="${libera ? "" : "trovane uno per sbloccarla"}">${libera ? "" : "🔒 "}${f.it || formNameOf(c.k, key) || "base"}</button>`;
        }).join("")
      : "";

    /* LIVREA — appare solo se di quella specie hai un cromatico. La fortuna NON
       dipende da quale scegli: viene dal dex (§33), quindi giocarlo normale non
       ti costa niente. Va detto, o sembra un difetto. */
    const livreaRiga = c.livreaMax != null && meta.unlocked[c.k] === 2
      ? `<button class="chip liv-chip ${!c.shiny ? "on" : ""}" data-liv="-1">normale</button>`
        + [0, 1, 2].filter(v => v <= c.livreaMax).map(v =>
            `<button class="chip liv-chip ${c.shiny && c.shinyVar === v ? "on" : ""}" data-liv="${v}">${cromStella(v)}${["comune", "rara", "epica"][v]}</button>`).join("")
        + `<span class="sd-nota">la fortuna resta ${dexLuck(c.k)}: viene dal dex, non da come lo giochi</span>`
      : "";
    showMetaScreen(`
      <div class="sd-head">
        <div class="sd-sprite-box"><span class="sd-sprite" id="sdSprite"></span></div>
        <div class="sd-id">
          <div class="sd-name">${c.shiny ? cromStella(c.shinyVar) : ""}${sp.it}${genderSymbol({ gender: c.gender })} ${c.pkrs ? '<span class="sb-pkrs">💜</span>' : ""} ${hasRibbon(c.k) ? "🎀" : ""}</div>
          <div class="sd-types">${tipi.map(t => `<span class="ticon t-${t}"></span>`).join("")}</div>
          <div class="sd-passive">Passiva: <b>${(ABIL[sp.passive] || {}).it || "—"}</b>${meta.passiveOn && meta.passiveOn[c.k] ? " ✅" : " 🔒"}</div>
          <div class="sd-passive">Occupa <b>${costoIt(starterCost(c.k))}</b> dei ${STARTER_BUDGET} punti squadra</div>
        </div>
      </div>
      <div class="sd-riga"><span class="sd-lab">🍬 ${candyOf(c.k)}</span><span class="sd-chips">
        ${cutPrice == null
          ? `<span class="sd-nota">costo già al minimo</span>`
          : `<button class="chip candy-btn" data-cc="1" ${candyOf(c.k) >= cutPrice ? "" : "disabled"}>−1 costo · 🍬${cutPrice}</button>`}
        ${meta.passiveOn && meta.passiveOn[c.k]
          ? `<span class="sd-nota">passiva già sbloccata</span>`
          : `<button class="chip candy-btn" data-cp="1" ${candyOf(c.k) >= passivePrice(c.k) ? "" : "disabled"}>Sblocca passiva · 🍬${passivePrice(c.k)}</button>`}
      </span></div>
      <div class="sd-riga"><span class="sd-lab">Sesso</span><span class="sd-chips">${sessoRiga}</span></div>
      ${formaRiga ? `<div class="sd-riga"><span class="sd-lab">Forma</span><span class="sd-chips">${formaRiga}</span></div>` : ""}
      ${livreaRiga ? `<div class="sd-riga"><span class="sd-lab">Livrea</span><span class="sd-chips">${livreaRiga}</span></div>` : ""}
      <div class="sd-riga"><span class="sd-lab">Abilità</span><span class="sd-chips">${abils}</span></div>
      ${c.info && c.info.tipo === "ab" ? snippetAbilita(c.info.id) : ""}
      <div class="sd-riga"><span class="sd-lab">Natura</span><span class="sd-chips">${nature}</span></div>
      <div class="meta-sub">Mosse iniziali (max 4 · scelte ${c.moves.length}/4)</div>
      <div class="move-chips">${moves}</div>
      ${c.info && c.info.tipo === "mv" ? snippetMossa(c.info.id) : ""}
      ${eggNote}
      <!-- ⚠️ Le statistiche vanno DOPO le mosse, non prima. Su questa schermata
           si SCEGLIE (sesso, livrea, abilità, natura, mosse) e si LEGGE (le
           barre delle statistiche). Sul telefono vero la scheda è più alta
           dello schermo, quindi qualcosa finisce sotto la barra dei due tasti:
           deve essere la roba da leggere, mai quella da toccare. Con l'ordine
           di prima le mosse restavano coperte per metà — cioè esattamente il
           difetto segnalato, spostato di dieci pixel. -->
      <div class="sd-stats">
        ${statBar("PS", bs.hp)}${statBar("Att", bs.atk)}${statBar("Dif", bs.def)}
        ${statBar("A.Sp", bs.spatk)}${statBar("D.Sp", bs.spdef)}${statBar("Vel", bs.spd)}
      </div>
      <div class="meta-actions two-col sd-azioni">
        <button class="meta-btn ghost" data-act="back">Indietro</button>
        <button class="meta-btn primary" data-act="go" ${c.moves.length ? "" : "disabled"}>➕ Aggiungi ${sp.it}</button>
      </div>`);
    /* Anteprima: è l'esemplare che schiererai davvero, sesso e livrea comprese.
       Si passa da `loadFighterSprite` e non da `loadSprite` perché per Meowstic
       e compagnia il sesso È una forma, e per le 98 specie con `genderDiffs` la
       femmina ha il suo file. */
    loadFighterSprite({ dex: sp.dex, speciesId: c.k, shiny: c.shiny, shinyVar: c.shinyVar,
                        gender: c.gender, formKey: formaMostrata ? formaMostrata.key : null, variant: null }, "front")
      .then(s => {
        const el = document.getElementById("sdSprite"); if (!el || !s) return;
        const k = Math.min(1.7, 104 / s.frame.h, 104 / s.frame.w);
        el.style.width = s.frame.w * k + "px"; el.style.height = s.frame.h * k + "px";
        el.style.background = `url("${s.sheet}") -${s.frame.x * k}px -${s.frame.y * k}px / ${s.sheet_w * k}px ${s.sheet_h * k}px no-repeat`;
        el.style.imageRendering = "pixelated";
      });
    const ccBtn = metaEl().querySelector("[data-cc]");
    if (ccBtn) ccBtn.onclick = () => {
      const price = costCutPrice(c.k);
      if (price == null || candyOf(c.k) < price) return;
      meta.candy[c.k] -= price;
      meta.costCut = meta.costCut || {};
      meta.costCut[c.k] = (meta.costCut[c.k] || 0) + 1;
      saveMeta(); renderStarterDetail();
    };
    const cpBtn = metaEl().querySelector("[data-cp]");
    if (cpBtn) cpBtn.onclick = () => {
      const price = passivePrice(c.k);
      if (candyOf(c.k) < price) return;
      meta.candy[c.k] -= price;
      meta.passiveOn = meta.passiveOn || {};
      meta.passiveOn[c.k] = true;
      saveMeta(); renderStarterDetail();
    };
    metaEl().querySelectorAll("[data-sex]").forEach(b => b.onclick = () => { c.gender = b.dataset.sex; renderStarterDetail(); });
    metaEl().querySelectorAll("[data-forma]").forEach(b => b.onclick = () => {
      if (b.disabled) return;
      c.formKey = b.dataset.forma || null; renderStarterDetail();
    });
    metaEl().querySelectorAll("[data-liv]").forEach(b => b.onclick = () => {
      const v = parseInt(b.dataset.liv, 10);
      c.shiny = v >= 0; c.shinyVar = v >= 0 ? v : 0;
      renderStarterDetail();
    });
    metaEl().querySelectorAll("[data-ab]").forEach(b => b.onclick = () => { c.ability = b.dataset.ab; renderStarterDetail(); });
    metaEl().querySelectorAll("[data-nat]").forEach(b => b.onclick = () => { c.nature = b.dataset.nat; renderStarterDetail(); });
    const natPiu = metaEl().querySelector("[data-nat-tutte]");
    if (natPiu) natPiu.onclick = () => { c.natTutte = !c.natTutte; renderStarterDetail(); };
    metaEl().querySelectorAll("[data-mv]").forEach(b => b.onclick = () => {
      const id = b.dataset.mv, i = c.moves.indexOf(id);
      if (i >= 0) c.moves.splice(i, 1);
      else if (c.moves.length < 4) c.moves.push(id);
      renderStarterDetail();
    });
    // le ⓘ aprono/chiudono lo snippet "cosa fa"
    metaEl().querySelectorAll("[data-i-ab]").forEach(b => b.onclick = () => apriInfo("ab", b.dataset.iAb));
    metaEl().querySelectorAll("[data-i-mv]").forEach(b => b.onclick = () => apriInfo("mv", b.dataset.iMv));
    metaEl().querySelector('[data-act="back"]').onclick = tornaAllaGrigliaStarter;
    metaEl().querySelector('[data-act="go"]').onclick = () => {
      // aggiunge alla squadra iniziale (sistema a punti), poi torna alla scelta
      starterTeam.push({ k: c.k, ability: c.ability, nature: c.nature, moves: c.moves.slice(),
                         shiny: c.shiny, shinyVar: c.shinyVar, gender: c.gender, pkrs: c.pkrs,
                         formKey: c.formKey || null });
      tornaAllaGrigliaStarter();
    };
  }

  /* ---------------------------------------------------------------------- */
  /*  PREMI TRA LE ONDATE                                                   */
  /* ---------------------------------------------------------------------- */
  /* ----------------------------------------------------------------------
     OGGETTI — valori, tier e pesi presi dal PokeRogue originale
       (modifier-type.ts per gli effetti, init-modifier-pools.ts per i pesi)

     Campi di ogni oggetto:
       tier    COMMON | GREAT | ULTRA | ROGUE | MASTER
       weight  peso DENTRO il tier
       target  "mon"   -> si sceglie A CHI darlo (schermata squadra)
               "party" -> agisce su tutta la squadra
               "run"   -> agisce sulla run (ball, soldi, amuleti, voucher)
       valid   per target "mon": chi puo' riceverlo davvero
       avail   se falso l'oggetto non entra nell'estrazione (come i pesi a 0
               dell'originale, che tolgono le cure quando nessuno e' ferito)
       dyn     richiede una seconda scelta (quale vitamina, quale tipo...)
     ---------------------------------------------------------------------- */
  /* `_avevaOggetto` serve ad AGILTECNICA: distingue «non ho mai tenuto niente»
     da «l'ho perso», che e' la condizione che raddoppia la Velocita'. */
  function addHeld(p, key) { p.held[key] = (p.held[key] || 0) + 1; p._avevaOggetto = true; }
  // Una vitamina: +10% lineare alla statistica base (usata anche dai mystery encounter)
  function boostBase(p, stat) { p.vits[stat] = (p.vits[stat] || 0) + 1; recomputeStats(p); }
  const VITS = ["atk", "def", "spatk", "spdef", "spd", "hp"];
  const VIT_IT = { atk: "ATT", def: "DIF", spatk: "A.SP", spdef: "D.SP", spd: "VEL", hp: "PS" };
  const VIT_NOME = { hp: "PS-su", atk: "Proteina", def: "Ferro", spatk: "Calcio", spdef: "Zinco", spd: "Carburante" };
  /* STRUMENTI X (TempStatStageBooster dell'originale). Non sono vitamine e non
     si chiamano "Poteslot": hanno nome, icona e statistiche loro.
     ⚠️ Le statistiche NON sono le stesse delle vitamine: qui non c'e' PS
     (un "Poteslot PS" non faceva assolutamente nulla, `stages` non ha `hp`)
     e c'e' invece la PRECISIONE. */
  const XITEMS = {
    atk:   { it: "Attacco X",       icon: "x_attack" },
    def:   { it: "Difesa X",        icon: "x_defense" },
    spatk: { it: "Att. Speciale X", icon: "x_sp_atk" },
    spdef: { it: "Dif. Speciale X", icon: "x_sp_def" },
    spd:   { it: "Velocità X",      icon: "x_speed" },
    acc:   { it: "Precisione X",    icon: "x_accuracy" },
  };
  const XITEM_KEYS = Object.keys(XITEMS);

  // Curamuleto: +10% a ogni cura (HEALING_CHARM dell'originale)
  function healMult() { return 1 + 0.1 * (game.charms.healing || 0); }
  // Cura PS come l'originale: il MAGGIORE fra i punti fissi e la percentuale.
  function hpRestore(p, points, percent) {
    const amt = Math.max(Math.floor(p.maxHp * percent / 100), points);
    p.hp = Math.min(p.maxHp, p.hp + Math.ceil(amt * healMult()));
  }
  // C'e' qualche statistica ANDATA GIU'? (i bonus non contano)
  const haCali = p => !!p && Object.values(p.stages || {}).some(v => v < 0);
  /* Azzera i soli stadi NEGATIVI. Ritorna quanti ne ha tolti, cosi' chi chiama
     puo' raccontarlo. */
  function togliCali(p) {
    if (!p) return 0;
    let n = 0;
    for (const k in p.stages) if (p.stages[k] < 0) { p.stages[k] = 0; n++; }
    return n;
  }

  // Predicati per i bersagli validi
  const canHeal   = p => !p.fainted && p.hp < p.maxHp;
  const isDown    = p => p.fainted;
  const hasStatus = p => !p.fainted && !!p.status;
  const needsPp   = p => p.moves.some(m => m.pp < m.maxPp);
  const canPpUp   = p => p.moves.some(m => (m.ppUp || 0) < 3);
  const alive     = p => !p.fainted;
  const someone   = f => () => game.party.some(f);

  // PP Up: +1/5 dei PP base per stadio, fino a 3 stadi (come nei giochi).
  /* 🔴 UNA mossa sola, quella scelta. Prima il ciclo passava su tutte e
     quattro: PP-su e PP-max valevano il quadruplo dell'originale, dove la
     descrizione dice chiaro «i PP di UNA mossa». */
  function applyPpUp(p, stages, indice) {
    const m = p.moves[indice || 0];
    if (!m) return;
    const base = M[m.id].pp;
    const cur = m.ppUp || 0;
    const add = Math.min(stages, 3 - cur);
    if (add <= 0) return;
    m.ppUp = cur + add;
    const gain = Math.floor(base / 5) * add;
    m.maxPp += gain; m.pp += gain;
  }
  /* Mosse che il Pokemon POTREBBE conoscere dal suo learnset ma non ha:
     e' quello che fa ricordare il Fungo della memoria (MEMORY_MUSHROOM). */
  function mosseDimenticate(p) {
    return (LEARN[p.speciesId] || [])
      .filter(([lv, mv]) => lv <= p.level && M[mv] && !p.moves.some(m => m.id === mv))
      .map(([, mv]) => mv);
  }
  // Etere/Elisir: `moves` = quante mosse (1 = quella piu' scarica), `amount` = -1 pieno
  /* `howMany === 1` = una mossa sola: se `indice` c'e', e' quella SCELTA da chi
     gioca (Etere ed Etere max lo chiedono, come nell'originale); se manca si
     ripiega su quella messa peggio. */
  function restorePp(p, howMany, amount, indice) {
    const list = howMany === 1
      ? [indice != null ? p.moves[indice]
                        : p.moves.slice().sort((a, b) => (a.pp / a.maxPp) - (b.pp / b.maxPp))[0]]
      : p.moves;
    for (const m of list) {
      if (!m) continue;
      m.pp = amount < 0 ? m.maxPp : Math.min(m.maxPp, m.pp + amount);
    }
  }
  function addLevels(p, n) {
    p.level += n + (game.charms.candyJar || 0);   // Barattolo di caramelle: +1 livello per caramella
    recomputeStats(p); checkLevelUpsQuiet(p);
  }
  function addBerry(p, kind) { p.berries[kind] = (p.berries[kind] || 0) + 1; }

  /* ----------------------------------------------------------------------
     OGGETTI TENUTI DAGLI AVVERSARI
     Formula dell'originale (`battle-scene.ts`):
       occasioni = ceil(ondata / 10)  (x2,5 sul boss finale)
       per ogni occasione: 1 possibilita' su 18 (su 6 se e' un boss)
       i boss ne ricevono comunque almeno meta' delle occasioni
     I pool sono quelli dedicati (`wildModifierPool` / `trainerModifierPool`),
     diversi da quelli del giocatore.
     ---------------------------------------------------------------------- */
  const POOL_SELVATICO = [
    { w: 8, k: "berry" }, { w: 4, k: "vit" }, { w: 4, k: "typeboost" },
  ];
  const POOL_ALLENATORE = [
    { w: 8, k: "berry" }, { w: 6, k: "vit" }, { w: 5, k: "typeboost" },
    { w: 2, k: "focusband" }, { w: 1, k: "quickclaw" }, { w: 1, k: "gripclaw" },
    { w: 1, k: "widelens" }, { w: 1, k: "kingsrock" }, { w: 1, k: "leftovers" },
    { w: 1, k: "shellbell" }, { w: 1, k: "scopelens" },
  ];
  function pescaOggettoNemico(pool) {
    let tot = pool.reduce((s, x) => s + x.w, 0), r = Math.random() * tot;
    for (const x of pool) { r -= x.w; if (r <= 0) return x.k; }
    return pool[0].k;
  }
  /* Assegna gli oggetti tenuti a un avversario appena creato. */
  function giveEnemyHeldItems(f, isTrainer) {
    const boss = !!f.boss;
    let occasioni = Math.ceil(game.wave / 10);
    if (f.finalBoss) occasioni = Math.ceil(occasioni * 2.5);
    const suUno = boss ? 6 : 18;
    let quanti = 0;
    for (let i = 0; i < occasioni; i++) if (Math.floor(Math.random() * suUno) === 0) quanti++;
    if (boss) quanti = Math.max(quanti, Math.floor(occasioni / 2));
    const pool = isTrainer ? POOL_ALLENATORE : POOL_SELVATICO;
    for (let i = 0; i < quanti; i++) {
      const k = pescaOggettoNemico(pool);
      if (k === "berry") addBerry(f, rndOf(BERRY_KEYS));
      else if (k === "vit") { const s = rndOf(VITS); f.vits[s] = (f.vits[s] || 0) + 1; recomputeStats(f); }
      else if (k === "typeboost") {
        f.held.typeboost = f.held.typeboost || {};
        const t = f.types[0] || "NORMAL";
        f.held.typeboost[t] = (f.held.typeboost[t] || 0) + 1;
      } else addHeld(f, k);
    }
  }
  /* Ruba un oggetto tenuto (o una bacca) da `vittima` a `ladro`.
     E' quello che fanno Presartigli (al contatto) e Piccolo buco nero (a ogni turno). */
  function rubaOggetto(ladro, vittima, messages, chi, verbo) {
    // oggetti "inchiodati": il Piccolo buco nero del boss finale non si può sfilare
    const fissi = vittima._heldFisso || [];
    const chiavi = Object.keys(vittima.held || {})
      .filter(k => k !== "typeboost" && !fissi.includes(k));
    const tipi = (vittima.held && vittima.held.typeboost) ? Object.keys(vittima.held.typeboost) : [];
    const bacche = Object.keys(vittima.berries || {});
    if (!chiavi.length && !tipi.length && !bacche.length) return false;
    const scelta = Math.floor(Math.random() * (chiavi.length + tipi.length + bacche.length));
    let nome;
    if (scelta < chiavi.length) {
      const k = chiavi[scelta];
      vittima.held[k]--; if (!vittima.held[k]) delete vittima.held[k];
      addHeld(ladro, k); nome = HELD_IT[k] || k;
    } else if (scelta < chiavi.length + tipi.length) {
      const t = tipi[scelta - chiavi.length];
      vittima.held.typeboost[t]--; if (!vittima.held.typeboost[t]) delete vittima.held.typeboost[t];
      ladro.held.typeboost = ladro.held.typeboost || {};
      ladro.held.typeboost[t] = (ladro.held.typeboost[t] || 0) + 1;
      nome = nomeTypeBoost(t);
    } else {
      const b = bacche[scelta - chiavi.length - tipi.length];
      vittima.berries[b]--; if (!vittima.berries[b]) delete vittima.berries[b];
      addBerry(ladro, b); nome = BERRY_DATA[b].it;
    }
    // le stat cambiano se l'oggetto rubato era uno di quelli che le alzano
    recomputeStats(ladro); recomputeStats(vittima);
    messages.push(`${chi} di ${ladro.name} ${verbo || "ruba"} ${nome} a ${vittima.name}!`);
    return true;
  }

  /* Disegna la barra degli oggetti tenuti di un combattente. */
  function renderHeldBar(sel, f) {
    const el = document.querySelector(sel);
    if (!el) return;
    const lista = heldIcons(f);
    el.innerHTML = lista.map(o =>
      `<div class="hi" style="background-image:url('${itemIcon(o.icon)}')">${o.n > 1 ? `<span>${o.n}</span>` : ""}</div>`).join("");
  }

  /* Elenco compatto degli oggetti tenuti, per la barra in scena. */
  function heldIcons(f) {
    if (!f) return [];
    const out = [];
    for (const k in (f.held || {})) {
      if (k === "typeboost") { for (const t in f.held.typeboost) out.push({ icon: TYPEBOOST_ICON[t] || "silk_scarf", n: f.held.typeboost[t] }); continue; }
      const b = SPECIE_BOOST[k];
      out.push({ icon: b ? b.icon : (HELD_ICON[k] || "leftovers"), n: f.held[k] });
    }
    for (const k in (f.berries || {})) out.push({ icon: BERRY_DATA[k].icon, n: f.berries[k] });
    return out;
  }
  const HELD_ICON = {
    leftovers: "leftovers", shellbell: "shell_bell", focusband: "focus_band",
    quickclaw: "quick_claw", kingsrock: "kings_rock", scopelens: "scope_lens",
    widelens: "wide_lens", multilens: "multi_lens", eviolite: "eviolite",
    reviverseed: "reviver_seed", toxicorb: "toxic_orb", flameorb: "flame_orb",
    souldew: "soul_dew", leek: "leek", mysticalrock: "mystical_rock",
    gripclaw: "grip_claw", blackhole: "mini_black_hole",
  };

  /* ----------------------------------------------------------------------
     OGGETTI LEGATI ALLA SPECIE (SpeciesStatBooster dell'originale):
     raddoppiano una statistica, ma SOLO per le specie giuste. Vengono proposti
     solo se hai in squadra un Pokemon che li userebbe.
     ---------------------------------------------------------------------- */
  const SPECIE_BOOST = {
    lightball:  { it: "Elettropalla",  icon: "light_ball",     stats: ["atk", "spatk"], mult: 2, specie: ["PIKACHU"] },
    thickclub:  { it: "Osso spesso",    icon: "thick_club",     stats: ["atk"],          mult: 2, specie: ["CUBONE", "MAROWAK"] },
    metalpowder:{ it: "Metalpolvere",icon: "metal_powder",   stats: ["def"],          mult: 2, specie: ["DITTO"] },
    quickpowder:{ it: "Velopolvere",icon:"quick_powder",   stats: ["spd"],          mult: 2, specie: ["DITTO"] },
    deepseascale:{it: "Squamabissi", icon: "deep_sea_scale", stats: ["spdef"],        mult: 2, specie: ["CLAMPERL"] },
    deepseatooth:{it: "Dente Abissi",  icon: "deep_sea_tooth", stats: ["spatk"],        mult: 2, specie: ["CLAMPERL"] },
  };
  const SPECIE_BOOST_KEYS = Object.keys(SPECIE_BOOST);
  // Chi in squadra userebbe questo oggetto?
  const chiUsaBoost = k => aliveParty().filter(p => SPECIE_BOOST[k].specie.includes(p.speciesId));
  const boostSpecieDisponibili = () => SPECIE_BOOST_KEYS.filter(k => chiUsaBoost(k).length > 0);
  /* Moltiplicatore su una stat dato dagli oggetti-specie tenuti. */
  function specieBoostMult(f, stat) {
    let m = 1;
    for (const k in (f.held || {})) {
      const b = SPECIE_BOOST[k];
      if (b && b.specie.includes(f.speciesId) && b.stats.includes(stat)) m *= b.mult;
    }
    return m;
  }

  /* ---------------------------------------------------------------------- */
  /*  MT (Macchine Tecniche)                                                */
  /*  `TMS.perSpecie[specie]` = mosse insegnabili · `TMS.tier[mossa]` = rarita'
      (COMMON/GREAT/ULTRA), esattamente come `tm-pool-tiers.ts` dell'originale. */
  /* ---------------------------------------------------------------------- */
  // Chi in squadra puo' imparare questa mossa (e non la conosce gia')
  function chiPuoImparare(moveId) {
    return game.party.filter(p =>
      !p.fainted
      && (TMS.perSpecie[p.speciesId] || []).includes(moveId)
      && !p.moves.some(m => m.id === moveId));
  }
  /* Una MT a caso del tier richiesto, ma SOLO fra quelle che qualcuno in
     squadra puo' davvero imparare (l'originale filtra allo stesso modo). */
  function randomTm(tier) {
    const cand = Object.keys(TMS.tier).filter(mv =>
      TMS.tier[mv] === tier && M[mv] && chiPuoImparare(mv).length > 0);
    return cand.length ? cand[Math.floor(Math.random() * cand.length)] : null;
  }
  /* Insegna una MT: mette in coda l'apprendimento e riusa la schermata di
     sostituzione mossa che il gioco ha gia' (`processLearns`). */
  function insegnaTm(moveId, mon) {
    const p = mon || chiPuoImparare(moveId)[0];
    if (!p) return false;
    if (p.moves.length < 4) {
      p.moves.push({ id: moveId, pp: M[moveId].pp, maxPp: M[moveId].pp });
      return true;
    }
    game.pendingLearns.push({ mon: p, moveId });
    return true;
  }
  // Soldi di un'ondata, come getWaveMoneyAmount dell'originale: serve sia per i
  // prezzi del negozio sia per il valore delle pepite.
  function waveMoney(mult) {
    const w = game.wave || 1, set = Math.ceil(w / 10) - 1;
    const v = Math.pow((set + 1 + (0.75 + (((w - 1) % 10) + 1) / 10)) * 100, 1 + 0.005 * set) * (mult || 1);
    return Math.floor(v / 10) * 10;
  }

  const REWARD_POOL = [
    /* ===================== COMMON ===================== */
    { tier: "COMMON", weight: 6, id: "balls", label: "Poké Ball ×5", desc: "cattura ×1", icon: "pb", ball: true,
      target: "run", apply: () => { game.balls += 5; } },
    { tier: "COMMON", weight: 3, id: "potion", label: "Pozione", desc: "cura 20 PS o il 10%", icon: "potion",
      target: "mon", valid: canHeal, avail: someone(canHeal), apply: p => hpRestore(p, 20, 10) },
    { tier: "COMMON", weight: 3, id: "superpotion", label: "Superpozione", desc: "cura 50 PS o il 25%", icon: "super_potion",
      target: "mon", valid: canHeal, avail: someone(canHeal), apply: p => hpRestore(p, 50, 25) },
    { tier: "COMMON", weight: 3, id: "ether", label: "Etere", desc: "+10 PP a una mossa che scegli tu", icon: "ether",
      target: "mon", mossa: true, valid: needsPp, avail: someone(needsPp), apply: (p, pk, i) => restorePp(p, 1, 10, i) },
    { tier: "COMMON", weight: 3, id: "maxether", label: "Etere max", desc: "PP pieni a una mossa che scegli tu", icon: "max_ether",
      target: "mon", mossa: true, valid: needsPp, avail: someone(needsPp), apply: (p, pk, i) => restorePp(p, 1, -1, i) },
    { tier: "COMMON", weight: 2, id: "candy", label: "Caramella rara", desc: "+1 livello", icon: "rare_candy",
      target: "mon", valid: alive, apply: p => addLevels(p, 1) },
    { tier: "COMMON", weight: 2, id: "berry", label: "Bacca", desc: "held: si attiva da sola in lotta", icon: "sitrus_berry",
      target: "mon", valid: alive, dyn: "berry", apply: (p, pk) => addBerry(p, pk.berry) },
    { tier: "COMMON", weight: 4, id: "xitem", label: "Strumento X", desc: "+20% a una statistica per 5 ondate", icon: "x_attack",
      target: "run", dyn: "xstat", apply: (p, pk) => {
        game.tempBoostN = game.tempBoostN || {};
        // se ne hai gia' uno attivo si somma, se no si riparte da un pezzo
        game.tempBoostN[pk.stat] = (game.tempBoost[pk.stat] > 0 ? (game.tempBoostN[pk.stat] || 1) : 0) + 1;
        game.tempBoost[pk.stat] = 5;
      } },
    { tier: "COMMON", weight: 4, id: "lure", label: "Esca", desc: "più lotte in doppio", icon: "lure",
      target: "run", avail: () => (game.charms.lure || 0) < 3,
      apply: () => { game.charms.lure = (game.charms.lure || 0) + 1; } },
    { tier: "COMMON", weight: 2, id: "tmcommon", label: "MT", desc: "insegna una mossa", icon: "tm_normal",
      target: "run", dyn: "tm", tmTier: "COMMON", avail: () => !!randomTm("COMMON"),
      apply: (p, pk) => insegnaTm(pk.tm) },

    /* ===================== GREAT ====================== */
    { tier: "GREAT", weight: 6, id: "greatballs", label: "Mega Ball ×5", desc: "cattura ×1,5", icon: "gb", ball: true,
      target: "run", apply: () => { game.greatballs += 5; } },
    { tier: "GREAT", weight: 3, id: "hyperpotion", label: "Iperpozione", desc: "cura 200 PS o il 50%", icon: "hyper_potion",
      target: "mon", valid: canHeal, avail: someone(canHeal), apply: p => hpRestore(p, 200, 50) },
    { tier: "GREAT", weight: 3, id: "maxpotion", label: "Pozione max", desc: "PS pieni", icon: "max_potion",
      target: "mon", valid: canHeal, avail: someone(canHeal), apply: p => { p.hp = p.maxHp; } },
    { tier: "GREAT", weight: 3, id: "fullrestore", label: "Ricarica totale", desc: "PS pieni e cura lo stato", icon: "full_restore",
      target: "mon", valid: p => canHeal(p) || hasStatus(p), avail: someone(p => canHeal(p) || hasStatus(p)),
      apply: p => { p.hp = p.maxHp; p.status = null; } },
    { tier: "GREAT", weight: 3, id: "fullheal", label: "Cura totale", desc: "cura lo stato", icon: "full_heal",
      target: "mon", valid: hasStatus, avail: someone(hasStatus), apply: p => { p.status = null; } },
    { tier: "GREAT", weight: 3, id: "revive", label: "Revitalizzante", desc: "rianima al 50%", icon: "revive",
      target: "mon", valid: isDown, avail: someone(isDown), apply: p => { p.fainted = false; p.hp = Math.floor(p.maxHp / 2); } },
    { tier: "GREAT", weight: 2, id: "maxrevive", label: "Revitalizzante max", desc: "rianima a PS pieni", icon: "max_revive",
      target: "mon", valid: isDown, avail: someone(isDown), apply: p => { p.fainted = false; p.hp = p.maxHp; } },
    { tier: "GREAT", weight: 1, id: "sacredash", label: "Cenere magica", desc: "rianima TUTTA la squadra", icon: "sacred_ash",
      target: "party", avail: someone(isDown), apply: () => { for (const q of game.party) if (q.fainted) { q.fainted = false; q.hp = q.maxHp; } } },
    { tier: "GREAT", weight: 3, id: "elisir", label: "Elisir", desc: "+10 PP a tutte le mosse", icon: "elixir",
      target: "mon", valid: needsPp, avail: someone(needsPp), apply: p => restorePp(p, 99, 10) },
    { tier: "GREAT", weight: 3, id: "maxelisir", label: "Elisir max", desc: "PP pieni a tutte le mosse", icon: "max_elixir",
      target: "mon", valid: needsPp, avail: someone(needsPp), apply: p => restorePp(p, 99, -1) },
    { tier: "GREAT", weight: 2, id: "ppup", label: "PP-su", desc: "alza i PP massimi di una mossa che scegli tu", icon: "pp_up",
      target: "mon", mossa: true, ppUp: true, valid: canPpUp, avail: someone(canPpUp), apply: (p, pk, i) => applyPpUp(p, 1, i) },
    { tier: "GREAT", weight: 3, id: "vit", label: "Vitamina", desc: "+10% a una statistica base", icon: "protein",
      target: "mon", valid: alive, dyn: "stat", apply: (p, pk) => { p.vits[pk.stat] = (p.vits[pk.stat] || 0) + 1; recomputeStats(p); } },
    /* Le pepite dicono QUANTO valgono: dipende dall'ondata, quindi la
       descrizione e' una funzione (come `getDescription` dell'originale, che
       scrive "una contenuta quantita' di soldi (₽1.234)"). */
    { tier: "GREAT", weight: 5, id: "nugget", label: "Pepita", desc: () => `soldi in quantità contenuta (₽${waveMoney(1)})`, icon: "nugget",
      target: "run", apply: () => { game.money += waveMoney(1); } },
    { tier: "GREAT", weight: 4, id: "direhit", label: "Supercolpo", desc: "+1 brutto colpo per 5 ondate", icon: "dire_hit",
      target: "run", apply: () => { game.tempBoost.crit = 5; } },
    { tier: "GREAT", weight: 4, id: "stone", label: "Pietra evolutiva", desc: "fa evolvere chi può usarla", icon: "fire_stone",
      target: "run", dyn: "stone", avail: () => usefulStones().length > 0, apply: (p, pk) => { game.stones[pk.stone] = (game.stones[pk.stone] || 0) + 1; } },
    { tier: "GREAT", weight: 1, id: "map", label: "Mappa", desc: "ti fa scegliere dove andare", icon: "map",
      target: "run", avail: () => !game.charms.map, apply: () => { game.charms.map = 1; } },
    { tier: "GREAT", weight: 1, id: "voucher", label: "Buono Uovo", desc: "+1 tiro al gacha", icon: "coupon",
      target: "run", apply: () => { meta.vouchers += 1; saveMeta(); } },
    { tier: "GREAT", weight: 3, id: "tmgreat", label: "MT", desc: "insegna una mossa", icon: "tm_normal",
      target: "run", dyn: "tm", tmTier: "GREAT", avail: () => !!randomTm("GREAT"),
      apply: (p, pk) => insegnaTm(pk.tm) },
    { tier: "GREAT", weight: 2, id: "speciesboost", label: "Strumento di specie", desc: "raddoppia una stat a chi lo sa usare", icon: "light_ball",
      target: "mon", dyn: "specieboost", avail: () => boostSpecieDisponibili().length > 0,
      valid: p => boostSpecieDisponibili().some(k => SPECIE_BOOST[k].specie.includes(p.speciesId)),
      apply: (p, pk) => addHeld(p, pk.boost) },
    { tier: "GREAT", weight: 3, id: "mushroom", label: "Fungo della memoria", desc: "fa ricordare una mossa dimenticata", icon: "big_mushroom",
      target: "mon", valid: p => mosseDimenticate(p).length > 0, avail: someone(p => mosseDimenticate(p).length > 0),
      /* 🔴 Sceglie CHI la ricorda, non il gioco. Nell'originale
         (`RememberMoveModifierType`) la mossa e' un argomento che arriva dal
         giocatore: gli si mette davanti l'elenco di quelle dimenticate.
         Da noi ne pescava una a caso, e su un Pokemon con dieci mosse
         imparate per livello voleva dire prendere quella sbagliata quasi
         sempre. */
      ricorda: true,
      apply: (p, pk, id) => insegnaTm(id || rndOf(mosseDimenticate(p)), p) },

    /* ===================== ULTRA ====================== */
    /* Toglie SOLO i cali, i bonus restano. Serve quando esci da una lotta
       conciato male: gli sbalzi restano addosso finche' non rientri nella
       ball, e rientrare vuol dire perdere anche quelli buoni.
       ⚠️ `avail` lo fa comparire fra i premi solo quando c'e' davvero
       qualcosa da togliere: un premio che non fa niente e' peggio di un
       premio che non c'e'. All'emporio invece sta sempre sullo scaffale. */
    { tier: "GREAT", weight: 10, id: "riequilibrante", label: "Riequilibrante",
      desc: "azzera i cali di statistica (i bonus restano)", icon: "riequilibrante",
      target: "run", avail: () => haCali(game.player),
      apply: () => togliCali(game.player) },
    { tier: "ULTRA", weight: 6, id: "ultraballs", label: "Ultra Ball ×5", desc: "cattura ×2", icon: "ub", ball: true,
      target: "run", apply: () => { game.ultraballs += 5; } },
    { tier: "ULTRA", weight: 9, id: "typeboost", label: "Strumento di tipo", desc: "held: +20% alle mosse di un tipo", icon: "charcoal",
      target: "mon", valid: alive, dyn: "type",
      apply: (p, pk) => { p.held.typeboost = p.held.typeboost || {}; p.held.typeboost[pk.type] = (p.held.typeboost[pk.type] || 0) + 1; } },
    { tier: "ULTRA", weight: 12, id: "bignugget", label: "Granpepita", desc: () => `soldi in quantità moderata (₽${waveMoney(2.5)})`, icon: "big_nugget",
      target: "run", apply: () => { game.money += waveMoney(2.5); } },
    { tier: "ULTRA", weight: 3, id: "ppmax", label: "PP-max", desc: "PP massimi al massimo su una mossa che scegli tu", icon: "pp_max",
      target: "mon", mossa: true, ppUp: true, valid: canPpUp, avail: someone(canPpUp), apply: (p, pk, i) => applyPpUp(p, 3, i) },
    { tier: "ULTRA", weight: 4, id: "rarercandy", label: "Caramella rarissima", desc: "+1 livello a TUTTA la squadra", icon: "rarer_candy",
      target: "party", apply: () => { for (const q of game.party) addLevels(q, 1); } },
    { tier: "ULTRA", weight: 4, id: "reviverseed", label: "Revitalseme", desc: "held: rianima una volta al 50%", icon: "reviver_seed",
      target: "mon", valid: alive, apply: p => addHeld(p, "reviverseed") },
    { tier: "ULTRA", weight: 3, id: "quickclaw", label: "Rapidartigli", desc: "held: 10% di attaccare per primo", icon: "quick_claw",
      target: "mon", valid: alive, apply: p => addHeld(p, "quickclaw") },
    { tier: "ULTRA", weight: 7, id: "widelens", label: "Grandelente", desc: "held: +5% precisione", icon: "wide_lens",
      target: "mon", valid: alive, apply: p => addHeld(p, "widelens") },
    { tier: "ULTRA", weight: 4, id: "eviolite", label: "Evolcondensa", desc: "held: +50% difese se non evoluto", icon: "eviolite",
      target: "mon", valid: p => alive(p) && (S[p.speciesId].evolutions || []).length > 0, apply: p => addHeld(p, "eviolite") },
    { tier: "ULTRA", weight: 3, id: "toxicorb", label: "Tossicsfera", desc: "held: ti avvelena a fine turno", icon: "toxic_orb",
      target: "mon", valid: alive, apply: p => addHeld(p, "toxicorb") },
    { tier: "ULTRA", weight: 3, id: "flameorb", label: "Fiammosfera", desc: "held: ti scotta a fine turno", icon: "flame_orb",
      target: "mon", valid: alive, apply: p => addHeld(p, "flameorb") },
    { tier: "ULTRA", weight: 5, id: "candyjar", label: "Barattolo di caramelle", desc: "+1 livello per ogni caramella", icon: "candy_jar",
      target: "run", apply: () => { game.charms.candyJar = (game.charms.candyJar || 0) + 1; } },
    { tier: "ULTRA", weight: 8, id: "expcharm", label: "Esperienzamuleto", desc: "+25% esperienza", icon: "exp_charm",
      target: "run", apply: () => { game.charms.exp = (game.charms.exp || 0) + 25; } },
    { tier: "ULTRA", weight: 3, id: "amulet", label: "Monetamuleto", desc: "+20% soldi", icon: "amulet_coin",
      target: "run", apply: () => { game.charms.amulet = (game.charms.amulet || 0) + 1; } },
    { tier: "ULTRA", weight: 2, id: "goldenpunch", label: "Pugno dorato", desc: "il danno inflitto frutta soldi", icon: "golden_punch",
      target: "run", apply: () => { game.charms.goldenPunch = (game.charms.goldenPunch || 0) + 1; } },
    { tier: "ULTRA", weight: 4, id: "ivscanner", label: "Scanner IV", desc: "mostra gli IV degli avversari", icon: "iv_scanner",
      target: "run", avail: () => !game.charms.ivScanner, apply: () => { game.charms.ivScanner = 1; } },
    { tier: "ULTRA", weight: 4, id: "rarestone", label: "Pietra rara", desc: "una pietra evolutiva rara", icon: "sun_stone",
      target: "run", dyn: "stone", avail: () => usefulStones().length > 0, apply: (p, pk) => { game.stones[pk.stone] = (game.stones[pk.stone] || 0) + 1; } },
    { tier: "ULTRA", weight: 11, id: "tmultra", label: "MT", desc: "insegna una mossa forte", icon: "tm_normal",
      target: "run", dyn: "tm", tmTier: "ULTRA", avail: () => !!randomTm("ULTRA"),
      apply: (p, pk) => insegnaTm(pk.tm) },
    { tier: "ULTRA", weight: 4, id: "mint", label: "Menta", desc: "cambia la natura di un Pokémon", icon: "mint",
      target: "mon", valid: alive, dyn: "nature",
      /* 🔴 Cambiava la natura e basta. Nell'originale la Menta chiama
         `unlockSpeciesNature`, cioe' quella natura entra nel DEX e da li' in
         poi la puoi scegliere quando schieri quella specie come starter — e'
         proprio il modo di collezionarle senza andare a caccia di esemplari.
         Come per cattura e schiusa si registra sul CAPOSTIPITE, che e' quello
         che si schiera (nell'originale sblocca specie + preevoluzioni: per noi
         `rootOf` e' la stessa cosa). */
      apply: (p, pk) => {
        p.nature = pk.nature; recomputeStats(p);
        const nuova = registraNatura(rootOf(p.speciesId), pk.nature);
        if (nuova) {
          saveMeta();
          game.pendingLearns = game.pendingLearns || [];
          game.pendingLearns.push({ soloTesto: `🌱 Nuova natura sbloccata per ${S[rootOf(p.speciesId)].it}: ${nuova}` });
        }
      } },

    /* ===================== ROGUE ====================== */
    { tier: "ROGUE", weight: 6, id: "rogueballs", label: "Rogue Ball ×5", desc: "cattura ×3", icon: "rb", ball: true,
      target: "run", apply: () => { game.rogueballs = (game.rogueballs || 0) + 5; } },
    { tier: "ROGUE", weight: 3, id: "leftovers", label: "Avanzi", desc: "held: rigenera 1/16 a fine turno", icon: "leftovers",
      target: "mon", valid: alive, apply: p => addHeld(p, "leftovers") },
    { tier: "ROGUE", weight: 3, id: "shellbell", label: "Conchinella", desc: "held: recuperi 1/8 del danno", icon: "shell_bell",
      target: "mon", valid: alive, apply: p => addHeld(p, "shellbell") },
    { tier: "ROGUE", weight: 5, id: "focusband", label: "Bandana", desc: "held: 10% di resistere con 1 PS", icon: "focus_band",
      target: "mon", valid: alive, apply: p => addHeld(p, "focusband") },
    { tier: "ROGUE", weight: 3, id: "kingsrock", label: "Roccia di re", desc: "held: 10% di far tentennare", icon: "kings_rock",
      target: "mon", valid: alive, apply: p => addHeld(p, "kingsrock") },
    { tier: "ROGUE", weight: 4, id: "scopelens", label: "Mirino", desc: "held: +1 stadio di brutto colpo", icon: "scope_lens",
      target: "mon", valid: alive, apply: p => addHeld(p, "scopelens") },
    { tier: "ROGUE", weight: 7, id: "souldew", label: "Cuorugiada", desc: "held: rinforza l'effetto della natura", icon: "soul_dew",
      target: "mon", valid: p => alive(p) && NATURES[p.nature] && NATURES[p.nature].su,
      apply: p => addHeld(p, "souldew") },
    { tier: "ULTRA", weight: 3, id: "mysticalrock", label: "Rocciamistica", desc: "held: il meteo dura più a lungo", icon: "mystical_rock",
      target: "mon", valid: alive, apply: p => addHeld(p, "mysticalrock") },
    { tier: "ULTRA", weight: 3, id: "leek", label: "Porro", desc: "held: brutto colpo quasi garantito", icon: "leek",
      target: "mon", valid: p => alive(p) && ["FARFETCHD", "SIRFETCHD"].includes(p.speciesId),
      avail: () => aliveParty().some(p => ["FARFETCHD", "SIRFETCHD"].includes(p.speciesId)),
      apply: p => addHeld(p, "leek") },
    { tier: "ROGUE", weight: 4, id: "berrypouch", label: "Porta bacche", desc: "30% di non consumare le bacche", icon: "berry_pouch",
      target: "run", apply: () => { game.charms.berryPouch = (game.charms.berryPouch || 0) + 1; } },
    { tier: "ROGUE", weight: 2, id: "relicgold", label: "Dobloantico", desc: () => `soldi in grande quantità (₽${waveMoney(10)})`, icon: "relic_gold",
      target: "run", apply: () => { game.money += waveMoney(10); } },
    { tier: "ROGUE", weight: 8, id: "superexpcharm", label: "Esperienzamuleto super", desc: "+60% esperienza", icon: "super_exp_charm",
      target: "run", apply: () => { game.charms.exp = (game.charms.exp || 0) + 60; } },
    { tier: "ROGUE", weight: 4, id: "catchingcharm", label: "Catturamuleto", desc: "più catture critiche", icon: "catching_charm",
      target: "run", apply: () => { game.charms.catching = (game.charms.catching || 0) + 1; } },
    { tier: "ROGUE", weight: 6, id: "abilitycharm", label: "Abilitamuleto", desc: "i selvatici hanno l'abilità nascosta", icon: "ability_charm",
      target: "run", apply: () => { game.charms.ability = (game.charms.ability || 0) + 1; } },
    { tier: "ROGUE", weight: 3, id: "megaRing", label: "Megapolsiera", desc: "sblocca la megaevoluzione", icon: "mega_bracelet",
      target: "run", avail: () => !game.hasMegaRing, apply: () => { game.hasMegaRing = true; } },
    { tier: "ROGUE", weight: 3, id: "dynamaxBand", label: "Polsino Dynamax", desc: "sblocca la gigamaxizzazione", icon: "dynamax_band",
      target: "run", avail: () => !game.hasDynamaxBand, apply: () => { game.hasDynamaxBand = true; } },
    { tier: "ROGUE", weight: 2, id: "voucherplus", label: "Buono Uovo Plus", desc: "+5 tiri al gacha", icon: "coupon",
      target: "run", apply: () => { meta.vouchers += 5; saveMeta(); } },

    /* ===================== MASTER ===================== */
    { tier: "MASTER", weight: 6, id: "masterball", label: "Master Ball", desc: "cattura garantita", icon: "mb", ball: true,
      target: "run", apply: () => { game.masterballs = (game.masterballs || 0) + 1; } },
    { tier: "MASTER", weight: 14, id: "shinycharm", label: "Cromamuleto", desc: "molti più cromatici", icon: "shiny_charm",
      target: "run", apply: () => { game.charms.shiny = (game.charms.shiny || 0) + 1; } },
    { tier: "MASTER", weight: 18, id: "healingcharm", label: "Curamuleto", desc: "+10% a tutte le cure", icon: "healing_charm",
      target: "run", apply: () => { game.charms.healing = (game.charms.healing || 0) + 1; } },
    { tier: "MASTER", weight: 18, id: "multilens", label: "Multilente", desc: "held: un colpo in più a danno ridotto", icon: "multi_lens",
      target: "mon", valid: alive, apply: p => addHeld(p, "multilens") },
    { tier: "ROGUE", weight: 5, id: "gripclaw", label: "Presartigli", desc: "held: 10% di rubare un oggetto al contatto", icon: "grip_claw",
      target: "mon", valid: alive, apply: p => addHeld(p, "gripclaw") },
    { tier: "MASTER", weight: 10, id: "blackhole", label: "Piccolo buco nero", desc: "held: ruba un oggetto ogni turno", icon: "mini_black_hole",
      target: "mon", valid: alive, apply: p => addHeld(p, "blackhole") },
    { tier: "MASTER", weight: 4, id: "voucherpremium", label: "Buono Uovo Premium", desc: "+10 tiri al gacha", icon: "coupon",
      target: "run", apply: () => { meta.vouchers += 10; saveMeta(); } },

    /* ============ bottino esclusivo dei team cattivi ============ */
    // Non entra nell'estrazione (weight 0): lo si ottiene solo battendoli.
    { tier: "ROGUE", weight: 0, id: "theft", label: "Clepto Ball", desc: "ruba un Pokémon a un allenatore", icon: "tb", ball: true,
      target: "run", apply: (p, pk) => { game.theftballs = (game.theftballs || 0) + (pk.qty || 1); } },
  ];
  /* ======================================================================
     LE MOSSE SPECIALI, gruppo per gruppo.
     Si registrano qui in fondo perche' hanno bisogno di quasi tutto il motore;
     la tabella `MOSSE_SPECIALI` e' dichiarata in cima ed e' letta solo a
     runtime, quindi l'ordine va bene.
     ====================================================================== */

  // ---------------------------------------------------------------- MALEDIZIONE
  /* Due mosse in una: da SPETTRO paga meta' PS e maledice, da chiunque altro
     e' un buff su di se'. Nell'originale e' la classe `CurseAttr`. */
  MOSSE_SPECIALI.CURSE = (actor, foe, move, messages) => {
    if (actor.types.includes("GHOST")) {
      if (foe.fainted || foe.volatile.curse) { stessoMomento(messages, "Ma non ha funzionato!"); return; }
      const costo = Math.max(1, Math.floor(actor.maxHp / 2));
      actor.hp = Math.max(0, actor.hp - costo); actor._justHit = true;
      foe.volatile.curse = true;
      messages.push(`${actor.name} sacrifica metà dei suoi PS per lanciare una maledizione su ${foe.name}!`);
      if (actor.hp <= 0) { actor.fainted = true; messages.push(`${actor.name} è esausto!`); }
    } else {
      applyStatStage(actor, ["ATK", "DEF"], 1, messages, true);
      applyStatStage(actor, ["SPD"], -1, messages, true);
    }
  };

  // -------------------------------------------------------------- GLI SCHERMI
  /* Durano 5 turni. Velaurora ne vuole due in uno ma si puo' usare SOLO con
     neve o grandine, come nell'originale. */
  MOSSE_SPECIALI.REFLECT      = (a, f, m, msg) => accendiLato(a, "reflect", 5, msg);
  MOSSE_SPECIALI.LIGHT_SCREEN = (a, f, m, msg) => accendiLato(a, "lightscreen", 5, msg);
  MOSSE_SPECIALI.SAFEGUARD    = (a, f, m, msg) => accendiLato(a, "safeguard", 5, msg);
  MOSSE_SPECIALI.MIST         = (a, f, m, msg) => accendiLato(a, "mist", 5, msg);
  MOSSE_SPECIALI.LUCKY_CHANT  = (a, f, m, msg) => accendiLato(a, "luckychant", 5, msg);
  MOSSE_SPECIALI.TAILWIND     = (a, f, m, msg) => accendiLato(a, "tailwind", 4, msg);
  MOSSE_SPECIALI.AURORA_VEIL  = (a, f, m, msg) => {
    const w = weatherKind();
    if (w !== "HAIL" && w !== "SNOW") { stessoMomento(msg, "Ma non ha funzionato: serve la neve!"); return; }
    accendiLato(a, "auroravelo", 5, msg);
  };

  // ------------------------------------------------------- TRAPPOLE D'INGRESSO
  /* Si mettono sul lato AVVERSARIO e restano finche' dura la lotta. Le Punte si
     accumulano fino a tre strati, le Fielepunte fino a due (col secondo il
     veleno diventa grave: da noi il veleno e' uno solo, quindi il secondo
     strato non aggiunge niente e la mossa lo dice). */
  MOSSE_SPECIALI.SPIKES = (a, f, m, msg) => {
    const L = latoDiFronte(a);
    if (L.spikes >= 3) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    L.spikes++;
    msg.push(`Punte sparse ai piedi della squadra ${nomeLato(f)}!`);
  };
  /* Il SECONDO strato di Fielepunte ipervelena invece di avvelenare: adesso
     che l'iperavvelenamento esiste, la differenza si sente davvero. */
  MOSSE_SPECIALI.TOXIC_SPIKES = (a, f, m, msg) => {
    const L = latoDiFronte(a);
    if (L.toxicspikes >= 2) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    L.toxicspikes++;
    msg.push(`Fielepunte sparse ai piedi della squadra ${nomeLato(f)}!`);
  };
  MOSSE_SPECIALI.STEALTH_ROCK = (a, f, m, msg) => {
    const L = latoDiFronte(a);
    if (L.stealthrock) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    L.stealthrock = 1;
    msg.push(`Pietre levitanti fluttuano attorno alla squadra ${nomeLato(f)}!`);
  };
  MOSSE_SPECIALI.STICKY_WEB = (a, f, m, msg) => {
    const L = latoDiFronte(a);
    if (L.stickyweb) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    L.stickyweb = 1;
    msg.push(`Una rete vischiosa avvolge i piedi della squadra ${nomeLato(f)}!`);
  };

  // ------------------------------------------------------- CURE E RECUPERI
  /* Aiutini comuni a tutto il gruppo. */
  const curaPS = (f, quota, messages, testo) => {
    if (f.volatile && f.volatile.anticura > 0) { stessoMomento(messages, `${f.name} non può curarsi!`); return false; }
    if (f.hp >= f.maxHp) { stessoMomento(messages, "Ma i PS erano già pieni!"); return false; }
    f.hp = Math.min(f.maxHp, f.hp + Math.max(1, Math.floor(f.maxHp * quota)));
    messages.push(testo || `${f.name} recupera energie!`);
    if (messages.anim) messages.anim("COMMON_HEALTH_UP", sideOf(f));
    return true;
  };
  /* Le cure che dipendono dal METEO: meta' PS col sereno, due terzi col sole,
     un quarto con qualunque altro tempo. E' la regola dell'originale. */
  const curaMeteo = (f, messages) => {
    const w = weatherKind();
    const quota = !w ? 0.5 : (w === "SUN" ? 2 / 3 : 0.25);
    return curaPS(f, quota, messages);
  };

  /* RIPOSO: PS pieni, ma ci si addormenta per due turni. ⚠️ Il sonno se lo
     da' da solo, quindi NON passa da `applyStatus` (che la Salvaguardia
     bloccherebbe, e sarebbe sbagliato). */
  MOSSE_SPECIALI.REST = (a, f, m, msg) => {
    if (a.hp >= a.maxHp) { stessoMomento(msg, "Ma i PS erano già pieni!"); return; }
    a.hp = a.maxHp; a.status = "SLEEP"; a.sleepTurns = 2;
    msg.push(`${a.name} si addormenta e recupera tutti i PS!`);
    if (msg.anim) msg.anim("COMMON_HEALTH_UP", sideOf(a));
  };
  MOSSE_SPECIALI.SYNTHESIS   = (a, f, m, msg) => curaMeteo(a, msg);
  MOSSE_SPECIALI.MOONLIGHT   = (a, f, m, msg) => curaMeteo(a, msg);
  MOSSE_SPECIALI.MORNING_SUN = (a, f, m, msg) => curaMeteo(a, msg);
  MOSSE_SPECIALI.SHORE_UP    = (a, f, m, msg) =>
    curaPS(a, weatherKind() === "SANDSTORM" ? 2 / 3 : 0.5, msg);
  MOSSE_SPECIALI.FLORAL_HEALING = (a, f, m, msg) => {
    const chi = f && !f.fainted ? f : a;
    curaPS(chi, terrainKind() === "GRASSY" ? 2 / 3 : 0.5, msg, `${chi.name} recupera energie!`);
  };
  MOSSE_SPECIALI.REFRESH = (a, f, m, msg) => {
    if (!a.status) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    a.status = null; a.sleepTurns = 0;
    msg.push(`${a.name} si è rimesso in sesto!`);
  };
  /* Rintoccasana e Aromaterapia curano TUTTA la squadra, panchina compresa. */
  const curaSquadra = (a, msg, come) => {
    const malati = game.party.filter(p => p.status).length;
    if (!malati) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    for (const p of game.party) { p.status = null; p.sleepTurns = 0; }
    msg.push(come);
  };
  MOSSE_SPECIALI.HEAL_BELL    = (a, f, m, msg) => curaSquadra(a, msg, "Un rintocco di campana cura tutta la squadra!");
  MOSSE_SPECIALI.AROMATHERAPY = (a, f, m, msg) => curaSquadra(a, msg, "Un dolce profumo cura tutta la squadra!");
  /* Malcomune: si sommano i PS dei due e si divide a meta'. */
  MOSSE_SPECIALI.PAIN_SPLIT = (a, f, m, msg) => {
    if (!f || f.fainted) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    const media = Math.floor((a.hp + f.hp) / 2);
    a.hp = Math.min(a.maxHp, media); f.hp = Math.min(f.maxHp, media); f._justHit = true;
    msg.push("I PS vengono divisi in parti uguali!");
  };
  /* Preghiera Vitale: rianima un esausto della panchina, a meta' PS. */
  MOSSE_SPECIALI.REVIVAL_BLESSING = (a, f, m, msg) => {
    const caduto = game.party.find(p => p.fainted);
    if (!caduto) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    caduto.fainted = false; caduto.hp = Math.max(1, Math.floor(caduto.maxHp / 2));
    caduto.status = null; caduto.sleepTurns = 0;
    msg.push(`${caduto.name} torna in forze!`);
  };
  /* Curardore e Lunardanza: chi la usa cade, e chi entra al suo posto trova il
     posto pulito. ⚠️ Da noi il "chi entra dopo" lo decide il giocatore, quindi
     si segna una promessa sul lato e la si riscuote all'ingresso. */
  const sacrificioCurativo = (a, msg, testo) => {
    a.hp = 0; a.fainted = true; a._justHit = true;
    lato(a).curaProssimo = true;
    msg.push(testo);
    msg.push(`${a.name} è esausto!`);
  };
  MOSSE_SPECIALI.HEALING_WISH = (a, f, m, msg) =>
    sacrificioCurativo(a, msg, `${a.name} esprime un desiderio di guarigione…`);
  MOSSE_SPECIALI.LUNAR_DANCE = (a, f, m, msg) =>
    sacrificioCurativo(a, msg, `${a.name} danza al chiaro di luna…`);
  /* Desiderio: cura chi si trova su quel lato DUE turni dopo. */
  MOSSE_SPECIALI.WISH = (a, f, m, msg) => {
    const L = lato(a);
    if (L.wish) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    L.wish = { turni: 2, quota: Math.max(1, Math.floor(a.maxHp / 2)) };
    msg.push(`${a.name} esprime un desiderio…`);
  };

  // ------------------------------------------------------- BUFF SU DI SE'
  MOSSE_SPECIALI.FOCUS_ENERGY = (a, f, m, msg) => {
    if (a.volatile.focus) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    a.volatile.focus = true;
    msg.push(`${a.name} si concentra: i brutti colpi diventano molto più probabili!`);
  };
  MOSSE_SPECIALI.LASER_FOCUS = (a, f, m, msg) => {
    a.volatile.laser = 2;   // vale per il PROSSIMO turno
    msg.push(`${a.name} si concentra: il prossimo colpo sarà critico!`);
  };
  /* Crescita: +1 e +1, ma col SOLE raddoppia. */
  MOSSE_SPECIALI.GROWTH = (a, f, m, msg) => {
    const n = weatherKind() === "SUN" ? 2 : 1;
    applyStatStage(a, ["ATK", "SPATK"], n, msg, true);
  };
  /* Panciamburo: meta' dei PS massimi per portare l'Attacco al MASSIMO. */
  MOSSE_SPECIALI.BELLY_DRUM = (a, f, m, msg) => {
    const costo = Math.max(1, Math.floor(a.maxHp / 2));
    if (a.hp <= costo || a.stages.atk >= 6) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    a.hp -= costo; a._justHit = true; a.stages.atk = 6;
    msg.push(`${a.name} si sacrifica: Attacco al massimo!`);
  };
  const pagaEBuffa = (a, msg, frazione, stats, stadi) => {
    const costo = Math.max(1, Math.floor(a.maxHp * frazione));
    if (a.hp <= costo) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    a.hp -= costo; a._justHit = true;
    msg.push(`${a.name} si sacrifica per rafforzarsi!`);
    applyStatStage(a, stats, stadi, msg, true);
  };
  MOSSE_SPECIALI.CLANGOROUS_SOUL = (a, f, m, msg) =>
    pagaEBuffa(a, msg, 1 / 3, ["ATK", "DEF", "SPATK", "SPDEF", "SPD"], 1);
  MOSSE_SPECIALI.FILLET_AWAY = (a, f, m, msg) =>
    pagaEBuffa(a, msg, 1 / 2, ["ATK", "SPATK", "SPD"], 2);
  /* Acupressione: +2 a una statistica a caso, fra quelle non gia' al massimo. */
  MOSSE_SPECIALI.ACUPRESSURE = (a, f, m, msg) => {
    const chi = (f && !isEnemySide(f) === !isEnemySide(a) && !f.fainted) ? f : a;
    const cand = ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"]
      .filter(k => (chi.stages[k.toLowerCase()] || 0) < 6);
    if (!cand.length) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    applyStatStage(chi, [rndOf(cand)], 2, msg, chi === a);
  };
  /* Altruismo e Grido del Drago: aiutano l'ALLEATO, quindi valgono in doppio. */
  MOSSE_SPECIALI.HELPING_HAND = (a, f, m, msg) => {
    if (!game.double || !f || isEnemySide(f) || f.fainted) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    f.volatile.helping = true;
    msg.push(`${a.name} dà una mano a ${f.name}!`);
  };
  MOSSE_SPECIALI.DRAGON_CHEER = (a, f, m, msg) => {
    if (!game.double || !f || isEnemySide(f) || f.fainted) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    f.volatile.focus = true;
    msg.push(`${a.name} incita ${f.name}: brutti colpi più probabili!`);
  };

  // --------------------------------------------- GIOCHI CON LE STATISTICHE
  const STADI = ["atk", "def", "spatk", "spdef", "spd", "acc", "eva"];
  MOSSE_SPECIALI.HAZE = (a, f, m, msg) => {
    for (const x of onField()) x.stages = { atk: 0, def: 0, spatk: 0, spdef: 0, spd: 0, acc: 0, eva: 0 };
    msg.push("Una nube nera azzera tutte le modifiche alle statistiche!");
  };
  MOSSE_SPECIALI.TOPSY_TURVY = (a, f, m, msg) => {
    if (!f || f.fainted) return;
    for (const k of STADI) f.stages[k] = -f.stages[k];
    msg.push(`Le modifiche di ${f.name} vengono capovolte!`);
  };
  MOSSE_SPECIALI.PSYCH_UP = (a, f, m, msg) => {
    if (!f || f.fainted) return;
    for (const k of STADI) a.stages[k] = f.stages[k];
    msg.push(`${a.name} copia le modifiche di ${f.name}!`);
  };
  const scambiaStadi = (a, f, msg, chiavi, testo) => {
    if (!f || f.fainted) return;
    for (const k of chiavi) { const t = a.stages[k]; a.stages[k] = f.stages[k]; f.stages[k] = t; }
    msg.push(testo);
  };
  MOSSE_SPECIALI.POWER_SWAP = (a, f, m, msg) =>
    scambiaStadi(a, f, msg, ["atk", "spatk"], "Le modifiche d'attacco vengono scambiate!");
  MOSSE_SPECIALI.GUARD_SWAP = (a, f, m, msg) =>
    scambiaStadi(a, f, msg, ["def", "spdef"], "Le modifiche di difesa vengono scambiate!");
  MOSSE_SPECIALI.SPEED_SWAP = (a, f, m, msg) => {
    if (!f || f.fainted) return;
    const t = a.stats.spd; a.stats.spd = f.stats.spd; f.stats.spd = t;
    msg.push("Le Velocità vengono scambiate!");
  };
  MOSSE_SPECIALI.HEART_SWAP = (a, f, m, msg) =>
    scambiaStadi(a, f, msg, STADI, "Tutte le modifiche vengono scambiate!");
  MOSSE_SPECIALI.POWER_TRICK = (a, f, m, msg) => {
    const t = a.stats.atk; a.stats.atk = a.stats.def; a.stats.def = t;
    msg.push(`${a.name} scambia Attacco e Difesa!`);
  };
  MOSSE_SPECIALI.POWER_SHIFT = MOSSE_SPECIALI.POWER_TRICK;
  const dividiStat = (a, f, msg, chiavi, testo) => {
    if (!f || f.fainted) return;
    for (const k of chiavi) {
      const media = Math.floor((a.stats[k] + f.stats[k]) / 2);
      a.stats[k] = media; f.stats[k] = media;
    }
    msg.push(testo);
  };
  MOSSE_SPECIALI.POWER_SPLIT = (a, f, m, msg) =>
    dividiStat(a, f, msg, ["atk", "spatk"], "Gli attacchi vengono livellati!");
  MOSSE_SPECIALI.GUARD_SPLIT = (a, f, m, msg) =>
    dividiStat(a, f, msg, ["def", "spdef"], "Le difese vengono livellate!");

  // ------------------------------------------------------ CAMBI DI TIPO
  const nomeTipo = t => (T[t] || {}).it || t;
  const cambiaTipo = (chi, tipi, msg) => {
    chi.types = tipi.slice();
    msg.push(`${chi.name} diventa di tipo ${tipi.map(nomeTipo).join("/")}!`);
  };
  MOSSE_SPECIALI.SOAK = (a, f, m, msg) => { if (f && !f.fainted) cambiaTipo(f, ["WATER"], msg); };
  MOSSE_SPECIALI.MAGIC_POWDER = (a, f, m, msg) => { if (f && !f.fainted) cambiaTipo(f, ["PSYCHIC"], msg); };
  /* Halloween e Boscomalocchio AGGIUNGONO un tipo invece di sostituirlo. */
  const aggiungiTipo = (f, t, msg) => {
    if (!f || f.fainted || f.types.includes(t)) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    f.types = f.types.concat([t]);
    msg.push(`${f.name} prende anche il tipo ${nomeTipo(t)}!`);
  };
  MOSSE_SPECIALI.TRICK_OR_TREAT = (a, f, m, msg) => aggiungiTipo(f, "GHOST", msg);
  MOSSE_SPECIALI.FORESTS_CURSE  = (a, f, m, msg) => aggiungiTipo(f, "GRASS", msg);
  /* Conversione: chi la usa prende il tipo di una sua mossa. */
  MOSSE_SPECIALI.CONVERSION = (a, f, m, msg) => {
    const tipi = a.moves.map(x => M[x.id] && M[x.id].type).filter(Boolean);
    if (!tipi.length) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    cambiaTipo(a, [rndOf(tipi)], msg);
  };
  /* Conversione2: si prende un tipo che RESISTE all'ultima mossa del bersaglio. */
  MOSSE_SPECIALI.CONVERSION_2 = (a, f, m, msg) => {
    const ultima = f && f.volatile && f.volatile.lastMove;
    const tipoMossa = ultima && M[ultima] ? M[ultima].type : null;
    if (!tipoMossa) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    const buoni = Object.keys(CHART).filter(t => typeMultiplier(tipoMossa, [t]) < 1);
    if (!buoni.length) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    cambiaTipo(a, [rndOf(buoni)], msg);
  };
  MOSSE_SPECIALI.REFLECT_TYPE = (a, f, m, msg) => {
    if (!f || f.fainted) return;
    cambiaTipo(a, f.types, msg);
  };
  /* Camuffamento: il tipo lo detta il TERRENO, e in mancanza il bioma. */
  MOSSE_SPECIALI.CAMOUFLAGE = (a, f, m, msg) => {
    const perTerreno = { GRASSY: "GRASS", ELECTRIC: "ELECTRIC", MISTY: "FAIRY", PSYCHIC: "PSYCHIC" };
    cambiaTipo(a, [perTerreno[terrainKind()] || "NORMAL"], msg);
  };

  // -------------------------------------------------- SCAMBI DI ABILITA'
  const cambiaAbilita = (chi, chiave, msg) => {
    const ab = ABIL[chiave];
    if (!ab) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    chi.ability = ab;
    msg.push(`L'abilità di ${chi.name} diventa ${ab.it}!`);
  };
  MOSSE_SPECIALI.SKILL_SWAP = (a, f, m, msg) => {
    if (!f || f.fainted) return;
    const t = a.ability; a.ability = f.ability; f.ability = t;
    msg.push("Le abilità vengono scambiate!");
  };
  MOSSE_SPECIALI.ROLE_PLAY = (a, f, m, msg) => {
    if (!f || f.fainted || !f.ability) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    a.ability = f.ability;
    msg.push(`${a.name} copia ${f.ability.it}!`);
  };
  MOSSE_SPECIALI.DOODLE = MOSSE_SPECIALI.ROLE_PLAY;
  MOSSE_SPECIALI.ENTRAINMENT = (a, f, m, msg) => {
    if (!f || f.fainted || !a.ability) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    f.ability = a.ability;
    msg.push(`${f.name} prende l'abilità ${a.ability.it}!`);
  };
  MOSSE_SPECIALI.SIMPLE_BEAM = (a, f, m, msg) => { if (f && !f.fainted) cambiaAbilita(f, "SIMPLE", msg); };
  MOSSE_SPECIALI.WORRY_SEED  = (a, f, m, msg) => { if (f && !f.fainted) cambiaAbilita(f, "INSOMNIA", msg); };
  /* Gastroacido: l'abilita' non viene sostituita, viene SPENTA. */
  MOSSE_SPECIALI.GASTRO_ACID = (a, f, m, msg) => {
    if (!f || f.fainted || !f.ability) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    msg.push(`L'abilità di ${f.name} viene annullata!`);
    f.ability = null;
  };

  // --------------------------------------------------- SCAMBI DI OGGETTI
  // (esiste gia un haOggetti piu su, per il pannello squadra: qui serve un nome suo)
  const tieneQualcosa = f => f && (Object.keys(f.held || {}).length || Object.keys(f.berries || {}).length);
  MOSSE_SPECIALI.TRICK = (a, f, m, msg) => {
    if (!f || f.fainted || (!tieneQualcosa(a) && !tieneQualcosa(f))) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    const h = a.held, b = a.berries;
    a.held = f.held || {}; a.berries = f.berries || {};
    f.held = h || {}; f.berries = b || {};
    msg.push("Gli oggetti tenuti vengono scambiati!");
  };
  MOSSE_SPECIALI.SWITCHEROO = MOSSE_SPECIALI.TRICK;
  MOSSE_SPECIALI.BESTOW = (a, f, m, msg) => {
    if (!f || f.fainted || !tieneQualcosa(a)) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    f.held = Object.assign({}, f.held, a.held);
    f.berries = Object.assign({}, f.berries, a.berries);
    a.held = {}; a.berries = {};
    msg.push(`${a.name} cede quello che teneva a ${f.name}!`);
  };
  MOSSE_SPECIALI.CORROSIVE_GAS = (a, f, m, msg) => {
    if (!f || f.fainted || !tieneQualcosa(f)) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    f.held = {}; f.berries = {};
    msg.push(`Il gas corrode gli oggetti di ${f.name}!`);
  };
  /* Riciclo riporta indietro l'ULTIMA bacca consumata in questa lotta
     (`volatile.bacciaFinita`, segnata da `useBerry`). Si azzera rientrando
     nella ball, come dev'essere. */
  MOSSE_SPECIALI.RECYCLE = (a, f, m, msg) => {
    const k = a.volatile.bacciaFinita;
    if (!k || !BERRY_DATA[k]) { stessoMomento(msg, "Ma non c'è niente da riciclare!"); return; }
    a.volatile.bacciaFinita = null;
    a.berries = a.berries || {};
    a.berries[k] = (a.berries[k] || 0) + 1;
    msg.push(`${a.name} ricicla la ${BERRY_DATA[k].it}!`);
  };
  MOSSE_SPECIALI.EMBARGO = (a, f, m, msg) => {
    if (!f || f.fainted) return;
    f.volatile.embargo = 5;
    spegniOggetti(f);
    msg.push(`${f.name} non può più usare il suo oggetto!`);
  };

  // ---------------------------------------------- VEDERE E NON SBAGLIARE
  /* Preveggenza, Segugio e Miracolvista tolgono le immunita' di tipo: da noi
     si segna sul bersaglio e lo legge `typeMultiplier` tramite `doDamage`. */
  const smascheraTipo = (f, tipi, msg, testo) => {
    if (!f || f.fainted) return;
    f.volatile.smascherato = (f.volatile.smascherato || []).concat(tipi);
    msg.push(testo);
  };
  MOSSE_SPECIALI.FORESIGHT    = (a, f, m, msg) => smascheraTipo(f, ["NORMAL", "FIGHTING"], msg, `${f.name} è stato individuato!`);
  MOSSE_SPECIALI.ODOR_SLEUTH  = MOSSE_SPECIALI.FORESIGHT;
  MOSSE_SPECIALI.MIRACLE_EYE  = (a, f, m, msg) => smascheraTipo(f, ["PSYCHIC"], msg, `${f.name} è stato individuato!`);
  /* Localizza e Leggimente: il prossimo colpo va a segno di sicuro. */
  MOSSE_SPECIALI.LOCK_ON = (a, f, m, msg) => {
    a.volatile.mirino = true;
    msg.push(`${a.name} prende la mira su ${f ? f.name : "l'avversario"}!`);
  };
  MOSSE_SPECIALI.MIND_READER = MOSSE_SPECIALI.LOCK_ON;
  /* Magnetascesa e Telecinesi: si sta per aria, quindi le mosse di Terra e le
     trappole a terra non arrivano piu'. */
  MOSSE_SPECIALI.MAGNET_RISE = (a, f, m, msg) => {
    a.volatile.levita = 5;
    msg.push(`${a.name} si solleva da terra!`);
  };
  MOSSE_SPECIALI.TELEKINESIS = (a, f, m, msg) => {
    if (!f || f.fainted) return;
    f.volatile.levita = 3;
    msg.push(`${f.name} viene sollevato in aria!`);
  };

  // ---------------------------------------------------- EFFETTI DI CAMPO
  const campoATempo = (chiave, turni, msg, testo) => {
    if (game[chiave] > 0) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    game[chiave] = turni;
    msg.push(testo);
  };
  MOSSE_SPECIALI.MUD_SPORT   = (a, f, m, msg) => campoATempo("fangata", 5, msg, "Il fango indebolisce le mosse Elettro!");
  MOSSE_SPECIALI.WATER_SPORT = (a, f, m, msg) => campoATempo("doccia", 5, msg, "L'acqua indebolisce le mosse Fuoco!");
  MOSSE_SPECIALI.GRAVITY     = (a, f, m, msg) => campoATempo("gravita", 5, msg, "La gravità aumenta: tutti a terra!");
  MOSSE_SPECIALI.TRICK_ROOM  = (a, f, m, msg) => {
    /* Distortozona si SPEGNE se e' gia' accesa: e' l'unica cosi'. */
    if (game.distorto > 0) { game.distorto = 0; msg.push("La distorsione svanisce!"); return; }
    game.distorto = 5;
    msg.push("Lo spazio si distorce: i più lenti agiscono per primi!");
  };
  MOSSE_SPECIALI.WONDER_ROOM = (a, f, m, msg) => {
    if (game.mirabil > 0) { game.mirabil = 0; msg.push("La Mirabilzona svanisce!"); return; }
    game.mirabil = 5;
    msg.push("Difesa e Difesa Speciale si scambiano per tutti!");
  };
  MOSSE_SPECIALI.MAGIC_ROOM = (a, f, m, msg) => {
    if (game.magica > 0) {
      game.magica = 0;
      for (const x of game.party.concat(onField())) riaccendiOggetti(x);
      msg.push("La Magicozona svanisce!"); return;
    }
    game.magica = 5;
    for (const x of onField()) spegniOggetti(x);
    msg.push("Gli oggetti tenuti smettono di funzionare!");
  };
  MOSSE_SPECIALI.ION_DELUGE = (a, f, m, msg) => campoATempo("plasma", 5, msg, "Particelle elettrizzate riempiono il campo!");

  // ------------------------------------------------------- ALTRE DUE COSE
  MOSSE_SPECIALI.PSYCHO_SHIFT = (a, f, m, msg) => {
    if (!a.status || !f || f.fainted || f.status) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    const st = a.status; a.status = null; a.sleepTurns = 0;
    applyStatus(f, st, msg);
    msg.push(`${a.name} passa il suo malessere a ${f.name}!`);
  };
  MOSSE_SPECIALI.HEAL_BLOCK = (a, f, m, msg) => {
    if (!f || f.fainted) return;
    f.volatile.anticura = 5;
    msg.push(`${f.name} non può piu' curarsi!`);
  };

  // ---------------------------------------------- QUELLE CHE NON FANNO NULLA
  /* ⚠️ Non sono dimenticate: nei giochi veri non fanno NIENTE, e il bello e'
     proprio quello. L'importante e' che lo DICANO, invece di lasciare un turno
     muto che sembra un difetto. */
  MOSSE_SPECIALI.SPLASH     = (a, f, m, msg) => msg.push(`${a.name} sguazza qua e là… ma non succede nulla!`);
  MOSSE_SPECIALI.CELEBRATE  = (a, f, m, msg) => msg.push(`${a.name} ti fa gli auguri!`);
  MOSSE_SPECIALI.HOLD_HANDS = (a, f, m, msg) => msg.push(`${a.name} e il suo alleato si tengono per mano!`);
  MOSSE_SPECIALI.TEATIME    = (a, f, m, msg) => {
    let qualcuno = false;
    for (const x of onField()) {
      const bacche = Object.keys(x.berries || {});
      if (bacche.length) { qualcuno = true; useBerry(x, bacche[0], msg); }
    }
    if (!qualcuno) msg.push("È l'ora del tè… ma nessuno ha bacche!");
  };
  /* Cuccagna: i soldi di fine ondata raddoppiano. */
  MOSSE_SPECIALI.HAPPY_HOUR = (a, f, m, msg) => {
    game.cuccagna = true;
    msg.push("Che fortuna! I premi in denaro raddoppiano!");
  };

  /* ====================================================================
     LOTTO 5 — le mosse che ne muovono ALTRE, o che muovono il Pokemon.
     Sono le piu' intricate del gruppo: non aggiungono un effetto, cambiano
     il funzionamento del turno.
     ==================================================================== */

  /* ---- una mossa che ne lancia un'altra --------------------------------
     Metronomo, Speculmossa, Copiatore, Introduzione, Sonnolalia, Prioricolpo,
     Naturforza, Assistenza, Bisticcio.
     [ATTENZIONE] Serve davvero un limite di profondita': Metronomo puo'
     pescare Metronomo, e Speculmossa puo' rispondere a Speculmossa. Senza
     tetto il gioco si pianta senza dire niente. */
  let profonditaMossa = 0;
  function usaAltraMossa(actor, foe, id, messages, testo) {
    if (!M[id] || profonditaMossa >= 2) { stessoMomento(messages, "Ma non ha funzionato!"); return; }
    profonditaMossa++;
    try {
      if (testo !== " ") messages.push(testo || `Parte ${M[id].it}!`);
      resolveAction(actor, foe || pickFoeFor(actor), { id, pp: 1, maxPp: 1 }, messages, true);
    } finally { profonditaMossa--; }
  }
  const scegliACaso = arr => arr[Math.floor(Math.random() * arr.length)];

  /* Metronomo non deve pescare le mosse che chiamano altre mosse (si
     rincorrerebbero) ne' quelle che qui non hanno senso. */
  const NIENTE_METRONOMO = new Set(["METRONOME", "MIRROR_MOVE", "COPYCAT", "ASSIST", "SLEEP_TALK",
    "ME_FIRST", "NATURE_POWER", "MIMIC", "SKETCH", "TRANSFORM", "STRUGGLE", "INSTRUCT",
    "SNATCH", "MAGIC_COAT", "BATON_PASS", "SHED_TAIL", "AFTER_YOU", "QUASH"]);
  MOSSE_SPECIALI.METRONOME = (a, f, m, msg) => {
    const pool = Object.keys(M).filter(id => !NIENTE_METRONOMO.has(id));
    const id = scegliACaso(pool);
    usaAltraMossa(a, f, id, msg, `Il dito indica ${M[id].it}!`);
  };
  MOSSE_SPECIALI.MIRROR_MOVE = (a, f, m, msg) => {
    const u = f && f.volatile && f.volatile.lastMove;
    if (!u) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    usaAltraMossa(a, f, u, msg, `${a.name} rispecchia ${M[u].it}!`);
  };
  MOSSE_SPECIALI.COPYCAT = (a, f, m, msg) => {
    const u = game.ultimaMossa;
    if (!u || u === "COPYCAT") { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    usaAltraMossa(a, f, u, msg, `${a.name} copia ${M[u].it}!`);
  };
  /* Assistenza pesca a caso tra le mosse dei COMPAGNI in panchina. */
  MOSSE_SPECIALI.ASSIST = (a, f, m, msg) => {
    const compagni = game.party.filter(p => p !== a && !p.fainted);
    const pool = [];
    for (const p of compagni) for (const mm of p.moves) if (!NIENTE_METRONOMO.has(mm.id)) pool.push(mm.id);
    if (!pool.length) { stessoMomento(msg, "Ma non c'è nessuno che possa aiutare!"); return; }
    const id = scegliACaso(pool);
    usaAltraMossa(a, f, id, msg, `Un compagno passa ${M[id].it}!`);
  };
  /* Naturforza cambia mossa col TERRENO, come nelle generazioni recenti. */
  const NATURA_PER_TERRENO = { GRASSY: "ENERGY_BALL", ELECTRIC: "THUNDERBOLT",
                               MISTY: "MOONBLAST", PSYCHIC: "PSYCHIC" };
  MOSSE_SPECIALI.NATURE_POWER = (a, f, m, msg) => {
    let id = NATURA_PER_TERRENO[terrainKind()] || "TRI_ATTACK";
    if (!M[id]) id = "SWIFT";
    usaAltraMossa(a, f, id, msg, `La natura sceglie ${M[id].it}!`);
  };
  /* PRECEDENZA: ruba la mossa che l'avversario STA PER usare e la lancia
     prima, col 50% di potenza in piu'. La si legge dalla coda del turno
     (`game._coda`): se l'avversario ha già agito non c'è niente da anticipare
     e la mossa fallisce, esattamente come nei giochi veri. */
  MOSSE_SPECIALI.ME_FIRST = (a, f, m, msg) => {
    if (!f || f.fainted) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    const q = game._coda || [];
    const az = q.find((x, k) => k > game._codaI && x.actor === f);
    if (!az) { stessoMomento(msg, `Ma ${f.name} ha già agito!`); return; }
    const id = az.move.id;
    if (!M[id] || M[id].category === "STATUS") { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    a.volatile.precedenza = true;
    try { usaAltraMossa(a, f, id, msg, `${a.name} anticipa ${M[id].it}!`); }
    finally { a.volatile.precedenza = false; }
  };
  /* Ordine: il bersaglio rifa' subito l'ultima mossa che ha usato. */
  MOSSE_SPECIALI.INSTRUCT = (a, f, m, msg) => {
    const u = f && f.volatile && f.volatile.lastMove;
    if (!f || f.fainted || !u) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    usaAltraMossa(f, pickFoeFor(f), u, msg, `${f.name} è costretto a rifare ${M[u].it}!`);
  };

  /* ---- copiare mosse e Pokemon ---------------------------------------- */
  /* Mimica e Schizzo scrivono la mossa copiata AL POSTO DI SE STESSE: da noi
     Mimica dura fino a fine lotta (i volatili si azzerano rientrando),
     Schizzo e' per sempre — la differenza dei giochi veri. */
  const copiaMossa = (a, f, msg, perSempre, nome) => {
    const u = f && f.volatile && f.volatile.lastMove;
    if (!u || a.moves.some(x => x.id === u)) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    const slot = a.moves.find(x => x.id === (perSempre ? "SKETCH" : "MIMIC"));
    if (!slot) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    slot.id = u; slot.pp = M[u].pp; slot.maxPp = M[u].pp;
    if (perSempre) { const sp = (a.movesFissi = a.movesFissi || []); sp.push(u); }
    msg.push(`${nome}: ${a.name} impara ${M[u].it}!`);
  };
  MOSSE_SPECIALI.MIMIC  = (a, f, m, msg) => copiaMossa(a, f, msg, false, "Mimica");
  MOSSE_SPECIALI.SKETCH = (a, f, m, msg) => copiaMossa(a, f, msg, true, "Schizzo");
  /* Trasformazione: statistiche, tipi, abilita' e mosse dell'avversario.
     I PS restano i propri — come nei giochi veri — e lo sprite non cambia:
     ridisegnarlo vorrebbe dire ricaricare l'atlante a meta' turno. */
  /* TRASFORMAZIONE: si diventa l'avversario. Statistiche (tranne i PS), tipi,
     abilita', mosse (a 5 PP l'una) e ANCHE l'aspetto.
     ⚠️ Cambiare `dex`/`speciesId` su un Pokemon della squadra e' pericoloso:
     `nextWave` salva la run PRIMA di `fineBattaglia`, e un Ditto salvato da
     Charizard resterebbe Charizard per sempre. L'originale si tiene sotto
     `_trasf`, e si annulla rientrando nella ball e a inizio ondata — tre reti
     invece di una perche' questa e' proprio una di quelle che non si perdona. */
  function annullaTrasformazione(f) {
    if (!f || !f._trasf) return;
    Object.assign(f, f._trasf);
    f._trasf = null;
    f.spr = null;
    loadFighterSprite(f, isEnemySide(f) ? "front" : "back").then(sp => { f.spr = sp; redrawScene(); });
  }
  MOSSE_SPECIALI.TRANSFORM = (a, f, m, msg) => {
    if (!f || f.fainted || a._trasf) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    a._trasf = { speciesId: a.speciesId, dex: a.dex, name: a.name, types: a.types,
                 stats: a.stats, ability: a.ability, moves: a.moves,
                 formKey: a.formKey, variant: a.variant, shiny: a.shiny, shinyVar: a.shinyVar };
    a.speciesId = f.speciesId; a.dex = f.dex; a.name = f.name;
    a.formKey = f.formKey; a.variant = f.variant;
    a.shiny = f.shiny; a.shinyVar = f.shinyVar;
    a.types = f.types.slice();
    a.stats = Object.assign({}, f.stats, { hp: a.stats.hp });
    a.stages = Object.assign({}, f.stages);
    a.ability = f.ability;
    a.moves = f.moves.map(x => ({ id: x.id, pp: Math.min(5, M[x.id].pp), maxPp: Math.min(5, M[x.id].pp) }));
    a.spr = null;
    loadFighterSprite(a, isEnemySide(a) ? "front" : "back").then(sp => { a.spr = sp; redrawScene(); });
    msg.push(`${a._trasf.name} si trasforma in ${f.name}!`);
  };

  /* ---- il sostituto ---------------------------------------------------- */
  /* Un quarto dei PS massimi diventa un fantoccio che incassa i colpi al posto
     suo (l'incasso vero sta in `doDamage`). */
  MOSSE_SPECIALI.SUBSTITUTE = (a, f, m, msg) => {
    if (a.volatile.sub > 0) { stessoMomento(msg, "C'è già un sostituto!"); return; }
    const costo = Math.floor(a.maxHp / 4);
    if (a.hp <= costo) { stessoMomento(msg, `${a.name} non ha abbastanza PS!`); return; }
    a.hp -= costo; a._justHit = true; a.volatile.sub = costo;
    msg.push(`${a.name} crea un sostituto!`);
  };

  /* ---- togliere mosse e PP all'avversario ------------------------------- */
  MOSSE_SPECIALI.DISABLE = (a, f, m, msg) => {
    const u = f && f.volatile && f.volatile.lastMove;
    if (!f || f.fainted || !u || (f.volatile.disable && f.volatile.disable.turni > 0)) {
      stessoMomento(msg, "Ma non ha funzionato!"); return;
    }
    f.volatile.disable = { id: u, turni: 4 };
    msg.push(`${M[u].it} di ${f.name} è bloccata!`);
  };
  MOSSE_SPECIALI.SPITE = (a, f, m, msg) => {
    const u = f && f.volatile && f.volatile.lastMove;
    const mi = u && f.moves.find(x => x.id === u);
    if (!mi || mi.pp <= 0) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    const tolti = Math.min(4, mi.pp); mi.pp -= tolti;
    msg.push(`${M[u].it} di ${f.name} perde ${tolti} PP!`);
  };
  /* Divieto sigilla le mosse che chi la usa conosce: legge in `mossaVietata`. */
  MOSSE_SPECIALI.IMPRISON = (a, f, m, msg) => {
    a.volatile.imprison = true;
    msg.push(`${a.name} sigilla le mosse che conosce anche lui!`);
  };
  /* Tentacolock stringe ogni turno: il morso sta in `endOfTurnResidual`. */
  MOSSE_SPECIALI.OCTOLOCK = (a, f, m, msg) => {
    if (!f || f.fainted) return;
    f.volatile.octolock = 1;
    msg.push(`${f.name} è stretto nella morsa e non può più difendersi!`);
  };

  /* ---- portarsi dietro chi ti stende ----------------------------------- */
  MOSSE_SPECIALI.DESTINY_BOND = (a, f, m, msg) => {
    a.volatile.destiny = true;
    msg.push(`${a.name} si prepara a trascinare con sé chi lo stenderà!`);
  };
  MOSSE_SPECIALI.GRUDGE = (a, f, m, msg) => {
    a.volatile.grudge = true;
    msg.push(`${a.name} nutre rancore verso chi lo stenderà!`);
  };

  /* ---- rubare e rimandare indietro le mosse di stato -------------------- */
  MOSSE_SPECIALI.MAGIC_COAT = (a, f, m, msg) => {
    a.volatile.magiccoat = true;
    msg.push(`${a.name} si avvolge in un manto magico!`);
  };
  MOSSE_SPECIALI.SNATCH = (a, f, m, msg) => {
    a.volatile.snatch = true;
    msg.push(`${a.name} si mette in agguato per rubare una mossa!`);
  };

  /* ---- attirare i colpi su di se' (solo in doppio ha senso) ------------- */
  const attiraColpi = (chi, msg, testo) => {
    if (!chi || chi.fainted) return;
    chi.volatile.centro = true;
    msg.push(testo);
  };
  MOSSE_SPECIALI.FOLLOW_ME    = (a, f, m, msg) => attiraColpi(a, msg, `${a.name} attira su di sé tutti i colpi!`);
  MOSSE_SPECIALI.RAGE_POWDER  = (a, f, m, msg) => attiraColpi(a, msg, `${a.name} si copre di polline e attira i colpi!`);
  MOSSE_SPECIALI.SPOTLIGHT    = (a, f, m, msg) => attiraColpi(f, msg, `Un riflettore punta ${f ? f.name : "l'avversario"}: tutti i colpi vanno su di lui!`);

  /* ---- protezioni di SQUADRA (le legge `resolveAction`) ----------------- */
  const guardiaSquadra = (a, chiave, msg, testo) => { lato(a)[chiave] = 1; msg.push(testo); };
  MOSSE_SPECIALI.WIDE_GUARD    = (a, f, m, msg) => guardiaSquadra(a, "wideguard", msg, "Ampiaguardia protegge la squadra dagli attacchi ad area!");
  MOSSE_SPECIALI.QUICK_GUARD   = (a, f, m, msg) => guardiaSquadra(a, "quickguard", msg, "Blocco protegge la squadra dalle mosse di priorità!");
  MOSSE_SPECIALI.CRAFTY_SHIELD = (a, f, m, msg) => guardiaSquadra(a, "craftyshield", msg, "Truccodifesa protegge la squadra dalle mosse di stato!");
  MOSSE_SPECIALI.MAT_BLOCK     = (a, f, m, msg) => guardiaSquadra(a, "matblock", msg, "Scudo Aureo para gli attacchi diretti alla squadra!");

  /* ---- riordinare il turno (Prendinota, Rinvio) ------------------------- */
  const spostaInCoda = (f, msg, inFondo) => {
    const q = game._coda || [];
    const i = q.findIndex((x, k) => k > game._codaI && x.actor === f);
    if (i < 0) { stessoMomento(msg, "Ma non ha funzionato!"); return; }
    const az = q.splice(i, 1)[0];
    if (inFondo) q.push(az); else q.splice(game._codaI + 1, 0, az);
    msg.push(inFondo ? `${f.name} viene rimandato in fondo al turno!`
                     : `${f.name} passa avanti nel turno!`);
  };
  MOSSE_SPECIALI.AFTER_YOU = (a, f, m, msg) => spostaInCoda(f, msg, false);
  MOSSE_SPECIALI.QUASH     = (a, f, m, msg) => spostaInCoda(f, msg, true);

  /* ---- scambiarsi di posto col compagno (solo in doppio) ---------------- */
  MOSSE_SPECIALI.ALLY_SWITCH = (a, f, m, msg) => {
    if (!game.double) { stessoMomento(msg, "Ma non c'è nessuno con cui scambiarsi!"); return; }
    if (a === game.player && game.player2) { const t = game.player; game.player = game.player2; game.player2 = t; game.active = game.party.indexOf(game.player); }
    else if (a === game.player2 && game.player) { const t = game.player; game.player = game.player2; game.player2 = t; game.active = game.party.indexOf(game.player); }
    else if (a === game.enemy && game.enemy2) { const t = game.enemy; game.enemy = game.enemy2; game.enemy2 = t; }
    else if (a === game.enemy2 && game.enemy) { const t = game.enemy; game.enemy = game.enemy2; game.enemy2 = t; }
    else { stessoMomento(msg, "Ma non c'è nessuno con cui scambiarsi!"); return; }
    renderScene();
    msg.push(`${a.name} e il suo compagno si scambiano di posto!`);
  };

  /* ---- effetti di campo minori ----------------------------------------- */
  MOSSE_SPECIALI.ELECTRIFY = (a, f, m, msg) => {
    if (!f || f.fainted) return;
    f.volatile.elettro = true;
    msg.push(`Le mosse di ${f.name} diventano di tipo Elettro!`);
  };
  MOSSE_SPECIALI.POWDER = (a, f, m, msg) => {
    if (!f || f.fainted) return;
    f.volatile.powder = true;
    msg.push(`${f.name} viene coperto di polvere esplosiva!`);
  };
  MOSSE_SPECIALI.FAIRY_LOCK = (a, f, m, msg) => {
    if (!game.lati) game.lati = latiVuoti();
    game.lati.mio.nocambio = 2; game.lati.suo.nocambio = 2;
    msg.push("Un vincolo fatato tiene tutti in campo!");
  };
  /* Cambiocampo: schermi e trappole passano dall'altra parte. Cambia la lotta
     in un colpo solo, ed e' proprio quello che fa nell'originale. */
  MOSSE_SPECIALI.COURT_CHANGE = (a, f, m, msg) => {
    if (!game.lati) { stessoMomento(msg, "Ma non c'è niente da scambiare!"); return; }
    const t = game.lati.mio; game.lati.mio = game.lati.suo; game.lati.suo = t;
    msg.push("I due campi si scambiano tutto quello che c'era sopra!");
  };

  /* ---- i cambi forzati -------------------------------------------------- */
  /* Chi entra al posto di chi esce, e chi porta con se' gli sbalzi.
     [ATTENZIONE] Non si esegue subito: si mette in lista e `afterTurn` la
     svuota a turno concluso. Le azioni ancora da risolvere tengono in mano il
     Pokemon che c'e' adesso, e cambiarlo sotto i piedi le farebbe colpire un
     riferimento morto. */
  /* `daSolo` distingue le DUE famiglie, che nell'originale sono due tipi di
     cambio diversi (`SwitchType.FORCE_SWITCH` contro `SwitchType.SWITCH`):
       · CACCIATO FUORI (Turbine, Boato)  → il ricambio esce A CASO;
       · SE NE VA DA SOLO (Staffetta, Teletrasporto, Monito, Tagliacoda)
         → il ricambio lo SCEGLIE chi gioca. */
  function chiediCambio(chi, stadi, msg, testo, daSolo) {
    if (!chi || chi.fainted) { stessoMomento(msg, "Ma non ha funzionato!"); return false; }
    if (game.lati && lato(chi).nocambio > 0) { stessoMomento(msg, "Un vincolo fatato lo tiene in campo!"); return false; }
    if (chi.volatile.trap || chi.volatile.ingrain) { stessoMomento(msg, `${chi.name} non riesce a lasciare il campo!`); return false; }
    /* Il ricambio si controlla ADESSO. Senza, si annunciava «X viene spazzato
       via!» e un attimo dopo «ma non c'e' nessuno che lo sostituisca»: due
       righe che si smentiscono.
       ⚠️ Il SELVATICO fa eccezione: non ha ricambio ma non fallisce — scappa,
       e la lotta finisce (senza premi). */
    const selvatico = isEnemySide(chi) && !chi.trainer && !chi.trainerMon
                      && !(game.enemyQueue && game.enemyQueue.length);
    const c_e_ricambio = selvatico ? true : isEnemySide(chi)
      ? (chi === game.enemy && !!(game.enemyQueue && game.enemyQueue.length))
      : game.party.some(p => !p.fainted && p !== game.player && p !== game.player2);
    if (!c_e_ricambio) { stessoMomento(msg, `Ma non c'è nessuno che possa sostituire ${chi.name}!`); return false; }
    const richiesta = { chi, stadi: !!stadi, sub: stadi ? chi.volatile.sub : 0 };
    // l'auto-cambio del GIOCATORE apre la squadra: la coda del turno lo aspetta
    if (daSolo && !isEnemySide(chi)) game.cambioScelto = richiesta;
    else (game.cambioForzato = game.cambioForzato || []).push(richiesta);
    if (testo) msg.push(testo);
    return true;
  }
  /* Fa entrare `riserva` al posto di `chi`, portandosi dietro gli sbalzi e il
     sostituto se la mossa li passa (Staffetta, Tagliacoda). */
  function scambiaSulCampo(chi, riserva, r, log) {
    const stadi = r.stadi ? Object.assign({}, chi.stages) : null;
    const sub = r.sub || 0;
    const secondo = (chi === game.player2);
    richiamaNellaBall(chi);
    log.push(conBall(`Ritirati, ${chi.name}!`, "ritiro", secondo ? "player2" : "player"));
    if (secondo) game.player2 = riserva; else setActive(game.party.indexOf(riserva));
    entraInCampo(riserva, log);
    riserva.spr = null;
    loadFighterSprite(riserva, "back").then(sp => { riserva.spr = sp; redrawScene(); });
    log.push(conBall(`Vai, ${riserva.name}!`, "uscita", secondo ? "player2" : "player"));
    if (stadi) riserva.stages = stadi;
    if (sub) riserva.volatile.sub = sub;
    applyOnSummon(riserva, game.enemy, log);
    renderScene();
  }

  function eseguiCambioForzato(r, log) {
    const chi = r.chi;
    if (!chi || chi.fainted) return;
    if (isEnemySide(chi)) {
      /* SELVATICO cacciato fuori: non ha ricambio, SCAPPA. Se non resta
         nessun altro avversario la lotta finisce senza premi — e' quello che
         fa l'originale (`BattleEndPhase(false)` + `NewBattlePhase`). */
      if (!chi.trainer && !chi.trainerMon && !(game.enemyQueue && game.enemyQueue.length)) {
        const altro = chi === game.enemy ? game.enemy2 : game.enemy;
        log.push(`${chi.name} se la dà a gambe!`);
        if (chi === game.enemy2) game.enemy2 = null;
        else if (altro) { game.enemy = altro; game.enemy2 = null; }
        else game.fugaSelvatica = true;      // non resta nessuno: fine lotta
        renderScene();
        return;
      }
      // ALLENATORE: ne manda un altro, pescato A CASO fra quelli in panchina
      if (chi !== game.enemy || !game.enemyQueue || !game.enemyQueue.length) {
        log.push(`Ma non c'è nessuno che possa sostituire ${chi.name}!`); return;
      }
      const stadi = r.stadi ? Object.assign({}, chi.stages) : null;
      richiamaNellaBall(chi);
      const i = Math.floor(Math.random() * game.enemyQueue.length);
      const next = game.enemyQueue.splice(i, 1)[0];
      game.enemyQueue.push(chi);           // torna in coda, non sparisce
      log.push(conBall(`${chi.name} lascia il campo!`, "ritiro", "enemy"));
      deployEnemy(next, log);
      entraInCampo(next, log);
      log.push(conBall(`Tocca a ${next.name}!`, "uscita", "enemy"));
      if (stadi) next.stages = stadi;
      if (r.sub) next.volatile.sub = r.sub;
      if (typeof renderTrainerBalls === "function") renderTrainerBalls();
      renderScene();
      return;
    }
    /* Squadra del giocatore CACCIATA FUORI: il ricambio esce A CASO, come
       nell'originale (`randBattleSeedInt` sugli indici disponibili). Quando
       invece se ne va da solo il ricambio lo sceglie lui, e non passa di qui. */
    const panchina = game.party.filter(p => !p.fainted && p !== game.player && p !== game.player2);
    if (!panchina.length) { log.push(`Ma non c'è nessuno che possa sostituire ${chi.name}!`); return; }
    scambiaSulCampo(chi, panchina[Math.floor(Math.random() * panchina.length)], r, log);
  }

  /* L'auto-cambio del giocatore ha aperto la schermata squadra: qui arriva la
     sua scelta, e da qui riparte la coda del turno rimasta in sospeso. */
  function staffettaVerso(index) {
    if (game.phase !== "STAFFETTA") return;
    const r = game.staffetta; game.staffetta = null;
    const riserva = game.party[index];
    const log = makeLog();
    if (r && riserva && !riserva.fainted && riserva !== game.player && riserva !== game.player2) {
      scambiaSulCampo(r.chi, riserva, r, log);
    }
    codaDelTurno(log);
  }

  /* Turbine e Boato scacciano l'AVVERSARIO; Staffetta, Zampata, Monito e
     Teletrasporto fanno uscire CHI LI USA. Solo Staffetta e Zampata passano
     gli sbalzi di statistica a chi entra. */
  MOSSE_SPECIALI.WHIRLWIND = (a, f, m, msg) => chiediCambio(f, false, msg, `${f.name} viene spazzato via dal campo!`);
  MOSSE_SPECIALI.ROAR      = (a, f, m, msg) => chiediCambio(f, false, msg, `Il boato caccia ${f.name} dal campo!`);
  MOSSE_SPECIALI.TELEPORT  = (a, f, m, msg) => chiediCambio(a, false, msg, `${a.name} si teletrasporta via!`, true);
  MOSSE_SPECIALI.BATON_PASS = (a, f, m, msg) => chiediCambio(a, true, msg, `${a.name} passa il testimone!`, true);
  MOSSE_SPECIALI.SHED_TAIL = (a, f, m, msg) => {
    const costo = Math.floor(a.maxHp / 4);
    if (a.hp <= costo) { stessoMomento(msg, `${a.name} non ha abbastanza PS!`); return; }
    if (!chiediCambio(a, true, msg, null, true)) return;
    a.hp -= costo; a._justHit = true; a.volatile.sub = costo;
    msg.push(`${a.name} lascia un sostituto e si defila!`);
  };
  MOSSE_SPECIALI.PARTING_SHOT = (a, f, m, msg) => {
    if (f && !f.fainted) applyStatStage(f, ["ATK", "SPATK"], -1, msg, false);
    chiediCambio(a, false, msg, `${a.name} lascia il campo dopo l'ultima parola!`, true);
  };

  // Probabilita' del TIER (poi si pesca l'oggetto dentro al tier, coi pesi sopra)
  const TIER_W = { COMMON: 50, GREAT: 34, ULTRA: 13, ROGUE: 3, MASTER: 0.5 };
  /* PROMOZIONE DI TIER PER FORTUNA — la cascata dell'originale
     (`getNewModifierTypeOption`, modifier-type.ts:2795):

         upgradeOdds = floor(128 / ((fortuna + 4) / 4))  =  floor(512 / (fortuna+4))
         si promuove se un tiro 0..odds-1 esce < 4, e SI RIPETE finché fallisce

     Cioè 3,13% a fortuna 0 e 14,29% a fortuna 14 — e, di rado, due tier in un
     colpo solo, che è metà del divertimento.
     ⚠️ Ha sostituito uno spostamento di pesi fatto in casa: quello non poteva
     mai promuovere due volte, e a fortuna 0 dava già percentuali diverse da
     quelle di base. La fortuna ora entra SOLO qui, i pesi di TIER_W restano
     quelli nostri. */
  const TIER_ORD = ["COMMON", "GREAT", "ULTRA", "ROGUE", "MASTER"];
  function promuoviPerFortuna(tier) {
    const odds = Math.floor(512 / (runLuck() + 4));
    let i = TIER_ORD.indexOf(tier);
    if (i < 0) return tier;
    while (i < TIER_ORD.length - 1 && Math.floor(Math.random() * odds) < 4) i++;
    return TIER_ORD[i];
  }
  const TIER_COL = { COMMON: "#7f8ba0", GREAT: "#3a7bd0", ULTRA: "#d0a53a", ROGUE: "#8a4ad0", MASTER: "#c0452a" };

  /* Bacche: si tengono e si attivano DA SOLE in lotta (come nell'originale). */
  const BERRY_DATA = {
    SITRUS: { it: "Baccacedro", icon: "sitrus_berry", desc: "cura il 25% sotto meta' PS" },
    LUM:    { it: "Baccaprugna",   icon: "lum_berry",    desc: "cura qualsiasi stato" },
    LEPPA:  { it: "Baccamela",  icon: "leppa_berry",  desc: "+10 PP a una mossa esaurita" },
    ENIGMA: { it: "Baccaenigma", icon: "enigma_berry", desc: "cura il 25% se colpito superefficace" },
    LIECHI: { it: "Baccalici",  icon: "liechi_berry", desc: "+1 Attacco sotto un quarto di PS" },
    GANLON: { it: "Baccalongan",  icon: "ganlon_berry", desc: "+1 Difesa sotto un quarto di PS" },
    PETAYA: { it: "Baccapitaya",  icon: "petaya_berry", desc: "+1 Att. Sp. sotto un quarto di PS" },
    APICOT: { it: "Baccacocca",  icon: "apicot_berry", desc: "+1 Dif. Sp. sotto un quarto di PS" },
    SALAC:  { it: "Baccasalak",   icon: "salac_berry",  desc: "+1 Velocita' sotto un quarto di PS" },
    LANSAT: { it: "Baccalangsa", icon: "lansat_berry", desc: "+2 brutto colpo sotto un quarto di PS" },
    STARF:  { it: "Baccambola",icon: "starf_berry",  desc: "+2 a una stat a caso sotto un quarto" },
  };
  const BERRY_KEYS = Object.keys(BERRY_DATA);

  /* -- Icone reali di PokeRogue per oggetti/ball/vitamine/boost ------------ */
  /* Icone INCORPORATE (data URI). Servono per gli oggetti aggiunti dopo
     l'ultimo APK: gli asset stanno solo dentro l'APK e NON viaggiano con
     l'aggiornamento a caldo, quindi un PNG nuovo in `assets/` resterebbe un
     buco vuoto sul telefono fino alla prossima ricostruzione. Sono 8 icone
     32x32 da 285 byte l'una (3 KB in tutto in base64). */
  const ITEM_DATAURI = {
    x_attack: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgBAMAAACBVGfHAAAAIVBMVEUAAAAgICCDMTGkSkrFYnPmg3uclJTunKzm1dX/5t7///8icg1iAAAAAXRSTlMAQObYZgAAAKpJREFUeF5joC9gFBRAFRBLS0QRYcxIW5mIoqA1alWaALICl1VLwxACgiJlXqtcwxLh8q7lRrOWl5jDBYRUwqdLugMFkBRUFoaYBjfCBEzDp4uXiJhGCMAEFFUrC8OdgArgKsrVS0SdK+C2iobPBCoIMWSAC1TOLFV1DhFAEpgeahpigiRQXhpsFKKCEBAJDTU2dFFE8pmxsbERUAcCCBsbCwqiBp8gA30BAGrtJrnF5vaHAAAAAElFTkSuQmCC",
    x_defense: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgBAMAAACBVGfHAAAAIVBMVEUAAAAgICA5OYtKSqRzYsV7g+aUlJysnO7V1ebe5v////+/l/rsAAAAAXRSTlMAQObYZgAAAKpJREFUeF5joC9gFBRAFRBLS0QRYcxIW5mIoqA1alWaALICl1VLwxACgiJlXqtcwxLh8q7lRrOWl5jDBYRUwqdLugMFkBRUFoaYBjfCBEzDp4uXiJhGCMAEFFUrC8OdgArgKsrVS0SdK+C2iobPBCoIMWSAC1TOLFV1DhFAEpgeahpigiRQXhpsFKKCEBAJDTU2dFFE8pmxsbERUAcCCBsbCwqiBp8gA30BAGrtJrnF5vaHAAAAAElFTkSuQmCC",
    x_sp_atk: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgBAMAAACBVGfHAAAAIVBMVEUAAAAgICBqaiCcnEqkpFrNzWqcnJTm5qzm5tX//97////u9APtAAAAAXRSTlMAQObYZgAAAKpJREFUeF5joC9gFBRAFRBLS0QRYcxIW5mIoqA1alWaALICl1VLwxACgiJlXqtcwxLh8q7lRrOWl5jDBYRUwqdLugMFkBRUFoaYBjfCBEzDp4uXiJhGCMAEFFUrC8OdgArgKsrVS0SdK+C2iobPBCoIMWSAC1TOLFV1DhFAEpgeahpigiRQXhpsFKKCEBAJDTU2dFFE8pmxsbERUAcCCBsbCwqiBp8gA30BAGrtJrnF5vaHAAAAAElFTkSuQmCC",
    x_sp_def: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgBAMAAACBVGfHAAAAIVBMVEUAAAAgICBaWlpic3tii4uUlJSLrKy91d7m5tXu7u7////hl5epAAAAAXRSTlMAQObYZgAAAKpJREFUeF5joC9gFBRAFRANDUQRYYwIXRmIoqAta1WoALICl1XLUhECgiKlXqvcUgPh8m7lRrOWl5jDBYRU0qdLugMFkBRUFqaYJTfCBMzSp4uXiJhlCMAEFNUqC9OdgArgKsrVS8ScK+C2iqXPBCpIMWSAC1TOLFNzThFAEpieZpZigiRQXpZslKKCEBBJSzM2dFFE8pmxsbERUAcCCBsbCwqiBp8gA30BAMZ7J2egqDTxAAAAAElFTkSuQmCC",
    x_speed: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgBAMAAACBVGfHAAAAIVBMVEUAAAAgICAgampKnJxapKRqzc2UnJys5ubV5ube//////8pPwKVAAAAAXRSTlMAQObYZgAAAKpJREFUeF5joC9gFBRAFRBLS0QRYcxIW5mIoqA1alWaALICl1VLwxACgiJlXqtcwxLh8q7lRrOWl5jDBYRUwqdLugMFkBRUFoaYBjfCBEzDp4uXiJhGCMAEFFUrC8OdgArgKsrVS0SdK+C2iobPBCoIMWSAC1TOLFV1DhFAEpgeahpigiRQXhpsFKKCEBAJDTU2dFFE8pmxsbERUAcCCBsbCwqiBp8gA30BAGrtJrnF5vaHAAAAAElFTkSuQmCC",
    x_accuracy: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgBAMAAACBVGfHAAAAIVBMVEUAAAAgICBzMWKkUpSsYpzNc72clJzutN7m1eb/5vb///+Q1cqMAAAAAXRSTlMAQObYZgAAAKpJREFUeF5joC9gFBRAFRBLS0QRYcxIW5mIoqA1alWaALICl1VLwxACgiJlXqtcwxLh8q7lRrOWl5jDBYRUwqdLugMFkBRUFoaYBjfCBEzDp4uXiJhGCMAEFFUrC8OdgArgKsrVS0SdK+C2iobPBCoIMWSAC1TOLFV1DhFAEpgeahpigiRQXhpsFKKCEBAJDTU2dFFE8pmxsbERUAcCCBsbCwqiBp8gA30BAGrtJrnF5vaHAAAAAElFTkSuQmCC",
    dire_hit: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgBAMAAACBVGfHAAAAIVBMVEUAAAAgICB7OQi0gzHNlDHmvVqklJT/1YPu1b3/5s3///+wuCDOAAAAAXRSTlMAQObYZgAAAKpJREFUeF5joC9gFBRAFRBLS0QRYcxIW5mIoqA1alWaALICl1VLwxACgiJlXqtcwxLh8q7lRrOWl5jDBYRUwqdLugMFkBRUFoaYBjfCBEzDp4uXiJhGCMAEFFUrC8OdgArgKsrVS0SdK+C2iobPBCoIMWSAC1TOLFV1DhFAEpgeahpigiRQXhpsFKKCEBAJDTU2dFFE8pmxsbERUAcCCBsbCwqiBp8gA30BAGrtJrnF5vaHAAAAAElFTkSuQmCC",
    /* Riequilibrante: e' la Cura totale con la tinta spostata al VERDE.
       ⚠️ Non al blu, che sarebbe stata la scelta ovvia: nei badge il blu vuol
       dire "statistica in calo", e un oggetto che i cali li TOGLIE non puo'
       avere il colore di quello che combatte. */
    riequilibrante: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABlElEQVR42u2WoUsDURzHP3MHs81XZLP4LhhcGLyVsWWTWsQ1o8VmsA7D8B+wXbEKgs3ZZGAZWDwwuCB6jwUFy4JBwTDDzbk5J/fuNkS4L1y478Hv+/v93vfLO4gR44+RmFQhKWV38F1rHai2NSnhE++sz+1wCPZFN0gTVtRpvwu7nTt4ekcGrGVFnXZI2H31iYw1eQ9IKbvCW8Fhd7xwT1yuPQb2gFED+noRACWWRoTl9jP6fMFIHGDG5AiUWALwxRsvQ9/00XwoE89Ezl+j7Z95xoLjB4SnRiI5vRg22lDyhQEoWbjeDcpTYBMohsYb2BCXw4RIwmrKf3IplJ3HocbUNpC8FZAdILIWzFk9j+RwqLHD/nQ84Fbr3Oc2+2YEUHYeJXJciVPc5jXFTsVoIKMNqIMSbrX+Reyle6m4pdhaD2UjcxPupaH1hioXAHCoUaQS2sfRYxgR/6sBk3j9mw0YmbDYXIfl2fEp6RmzY7uBL6TAG9BaJ+RWAlpvPzahygU6tmskHuqf8LeLxkQ4RowYn/gA+ISH0AIsmB0AAAAASUVORK5CYII=",
    big_mushroom: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgBAMAAACBVGfHAAAAIVBMVEUAAAAgICDVOSCLe3v/c1ru1Ur25mK0pKT/pIPezc3u3t666kKVAAAAAXRSTlMAQObYZgAAAIxJREFUeF5jGGggKCiAEGAUFBRUynBECAi5uoR0ZCgiFHi0uIZ4dCAEhDpaXF08mhBmiHS4uLh0IAu4uIa4RgB1IARCXUKbkAREQ1zARiAEXFxdOhQFULR0NAkXIpyh5pLRoWheKQAX0OjoUBIun4UQyOhoUhSvXIUQAPIFGGctRJjhBLIB4XsEezABAGkLHpxJELo6AAAAAElFTkSuQmCC",
  };
  const itemIcon = n => ITEM_DATAURI[n] || `assets/ui/items/${n}.png`;
  const ballIcon = n => `assets/ui/pokeball/${n}.png`;
  const VIT_ICON = { hp: "hp_up", atk: "protein", def: "iron", spatk: "calcium", spdef: "zinc", spd: "carbos" };
  /* Nome ufficiale dello strumento che potenzia un tipo: nell'originale non
     si chiamano "Boost Fuoco" ma Carbonella, Acqua magica, Miracolseme... */
  const TYPEBOOST_IT = { silk_scarf: "Sciarpa seta", black_belt: "Cinturanera", sharp_beak: "Beccaffilato", poison_barb: "Velenaculeo", soft_sand: "Sabbia soffice", hard_stone: "Pietradura", silver_powder: "Argenpolvere", spell_tag: "Spettrotarga", metal_coat: "Metalcopertura", charcoal: "Carbonella", mystic_water: "Acqua magica", miracle_seed: "Miracolseme", magnet: "Magnete", twisted_spoon: "Cucchiaio torto", never_melt_ice: "Gelomai", dragon_fang: "Dente di drago", black_glasses: "Occhialineri", fairy_feather: "Piuma fatata" };
  const nomeTypeBoost = t => TYPEBOOST_IT[TYPEBOOST_ICON[t]] || `strumento ${(T[t] || {}).it || ""}`;
  const TYPEBOOST_ICON = { NORMAL: "silk_scarf", FIRE: "charcoal", WATER: "mystic_water", GRASS: "miracle_seed", ELECTRIC: "magnet", PSYCHIC: "twisted_spoon", FIGHTING: "black_belt", FLYING: "sharp_beak", POISON: "poison_barb", GROUND: "soft_sand", ROCK: "hard_stone", GHOST: "spell_tag", DRAGON: "dragon_fang", DARK: "black_glasses", STEEL: "metal_coat", ICE: "never_melt_ice", BUG: "silver_powder", FAIRY: "fairy_feather" };
  // Icona di una scelta premio. Le scelte "dinamiche" (vitamina, boost di tipo,
  // pietra, bacca) hanno l'icona del pezzo effettivamente estratto.
  /* La descrizione di un premio. Alcune dipendono dall'ondata (le pepite
     dicono quante monete valgono adesso) e sono funzioni. */
  function descOggetto(pk) {
    const d = pk.desc || pk.item.desc;
    return typeof d === "function" ? d() : d;
  }

  function rewardIconSrc(pk) {
    const it = pk.item;
    if (pk.stat && it.id === "vit") return itemIcon(VIT_ICON[pk.stat] || "hp_up");
    if (pk.stat && it.id === "xitem") return itemIcon((XITEMS[pk.stat] || {}).icon || "x_attack");
    if (pk.type) return itemIcon(TYPEBOOST_ICON[pk.type] || "silk_scarf");
    if (pk.stone) return itemIcon(STONE_DATA[pk.stone].icon);
    if (pk.berry) return itemIcon(BERRY_DATA[pk.berry].icon);
    // MT: icona del TIPO della mossa · Menta: icona della statistica alzata
    if (pk.boost) return itemIcon(SPECIE_BOOST[pk.boost].icon);
    if (pk.tm) return itemIcon("tm_" + (M[pk.tm].type || "normal").toLowerCase());
    if (pk.nature) {
      const su = NATURES[pk.nature].su;
      return itemIcon(su ? "mint_" + (su === "spatk" ? "spatk" : su === "spdef" ? "spdef" : su) : "mint_neutral");
    }
    return it.ball ? ballIcon(it.icon) : itemIcon(it.icon);
  }

  // Caramelle fuori-lotta: livelli e mosse senza prompt (auto-impara solo se c'e' posto)
  function checkLevelUpsQuiet(p) {
    const dummy = { push: () => {} };
    checkLevelUps(p, dummy);
    // controllo "silenzioso": niente code, né mosse da sostituire né evoluzioni
    game.pendingLearns = []; game.pendingEvos = [];
  }

  /* Completa una scelta "dinamica": decide QUALE vitamina/tipo/pietra/bacca. */
  function fillPick(item) {
    const pick = { item, label: item.label };
    const rnd = a => a[Math.floor(Math.random() * a.length)];
    if (item.dyn === "stat") {
      pick.stat = rnd(VITS);
      pick.label = VIT_NOME[pick.stat];
      pick.desc = `+10% ${STAT_IT[pick.stat] || VIT_IT[pick.stat]} di base`;
    } else if (item.dyn === "xstat") {
      pick.stat = rnd(XITEM_KEYS);
      pick.label = XITEMS[pick.stat].it;
      pick.desc = pick.stat === "acc"
        ? "+1 stadio di Precisione a tutta la squadra, per 5 ondate"
        : `+20% ${STAT_IT[pick.stat]} a tutta la squadra, per 5 ondate`;
    } else if (item.dyn === "type") {
      // un tipo fra quelli che la squadra usa davvero, come fa l'originale
      const tipi = [...new Set(game.party.flatMap(p => p.types))];
      pick.type = rnd(tipi.length ? tipi : ["NORMAL"]);
      pick.label = nomeTypeBoost(pick.type);
      pick.desc = `held: +20% alle mosse di tipo ${T[pick.type].it}`;
    } else if (item.dyn === "stone") {
      const s = usefulStones();
      if (!s.length) return null;              // nessuno in squadra la userebbe
      pick.stone = rnd(s);
      pick.label = STONE_DATA[pick.stone].it;
      pick.desc = "fa evolvere un membro della squadra";
    } else if (item.dyn === "berry") {
      pick.berry = rnd(BERRY_KEYS);
      pick.label = BERRY_DATA[pick.berry].it;
      pick.desc = BERRY_DATA[pick.berry].desc;
    } else if (item.dyn === "nature") {
      // solo nature "utili": niente neutre, come le Mente vere
      pick.nature = rnd(NATURE_KEYS.filter(k => NATURES[k].su));
      const n = NATURES[pick.nature];
      pick.label = `Menta ${n.it}`;
      pick.desc = `natura ${n.it}: +${VIT_IT[n.su]}, −${VIT_IT[n.giu]}`;
    } else if (item.dyn === "specieboost") {
      const disp = boostSpecieDisponibili();
      if (!disp.length) return null;
      pick.boost = rnd(disp);
      pick.label = SPECIE_BOOST[pick.boost].it;
      pick.desc = `raddoppia ${SPECIE_BOOST[pick.boost].stats.map(s => VIT_IT[s]).join(" e ")} a chi lo sa usare`;
    } else if (item.dyn === "tm") {
      const tm = randomTm(item.tmTier);
      if (!tm) return null;                    // nessuno in squadra la puo' imparare
      pick.tm = tm;
      pick.label = `MT ${M[tm].it}`;
      pick.desc = `insegna ${M[tm].it} (${(T[M[tm].type] || {}).it || ""})`;
    }
    return pick;
  }

  /* Genera una scelta: prima il TIER (pesato dalla fortuna), poi l'oggetto
     DENTRO il tier coi pesi dell'originale. Gli oggetti con `avail` falso
     (cure senza feriti, pietre inutili...) non entrano proprio nell'urna. */
  /* Estrae un premio di un TIER IMPOSTO (serve ai premi garantiti del Rivale). */
  function rollRewardTier(tier, excludeIds) {
    for (let tries = 0; tries < 30; tries++) {
      const pool = REWARD_POOL.filter(x =>
        x.tier === tier && x.weight > 0 && !excludeIds.includes(x.id) && (!x.avail || x.avail()));
      if (!pool.length) break;
      let wt = pool.reduce((s, x) => s + x.weight, 0), r = Math.random() * wt;
      let item = pool[pool.length - 1];
      for (const x of pool) { r -= x.weight; if (r <= 0) { item = x; break; } }
      const pick = fillPick(item);
      if (pick) return pick;
    }
    return rollReward(excludeIds);      // se quel tier non ha nulla di utile
  }

  function rollReward(excludeIds) {
    for (let tries = 0; tries < 40; tries++) {
      const W = TIER_W;
      const tot = Object.values(W).reduce((a, b) => a + b, 0);
      let r = Math.random() * tot, tier = "COMMON";
      for (const k in W) { r -= W[k]; if (r <= 0) { tier = k; break; } }
      tier = promuoviPerFortuna(tier);
      const pool = REWARD_POOL.filter(x =>
        x.tier === tier && x.weight > 0 && !excludeIds.includes(x.id) && (!x.avail || x.avail()));
      if (!pool.length) continue;
      let wt = pool.reduce((s, x) => s + x.weight, 0), r2 = Math.random() * wt;
      let item = pool[pool.length - 1];
      for (const x of pool) { r2 -= x.weight; if (r2 <= 0) { item = x; break; } }
      const pick = fillPick(item);
      if (pick) return pick;
    }
    // rete di sicurezza: una Poke Ball fa sempre comodo
    return fillPick(REWARD_POOL.find(x => x.id === "balls"));
  }

  // Negozio del mercante: quanto costa il prossimo reroll (cresce a ogni uso).
  let rerollCount = 0;
  // Oggetti evolutivi: tutti e 41 quelli usati dalle nostre 1084 specie,
  // con il nome italiano ufficiale e l'icona reale di PokeRogue.
  const STONE_DATA = {
    AUSPICIOUS_ARMOR: { it: "Armatura fausta", icon: "auspicious_armor" },
    BLACK_AUGURITE: { it: "Augite nera", icon: "black_augurite" },
    CRACKED_POT: { it: "Teiera rotta", icon: "cracked_pot" },
    DAWN_STONE: { it: "Pietralbore", icon: "dawn_stone" },
    DRAGON_SCALE: { it: "Squama drago", icon: "dragon_scale" },
    DUBIOUS_DISC: { it: "Dubbiodisco", icon: "dubious_disc" },
    DUSK_STONE: { it: "Neropietra", icon: "dusk_stone" },
    ELECTIRIZER: { it: "Elettritore", icon: "electirizer" },
    FIRE_STONE: { it: "Pietrafocaia", icon: "fire_stone" },
    GALARICA_CUFF: { it: "Fascia Galarnoce", icon: "galarica_cuff" },
    GALARICA_WREATH: { it: "Corona Galarnoce", icon: "galarica_wreath" },
    ICE_STONE: { it: "Pietragelo", icon: "ice_stone" },
    LEADERS_CREST: { it: "Simbolo del capo", icon: "leaders_crest" },
    LEAF_STONE: { it: "Pietrafoglia", icon: "leaf_stone" },
    LINKING_CORD: { it: "Filo dell'unione", icon: "linking_cord" },
    MAGMARIZER: { it: "Magmatore", icon: "magmarizer" },
    MALICIOUS_ARMOR: { it: "Armatura infausta", icon: "malicious_armor" },
    METAL_ALLOY: { it: "Metallo composito", icon: "metal_alloy" },
    MOON_FLUTE: { it: "Flauto lunare", icon: "moon_flute" },
    MOON_STONE: { it: "Pietralunare", icon: "moon_stone" },
    OVAL_STONE: { it: "Pietraovale", icon: "oval_stone" },
    PEAT_BLOCK: { it: "Blocco di torba", icon: "peat_block" },
    PRISM_SCALE: { it: "Squama bella", icon: "prism_scale" },
    PROTECTOR: { it: "Copertura", icon: "protector" },
    RAZOR_CLAW: { it: "Affilartiglio", icon: "razor_claw" },
    RAZOR_FANG: { it: "Affilodente", icon: "razor_fang" },
    REAPER_CLOTH: { it: "Terrorpanno", icon: "reaper_cloth" },
    SACHET: { it: "Bustina aromi", icon: "sachet" },
    SCROLL_OF_DARKNESS: { it: "Rotolo del Buio", icon: "scroll_of_darkness" },
    SHINY_STONE: { it: "Pietrabrillo", icon: "shiny_stone" },
    STRAWBERRY_SWEET: { it: "Bonbonfragola", icon: "strawberry_sweet" },
    SUN_FLUTE: { it: "Flauto solare", icon: "sun_flute" },
    SUN_STONE: { it: "Pietrasolare", icon: "sun_stone" },
    SWEET_APPLE: { it: "Dolcepomo", icon: "sweet_apple" },
    SYRUPY_APPLE: { it: "Sciroppomo", icon: "syrupy_apple" },
    TART_APPLE: { it: "Aspropomo", icon: "tart_apple" },
    THUNDER_STONE: { it: "Pietratuono", icon: "thunder_stone" },
    UNREMARKABLE_TEACUP: { it: "Tazza dozzinale", icon: "unremarkable_teacup" },
    UPGRADE: { it: "Upgrade", icon: "upgrade" },
    WATER_STONE: { it: "Pietraidrica", icon: "water_stone" },
    WHIPPED_DREAM: { it: "Dolcespuma", icon: "whipped_dream" },
  };

  /* Pietre che servono DAVVERO a qualcuno in squadra.
     Nell'originale `EvolutionItemModifierType` propone un oggetto evolutivo solo
     se un membro ha un'evoluzione valida con quell'oggetto: senza questo filtro
     compaiono pietre inutili. */
  function usefulStones() {
    const out = new Set();
    for (const mon of game.party) {
      if (mon.fainted) continue;
      for (const e of (S[mon.speciesId].evolutions || [])) {
        if (e.item && evoUsabile(e) && STONE_DATA[e.item] && evoConditionOk(mon, e)) out.add(e.item);
      }
    }
    return [...out];
  }
  // Evoluzioni a pietra possibili ORA: per ogni membro squadra che può evolvere
  // con una pietra POSSEDUTA e verso una specie esistente (Gen1).
  function compatibleStoneEvos() {
    const out = [];
    game.party.forEach((mon, i) => {
      for (const e of (S[mon.speciesId].evolutions || [])) {
        // la pietra da sola non basta: vanno rispettate anche le condizioni
        // (Eevee->Sylveon vuole una mossa Folletto, Kirlia->Gallade il maschio…)
        if (e.item && evoUsabile(e) && (game.stones[e.item] || 0) > 0 && evoConditionOk(mon, e))
          out.push({ i, mon, stone: e.item, to: e.to });
      }
    });
    return out;
  }

  /* ----------------------------------------------------------------------
     NEGOZIO — come `getPlayerShopModifierTypeOptionsForWave` dell'originale:
       · vende SOLO consumabili (ball, pietre e amuleti sono PREMI, non merce)
       · le righe si sbloccano con le ondate: ceil((ondata + 10) / 30)
       · alle ondate multiple di 10 il negozio e' CHIUSO
       · i prezzi sono multipli del "denaro d'ondata" (waveMoney), quindi
         scalano da soli invece di essere fissi
     ---------------------------------------------------------------------- */
  const SHOP_ROWS = [
    [{ id: "potion", mult: 0.2 }, { id: "ether", mult: 0.4 }, { id: "revive", mult: 2 }],
    [{ id: "superpotion", mult: 0.45 }, { id: "fullheal", mult: 1 }],
    [{ id: "elisir", mult: 1 }, { id: "maxether", mult: 1 }, { id: "riequilibrante", mult: 1.2 }],
    // ⚠️ il Fungo della memoria mancava: nell'originale sta proprio qui, a x4
    [{ id: "hyperpotion", mult: 0.8 }, { id: "maxrevive", mult: 2.75 }, { id: "mushroom", mult: 4 }],
    [{ id: "maxpotion", mult: 1.5 }, { id: "maxelisir", mult: 2.5 }],
    [{ id: "fullrestore", mult: 2.25 }],
    [{ id: "sacredash", mult: 10 }],
  ];
  function shopStock() {
    if (game.wave % 10 === 0) return [];       // niente negozio sulle ondate x10
    const righe = Math.ceil(Math.max(game.wave + 10, 0) / 30);
    const base = waveMoney(1);
    return SHOP_ROWS.slice(0, righe).flat().map(g => {
      const item = REWARD_POOL.find(x => x.id === g.id);
      // rincaro dell'incontro "Da Monnezza a Meraviglia"
      const mult = g.mult * (game.shopMarkup || 1);
      return { item, price: Math.max(10, Math.floor(base * mult / 10) * 10) };
    });
  }

  /* 🔴 LA PIETRA SI USA SUBITO.
     Prima prendere il Filo di Unione come premio lo infilava in un magazzino
     (`game.stones`) e basta: l'evoluzione bisognava andarsela a cercare con un
     tasto a parte, e se non ci pensavi la pietra restava li' per sempre. Un
     premio che non fa niente quando lo prendi non sembra un premio.
     Adesso appena lo scegli ti chiede su CHI usarlo, e l'evoluzione parte.
     ⚠️ Se dici di no si torna all'EMPORIO col premio ancora da scegliere:
     `back` è la stessa strada del tasto Indietro, quindi il premio non si
     consuma e ne puoi prendere un altro. */
  function chiEvolveCon(pietra) {
    const out = [];
    game.party.forEach(mon => {
      if (mon.fainted) return;
      for (const e of (S[mon.speciesId].evolutions || [])) {
        if (e.item === pietra && evoUsabile(e) && evoConditionOk(mon, e)) out.push({ mon, to: e.to });
      }
    });
    return out;
  }
  /* Come per le pietre: la MT la si consegna SUBITO, e a chi decidi tu.
     Prima `insegnaTm` prendeva `chiPuoImparare(moveId)[0]`, cioe' il PRIMO
     della lista: la mossa finiva addosso a qualcuno a caso senza chiedere. */
  function usaMtSubito(pick, done, back) {
    const mv = M[pick.tm];
    const puo = chiPuoImparare(pick.tm);
    const tit = `MT ${mv.it}`;
    if (!puo.length) {
      showMetaScreen(`
        <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">${tit}</div>
        <div class="meta-sub">Nessuno in squadra può impararla.</div>
        <div class="meta-actions"><button class="meta-btn ghost" data-act="back">↩ Scegli un altro premio</button></div>`);
      metaEl().querySelector('[data-act="back"]').onclick = back;
      return;
    }
    const righe = puo.map((p, i) => {
      /* Dire in anticipo se dovra' DIMENTICARE qualcosa: e' l'informazione che
         serve per scegliere, e senza si scopriva solo dopo. */
      const pieno = p.moves.length >= 4;
      return `<button class="me-opt" data-i="${i}">
        <span class="me-opt-l">${miniIcon(p.dex, 1.2)}${p.name}</span>
        <span class="me-opt-s">Lv.${p.level} · ${pieno ? "dovrà dimenticare una mossa" : "ha ancora spazio"}</span></button>`;
    }).join("");
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">${tit}</div>
      <div class="meta-sub"><span class="ticon t-${mv.type}"></span> ${mv.effect || "A chi la insegni?"}</div>
      <div class="me-opts">${righe}
        <button class="me-opt" data-act="back">
          <span class="me-opt-l">↩ A nessuno</span>
          <span class="me-opt-s">torna all'emporio e scegli un altro premio</span></button></div>`);
    metaEl().querySelectorAll(".me-opt[data-i]").forEach(b => b.onclick = () => {
      insegnaTm(pick.tm, puo[parseInt(b.dataset.i, 10)]);
      done();
    });
    metaEl().querySelector('[data-act="back"]').onclick = back;
  }

  function usaPietraSubito(pick, done, back) {
    const pietra = pick.stone;
    const evos = chiEvolveCon(pietra);
    const nome = (STONE_DATA[pietra] || {}).it || "la pietra";
    if (!evos.length) {
      // non serve a nessuno: si torna indietro senza consumare il premio
      showMetaScreen(`
        <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">${nome}</div>
        <div class="meta-sub">Nessuno in squadra può usarla adesso.</div>
        <div class="meta-actions"><button class="meta-btn ghost" data-act="back">↩ Scegli un altro premio</button></div>`);
      metaEl().querySelector('[data-act="back"]').onclick = back;
      return;
    }
    const righe = evos.map((e, i) =>
      `<button class="me-opt" data-i="${i}">
        <span class="me-opt-l">${miniIcon(e.mon.dex, 1.2)}${e.mon.name} → ${S[e.to].it}</span>
        <span class="me-opt-s">Lv.${e.mon.level}</span></button>`).join("");
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">${nome}</div>
      <div class="meta-sub">Su chi vuoi usarla?</div>
      <div class="me-opts">${righe}
        <button class="me-opt" data-act="back">
          <span class="me-opt-l">↩ Su nessuno</span>
          <span class="me-opt-s">torna all'emporio e scegli un altro premio</span></button></div>`);
    metaEl().querySelectorAll(".me-opt[data-i]").forEach(b => b.onclick = () => {
      const e = evos[parseInt(b.dataset.i, 10)];
      hideMeta(); renderScene();
      animaEvoluzione(e.mon, e.to, (proseguito) => {
        /* Fermare l'evoluzione a meta' equivale a dire «su nessuno»: la pietra
           non si spende e il premio resta da scegliere. */
        if (!proseguito) {
          renderScene();
          queueMessages([`Cosa?! ${e.mon.name} ha smesso di evolversi!`], back);
          return;
        }
        const msgs = [];
        evolve(e.mon, e.to, msgs);
        renderScene();
        queueMessages(msgs, done);
      });
    });
    metaEl().querySelector('[data-act="back"]').onclick = back;
  }

  // Schermata "usa una pietra": elenca le evoluzioni disponibili; scegline una.
  function showEvolvePicker(back) {
    const evos = compatibleStoneEvos();
    if (!evos.length) { back(); return; }
    const rows = evos.map((e, idx) =>
      `<button class="me-opt" data-i="${idx}">
        <span class="me-opt-l">${e.mon.name} → ${S[e.to].it}</span>
        <span class="me-opt-s">con ${STONE_DATA[e.stone].it}</span></button>`).join("");
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">Evoluzione con Pietra</div>
      <div class="me-opts">${rows}
        <button class="me-opt" data-act="back"><span class="me-opt-l">Indietro</span></button></div>`);
    metaEl().querySelectorAll(".me-opt[data-i]").forEach(b => b.onclick = () => {
      const e = evos[parseInt(b.dataset.i, 10)];
      hideMeta();                  // narrazione sul bottom screen
      renderScene();
      // anche con la pietra si vede l'animazione, e si può fermare: in quel
      // caso la pietra NON si consuma
      animaEvoluzione(e.mon, e.to, (proseguito) => {
        const msgs = [];
        if (proseguito) { game.stones[e.stone]--; evolve(e.mon, e.to, msgs); }
        else msgs.push(`Cosa?! ${e.mon.name} ha smesso di evolversi!`);
        renderScene();
        queueMessages(msgs, () => back());
      });
    });
    metaEl().querySelector('[data-act="back"]').onclick = back;
  }

  /* ----------------------------------------------------------------------
     A CHI DARE L'OGGETTO
     Pozioni, eteri, caramelle, vitamine e oggetti tenuti NON vanno per forza
     al Pokemon in campo: si sceglie il destinatario, come nell'originale.
     Chi non puo' riceverlo (gia' a PS pieni, non esausto, ecc.) resta grigio.
     ---------------------------------------------------------------------- */
  function chooseTarget(pick, onDone, onBack) {
    const item = pick.item;
    const valid = item.valid || alive;
    const usable = game.party.filter(valid);
    if (!usable.length) { onBack(); return; }
    // un solo destinatario possibile: niente schermata, si applica e via
    if (usable.length === 1 && game.party.length === 1) { onDone(usable[0]); return; }

    const rows = game.party.map((p, i) => {
      const ok = valid(p);
      const ratio = Math.max(0, p.hp / p.maxHp);
      const col = ratio > 0.5 ? "var(--hp-green)" : ratio > 0.2 ? "var(--hp-yellow)" : "var(--hp-red)";
      const st = p.status ? `<span class="status-badge st-${p.status}">${STATUS_IT[p.status]}</span>` : "";
      const ppTot = p.moves.reduce((s, m) => s + m.pp, 0), ppMax = p.moves.reduce((s, m) => s + m.maxPp, 0);
      const held = Object.keys(p.held || {}).length || Object.keys(p.berries || {}).length
        ? `<span class="pd-held">🎒 ${heldSummary(p)}</span>` : "";
      return `<button class="pd-card tgt ${ok ? "" : "ko"}" data-i="${i}" ${ok ? "" : "disabled"}>
          <div class="pd-top">
            <span class="pd-name">${miniIcon(p.dex, 1.1)}${p.shiny ? cromStella(p.shinyVar) : ""}${p.name.replace("✨", "")}<span class="gen g-${p.gender}">${genderSymbol(p)}</span>${st}</span>
            <span class="pd-lv">Lv.${p.level}</span></div>
          <div class="party-hp-track"><div class="party-hp-fill" style="width:${ratio * 100}%;background:${col};"></div></div>
          <div class="pd-hp">${p.fainted ? "esausto" : Math.max(0, p.hp) + "/" + p.maxHp + " PS"} · PP ${ppTot}/${ppMax} ${held}</div>
        </button>`;
    }).join("");

    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(18px,5.2vw,28px)">${pick.label}</div>
      <div class="meta-sub">A chi lo dai?</div>
      <div class="pd-list">${rows}</div>
      <div class="meta-actions"><button class="meta-btn ghost" data-act="back">Indietro</button></div>`);
    metaEl().querySelectorAll(".pd-card.tgt[data-i]").forEach(b => b.onclick = () =>
      onDone(game.party[parseInt(b.dataset.i, 10)]));
    metaEl().querySelector('[data-act="back"]').onclick = onBack;
  }

  /* Consegna un premio/acquisto: se serve un destinatario lo chiede prima. */
  /* 🔴 QUALE MOSSA. Etere, Etere max, PP-su e PP-max agiscono su una mossa
     sola, e nell'originale la scegli tu (il pannello squadra si apre in modo
     MOVE_MODIFIER). Qui e' una schermata sua, con i PP di ognuna e il tastino
     che dice cosa fa la mossa. */
  /* Elenco delle mosse che quel Pokemon ha imparato per livello ma non ha
     piu': e' quello che il Fungo della memoria puo' restituire. */
  function scegliMossaDimenticata(pick, mon, onDone, back) {
    const perse = mosseDimenticate(mon);
    if (!perse.length) { back(); return; }
    const righe = perse.map(id => {
      const mv = M[id];
      return `<button class="btn move-btn" data-mv="${id}" style="background:${T[mv.type].color}">
        <span class="move-name">${mv.it}</span>
        <span class="move-meta">
          <span class="ticon t-${mv.type}"></span><span class="cicon c-${mv.category}"></span>
          <span class="move-pp">${mv.power > 0 ? "P" + mv.power + " \u00b7 " : ""}${mv.pp}/${mv.pp}</span>
        </span></button>`;
    }).join("");
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">🍄 Fungo della memoria</div>
      <div class="meta-sub">quale mossa deve ricordare ${mon.name}?</div>
      <div class="ms-mosse-scelta">${righe}</div>
      <div class="meta-actions"><button class="meta-btn ghost" data-act="back">\u21a9 Indietro</button></div>`);
    metaEl().querySelectorAll("[data-mv]").forEach(b => b.onclick = () => onDone(b.dataset.mv));
    metaEl().querySelector('[data-act="back"]').onclick = back;
  }

  function chooseMove(pick, mon, onDone, back) {
    const item = pick.item;
    const utile = (m, i) => item.ppUp ? (m.ppUp || 0) < 3 : m.pp < m.maxPp;
    const righe = mon.moves.map((m, i) => {
      const mv = M[m.id];
      const ok = utile(m, i);
      const extra = item.ppUp
        ? `PP max ${m.maxPp}${(m.ppUp || 0) ? ` · già +${m.ppUp}` : ""}${ok ? "" : " · al massimo"}`
        : `PP ${m.pp}/${m.maxPp}${ok ? "" : " · già pieni"}`;
      return `<button class="btn move-btn" data-i="${i}" ${ok ? "" : "disabled"}
                style="background:${T[mv.type].color};">
          <span class="move-name">${mv.it}</span>
          <span class="move-meta"><span class="ticon t-${mv.type}"></span>
            <span class="move-pp">${extra}</span></span>
        </button>`;
    }).join("");
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(18px,5.2vw,27px)">${pick.label}</div>
      <div class="meta-sub">Su quale mossa di ${mon.name}?</div>
      <div class="ms-mosse-scelta">${righe}</div>
      <div class="meta-actions"><button class="meta-btn ghost" data-act="back">↩ Indietro</button></div>`);
    metaEl().querySelectorAll(".move-btn").forEach(b => b.onclick = () => {
      if (b.disabled) return;
      onDone(parseInt(b.dataset.i, 10));
    });
    metaEl().querySelector('[data-act="back"]').onclick = back;
  }

  /* 🔴 Un oggetto curativo non si vedeva per niente: la barra era già
     piena quando l'emporio si chiudeva, e nessuno diceva cos'era successo.
     Adesso si guarda il Pokemon PRIMA e DOPO e si racconta la differenza — una
     sola volta, qui, cosi' vale anche per gli oggetti che aggiungeremo poi
     invece di dover ricordarsi di scriverlo in ognuno. */
  const STATO_ERA = { BURN: "scottato", PARALYSIS: "paralizzato", SLEEP: "addormentato",
                      POISON: "avvelenato", FREEZE: "congelato" };
  const fotoMon = p => p ? { hp: p.hp, ko: p.fainted, st: p.status,
                             pp: p.moves.reduce((n, m) => n + m.pp, 0),
                             cali: Object.values(p.stages || {}).filter(v => v < 0).length } : null;
  function raccontaEffetto(p, prima) {
    if (!p || !prima) return null;
    const righe = [];
    if (prima.ko && !p.fainted) righe.push(`${p.name} torna in forze!`);
    else if (p.hp > prima.hp) righe.push(`${p.name} recupera ${p.hp - prima.hp} PS!`);
    if (prima.st && !p.status) righe.push(`${p.name} non è più ${STATO_ERA[prima.st] || "malato"}!`);
    const pp = p.moves.reduce((n, m) => n + m.pp, 0) - prima.pp;
    if (pp > 0) righe.push(`${p.name} recupera ${pp} PP!`);
    const caliOra = Object.values(p.stages || {}).filter(v => v < 0).length;
    if (prima.cali > caliOra) righe.push(`${p.name} si scrolla di dosso i cali di statistica!`);
    return righe.length ? righe.join("\n") : null;
  }
  /* Mette in coda il racconto della cura. `pre` e' l'istantanea del campo PRIMA
     che l'oggetto facesse effetto: `nextEvent` la usa per far partire la barra
     da li' e vederla salire (e' lo stesso meccanismo delle mosse). */
  function segnalaCura(p, prima) {
    const testo = raccontaEffetto(p, prima);
    if (!testo) return;
    game.pendingLearns = game.pendingLearns || [];
    game.pendingLearns.push({ cura: { testo, pre: preCura, lato: onField().includes(p) ? sideOf(p) : null } });
  }
  let preCura = null;    // fotografia del CAMPO, presa appena prima di applicare

  /* Suona una o piu' cure di fila e poi chiama `poi`. */
  function suonaCure(lista, poi) {
    if (!lista.length) { poi(); return; }
    const c = lista[0];
    const log = makeLog();
    log.push(c.testo);
    if (c.pre) log.events[0].pre = c.pre;
    if (c.lato) log.anim("COMMON_HEALTH_UP", c.lato);
    playEvents(log.events, () => suonaCure(lista.slice(1), poi));
  }

  function grantItem(pick, done, back) {
    const item = pick.item;
    const conRacconto = (p, esegui) => {
      preCura = snapEvent("");          // com'era il campo un attimo fa
      const prima = fotoMon(p);
      esegui();
      segnalaCura(p, prima);
      preCura = null;
      done();
    };
    /* Le pietre evolutive non finiscono in tasca: si usano ORA (vedi
       `usaPietraSubito`), e dire di no riporta all'emporio. */
    if (item.dyn === "stone" && pick.stone) { usaPietraSubito(pick, done, back); return; }
    if (item.dyn === "tm" && pick.tm) { usaMtSubito(pick, done, back); return; }
    if (item.target === "mon") {
      chooseTarget(pick, p => {
        // gli oggetti "su una mossa" chiedono ANCHE quale
        if (item.mossa) chooseMove(pick, p, (i) => conRacconto(p, () => item.apply(p, pick, i)), back);
        // il Fungo chiede QUALE mossa far ricordare
        else if (item.ricorda) scegliMossaDimenticata(pick, p, (id) => conRacconto(p, () => item.apply(p, pick, id)), back);
        else conRacconto(p, () => item.apply(p, pick));
      }, back);
    } else {
      // oggetti su TUTTA la squadra (Cenere magica): si racconta l'attivo
      conRacconto(game.player, () => item.apply(game.player, pick));
    }
  }

  // Ingresso nel negozio (dopo un'ondata): azzera il costo del reroll.
  function openShop() { rerollCount = 0; showReward(null); }

  // Negozio a SCHERMO INTERO (overlay #meta): la lotta e' finita, quindi si usa
  // tutto lo spazio. Icone reali di PokeRogue per oggetti e ball.
  function showReward(currentPicks) {
    game.phase = "REWARD";
    let picks = currentPicks;
    if (!picks) {
      picks = [];
      // bottino dei team cattivi: Clepto Ball garantite, in quantità
      if (game.pendingTheft) {
        const it = REWARD_POOL.find(r => r.id === "theft");
        picks.push({ item: it, label: `Clepto Ball ×${game.pendingTheft}`, qty: game.pendingTheft });
      }
      // una cura garantita, ma SOLO se c'e' davvero qualcuno da curare
      const heals = REWARD_POOL.filter(r => r.avail && r.avail() &&
        ["potion", "superpotion", "hyperpotion", "maxpotion", "fullrestore", "fullheal", "revive"].includes(r.id));
      if (heals.length) {
        const g = heals[Math.floor(Math.random() * heals.length)];
        picks.push(fillPick(g));
      }
      /* PREMI GARANTITI DEL RIVALE. Nell'originale ogni incontro col Rivale ha
         `guaranteedModifierTiers` con `allowLuckUpgrades: false`: la scelta è
         ricca per costruzione, ed è il motivo per cui il suo dialogo dice «il
         professore mi ha chiesto di darti questi strumenti». Cresce a ogni
         incontro: 2° ULTRA+GREAT+GREAT · 3° ULTRA+ULTRA+GREAT+GREAT ·
         dal 4° in poi tutti ULTRA (e ROGUE negli ultimi). */
      const tappa = game.rivalBattuto;
      if (tappa) {
        const tiers = TIER_PREMI_RIVALE[Math.min(tappa, TIER_PREMI_RIVALE.length) - 1] || [];
        for (const t of tiers) picks.push(rollRewardTier(t, picks.map(x => x.item.id)));
        game.rivalBattuto = 0;
      }
      while (picks.length < 3) picks.push(rollReward(picks.map(x => x.item.id)));
    }
    // costo del rimescolo come l'originale: ceil(ondata/10) x 250, raddoppia a ogni uso
    const rerollCost = Math.ceil(game.wave / 10) * 250 * Math.pow(2, rerollCount);
    const cards = picks.map((pk, i) =>
      `<button class="shop-card" data-i="${i}" style="background:${TIER_COL[pk.item.tier] || TIER_COL.COMMON};">
        <img class="item-icon" src="${rewardIconSrc(pk)}" alt="">
        <span class="rn">${pk.label}</span><span class="rd">${descOggetto(pk)}</span></button>`).join("");
    const stock = shopStock();
    const buyRows = stock.map((g, i) =>
      `<button class="shop-buy" data-s="${i}" ${game.money < g.price ? "disabled" : ""}>
        <img class="item-icon small" src="${itemIcon(g.item.icon)}" alt=""><span>${g.item.label}</span><span class="shop-price">₽${g.price}</span></button>`).join("");
    const shopBlock = stock.length
      ? `<div class="meta-sub">Emporio</div><div class="shop-buy-grid">${buyRows}</div>`
      : `<div class="meta-sub">L'emporio è chiuso su questa ondata</div>`;
    const canEvolve = compatibleStoneEvos().length;
    const evolveBtn = canEvolve ? `<button class="team-btn evolve-btn" data-act="evolve">🌟 Evolvi (${canEvolve})</button>` : "";
    showMetaScreen(`
      <div class="shop-head">
        <div class="meta-title" style="font-size:clamp(18px,5.2vw,28px)">Ondata ${game.wave} superata!</div>
        <div class="shop-head-btns">${evolveBtn}<button class="team-btn" data-act="team">👥 Squadra</button></div>
      </div>
      <div class="meta-stats"><span>₽ ${game.money}</span><span>🔴 ${totalBalls()}</span><span>squadra ${aliveParty().length}/${game.party.length}</span></div>
      <div class="shopfull">
        ${luckBar()}
        <div class="meta-sub">Scegli un premio</div>
        <div class="shop-cards">${cards}
          <button class="shop-card" data-act="reroll" style="background:#3a4250;" ${game.money < rerollCost ? "disabled" : ""}>
            <span class="rn">🎲 Rimescola</span><span class="rd">₽${rerollCost}</span></button>
        </div>
        ${shopBlock}
      </div>`);
    /* 🔴 Il tasto «Squadra» del negozio porta al pannello vero (§35), non più a
       un elenco di sola lettura. In modo «check»: si guardano le schede e si
       spostano gli oggetti, ma non si schiera nessuno — non c'è una lotta. */
    metaEl().querySelector('[data-act="team"]').onclick = () => {
      ritornoSquadra = () => showReward(picks);
      renderParty("check");
    };
    if (canEvolve) metaEl().querySelector('[data-act="evolve"]').onclick = () => showEvolvePicker(() => showReward(picks));
    metaEl().querySelectorAll(".shop-card[data-i]").forEach(b => b.onclick = () => {
      const pk = picks[parseInt(b.dataset.i, 10)];
      grantItem(pk,
        () => { game.pendingTheft = 0; hideMeta(); renderScene();
                // una MT puo' aver messo in coda una sostituzione di mossa
                processLearns(afterReward); },
        () => showReward(picks));      // "Indietro" dalla scelta del destinatario
    });
    metaEl().querySelector('[data-act="reroll"]').onclick = () => {
      if (game.money < rerollCost) return;
      game.money -= rerollCost; rerollCount++;
      showReward(null);
    };
    metaEl().querySelectorAll(".shop-buy").forEach(b => b.onclick = () => {
      const g = stock[parseInt(b.dataset.s, 10)];
      if (game.money < g.price) return;
      const pk = fillPick(g.item);
      grantItem(pk,
        () => {
          game.money -= g.price;
          /* ⚠️ Questo ramo azzerava `pendingLearns` (serve per le caramelle
             comprate) e con esso buttava via anche il racconto della cura, che
             all'emporio e' proprio il caso piu' comune: si compra una Pozione e
             non si vedeva succedere niente. Ora si mette da parte prima. */
          const cure = (game.pendingLearns || []).filter(x => x.cura).map(x => x.cura);
          game.pendingLearns = [];
          renderScene();
          if (cure.length) { hideMeta(); suonaCure(cure, () => showReward(picks)); return; }
          showReward(picks);
        },
        () => showReward(picks));
    });
  }

  // Vista squadra a schermo intero (sola lettura), con dettaglio di ogni Pokemon.
  // `back` = funzione da richiamare col tasto Indietro.
  function showPartyOverlay(back) {
    const rows = game.party.map(p => {
      const ratio = Math.max(0, p.hp / p.maxHp);
      const col = ratio > 0.5 ? "var(--hp-green)" : ratio > 0.2 ? "var(--hp-yellow)" : "var(--hp-red)";
      const types = p.types.map(t => `<span class="ticon t-${t}"></span>`).join("");
      const st = p.status ? `<span class="status-badge st-${p.status}">${STATUS_IT[p.status]}</span>` : "";
      const held = Object.keys(p.held || {}).length ? `<span class="pd-held">🎒 ${heldSummary(p)}</span>` : "";
      const moves = p.moves.map(m => M[m.id].it).join(", ");
      return `<div class="pd-card ${p.fainted ? "ko" : ""}">
          <div class="pd-top"><span class="pd-name">${miniIcon(p.dex, 1.1)}${p.shiny ? cromStella(p.shinyVar) : ""}${p.name.replace("✨", "")}<span class="gen g-${p.gender}">${genderSymbol(p)}</span>${st}</span><span class="pd-lv">Lv.${p.level}</span></div>
          <div class="pd-types">${types} ${p.ability ? `<span class="pd-ab">${p.ability.it}</span>` : ""}${p.passiveAbility ? `<span class="pd-ab pd-pass">+${p.passiveAbility.it}</span>` : ""}${p.nature ? `<span class="pd-ab pd-nat">${natureLabel(p)}</span>` : ""} ${held}</div>
          <div class="party-hp-track"><div class="party-hp-fill" style="width:${ratio * 100}%;background:${col};"></div></div>
          <div class="pd-hp">${Math.max(0, p.hp)}/${p.maxHp} PS · <span class="pd-moves">${moves}</span></div>
        </div>`;
    }).join("");
    const box = game.box.length ? `<div class="meta-sub">Box: ${game.box.length} Pokémon in deposito</div>` : "";
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">La tua Squadra</div>
      <div class="pd-list">${rows}</div>${box}
      <div class="meta-actions"><button class="meta-btn ghost" data-act="back">Indietro</button></div>`);
    metaEl().querySelector('[data-act="back"]').onclick = back;
  }
  // Nomi brevi degli oggetti tenuti, per la vista squadra e la scelta destinatario
  const HELD_IT = {
    leftovers: "Avanzi", shellbell: "Conchinella", focusband: "Bandana",
    quickclaw: "Rapidartigli", kingsrock: "Roccia di re", scopelens: "Mirino",
    widelens: "Grandelente", multilens: "Multilente", eviolite: "Evolcondensa",
    reviverseed: "Revitalseme", toxicorb: "Tossicsfera", flameorb: "Fiammosfera",
    souldew: "Cuorugiada", leek: "Porro",
    gripclaw: "Presartigli", blackhole: "Piccolo buco nero", mysticalrock: "Rocciamistica",
    lightball: "Elettropalla", thickclub: "Osso spesso", metalpowder: "Metalpolvere",
    quickpowder: "Velopolvere", deepseascale: "Squamabissi", deepseatooth: "Dente Abissi",
  };
  // Nome leggibile di un oggetto tenuto (i Boost di Tipo non hanno voce fissa)
  const nomeHeld = k => k === "typeboost" ? "uno strumento di tipo" : (HELD_IT[k] || k);
  function heldSummary(p) {
    const parts = [];
    for (const k in (p.held || {})) {
      if (k === "typeboost") continue;
      if (HELD_IT[k]) parts.push(`${HELD_IT[k]}×${p.held[k]}`);
    }
    if (p.held && p.held.typeboost) for (const t in p.held.typeboost) parts.push(`${T[t].it}×${p.held.typeboost[t]}`);
    for (const k in (p.berries || {})) parts.push(`${BERRY_DATA[k].it}×${p.berries[k]}`);
    return parts.join(" ");
  }

  // Dopo il premio: ogni 10 ondate si cambia zona (bioma).
  function afterReward() {
    if (game.wave % BOSS_EVERY === 0) showBiomeChoice();
    else nextWave();
  }

  /* L'ULTIMO TRATTO NON SI SCEGLIE.
     Nell'originale (`select-biome-phase.ts`) c'e' un salto scritto a mano:
     quando la prossima ondata e' la FINALE − 9, si finisce in END e ci si resta
     fino alla fine. Da noi: dalla 191 alla 200. END non ha collegamenti proprio
     per questo — non ci si arriva camminando. */
  const ondataDiEND = () => FINAL_WAVE - 9;   // 191
  const versoEND = () => game.wave + 1 >= ondataDiEND();

  /* ---------------------------------------------------------------------- */
  /*  GAME OVER                                                             */
  /* ---------------------------------------------------------------------- */
  // Schermata di vittoria della run (ondata 200 completata).
  function renderRunVictory() {
    game.phase = "GAMEOVER";
    cancellaSlot(game.slot);      // run completata: lo slot torna libero (§26)
    clearTimeout(game.timer);
    hideTrainerPortrait();
    const team = game.party.map(p => `${p.name} Lv.${p.level}`).join(" · ");
    showMetaScreen(`
      <div class="meta-title" style="color:#ffcf4a">🏆 CAMPIONE!</div>
      <div class="meta-sub">Hai superato tutte le 200 ondate della modalità Classica.</div>
      <div class="me-text" style="margin-top:2vh"><b>La tua squadra vincente</b><br>${team}</div>
      <div class="meta-stats"><span>Vittorie totali: ${meta.stats.wins || 1}</span><span>🎟 ${meta.vouchers}</span></div>
      <div class="meta-actions">
        <button class="meta-btn primary" data-act="again">▶ Nuova Run</button>
        <button class="meta-btn ghost" data-act="home">🏠 Home</button>
      </div>`);
    metaEl().querySelector('[data-act="again"]').onclick = () => { hideMeta(); startRun(); };
    metaEl().querySelector('[data-act="home"]').onclick = showHome;
  }

  function renderGameOver(reason) {
    const cleared = Math.max(0, game.wave - 1);
    if (cleared > meta.stats.bestWave) meta.stats.bestWave = cleared;
    saveMeta();
    const title = reason === "RUN" ? "In fuga…" : "Sconfitta";
    const sub = reason === "RUN"
      ? `Hai abbandonato all'ondata ${game.wave}.`
      : `La squadra è caduta all'ondata ${game.wave}.`;
    cmd().innerHTML = `
      <div class="endbox">
        <div class="title lose">${title}</div>
        <div>${sub}</div>
        <div class="run-score">Ondate superate: <b>${cleared}</b> · record <b>${meta.stats.bestWave}</b></div>
        <button class="btn restart" data-act="restart">Nuova run</button>
        <button class="btn back" data-act="home" style="width:auto;padding:10px 22px;">🏠 Home</button>
      </div>`;
    cmd().querySelector('[data-act="restart"]').onclick = () => { hideMeta(); startRun(); };
    cmd().querySelector('[data-act="home"]').onclick = showHome;
  }

  /* ---------------------------------------------------------------------- */
  /*  AVVIO — carica i dati reali, poi comincia                             */
  /* ---------------------------------------------------------------------- */
  const DATA_V = 24;   // versione dei dati: alzala a ogni rigenerazione
  /* I dati arrivano dallo strato aggiornato se c'e' (vedi pokerogue-boot.js,
     §28), altrimenti dai file locali. `window.PR` esiste solo quando la pagina
     e' stata avviata dal guscio: aprendo i file a mano si ricade sul fetch. */
  function loadJson(name) {
    const percorso = `data/${name}.json`;
    const locale = () => fetch(`${percorso}?v=${DATA_V}`).then(r => r.json());
    if (!window.PR || !PR.file) return locale();
    return PR.file(percorso).then(t => (t != null ? JSON.parse(t) : locale()));
  }

  function boot() {
    cmd().innerHTML = `<div class="msgbox">Caricamento dati...</div>`;
    Promise.all([
      loadJson("types"), loadJson("moves"), loadJson("species"),
      loadJson("learnsets"), loadJson("typechart"), loadJson("abilities"), loadJson("biomes"), loadJson("forms"), loadJson("icons"), loadJson("variants"),
      loadJson("tms"), loadJson("eggmoves"), loadJson("dialoghi"),
      /* Le TERNE delle livree cromatiche: 47 KiB, servono a ogni tiro di
         cromatico. Le tabelle colore (930 KiB) no: quelle arrivano solo
         quando una rara va davvero disegnata. Se il file manca si resta
         alla livrea comune, che è come il gioco si comportava prima. */
      loadJson("cromatici").catch(() => null),
      // indice delle animazioni: solo l'elenco, i frame arrivano su richiesta
      loadJson("anims-index").catch(() => null),
    ]).then(([types, moves, species, learnsets, chart, abilities, biomes, forms, icons, variants, tmdata, eggmoves, dialoghi, cromatici, anims]) => {
      T = types; M = moves; S = species; LEARN = learnsets; CHART = chart; ABIL = abilities; BIOMES = biomes; FORMS = forms; ICONS = icons; VARIANTS = variants;
      TMS = tmdata; EGGM = eggmoves; DIAL = dialoghi || {}; ANIMS = anims;
      CROMSET = (cromatici && cromatici.set) || {};
      /* Il tipo ASTRALE non esiste in types.json (i tipi veri sono 18):
         lo si aggiunge a mano perche' Terapagos Stellare e l'Arceus Perfetto
         ce l'hanno, e ogni schermata che stampa un tipo fa `T[tipo].it`. */
      T[ASTRALE] = { it: "Astrale", color: "#dcd2ff" };
      // solo le specie con sprite disponibile (esclude le forme regionali senza asset)
      SPECIES_KEYS = Object.keys(species).filter(k => !species[k].noSprite);
      loadMeta();
      showHome();
      /* Arrivati qui il gioco e' su e funzionante: si dice al cane da guardia
         che questa versione e' buona. Se non lo dicessimo (perche' l'avvio e'
         morto prima), al riavvio lo strato scaricato verrebbe buttato e si
         tornerebbe a quello dell'APK. Vedi §28. */
      if (window.PR && PR.avvioRiuscito) PR.avvioRiuscito();
    }).catch(err => {
      cmd().innerHTML = `<div class="msgbox">Errore nel caricamento dati.<br>${err}</div>`;
      console.error(err);
    });
  }

  /* Ridisegno su resize/rotazione: ricalcola le scale degli sprite e ridipinge
     bioma e pedane. Serve sul telefono (rotazione, barra URL che compare) e
     ripulisce eventuali layer "fantasma" degli emulatori da browser. */
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (game.biome) applyBiomeBackground();
      redrawScene();
    }, 120);
  });

  /* ⚠️ Non basta `DOMContentLoaded`: il guscio (§28) inserisce questo script
     DOPO che quell'evento e' gia' scattato, quindi in app non arriverebbe mai e
     il gioco resterebbe sulla schermata di caricamento. Se il documento e' gia'
     pronto si parte subito. */
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
