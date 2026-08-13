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
       PokeRogue si ottiene presto). Pokerus ×1,5, Espamuleto +%.
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
  const META_KEY = "pokerogue_mobile_meta_v1";
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
      starterBest: {},   // record di ondate per starter (per i fiocchi)
      candy: {},         // caramelle per specie (da catture/schiuse)
      costCut: {},       // riduzione permanente del costo starter (comprata con caramelle)
      passiveOn: {},     // specie con PASSIVA sbloccata (caramelle)
      ivs: {},           // migliori IV visti per specie: { SPECIE: {hp,atk,...} }
      formsSeen: {},     // forme estetiche già catturate: { dex: {formKey: true} }
      seen: {},          // specie INCONTRATE (anche senza catturarle): { SPECIE: true }
      eggMoves: {},      // mosse da uovo sbloccate: { SPECIE: maschera di bit 0-15 }
      abils: {},         // abilità sbloccate: { SPECIE: 1|2|4 } (4 = nascosta)
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
  // Fiocco ("ribbon"): assegnato allo starter che ha raggiunto l'ondata 30.
  const RIBBON_WAVE = 30;
  function hasRibbon(k) { return (meta.starterBest[k] || 0) >= RIBBON_WAVE; }
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
  function isGrounded(f) {
    if (!f) return false;
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
  const rollNature = () => NATURE_KEYS[Math.floor(Math.random() * NATURE_KEYS.length)];
  // Moltiplicatore della natura su una statistica (i PS non sono mai toccati)
  function natureMult(f, stat) {
    const n = NATURES[f.nature];
    if (!n || stat === "hp") return 1;
    // Rugiadanima amplifica l'effetto della natura di 10 punti per pezzo
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
    // Gli oggetti legati alla specie (Sferapalla, Ossoduro...) raddoppiano.
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
     L'Abilamuleto alza la probabilità della nascosta (solo sui selvatici).
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
    const f = {
      speciesId,
      dex: sp.dex,
      name: (boss ? "👑 " : "") + (shiny ? "✨" : "") + sp.it + formSuffix,
      shiny,
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
      volatile: { confusion: 0, flinch: false },
      // istanze mossa con PP correnti, dal learnset reale
      moves: buildMovepool(speciesId, level).map(id => ({ id, pp: M[id].pp, maxPp: M[id].pp })),
    };
    recomputeStats(f);        // calcola stats/maxHp/hp dal livello
    // boss: barra HP a SEGMENTI (come nell'originale): il danno che sfonderebbe
    // un segmento viene scartato — il boss va "rotto" un segmento alla volta.
    if (boss) {
      const segs = 2 + Math.floor(level / 25);          // 2-3+ segmenti
      f.segTotal = segs;
      f.segBroken = 0;
      f.segBounds = [];
      for (let i = segs - 1; i >= 1; i--) f.segBounds.push(Math.floor(f.maxHp * i / segs)); // decrescenti
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
  const STATUS_IT = { BURN: "SCT", PARALYSIS: "PAR", SLEEP: "DOR", POISON: "VEL", FREEZE: "CON" };
  // Immunita' di tipo agli stati principali.
  const STATUS_IMMUNE = {
    BURN: ["FIRE"], FREEZE: ["ICE"], PARALYSIS: ["ELECTRIC"], POISON: ["POISON", "STEEL"],
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
    let eff = typeMultiplier(move.type, defender.types);
    /* ARCEUS PERFETTO: le sue mosse sono SEMPRE superefficaci. Spunto dalla
       Lastra Legum di Leggende: Arceus, che gli fa assumere il tipo che
       infligge più danno (in PokéRogue l'oggetto esiste ma non fa nulla).
       Le immunità restano tali: se non ha effetto, non ha effetto. */
    if (attacker.superEff && eff > 0) eff = Math.max(eff, 2);
    if (eff === 0) return { damage: 0, effectiveness: 0, crit: false, immune: true };

    const isPhysical = move.category === "PHYSICAL";
    // stat stages: nel critico gli sbalzi negativi di chi attacca e positivi di
    // chi difende vengono ignorati (semplificazione: ignoriamo il def buff nel crit).
    // Scala del brutto colpo: stadio 0 = 1/16, poi 1/8, 1/2, sempre.
    // Gli stadi arrivano da HighCritAttr, dal Mirino, dalla Baccalansa e dal Supercolpo.
    const CRIT_ODDS = [1 / 16, 1 / 8, 1 / 2, 1];
    const cs = Math.min(3, (opts.highCrit ? 1 : 0) + (opts.critStage || 0));
    const crit = opts.forceCrit || Math.random() < CRIT_ODDS[cs];
    const atkStage = isPhysical ? attacker.stages.atk : attacker.stages.spatk;
    const defStage = isPhysical ? defender.stages.def : defender.stages.spdef;
    // abilita': moltiplicatori di statistica (es. Grancampione ATK x2, Corposcelto)
    const atkAb = abStatMult(attacker, isPhysical ? "ATK" : "SPATK");
    // Evolcondensa: +50% alle difese se la specie puo' ancora evolvere
    const evio = (defender.held && defender.held.eviolite && (S[defender.speciesId].evolutions || []).length) ? 1.5 : 1;
    const defAb = abStatMult(defender, isPhysical ? "DEF" : "SPDEF") * evio;
    const atk = (isPhysical ? attacker.stats.atk : attacker.stats.spatk) * stageMult(atkStage) * atkAb;
    const def = (isPhysical ? defender.stats.def : defender.stats.spdef) * stageMult(crit ? Math.min(0, defStage) : defStage) * defAb;

    // abilita': boost di potenza per tipo (Aiutofuoco/Erbaiuto a HP bassi, ecc.)
    let power = move.power;
    const lowHp = findAb(attacker, "lowHpTypeBoost");
    if (lowHp && move.type === lowHp.moveType && attacker.hp <= attacker.maxHp / 3) power *= lowHp.mult;
    const tb = findAb(attacker, "typeBoost");
    if (tb && move.type === tb.moveType) power *= tb.mult;
    // held: Boost di Tipo impilabile (+20% l'uno)
    const hb = attacker.held && attacker.held.typeboost && attacker.held.typeboost[move.type];
    if (hb) power *= 1 + 0.2 * hb;
    // METEO: Sole potenzia il Fuoco e smorza l'Acqua, la Pioggia il contrario
    power *= weatherMoveMult(move.type);
    // TERRENO: +30% al tipo del campo (solo se chi attacca tocca terra)
    power *= terrainMoveMult(attacker, move.type);

    // Nucleo della formula (Gen moderne). Usa il livello di chi attacca.
    let dmg = Math.floor(Math.floor(Math.floor(2 * attacker.level / 5 + 2) * power * atk / def) / 50) + 2;

    // Modificatori
    const stab = attacker.types.includes(move.type) ? 1.5 : 1;
    const critMult = crit ? 1.5 : 1;
    const rand = 0.85 + Math.random() * 0.15;    // varianza 85-100%
    const burn = (isPhysical && attacker.status === "BURN") ? 0.5 : 1; // la scottatura dimezza il fisico
    // abilita' del difensore: riduce il danno di certi tipi (Grassottello, Antifuoco)
    let abMult = 1;
    for (const a of abAttrs(defender)) if (a.kind === "typeDamageMult" && a.moveType === move.type) abMult *= a.mult;

    dmg = Math.floor(dmg * stab * eff * critMult * rand * burn * abMult);
    if (dmg < 1) dmg = 1;                          // almeno 1 se non immune

    return { damage: dmg, effectiveness: eff, crit, immune: false };
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
    /* Avvia SUBITO una lotta in doppio (per provarla senza aspettare il caso). */
    doppia: () => {
      if (game.party.filter(p => !p.fainted).length < 2) return "servono 2 Pokemon vivi";
      clearTimeout(game.timer); game.events = []; game.eventIndex = 0;
      const lvl = enemyLevelFor(game.wave);
      const a = makeFighter(biomePick(), lvl, {});
      const b = makeFighter(biomePick(), lvl, {});
      game.double = true; game.enemy2 = b;
      game.chooser = 0; game.queued = null;
      game.player2 = game.party.find(p => !p.fainted && p !== game.player) || null;
      resetForBattle(game.player); if (game.player2) resetForBattle(game.player2);
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
  function snapEvent(text) {
    const p = game.player, e = game.enemy;
    const ev = {
      text,
      php: p ? p.hp : 0, pmax: p ? p.maxHp : 1, pst: p ? p.status : null, pfaint: p ? p.fainted : false, phit: !!(p && p._justHit),
      ehp: e ? e.hp : 0, emax: e ? e.maxHp : 1, est: e ? e.status : null, efaint: e ? e.fainted : false, ehit: !!(e && e._justHit),
    };
    if (p) p._justHit = false;   // il colpo si "consuma": solo il 1° evento dopo scuote
    if (e) e._justHit = false;
    return ev;
  }
  // "log" del turno: gli attributi del motore fanno messages.push(testo);
  // qui lo intercettiamo per catturare anche lo snapshot.
  /* Riallinea l'istantanea di un evento allo stato ATTUALE, conservando in
     `pre` quella di partenza. Il "prima" serve alla riproduzione: durante
     l'animazione della mossa si mostra lui, così le barre calano al momento
     dell'impatto e non un istante prima. Vale anche per il PRIMO evento del
     turno, che non avrebbe un evento precedente da cui pescare. */
  const CAMPI_SNAP = ["php", "pmax", "pst", "pfaint", "ehp", "emax", "est", "efaint"];
  function riallinea(e) {
    if (!e.pre) { e.pre = {}; for (const k of CAMPI_SNAP) e.pre[k] = e[k]; }
    const s = snapEvent("");
    for (const k of CAMPI_SNAP) e[k] = s[k];
    if (s.phit) e.phit = true;
    if (s.ehit) e.ehit = true;
  }
  function makeLog() {
    const events = [];
    return {
      events,
      push(t) { events.push(snapEvent(t)); },
      // marca l'ultimo evento con un effetto visivo (tipo mossa + bersaglio + quale mossa)
      fx(type, side, move) { if (events.length) events[events.length - 1].fx = { type, side, move }; },
      /* Come `fx`, ma su un evento PRECISO. Serve perche' l'animazione della
         mossa va sul messaggio «X usa Y!», che fotografa la situazione PRIMA
         del colpo. Attaccandola all'ultimo evento finiva su un messaggio gia'
         successivo al danno (spesso «X e' esausto!»): si vedeva il nemico
         cadere e solo dopo partiva l'animazione che avrebbe dovuto colpirlo. */
      fxAt(i, type, side, move) { if (events[i]) events[i].fx = { type, side, move }; },
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
  function showBiomeChoice() {
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

  // Riporta un combattente allo stato "inizio battaglia" mantenendo HP e PP
  // (l'attrito tra le ondate e' il cuore del roguelite).
  function resetForBattle(f) {
    revertForm(f);            // mega/gigamax durano solo una battaglia
    game.weather = null; game.terrain = null;   // non passano da una lotta all'altra
    f.status = null; f.sleepTurns = 0;
    f.stages = { atk: 0, def: 0, spatk: 0, spdef: 0, spd: 0, acc: 0, eva: 0 };
    f.volatile = { confusion: 0, flinch: false, protect: null, protectUsi: 0,
                   trap: null, seed: false, seedBy: null, perish: 0, recharge: false,
                   charging: null, infatuated: false, encore: null, taunt: 0,
                   torment: false, drowsy: 0, nightmare: false, ingrain: false,
                   aquaring: false, saltcure: false, curse: false, lastMove: null };
    f._lansat = false;
    f.fainted = false;
    // Poteslot: finche' dura, la squadra entra in campo con +1 stadio
    if (game.tempBoost && game.party.includes(f)) {
      for (const k in game.tempBoost) if (k !== "crit" && k in f.stages) f.stages[k] = 1;
    }
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
    // amuleti e potenziamenti di run (Espamuleto, Monetamuleto, Mappa, ecc.)
    game.charms = { exp: 0, amulet: 0, healing: 0, shiny: 0, catching: 0, ability: 0, lure: 0,
                    candyJar: 0, berryPouch: 0, ivScanner: 0, goldenPunch: 0, map: 0 };
    // Poteslot / Supercolpo: durano 5 ondate
    game.tempBoost = {};
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
      const mon = makeFighter(e.k, START_LEVEL, { shiny: e.shiny, ivs: bestIVsFor(e.k) || rollIVs(), ignoreArena: true });
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
    const mon = makeFighter(speciesId, START_LEVEL, { shiny, ignoreArena: true });
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

  /* ---- Classi allenatore: nome, sprite e TIPI preferiti (squadre a tema) ---
     Con la dex completa ogni classe può pescare Pokémon coerenti dal proprio
     tema, invece che a caso: il Pescatore ha Acqua, il Fantasista Spettro, ecc. */
  const TRAINER_CLASSES = [
    { name: "il Giovane", sprites: ["youngster_m", "youngster_f"], types: ["NORMAL", "BUG"] },
    { name: "il Pescatore", sprites: ["fisherman"], types: ["WATER"] },
    { name: "il Montanaro", sprites: ["hiker"], types: ["ROCK", "GROUND"] },
    { name: "lo Scienziato", sprites: ["scientist_m", "scientist_f"], types: ["ELECTRIC", "STEEL", "POISON"] },
    { name: "la Bellezza", sprites: ["beauty"], types: ["FAIRY", "NORMAL"] },
    { name: "il Lottatore", sprites: ["black_belt_m"], types: ["FIGHTING"] },
    { name: "il Campeggiatore", sprites: ["camper_m", "camper_f"], types: ["GRASS", "BUG"] },
    { name: "il Superquattro", sprites: ["ace_trainer_m", "ace_trainer_f"], types: null },   // qualsiasi
    { name: "il Nuotatore", sprites: ["swimmer_m", "swimmer_f"], types: ["WATER", "ICE"] },
    { name: "il Sensitivo", sprites: ["psychic_m", "psychic_f"], types: ["PSYCHIC"] },
    { name: "la Maniaca", sprites: ["hex_maniac"], types: ["GHOST", "DARK"] },
    { name: "il Mangiafuoco", sprites: ["firebreather"], types: ["FIRE"] },
    { name: "il Ranger", sprites: ["ranger_m", "ranger_f"], types: ["GRASS", "FLYING"] },
    { name: "il Tipo Rocket", sprites: ["rocket_grunt_m", "rocket_grunt_f"], types: ["POISON", "DARK"] },
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

  // Squadra del Rivale: starter opposto (evoluto secondo il livello) + Pokemon
  // a tema. Cresce di numero e di forma a ogni incontro.
  function buildRival(eLevel) {
    const rivalStage = RIVAL_WAVES.indexOf(game.wave);   // 0..3
    const count = rivalStage + 2;                          // 2,3,4,5 Pokemon
    // starter opposto: sceglie quello forte contro il tuo tipo primario
    const counter = { GRASS: ["CHARMANDER", "CYNDAQUIL", "TORCHIC", "FENNEKIN"],
                      FIRE:  ["SQUIRTLE", "TOTODILE", "MUDKIP", "FROAKIE"],
                      WATER: ["BULBASAUR", "CHIKORITA", "TREECKO", "CHESPIN"] };
    const myType = game.starterSpecies && S[game.starterSpecies] ? S[game.starterSpecies].types[0] : null;
    const opts = (counter[myType] || ["PIKACHU", "EEVEE", "RIOLU"]).filter(k => S[k]);
    let oppStarter = opts.length ? opts[Math.floor(Math.random() * opts.length)] : "PIKACHU";
    oppStarter = evolvedFormFor(oppStarter, eLevel);
    const mons = [];
    for (let i = 0; i < count; i++) {
      const isAce = i === count - 1;
      const key = isAce ? oppStarter : evolvedFormFor(pickThemed(null, eLevel), eLevel);
      const f = makeFighter(key, eLevel + (isAce ? 2 : 0), { isTrainer: true });
      f.trainer = game.rivalFemale ? "la Rivale" : "il Rivale"; f.rival = true;
      mons.push(f);
    }
    return mons;
  }

  /* ---------------- MEGAEVOLUZIONE / GIGAMAX ----------------
     Servono l'oggetto (Megacerchio / Dynamax Band) comprato al negozio, e la
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
        resetForBattle(secondo);
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
    if (!game.trainerTotal) { el.hidden = true; el.innerHTML = ""; return; }
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
    game.trainerRoster = mons.slice();      // serve alla Theft Ball
    game.trainerIsRival = mons.some(m => m.rival);
    // chiave dei dialoghi ufficiali (vedi `chiaveDialogo`): serve a fargli dire
    // qualcosa quando lo batti
    game.trainerSprite = portraitSprite;
    game.trainerTotal = mons.length;
    game.trainerDefeated = 0;
    game.enemyQueue = mons.slice(1);
    game.enemy = null;                 // niente mon durante la sfida
    showTrainerPortrait(portraitSprite);
    renderTrainerBalls();
    renderScene();                     // enemy null → slot vuoto; portrait visibile
    loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
    queueMessages(challengeMsgs, () => {
      hideTrainerPortrait();
      const m = [`${name} manda in campo ${mons[0].name}!`];
      deployEnemy(mons[0], m);
      renderTrainerBalls();
      renderScene();
      queueMessages(m, () => { game.phase = "CHOICE"; showMainMenu(); });
    });
  }

  function nextWave() {
    pulisciBallScena();      // il campo riparte pulito
    /* SALVATAGGIO AUTOMATICO (§26): si scrive PRIMA di incrementare, quindi lo
       slot contiene sempre "ondate completate". Riprendendo si rigioca da qui
       con un avversario nuovo. */
    salvaRun();
    game.wave++;
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
    resetForBattle(game.player);
    clearTimeout(game.timer); game.events = []; game.eventIndex = 0; game.afterEvents = null;
    game.enemyQueue = [];
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
      game.evilRank = evilKind;    // serve al bottino Theft Ball (recluta/admin/boss)
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
    const eKey = (game.wave === 1 && overrideKey("e")) || biomePick(boss);
    const f = makeFighter(eKey, eLevel, { boss, shiny: rollShiny() });
    // LOTTA IN DOPPIO: due selvatici contro i tuoi due Pokemon in campo
    if (!boss && rollDouble()) {
      game.double = true;
      const f2 = makeFighter(biomePick(), eLevel, { shiny: rollShiny() });
      game.enemy2 = f2;
      const secondo = game.party.find(p => !p.fainted && p !== game.player);
      if (secondo) { resetForBattle(secondo); game.player2 = secondo; }
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
    if (f.shiny) messages.push("✨ È SHINY! Che fortuna!");
    deployEnemy(f, messages);
    renderScene();
    loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
    queueMessages(messages, () => { game.phase = "CHOICE"; showMainMenu(); });
  }

  // Abilita' che scattano all'ingresso in campo (Prepotenza abbassa l'Attacco).
  function applyOnSummon(f, foe, messages) {
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

     La sequenza: buio in scena, il Pokemon al centro, sagome bianche che si
     alternano sempre più in fretta fra la vecchia e la nuova forma, lampo,
     nuova forma. Un pulsante «✖ Interrompi» resta visibile per tutto il
     tempo: se lo premi, l'evoluzione si ferma e il Pokemon resta com'è
     (si riproporra' al prossimo livello, come nell'originale).
     ⚠️ Funziona anche per i membri in PANCHINA: lo sprite lo dipinge questa
     schermata, non si appoggia a quello in campo.
     ====================================================================== */
  function animaEvoluzione(p, toId, fine) {
    const scena = document.getElementById("scene");
    if (!scena) { fine(false); return; }
    const nsp = S[toId];
    const vecchio = p.name, nuovo = nsp.it;

    const ov = document.createElement("div");
    ov.id = "evo-overlay";
    ov.innerHTML = `<div class="evo-sprite" id="evoSprite"></div>
                    <div class="evo-testo">${vecchio} si sta evolvendo…</div>`;
    scena.appendChild(ov);
    const el = ov.querySelector("#evoSprite");

    // dipinge un frame di sprite dentro l'elemento dell'overlay
    const dipingi = (s) => {
      if (!s || !el) return;
      const f = s.frame, k = Math.min(2.6, 150 / f.h, 150 / f.w);
      el.style.width = (f.w * k) + "px";
      el.style.height = (f.h * k) + "px";
      el.style.backgroundImage = `url("${s.sheet}")`;
      el.style.backgroundPosition = `-${f.x * k}px -${f.y * k}px`;
      el.style.backgroundSize = `${s.sheet_w * k}px ${s.sheet_h * k}px`;
    };

    let annullato = false, tmr = null;
    const pulisci = () => { clearTimeout(tmr); ov.remove(); cmd().innerHTML = ""; };

    // il tasto per fermarla sta nella fascia comandi, dove si tocca sempre
    game.phase = "MESSAGE";
    cmd().innerHTML = `<div class="msgbox evo-box"><div class="log-line">${vecchio} si sta evolvendo…</div>
      <button class="btn back evo-stop">✖ Interrompi</button></div>`;
    cmd().querySelector(".evo-stop").onclick = () => {
      if (annullato) return;
      annullato = true;
      pulisci();
      fine(false);
    };

    Promise.all([
      loadSprite(S[p.speciesId].dex, "back", p.shiny),
      loadSprite(nsp.dex, "back", p.shiny),
    ]).then(([sVecchio, sNuovo]) => {
      if (annullato) return;
      dipingi(sVecchio);
      // 8 alternanze che accelerano: 260 ms → 90 ms
      const passi = [260, 240, 210, 180, 150, 130, 110, 90, 90, 90];
      let i = 0;
      const passo = () => {
        if (annullato) return;
        if (i >= passi.length) {
          // lampo finale e nuova forma
          el.classList.add("evo-lampo");
          dipingi(sNuovo);
          el.classList.remove("evo-sagoma");
          ov.querySelector(".evo-testo").textContent = `${nuovo}!`;
          tmr = setTimeout(() => { if (!annullato) { pulisci(); fine(true); } }, 900);
          return;
        }
        // a sagoma bianca mostra la forma NUOVA, a colori quella vecchia
        const sagoma = i % 2 === 0;
        el.classList.toggle("evo-sagoma", sagoma);
        dipingi(sagoma ? sNuovo : sVecchio);
        tmr = setTimeout(passo, passi[i++]);
      };
      passo();
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
    // tiene un oggetto legato alla specie (Dentebissi / Squamabissi)
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
    if (item.testo) {
      const t = item.testo;
      item.testo = null;                       // gia' detto: non ripeterlo
      game.pendingLearns.unshift(item);        // rimettilo in testa
      queueMessages([t], () => processLearns(done));
      return;
    }
    const { mon, moveId } = item;
    const nv = M[moveId];
    const btns = mon.moves.map((mi, i) => {
      const mv = M[mi.id], ty = T[mv.type];
      return `<button class="btn move-btn" data-i="${i}" style="background:${ty.color};">
        <span class="move-name">${mv.it}</span>
        <span class="move-meta"><span class="ticon t-${mv.type}"></span><span class="cicon c-${mv.category}"></span><span>${mv.power ? "pot " + mv.power : ""}</span></span></button>`;
    }).join("");
    cmd().innerHTML = `
      <div class="prompt-line">${mon.name} vuole imparare <b>${nv.it}</b> (${(T[nv.type] || {}).it || nv.type}${nv.power ? ", pot " + nv.power : ""}). Quale mossa dimentica?</div>
      <div class="grid2">${btns}</div>
      <div class="back-row"><button class="btn back" data-act="skip">Rinuncia a ${nv.it}</button></div>`;
    cmd().querySelectorAll(".move-btn").forEach(b => b.onclick = () => {
      const i = parseInt(b.dataset.i, 10);
      const old = M[mon.moves[i].id].it;
      mon.moves[i] = { id: moveId, pp: nv.pp, maxPp: nv.pp };
      queueMessages([`${mon.name} dimentica ${old} e impara ${nv.it}!`], () => processLearns(done));
    });
    cmd().querySelector('[data-act="skip"]').onclick = () => processLearns(done);
  }

  /* ---------------- Fine ondata ---------------- */
  /* Ondata superata. Se e' appena caduto un ALLENATORE e l'easter egg delle
     GIF e' attivo, la GIF viene PRIMA di tutto il resto: e' il momento della
     vittoria, non un premio da riscuotere dopo. Dura tanti secondi quanta e'
     l'ondata. Finita, la partita riprende da `vittoriaOndata()`, che e' il
     corpo di sempre. (§25) */
  function onWaveCleared() {
    if (game.enemy && game.enemy.trainer && gifPronte()) {
      gifMostra(game.wave, vittoriaOndata);
      return;
    }
    vittoriaOndata();
  }

  function vittoriaOndata() {
    // VITTORIA DELLA RUN: battuto il boss finale dell'ondata 200
    if (game.enemy.finalBoss) {
      meta.stats.wins = (meta.stats.wins || 0) + 1;
      if (FINAL_WAVE > meta.stats.bestWave) meta.stats.bestWave = FINAL_WAVE;
      saveMeta();
      queueMessages([
        `${game.enemy.name} è stato sconfitto!`,
        `«…magnifico.»`,                       // `secondStageWin` dei testi ufficiali
        `🏆 HAI COMPLETATO LA MODALITÀ CLASSICA!`,
      ], () => renderRunVictory());
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
      for (const riga of dialogoSconfitta()) messages.push(riga);
    }
    // premio promesso da un incontro misterioso che finiva in lotta
    if (game.encReward) {
      const t = game.encReward();
      game.encReward = null;
      if (t) messages.push(t);
    }
    // soldi: piu' per boss e capipalestra. Il Monetamuleto da' +20% per pezzo.
    const base = (wasGym || wasEvilBoss ? 500 : wasBoss ? 260 : 90) + game.wave * 12;
    const money = Math.floor(base * (1 + 0.2 * (game.charms.amulet || 0)));
    game.money += money;
    stessoMomento(messages, `Ricevi ₽${money}!`);
    // i potenziamenti a tempo (Poteslot/Supercolpo) durano 5 ondate
    for (const k in game.tempBoost) if (--game.tempBoost[k] <= 0) delete game.tempBoost[k];
    // contatore del tesoro di Gimmighoul: cresce a ogni ondata vinta
    for (const p of game.party) if (p.speciesId === "GIMMIGHOUL") p.treasure = (p.treasure || 0) + 1;
    // fiocco: aggiorna il record di ondate raggiunte con questo starter
    if (game.starterSpecies) {
      const cur = meta.starterBest[game.starterSpecies] || 0;
      if (game.wave > cur) {
        meta.starterBest[game.starterSpecies] = game.wave;
        if (cur < RIBBON_WAVE && game.wave >= RIBBON_WAVE) messages.push(`🎀 ${S[game.starterSpecies].it} ha ottenuto il Fiocco!`);
        saveMeta();
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
    // prima le EVOLUZIONI (con la loro animazione), poi le mosse da imparare
    queueMessages(messages, () => processEvos(() => processLearns(() => {
      // ULTIMA BALL (una sola) solo se il selvatico è stato SCONFITTO, non catturato
      if (!wasBoss && !wasTrainer && !game.capturedThisWave) { offerCapture(); return; }
      // allenatore (NON il Rivale): con una Theft Ball puoi rubargli un Pokémon
      if (wasTrainer && !game.trainerIsRival && (game.theftballs || 0) > 0 && game.trainerRoster.length) { offerSteal(); return; }
      openShop();
    })));
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
    // Il Presamuleto la rende piu' probabile.
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
          // 4. i dondolii veri
          let n = 0;
          const dondola = () => {
            if (n >= esito.scosse) return chiusura();
            n++;
            ball.classList.add("dondola");
            dopo(460, () => { ball.classList.remove("dondola"); dopo(140, dondola); });
          };
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
    { key: "theftballs",  it: "Theft Ball", mult: 2, theft: true },
    { key: "masterballs", it: "Master Ball", mult: 255 },
  ];
  function totalBalls() { return BALL_TYPES.reduce((s, b) => s + (game[b.key] || 0), 0); }

  /* ---- FURTO con Theft Ball: scegli un Pokémon della squadra avversaria ----
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
      <div class="me-text">Hai <b>${game.theftballs}</b> Theft Ball. Quale Pokémon rubi a ${game.trainerName}?</div>
      <div class="me-opts">${rows}
        <button class="me-opt" data-act="skip"><span class="me-opt-l">Lascia stare</span></button></div>`);
    metaEl().querySelectorAll(".me-opt[data-i]").forEach(b => b.onclick = () => {
      const m = roster[parseInt(b.dataset.i, 10)];
      game.theftballs--;
      hideMeta();
      const caught = rollCapture(m, 2, 1);
      const msgs = [`Lanci una Theft Ball su ${m.name}…`];
      if (caught) {
        const mon = makeFighter(m.speciesId, m.level, { shiny: m.shiny, ivs: m.ivs, variant: m.variant, abilIndex: m.abilIndex });
        accogliPokemon(mon, msgs, "🕶 Rubato!");
        registerCaught(m.speciesId, m.shiny, m.ivs, msgs, m.variant, m.abilIndex);
      } else msgs.push(`${m.name} è sfuggito alla Theft Ball!`);
      renderScene();
      queueMessages(msgs, () => chiediPostoInSquadra(() => openShop()));
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
          <div class="pd-top"><span class="pd-name">${miniIcon(p.dex, 1.1)}${p.shiny ? "✨" : ""}${p.name.replace("✨", "")}</span><span class="pd-lv">Lv.${p.level}</span></div>
          <div class="pd-types">${types}${p.ability ? `<span class="pd-ab">${p.ability.it}</span>` : ""}</div>
          <div class="party-hp-track"><div class="party-hp-fill" style="width:${ratio * 100}%;background:${col};"></div></div>
          <div class="pd-hp">${Math.max(0, p.hp)}/${p.maxHp} PS</div>
        </button>`;
    }).join("");
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">Squadra al completo</div>
      <div class="meta-sub">chi cede il posto a <b>${mon.name}</b> (Lv.${mon.level})? Chi esce va al PC.</div>
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

  // Registra una specie catturata nel meta: starter sbloccato, caramella, IV migliori.
  function registerCaught(speciesId, shiny, ivs, messages, variant, abilIndex) {
    if (variant && registerForm(S[speciesId].dex, variant) && messages) {
      const tot = collectableForms(speciesId);
      const got = Object.keys(meta.formsSeen[S[speciesId].dex]).length;
      messages.push(`🦋 Nuova forma: ${formNameOf(speciesId, variant)} (${got}/${tot} di ${S[speciesId].it})`);
    }
    const val = shiny ? 2 : 1;
    // Voce nel dex per la specie presa...
    if (val > (meta.unlocked[speciesId] || 0)) meta.unlocked[speciesId] = val;
    /* ...ma quello che si SCHIERA è il capostipite: prendendo un Venusaur si
       sblocca Bulbasaur, prendendone uno cromatico si sblocca Bulbasaur
       cromatico. Senza questo, catturare un evoluto non darebbe più nulla
       (gli evoluti non sono schierabili). */
    const root = rootOf(speciesId);
    if (val > (meta.unlocked[root] || 0)) {
      meta.unlocked[root] = val;
      messages.push(root === speciesId
        ? `📖 ${S[root].it}${shiny ? " ✨" : ""} registrato come starter!`
        : `📖 ${S[speciesId].it}${shiny ? " ✨" : ""} nel dex — sbloccato ${S[root].it}${shiny ? " ✨" : ""} come starter!`);
    } else if (meta.unlocked[speciesId] === val && val > 0 && root !== speciesId) {
      messages.push(`📖 ${S[speciesId].it}${shiny ? " ✨" : ""} registrato nel dex!`);
    }
    meta.candy = meta.candy || {};
    meta.candy[speciesId] = (meta.candy[speciesId] || 0) + 1;
    stessoMomento(messages, `🍬 +1 Caramella ${S[speciesId].it} (totale ${meta.candy[speciesId]})`);
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
      const mon = makeFighter(enemy.speciesId, enemy.level, { shiny: enemy.shiny, ivs: enemy.ivs, variant: enemy.variant, abilIndex: enemy.abilIndex }); // fresco, HP/PP pieni
      accogliPokemon(mon, messages, "Preso!");
      // meta-progressione: starter sbloccato + caramella + IV migliori
      registerCaught(enemy.speciesId, enemy.shiny, enemy.ivs, messages, enemy.variant, enemy.abilIndex);
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
  function loadSpriteFrom(dir, name) {
    const key = dir + "/" + name;
    if (spriteCache[key] !== undefined) return Promise.resolve(spriteCache[key]);
    return fetch(`${dir}/${name}.json`)
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(atlas => {
        const { frame, size } = atlasFrame0(atlas);
        const spr = { sheet: `${dir}/${name}.png`, frame, sheet_w: size.w, sheet_h: size.h };
        spriteCache[key] = spr;
        return spr;
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
  function loadSprite(dex, side, shiny, femmina) {
    /* Catena di ripieghi, dal più giusto al meno peggio. L'ultimo anello serve
       a non mostrare MAI il segnaposto colorato: 4 specie (Koraidon, Miraidon,
       Poltchageist Autentica, Sinistcha Capolavoro) non hanno lo sprite
       cromatico nemmeno nell'originale, e il modello giusto coi colori normali
       è comunque meglio di un rettangolo tinta unita. */
    const dirs = [];
    if (femmina && shiny) dirs.push(`assets/pokemon/femmina/shiny/${side}`);
    if (shiny) dirs.push(`assets/pokemon/shiny/${side}`);
    if (femmina) dirs.push(`assets/pokemon/femmina/${side}`);
    dirs.push(`assets/pokemon/${side}`);
    return loadSpriteChain(dirs, String(dex));
  }
  // Carica lo sprite giusto per un combattente: se ha una forma (estetica o di
  // battaglia) usa "<dex>-<forma>", altrimenti lo sprite base.
  function loadFighterSprite(f, side) {
    const form = f.formKey || f.variant;
    const base = () => loadSprite(f.dex, side, f.shiny, usaSpriteFemmina(f));
    if (!form) return base();
    /* ⚠️ Anche le forme hanno il loro sprite CROMATICO: prima si prendeva
       sempre quello normale e un Unown cromatico usciva coi colori sbagliati.
       Se la forma non ha un file suo si ricade sulla specie — ed è giusto:
       nemmeno l'originale ne ha uno per le 20 fantasie di Scatterbug o per le
       taglie di Pumpkaboo, che sono identiche a vedersi. */
    const dirs = [];
    if (f.shiny) dirs.push(`assets/pokemon/shiny/${side}`);
    dirs.push(`assets/pokemon/${side}`);
    return loadSpriteChain(dirs, `${f.dex}-${form}`).then(spr => spr || base());
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
    const playFx = (poi) => animAvailable(e.fx.move)
      ? playMoveAnim(e.fx.move, e.fx.side === "enemy" ? "player" : "enemy", e.fx.side, e.fx.type, poi)
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
    mostraContinua(Math.min(animMs || 0, 2400));

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
      const c = cmd().querySelector(".msgbox .cont");
      if (c) c.classList.add("pronto");
    };
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
    POISON: "COMMON_POISON", FREEZE: "COMMON_FROZEN",
  };

  /* Lato di un combattente: serve per ancorare l'animazione al Pokemon giusto. */
  function sideOf(f) { return f === game.enemy ? "enemy" : "player"; }

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

  /* Posizione di uno sprite del frame, nello spazio-animazione.
     `kY` = quanto è più alto il nostro campo rispetto ai 180 dell'originale. */
  function animPos(f, U, Tg, src, dst, kY) {
    let x = f.x + UF_X, y = f.y + UF_Y;
    if (f.focus === 1)      { x += Tg.x - TF_X; y += Tg.y - TF_Y; }  // bersaglio
    else if (f.focus === 2) { x += U.x - UF_X;  y += U.y - UF_Y;  }  // chi attacca
    else if (f.focus === 3) { const p = animTransform(src, dst, x, y); x = p[0]; y = p[1]; }
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
    const scene = document.getElementById("scene");
    // se non c'e' l'animazione: particelle per tipo (o nulla, per le comuni)
    const fallback = () => {
      if (fallbackType) spawnMoveFx(fallbackType, targetSide);
      if (onDone) onDone();
      return 0;
    };
    if (!data || !canvas || !scene) return fallback();

    // se attacca l'avversario e il file ha la seconda variante, si usa quella
    const anim = (userSide === "enemy" && data.o) ? data.o : data;
    const frames = anim.f;
    if (!frames || !frames.length) return fallback();

    stopMoveAnim();

    const rect = scene.getBoundingClientRect();
    const scale = rect.width / ANIM_SPACE_W;
    const uId = userSide === "enemy" ? "enemy-sprite" : "player-sprite";
    const tId = targetSide === "enemy" ? "enemy-sprite" : "player-sprite";
    const U = animAnchor(uId, rect, scale), Tg = animAnchor(tId, rect, scale);
    if (!U || !Tg) return fallback();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");

    const sheet = loadSheet(anim.g);
    const shMeta = ANIMS.sheets[anim.g] || {};
    const cols = shMeta.c || 1;
    const cells = shMeta.k || 1;
    const src = [UF_X, UF_Y, TF_X, TF_Y], dst = [U.x, U.y, Tg.x, Tg.y];
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
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

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
        const p = animPos(f, U, Tg, src, dst, kY);

        if (f.target === 2) {
          // grafica dell'effetto: una cella 96x96 del foglio
          if (!f.vis || !sheet || !sheet.complete || !sheet.naturalWidth) continue;
          // Alcune animazioni chiedono una cella che il foglio non ha (succede
          // anche nell'originale: Phaser ripiega sul primo fotogramma).
          const gf = f.gf < cells ? f.gf : 0;
          const sx = (gf % cols) * ANIM_TILE, sy = Math.floor(gf / cols) * ANIM_TILE;
          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, f.op / 255));
          ctx.globalCompositeOperation =
            f.blend === 1 ? "lighter" : f.blend === 2 ? "difference" : "source-over";
          if (hue) ctx.filter = hue;
          ctx.translate(p.x * scale, p.y * scale);
          if (f.angle) ctx.rotate((-f.angle * Math.PI) / 180);
          ctx.scale((f.zx / 100) * p.flip * scale, (f.zy / 100) * scale);
          ctx.drawImage(sheet, sx, sy, ANIM_TILE, ANIM_TILE,
                        -ANIM_TILE / 2, -ANIM_TILE / 2, ANIM_TILE, ANIM_TILE);
          ctx.restore();
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
    const sprite = document.getElementById(side === "enemy" ? "enemy-sprite" : "player-sprite");
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
    if (game.phase !== "MESSAGE") return;
    nextEvent();
  }

  /* ---------------------------------------------------------------------- */
  /*  RISOLUZIONE DEL TURNO                                                  */
  /* ---------------------------------------------------------------------- */
  // L'IA nemica sceglie una mossa (a caso tra quelle con PP).
  function enemyChooseMove() { return aiChooseMove(game.enemy); }
  /* Sceglie una mossa per un combattente guidato dal computer (vale sia per gli
     avversari sia per il secondo alleato nelle lotte in doppio). */
  function aiChooseMove(f) {
    if (!f || !f.moves || !f.moves.length) return null;
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
  function risolviTurno(actions, logIniziale) {
    game.queued = null; game.chooser = 0;
    // avversari
    for (const e of [game.enemy, game.enemy2]) {
      if (!e || e.fainted) continue;
      const mv = e === game.enemy ? enemyChooseMove() : aiChooseMove(e);
      if (mv) actions.push({ actor: e, foe: pickFoeFor(e), move: mv });
    }
    // Rapidartigli: 10% per pezzo di partire per primi comunque
    for (const act of actions) {
      const qc = act.actor.held && act.actor.held.quickclaw;
      act.quick = !!(qc && Math.random() < 0.1 * qc);
    }
    actions.sort((a, b) => {
      if (a.quick !== b.quick) return a.quick ? -1 : 1;
      const pa = M[a.move.id].priority || 0;
      const pb = M[b.move.id].priority || 0;
      if (pa !== pb) return pb - pa;
      if (a.actor.stats.spd !== b.actor.stats.spd) return b.actor.stats.spd - a.actor.stats.spd;
      return Math.random() - 0.5;
    });

    const log = logIniziale || makeLog();
    for (const act of actions) if (act.quick) log.push(`I Rapidartigli di ${act.actor.name} scattano!`);
    for (const act of actions) {
      if (act.actor.fainted) continue;                  // niente colpi post-KO
      // se il bersaglio e' caduto nel frattempo, si ripiega sull'altro
      let foe = act.foe;
      if (!foe || foe.fainted) foe = pickFoeFor(act.actor);
      if (!foe) continue;
      resolveAction(act.actor, foe, act.move, log);
    }
    for (const f of onField()) endOfTurnResidual(f, log);
    tickWeather(log);            // il meteo scade
    tickTerrain(log);            // e anche il terreno
    for (const f of onField()) {
      f.volatile.flinch = false;
      // la protezione dura un solo turno; il contatore degli usi di fila
      // si azzera solo quando NON la si e' usata (cosi' 1/3^usi funziona)
      if (!f.volatile.protect) f.volatile.protectUsi = 0;
      f.volatile.protect = null;
    }
    playEvents(log.events, afterTurn);
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
    const log = makeLog();

    if (game.double && uscente === game.player2) {
      // ---- SECONDO slot: si sostituisce `player2`, il primo ha gia' scelto --
      log.push(`Ritirati, ${game.player2.name}!`);
      game.player2 = entrante;
      resetForBattle(entrante);
      entrante.spr = null;
      loadFighterSprite(entrante, "back").then(s => { entrante.spr = s; redrawScene(); });
      log.push(`Vai, ${entrante.name}!`);
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
    log.push(`Ritirati, ${outgoing.name}!`);
    setActive(index);
    resetForBattle(game.player);   // stadi/stato-volatile azzerati entrando in campo
    game.player.spr = null;
    loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
    log.push(`Vai, ${game.player.name}!`);
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
     prende il 20% (Esperienza Condivisa). Pokérus ×1,5, Espamuleto +%. */
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
        game.player2 = riserva || null;
        if (game.player2) { resetForBattle(game.player2); loadFighterSprite(game.player2, "back").then(s => { game.player2.spr = s; redrawScene(); }); }
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
        log.push(next.trainer ? `${next.trainer} manda in campo ${next.name}!`
                              : `${next.name} irrompe sul campo!`);
        deployEnemy(next, log);
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
    resetForBattle(game.player);
    game.player.spr = null;
    const log = makeLog();
    log.push(`Vai, ${game.player.name}!`);
    applyOnSummon(game.player, game.enemy, log);
    loadFighterSprite(game.player, "back").then(s => { game.player.spr = s; redrawScene(); });
    playEvents(log.events, () => { game.phase = "CHOICE"; showMainMenu(); });
  }

  // Esegue una singola mossa: blocchi pre-mossa, PP, precisione, danno, effetti.
  function resolveAction(actor, foe, moveInst, messages) {
    const move = M[moveInst.id];

    // 1. l'attore riesce ad agire? (congelato/dorme/paralisi/tentennamento/confusione)
    if (!canAct(actor, messages)) return;

    // 1-zero. mosse VIETATE da Provocazione / Attaccalite / Ripeti
    const veto = mossaVietata(actor, move, moveInst);
    if (veto) { messages.push(veto); return; }
    actor.volatile.lastMove = moveInst.id;   // serve a Ripeti e Attaccalite

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

    // 2. consuma PP e annuncia
    moveInst.pp = Math.max(0, moveInst.pp - 1);
    /* Indice dell'annuncio: e' QUI che va appesa l'animazione della mossa,
       perche' e' l'unico evento che fotografa il campo prima del colpo. */
    const iAnnuncio = messages.length;
    messages.push(`${actor.name} usa ${move.it}!`);
    // Mosse a due turni (Volo, Solarraggio...): da noi colpiscono subito, ma
    // l'animazione di CARICA si vede lo stesso, su chi la usa, prima del colpo.
    if (move.charging && messages.anim) messages.anim("CHARGE_" + move.id, sideOf(actor));

    // 3. precisione (stadi + abilita' di precisione/elusione). accuracy -1 = sempre a segno
    if (move.accuracy !== -1) {
      // Grandelente: +5% di precisione per pezzo
      const lente = 1 + 0.05 * ((actor.held && actor.held.widelens) || 0);
      const chance = move.accuracy * accMult(actor.stages.acc - foe.stages.eva)
        * abStatMult(actor, "ACC") * lente / abStatMult(foe, "EVA");
      if (Math.random() * 100 >= chance) { stessoMomento(messages, `${actor.name} ha mancato il bersaglio!`); return; }
    }

    // 4. danno (se e' una mossa d'attacco)
    let landed = true;
    if (move.category !== "STATUS" && move.power > 0) {
      landed = doDamage(actor, foe, move, messages);
      // effetto visivo sul bersaglio: l'animazione vera della mossa se esiste,
      // altrimenti le particelle per tipo. Il prefetch parte ora, cosi' al
      // momento di mostrarla il file e' gia' in memoria.
      if (landed && messages.fx) {
        const key = animKeyForMove(move.id);   // la sua, o quella di ripiego
        prefetchAnim(key);
        segnaFx(messages, iAnnuncio, move.type, sideOf(foe), key);
      }
    } else if (move.category !== "STATUS" && messages.fx) {
      /* Mossa d'attacco a POTENZA -1: sono le 75 a danno FISSO (Movimento
         Sismico, Ombra Notte, Ira di Drago…). Il danno non è ancora
         implementato, ma almeno l'animazione va mostrata: prima queste mosse
         non facevano proprio niente a schermo. */
      const key = animKeyForMove(move.id);
      prefetchAnim(key);
      segnaFx(messages, iAnnuncio, move.type, sideOf(foe), key);
    } else if (move.category === "STATUS" && messages.fx) {
      // Anche le mosse di stato hanno la loro animazione: si ancora al bersaglio
      // (che per le mosse su se' stessi e' chi la usa).
      const key = animKeyForMove(move.id);
      prefetchAnim(key);
      segnaFx(messages, iAnnuncio, move.type, sideOf(foe), key);
    }

    // 4-bis. mosse che cambiano il METEO (l'estrattore non le marca: sono poche
    // e note per nome, come SUNNY_DAY/RAIN_DANCE/SANDSTORM/HAIL).
    if (WEATHER_MOVES[move.id]) {
      setWeather(WEATHER_MOVES[move.id], messages, actor.name);
      if (messages.anim) messages.anim("COMMON_" + WEATHER_ANIM[WEATHER_MOVES[move.id]], sideOf(actor));
    }

    // 5. effetti (mattoncini). Se la mossa da danno non e' andata a segno, niente effetti.
    if (landed) applyMoveAttrs(actor, foe, move, messages);
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
    if (messages.length) messages[messages.length - 1] += "\n" + t;
    else messages.push(t);
  }

  /* Appende l'animazione della mossa all'evento dell'annuncio. Se il log non
     sa farlo (array semplice usati da qualche chiamante) si ripiega sull'ultimo. */
  function segnaFx(messages, i, type, side, key) {
    if (messages.fxAt) messages.fxAt(i, type, side, key);
    else messages.fx(type, side, key);
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
        actor.sleepTurns--; messages.push(`${actor.name} sta dormendo.`);
        if (messages.anim) messages.anim("COMMON_SLEEP", sideOf(actor));
        return false;
      }
    }
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
  function rollMultiHit(mode) {
    if (mode === "TWO") return 2;
    if (mode === "THREE") return 3;
    const r = Math.random(); // distribuzione classica 2-5
    return r < 0.35 ? 2 : r < 0.70 ? 3 : r < 0.85 ? 4 : 5;
  }

  // Applica il danno (gestisce OHKO, multi-colpo, critico, drain, contraccolpo).
  // Ritorna true se la mossa ha colpito (non immune).
  function doDamage(actor, foe, move, messages) {
    const attrs = move.attrs || [];
    const forceCrit = attrs.some(a => a.kind === "critOnly");
    const highCrit = attrs.some(a => a.kind === "highCrit");
    const multi = attrs.find(a => a.kind === "multiHit");

    // abilita' del difensore: immunita' a un tipo di mossa (Levitazione) o
    // assorbimento (Assorbivolt/Assorbacqua: immune + recupera HP).
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
      foe.hp = 0; foe._justHit = true; foe.fainted = true;
      messages.push("KO in un colpo solo!"); messages.push(`${foe.name} è esausto!`);
      return true;
    }

    // Multilente: un colpo in piu' (a danno ridotto, come nell'originale)
    const lens = (actor.held && actor.held.multilens) || 0;
    const hits = (multi ? rollMultiHit(multi.mode) : 1) + lens;
    const lensPenalty = lens ? 1 / (1 + lens) : 1;
    // Mirino / Baccalansa / Supercolpo alzano la probabilita' di brutto colpo
    const critBonus = (actor.held && actor.held.scopelens ? 1 : 0)
                    + (actor.held && actor.held.leek && ["FARFETCHD", "SIRFETCHD"].includes(actor.speciesId) ? 2 : 0)
                    + (actor._lansat ? 2 : 0)
                    + (actor === game.player && game.tempBoost.crit > 0 ? 1 : 0);
    let total = 0, lastEff = 1, anyCrit = false, immune = false, done = 0;
    for (let h = 0; h < hits; h++) {
      if (foe.fainted) break;
      const res = computeDamage(actor, foe, move, { forceCrit, highCrit, critStage: critBonus });
      if (res.immune) { immune = true; break; }
      let raw = Math.max(1, Math.floor(res.damage * lensPenalty));
      const dealt = bossClamp(foe, raw, messages);  // scudi del boss
      total += dealt; lastEff = res.effectiveness; if (res.crit) anyCrit = true; done++;
      foe.hp = Math.max(0, foe.hp - dealt); foe._justHit = true;
      if (foe.hp <= 0) {
        // Resistenza (Protect in versione "endure") e Bandana: si sopravvive con 1 PS
        if (foe.volatile.protect === "endure") {
          foe.hp = 1; messages.push(`${foe.name} ha resistito al colpo!`);
        } else if (foe.held && foe.held.focusband && Math.random() < 0.1 * foe.held.focusband) {
          foe.hp = 1; messages.push(`${foe.name} ha resistito grazie alla Bandana!`);
        } else { foe.fainted = true; break; }
      }
    }
    // Pugno d'Oro: il danno inflitto frutta soldi
    if (actor === game.player && game.charms.goldenPunch && total > 0) {
      const g = Math.floor(total * 0.5 * game.charms.goldenPunch);
      if (g > 0) { game.money += g; messages.push(`Il Pugno d'Oro frutta ₽${g}!`); }
    }
    // Roccia di Re: 10% per pezzo di far tentennare
    if (actor.held && actor.held.kingsrock && total > 0 && !foe.fainted
        && Math.random() < 0.1 * actor.held.kingsrock) {
      foe.volatile.flinch = true;
      messages.push(`La Roccia di Re fa tentennare ${foe.name}!`);
    }
    // Presartigli: 10% per pezzo di RUBARE un oggetto tenuto, col contatto
    if (actor.held && actor.held.gripclaw && total > 0 && move.contact
        && Math.random() < 0.1 * actor.held.gripclaw) rubaOggetto(actor, foe, messages, "I Presartigli", "rubano");
    if (immune && total === 0) { stessoMomento(messages, `Non ha effetto su ${foe.name}...`); return false; }

    /* Il danno e' stato applicato: l'istantanea dell'evento della mossa va
       riallineata, cosi' la barra cala su QUELLA schermata (alla fine della
       sua animazione) e non su quella dopo. */
    if (messages.snap) messages.snap();

    if (anyCrit) stessoMomento(messages, "Colpo critico!");
    if (lastEff > 1) stessoMomento(messages, "È superefficace!");
    else if (lastEff > 0 && lastEff < 1) stessoMomento(messages, "Non è molto efficace...");
    if (done > 1) stessoMomento(messages, `Colpito ${done} volte!`);

    const drain = attrs.find(a => a.kind === "drain");
    if (drain && total > 0 && actor.hp < actor.maxHp) {
      actor.hp = Math.min(actor.maxHp, actor.hp + Math.max(1, Math.floor(total * drain.ratio)));
      stessoMomento(messages, `${actor.name} ha assorbito energia!`);
      if (messages.anim) messages.anim("COMMON_HEALTH_UP", sideOf(actor));
    }
    // held: Conchiglia — recuperi 1/8 del danno inflitto (impilabile)
    if (actor.held && actor.held.shellbell && total > 0 && actor.hp < actor.maxHp && !actor.fainted) {
      actor.hp = Math.min(actor.maxHp, actor.hp + Math.max(1, Math.floor(total * actor.held.shellbell / 8)));
      stessoMomento(messages, `La Conchiglia ristora ${actor.name}!`);
    }
    const recoil = attrs.find(a => a.kind === "recoil");
    if (recoil && total > 0 && !actor.fainted && !findAb(actor, "noRecoil")) {
      actor.hp = Math.max(0, actor.hp - Math.max(1, Math.floor(total * recoil.ratio))); actor._justHit = true;
      stessoMomento(messages, `${actor.name} è danneggiato dal contraccolpo!`);
      if (actor.hp <= 0) { actor.fainted = true; messages.push(`${actor.name} è esausto!`); }
    }

    // effetti da CONTATTO: l'abilita' del difensore colpisce l'attaccante
    if (move.contact && total > 0) {
      const cs = findAb(foe, "contactStatus");
      if (cs && !actor.fainted && Math.random() * 100 < cs.chance) applyStatus(actor, cs.status, messages, foe.ability.it);
      const cd = findAb(foe, "contactDamage");
      if (cd && !actor.fainted) {
        actor.hp = Math.max(0, actor.hp - Math.max(1, Math.floor(actor.maxHp / cd.fraction))); actor._justHit = true;
        messages.push(`${actor.name} è ferito da ${foe.ability.it}!`);
        if (actor.hp <= 0) { actor.fainted = true; messages.push(`${actor.name} è esausto!`); }
      }
    }

    // Seme Rinascita: rianima una volta sola, poi si consuma
    if (foe.fainted && foe.held && foe.held.reviverseed) {
      foe.held.reviverseed--;
      if (!foe.held.reviverseed) delete foe.held.reviverseed;
      foe.fainted = false; foe.hp = Math.floor(foe.maxHp / 2);
      messages.push(`Il Seme Rinascita riporta in forze ${foe.name}!`);
      if (messages.anim) messages.anim("COMMON_HEALTH_UP", sideOf(foe));
    }
    if (foe.fainted) messages.push(`${foe.name} è esausto!`);
    else { checkEnigmaBerry(foe, lastEff, messages); checkBerries(foe, messages); }
    return true;
  }

  // Applica gli effetti-mattoncino (stato, statistiche, flinch, confusione, cura).
  // Su mossa STATUS: sempre. Su mossa d'attacco: solo con la chance secondaria
  // (tranne gli auto-effetti self, che sono garantiti).
  function applyMoveAttrs(actor, foe, move, messages) {
    const isStatus = move.category === "STATUS";
    const ch = move.effectChance;
    const secondary = () => isStatus || (ch > 0 && Math.random() * 100 < ch);
    for (const a of move.attrs || []) {
      switch (a.kind) {
        case "status":    if (secondary()) applyStatus(foe, a.status, messages); break;
        case "confuse":   if (secondary()) applyConfuse(foe, messages); break;
        case "flinch":    if (ch > 0 && Math.random() * 100 < ch && !foe.fainted) foe.volatile.flinch = true; break;
        case "statStage": {
          const tgt = a.self ? actor : foe;
          if (isStatus || a.self || (ch > 0 && Math.random() * 100 < ch)) applyStatStage(tgt, a.stats, a.stages, messages, a.self);
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

  function applyStatus(target, status, messages, sourceAbility) {
    if (target.fainted || target.status) return;
    if ((STATUS_IMMUNE[status] || []).some(t => target.types.includes(t))) return;
    // TERRENI: il Nebbioso protegge da tutti gli stati, l'Elettrico dal sonno
    // (vale solo per chi tocca terra).
    if (isGrounded(target)) {
      const t = terrainKind();
      if (t === "MISTY") { messages.push(`Il Campo Nebbioso protegge ${target.name}!`); return; }
      if (t === "ELECTRIC" && status === "SLEEP") { messages.push(`Il Campo Elettrico tiene sveglio ${target.name}!`); return; }
    }
    // abilita' che immunizzano da uno stato (Insonnia, Immunita', Scioltezza...)
    const si = findAb(target, "statusImmunity");
    if (si && si.statuses.includes(status)) { messages.push(`${target.ability.it} protegge ${target.name}!`); return; }
    if (sourceAbility) messages.push(`${sourceAbility} è entrata in azione!`);
    target.status = status;
    if (status === "SLEEP") target.sleepTurns = 1 + Math.floor(Math.random() * 3); // 1-3 turni
    messages.push({
      BURN: `${target.name} è scottato!`, PARALYSIS: `${target.name} è paralizzato!`,
      SLEEP: `${target.name} si è addormentato!`, POISON: `${target.name} è avvelenato!`,
      FREEZE: `${target.name} si è congelato!`,
    }[status]);
    if (messages.anim) messages.anim(STATUS_ANIM[status], sideOf(target));
  }

  function applyStatStage(target, stats, delta, messages, isSelf) {
    if (target.fainted) return;
    // abilita' che bloccano i cali di statistiche causati dall'avversario (Corpochiaro)
    if (!isSelf && delta < 0 && findAb(target, "protectStats")) {
      stessoMomento(messages, `${target.ability.it} impedisce il calo a ${target.name}!`);
      return;
    }
    for (const st of stats) {
      const k = st.toLowerCase();
      if (!(k in target.stages)) continue;
      const before = target.stages[k];
      target.stages[k] = Math.max(-6, Math.min(6, before + delta));
      const name = STAT_IT[k] || k;
      if (target.stages[k] === before) { stessoMomento(messages, `${name} di ${target.name} non può ${delta > 0 ? "salire" : "scendere"} oltre!`); continue; }
      const word = delta >= 2 ? "è aumentato molto" : delta === 1 ? "è aumentato" : delta === -1 ? "è diminuito" : "è diminuito molto";
      stessoMomento(messages, `${name} di ${target.name} ${word}!`);
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
    return null;
  }

  function applyConfuse(target, messages) {
    if (target.fainted || target.volatile.confusion > 0) return;
    target.volatile.confusion = 2 + Math.floor(Math.random() * 4); // 2-5 turni
    messages.push(`${target.name} è confuso!`);
    if (messages.anim) messages.anim("COMMON_CONFUSION", sideOf(target));
  }

  /* ----------------------------------------------------------------------
     BACCHE — si tengono e si attivano DA SOLE quando serve, poi si consumano.
     La Bacchiporta (BERRY_POUCH) da' il 30% di non consumarle, come l'originale.
     Va chiamata dopo ogni colpo e a fine turno, per entrambi i combattenti.
     ---------------------------------------------------------------------- */
  function useBerry(f, kind, messages) {
    const b = BERRY_DATA[kind];
    if (!(game.charms.berryPouch && Math.random() < 0.3 * Math.min(1, game.charms.berryPouch))) {
      f.berries[kind]--;
      if (f.berries[kind] <= 0) delete f.berries[kind];
    }
    messages.push(`${f.name} usa la ${b.it}!`);
  }
  function checkBerries(f, messages) {
    if (!f || f.fainted || !f.berries) return;
    const has = k => (f.berries[k] || 0) > 0;
    const half = f.hp <= f.maxHp / 2, quarter = f.hp <= f.maxHp / 4;
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
  function endOfTurnResidual(f, messages) {
    if (f.fainted) return;
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
    if (f.status === "BURN") { dmg = Math.floor(f.maxHp / 16); txt = `${f.name} soffre per la scottatura!`; }
    else if (f.status === "POISON") { dmg = Math.floor(f.maxHp / 8); txt = `${f.name} soffre per il veleno!`; }
    if (dmg > 0) {
      f.hp = Math.max(0, f.hp - Math.max(1, dmg)); f._justHit = true; messages.push(txt);
      // il danno residuo mostra l'animazione dello stato, come nell'originale
      if (messages.anim) messages.anim(STATUS_ANIM[f.status], sideOf(f));
      if (f.hp <= 0) { f.fainted = true; messages.push(`${f.name} è esausto!`); }
    }
    // Buconero: a ogni fine turno ruba un oggetto all'avversario
    if (f.held && f.held.blackhole) {
      const altro = f === game.enemy ? game.player : game.enemy;
      if (altro && !altro.fainted) rubaOggetto(f, altro, messages, "Il Buconero", "ruba");
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
  const DOUBLE_SHRINK = 0.72;
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
    const fainted = ov ? ov.fainted : fighter.fainted;
    const hit = ov ? ov.hit : fighter._justHit;
    el.classList.toggle("faint", fainted);
    if (hit) {
      if (!ov) fighter._justHit = false;
      el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit");
    }
  }

  // ov (opzionale) = { hp, maxHp, status } snapshot.
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
        <span class="name">${fighter.name}<span class="gen g-${fighter.gender}">${genderSymbol(fighter)}</span>${badge}</span>
        <span class="lvl">Lv.${fighter.level}</span>
      </div>
      <div class="hp-bar-track">
        <div class="hp-bar-fill" style="width:${ratio * 100}%; background:${color};"></div>
        ${(fighter.segBounds || []).map(b => `<div class="seg-mark" style="left:${b / maxHp * 100}%"></div>`).join("")}
      </div>
      <div class="hp-text">${Math.max(0, hp)} / ${maxHp}</div>
      ${barraExp(fighter)}
      ${fighter.ability ? `<div class="ability-line">${fighter.ability.it}</div>` : ""}`;
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
      const painted = el && el.style.backgroundImage.includes("assets/pokemon");
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
  function slot2(prefix, slotSel, f, cap) {
    const slot = document.querySelector(slotSel);
    if (!slot) return;
    // il riquadro PS non sta piu' dentro lo slot (sta agli angoli della scena):
    // va nascosto per conto suo, altrimenti resta appeso a mezz'aria
    const panel = $(prefix + "-hp-panel");
    if (!f) { slot.hidden = true; if (panel) panel.hidden = true; return; }
    slot.hidden = false;
    if (panel) panel.hidden = false;
    renderSprite($(prefix + "-sprite"), f, cap, null);
    renderHpPanel(panel, f, null);
  }

  function renderScene(frame) {
    applyAmbiente();          // luce dell'ora + effetto del meteo in corso
    const eOv = frame ? { hp: frame.ehp, maxHp: frame.emax, status: frame.est } : null;
    const pOv = frame ? { hp: frame.php, maxHp: frame.pmax, status: frame.pst } : null;
    const eSprOv = frame ? { fainted: frame.efaint, hit: frame.ehit } : null;
    const pSprOv = frame ? { fainted: frame.pfaint, hit: frame.phit } : null;
    // chi finisce in campo e' "visto": basta questo punto solo, ci passano
    // selvatici, boss, squadre degli allenatori e incontri misteriosi
    if (game.enemy) registerSeen(game.enemy.speciesId);
    if (game.enemy2) registerSeen(game.enemy2.speciesId);
    if (game.enemy) { $("#enemy-hp-panel").hidden = false; renderSprite($("#enemy-sprite"), game.enemy, spriteCfg(ENEMY_SPRITE, game.enemy), eSprOv); renderHpPanel($("#enemy-hp-panel"), game.enemy, eOv); }
    else clearSlot("#enemy-sprite", "#enemy-hp-panel");
    if (game.player) { $("#player-hp-panel").hidden = false; renderSprite($("#player-sprite"), game.player, spriteCfg(PLAYER_SPRITE, game.player), pSprOv); renderHpPanel($("#player-hp-panel"), game.player, pOv); }
    else clearSlot("#player-sprite", "#player-hp-panel");
    // SECONDI slot: presenti solo nelle lotte in doppio
    const gm = $("#game");
    if (gm) gm.classList.toggle("double", !!game.double);
    slot2("#enemy2", ".battler-slot.enemy2", game.enemy2, spriteCfg(ENEMY_SPRITE, game.enemy2));
    slot2("#player2", ".battler-slot.ally2", game.player2, spriteCfg(PLAYER_SPRITE, game.player2));
    // barre degli oggetti tenuti (giocatore e avversario)
    renderHeldBar("#held-ally", game.player);
    renderHeldBar("#held-enemy", game.enemy);
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
    const btns = bersagli.map((f, i) => {
      const ratio = Math.max(0, f.hp / f.maxHp);
      const col = ratio > 0.5 ? "var(--hp-green)" : ratio > 0.2 ? "var(--hp-yellow)" : "var(--hp-red)";
      return `<button class="btn move-btn tgt-btn" data-i="${i}" style="background:#2c3444;">
          <span class="move-name">${miniIcon(f.dex, 1)} ${f.name}</span>
          <span class="move-meta"><span>Lv.${f.level}</span>
            <span class="tgt-hp"><span style="width:${ratio * 100}%;background:${col}"></span></span></span>
        </button>`;
    }).join("");
    cmd().innerHTML = `
      <div class="prompt-line">Chi vuoi colpire? <span class="hud">· o toccalo in campo</span></div>
      <div class="grid2">${btns}</div>
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
      <div class="prompt-line">Cosa deve fare ${(chi || game.player).name}?${game.double ? ` <b>(${game.chooser === 1 ? "2°" : "1°"})</b>` : ""} <span class="hud">· ${alive}/${game.party.length} · 🔴${totalBalls()}${game.theftballs ? " 🕶" + game.theftballs : ""} · ₽${game.money}${runLuck() ? " · 🍀" + runLuck() : ""}</span></div>
      <div class="grid2">
        <button class="btn main-fight" data-act="fight">Lotta</button>
        <button class="btn main-bag"   data-act="ball">Ball</button>
        <button class="btn main-team"  data-act="team">Squadra</button>
        <button class="btn main-run"   data-act="run">Fuggi</button>
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
    cmd().querySelector('[data-act="run"]').onclick  = () => gameOver("RUN");
  }

  // Lista squadra. mode "switch" (dal menu, con Indietro) o "force" (dopo un KO,
  // obbligatorio). Ogni voce mostra nome, Lv, barra HP, stato.
  /* Scelta del Pokemon da mandare in campo — A SCHERMO INTERO (overlay #meta).
     Prima stava nella sola fascia comandi (un quarto dello schermo) e le righe
     erano minuscole: per un menu che si apre a ogni cambio, e in cui bisogna
     confrontare PS, stato e mosse, era troppo poco. Ora e' una carta per
     Pokemon con tipi, abilita', oggetti tenuti e mosse coi PP. */
  function renderParty(mode) {
    const cards = game.party.map((p, i) => {
      const ratio = Math.max(0, p.hp / p.maxHp);
      const col = ratio > 0.5 ? "var(--hp-green)" : ratio > 0.2 ? "var(--hp-yellow)" : "var(--hp-red)";
      /* ⚠️ In doppio sono in campo DUE Pokemon: nessuno dei due può essere
         scelto come sostituto (prima si poteva toccare il secondo alleato e
         non succedeva nulla). */
      const inCampo = p === game.player || (game.double && p === game.player2);
      const selectable = !p.fainted && !inCampo;
      const tag = inCampo ? '<span class="party-active">in campo</span>'
        : p.fainted ? '<span class="party-ko">KO</span>' : "";
      const st = p.status ? `<span class="status-badge st-${p.status}">${STATUS_IT[p.status]}</span>` : "";
      const types = p.types.map(t => `<span class="ticon t-${t}"></span>`).join("");
      const held = Object.keys(p.held || {}).length ? `<span class="pd-held">🎒 ${heldSummary(p)}</span>` : "";
      // mosse coi PP residui: e' l'informazione che serve davvero per decidere
      const moves = p.moves.map(m => {
        const mv = M[m.id];
        return `<span class="pd-move${m.pp === 0 ? " vuota" : ""}"><span class="ticon t-${mv.type}"></span>${mv.it} <b>${m.pp}/${m.maxPp}</b></span>`;
      }).join("");
      return `<button class="pd-card sceglibile ${p.fainted ? "ko" : ""}" data-i="${i}" ${selectable ? "" : "disabled"}>
          <div class="pd-top"><span class="pd-name">${miniIcon(p.dex, 1.1)}${p.shiny ? "✨" : ""}${p.name.replace("✨", "")}<span class="gen g-${p.gender}">${genderSymbol(p)}</span>${st}</span><span class="pd-lv">Lv.${p.level} ${tag}</span></div>
          <div class="pd-types">${types} ${p.ability ? `<span class="pd-ab">${p.ability.it}</span>` : ""}${p.passiveAbility ? `<span class="pd-ab pd-pass">+${p.passiveAbility.it}</span>` : ""} ${held}</div>
          <div class="party-hp-track"><div class="party-hp-fill" style="width:${ratio * 100}%;background:${col};"></div></div>
          <div class="pd-hp">${Math.max(0, p.hp)}/${p.maxHp} PS · <span class="pd-exp">Lv.${p.level}${expEtichetta(p)}</span></div>
          ${barraExp(p)}
          <div class="pd-moves-row">${moves}</div>
        </button>`;
    }).join("");
    const boxLine = game.box.length ? `<div class="meta-sub">Box: ${game.box.length} Pokémon in deposito</div>` : "";
    // nel cambio FORZATO non si torna indietro: qualcuno deve scendere in campo
    const backRow = mode === "switch"
      ? `<div class="meta-actions"><button class="meta-btn ghost" data-act="back">↩ Indietro</button></div>` : "";
    const title = mode === "force" ? "Chi mandi in campo?" : "Cambia Pokémon";
    const sub = mode === "force" ? "il tuo Pokémon è esausto" : "tocca chi deve scendere in campo";
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,30px)">${title}</div>
      <div class="meta-sub">${sub}</div>
      <div class="pd-list">${cards}</div>${boxLine}${backRow}`);
    metaEl().querySelectorAll(".pd-card[data-i]").forEach(b => b.onclick = () => {
      if (b.disabled) return;
      const i = parseInt(b.dataset.i, 10);
      hideMeta();
      if (mode === "force") forceSwitchTo(i); else playerSwitch(i);
    });
    if (mode === "switch") metaEl().querySelector('[data-act="back"]').onclick = () => { hideMeta(); showMainMenu(); };
  }

  // Offerta di cattura dopo aver sconfitto un selvatico: scegli quale ball usare.
  function renderCaptureScreen() {
    const BALL_IMG = { balls: "pb", greatballs: "gb", ultraballs: "ub", rogueballs: "rb", theftballs: "tb", masterballs: "mb" };
    const owned = BALL_TYPES.filter(b => (game[b.key] || 0) > 0);
    const btns = owned.map(b => {
      const pct = b.mult >= 255 ? 100 : captureChancePct(game.enemy, b.mult, psUltimaBall(game.enemy));
      return `<button class="btn capture-yes" data-b="${b.key}">
        <img class="ball-icon" src="${ballIcon(BALL_IMG[b.key])}" alt="">${b.it}<span class="cap-sub">~${pct}% · ×${game[b.key]}</span></button>`;
    }).join("");
    cmd().innerHTML = `
      <div class="prompt-line">${game.enemy.name} è a terra: <b>ultima ball</b> per catturarlo!</div>
      <div class="grid2 capture-grid">${btns}
        <button class="btn capture-no" data-act="skip">Lascia</button>
      </div>`;
    cmd().querySelectorAll("[data-b]").forEach(b => b.onclick = () => attemptCapture(b.dataset.b));
    cmd().querySelector('[data-act="skip"]').onclick = () => openShop();
  }

  /* ---------------- LANCIO BALL IN BATTAGLIA ----------------
     Come nei giochi veri: si lancia durante la lotta, consuma il turno, e si
     possono lanciare quante ball si vuole. Le ball normali funzionano solo sui
     SELVATICI; la Theft Ball (nostra aggiunta) ruba anche agli allenatori, ma
     non al Rivale. Il boss finale non è catturabile. */
  function ballBlockReason(ball) {
    const e = game.enemy;
    if (!e) return "Nessun bersaglio.";
    // NB: il boss finale È catturabile (scelta del proprietario, diversa
    // dall'originale che lo blocca): tasso basso ma non impossibile.
    if (e.trainer) {
      if (!ball.theft) return `Non puoi catturare il Pokémon di un allenatore! Serve una Theft Ball.`;
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
      ? `Solo la Theft Ball funziona sugli allenatori`
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
      const mon = makeFighter(enemy.speciesId, enemy.level, { shiny: enemy.shiny, ivs: enemy.ivs, variant: enemy.variant, abilIndex: enemy.abilIndex });
      const stolen = !!enemy.trainer;
      accogliPokemon(mon, log, stolen ? "🕶 Rubato!" : "Preso!");
      registerCaught(enemy.speciesId, enemy.shiny, enemy.ivs, log, enemy.variant, enemy.abilIndex);
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
          l2.push(`${next.trainer} manda in campo ${next.name}!`);
          deployEnemy(next, l2);
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

  function showMoves() {
    const chi = currentChooser() || game.player;
    const buttons = chi.moves.map((mi, i) => {
      const mv = M[mi.id];
      const ty = T[mv.type];
      const disabled = mi.pp <= 0 ? "disabled" : "";
      return `
        <button class="btn move-btn" data-i="${i}" ${disabled}
                style="background:${ty.color};">
          <span class="move-name">${mv.it}</span>
          <span class="move-meta">
            <span class="ticon t-${mv.type}"></span>
            <span class="cicon c-${mv.category}"></span>
            <span class="move-pp">${mv.power ? "P" + mv.power + " · " : ""}PP ${mi.pp}/${mi.maxPp}</span>
          </span>
        </button>`;
    }).join("");

    cmd().innerHTML = `
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

  /* Lancia la mossa scelta (in doppio passa prima dalla scelta del bersaglio). */
  function usaMossa(i) {
    const bersagli = enemiesOnField();
    if (game.double && bersagli.length > 1) showTargetMenu(i, bersagli);
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
          const chi = a.self ? "a sé" : "al bersaglio";
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
    cmd().innerHTML = `<div class="msgbox">${righe}<span class="cont">▸</span></div>`;
    cmd().querySelector(".msgbox").onclick = advanceMessages;
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
  const SLOT_KEY = n => `pokerogue_mobile_save_${n}`;

  /* Campi della run da salvare. Fuori restano: `player`/`enemy` (si ricreano),
     `events`/`timer`/`afterEvents` (roba di narrazione) e `encReward`, che e'
     una FUNZIONE e non sopravvive a JSON. */
  const CAMPI_RUN = ["balls", "greatballs", "ultraballs", "rogueballs", "theftballs",
    "pendingTheft", "money", "stones", "charms", "tempBoost", "shopMarkup",
    "cicloOffset", "encSeen", "encTiersSeen", "leagueIdx", "evilIdx", "finalBossIdx",
    "rivalFemale", "hasMegaRing", "hasDynamaxBand", "active", "biome", "starterSpecies"];

  /* Un Pokemon e' gia' quasi tutto JSON. Le due eccezioni: `spr` (i dati
     dell'immagine, si ricaricano) e le abilita', che sono RIFERIMENTI dentro
     ABIL — si salva il loro id e si riaggancia al caricamento. */
  function monSalva(p) {
    const o = {};
    for (const k in p) {
      if (k === "spr") continue;
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
    catch (e) { console.warn("[salvataggio] non riuscito:", e.message); }
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
    // easter egg: tre tocchi sul titolo aprono il selettore dello zip di GIF (§25)
    metaEl().querySelector(".meta-title").onclick = gifTocco;
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
  function showGacha(result) {
    game.phase = "GACHA";
    const canPull = meta.vouchers > 0;
    const evid = specieInEvidenza();
    const stage = result
      ? `<span class="egg-sprite big shake egg-${result.tier}"></span>
         <div class="gacha-result">È un <span class="tier-${result.tier}">Uovo ${EGG_TIERS[result.tier].it}</span>!</div>
         <div class="meta-sub">dal ${GACHA[result.tipo].emoji} ${GACHA[result.tipo].it} · si schiude superando ${result.waves} ondate</div>`
      : `<span class="egg-sprite big" style="opacity:.55"></span>
         <div class="meta-sub">Scegli la macchina: cambia cosa è più probabile che l'uovo ti dia.</div>`;
    const macchine = Object.keys(GACHA).map(k => {
      const sub = k === "LEGENDARY" && evid
        ? `in evidenza oggi: <b>${S[evid].it}</b>` : GACHA[k].sub;
      return `<button class="meta-btn gacha macchina" data-g="${k}" ${canPull ? "" : "disabled"}>
          <span class="mac-tit">${GACHA[k].emoji} ${GACHA[k].it}</span>
          <span class="mac-sub">${sub}</span>
        </button>`;
    }).join("");
    showMetaScreen(`
      <div class="meta-title">Gacha Uova</div>
      <div class="meta-stats"><span>🎟 ${meta.vouchers} voucher</span></div>
      <div class="gacha-stage">${stage}</div>
      <div class="macchine">${macchine}</div>
      <div class="meta-actions"><button class="meta-btn ghost" data-a="back">Indietro</button></div>`);
    metaEl().querySelectorAll(".macchina").forEach(b => b.onclick = () => {
      if (meta.vouchers <= 0) return;
      meta.vouchers--;
      const egg = pullEgg(b.dataset.g);
      saveMeta();
      showGacha(egg);
    });
    metaEl().querySelector('[data-a="back"]').onclick = showHome;
  }

  function showEggs() {
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
  function tickEggs(messages) {
    if (!meta.eggs.length) return;
    const hatched = [];
    for (const egg of meta.eggs) { egg.waves--; if (egg.waves <= 0) hatched.push(egg); }
    if (hatched.length) {
      meta.eggs = meta.eggs.filter(e => e.waves > 0);
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
        if (!meta.unlocked[sp] || shiny) meta.unlocked[sp] = shiny ? 2 : (meta.unlocked[sp] || 1);
        meta.stats.hatched++;
        meta.candy = meta.candy || {};
        meta.candy[sp] = (meta.candy[sp] || 0) + 3;   // le uova danno più caramelle
        if (messages) messages.push(`🥚 Un uovo ${GACHA[tipo].emoji} si è schiuso! È nato ${S[sp].it}${shiny ? " ✨CROMATICO" : ""} — sbloccato come starter!`);
        /* ABILITÀ NASCOSTA: 1 su 192, come `GACHA_EGG_HA_RATE`. È l'altra via
           per sbloccarla, oltre a catturare un esemplare che ce l'ha. */
        if (S[sp].abilities.hidden && Math.floor(Math.random() * GACHA_EGG_HA_RATE) === 0) {
          const nuova = registraAbilita(rootOf(sp), 2);
          if (nuova && messages) messages.push(`🔓✨ È nato con l'abilità NASCOSTA: ${nuova.it} sbloccata per ${S[sp].it}!`);
        }
        /* Ogni schiusa sblocca UNA mossa da uovo della specie nata: e' l'unico
           modo di ottenerle, ed e' cio' che fa crescere le mosse iniziali
           selezionabili nel menu di partenza. Il gacha MOSSE rende molto piu'
           probabile che tocchi la RARA (`BOOSTED_RARE_EGGMOVE_RATES`). */
        const em = unlockEggMove(sp, egg.tier, tipo === "MOVE");
        if (em && messages) {
          messages.push(em.rara
            ? `🥚✨ ${S[sp].it} ha imparato la mossa da uovo RARA ${em.it}!`
            : `🥚 ${S[sp].it} ha imparato la mossa da uovo ${em.it}!`);
        }
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
        { label: "Negozio di strumenti per la Lotta", sub: "2 Poteslot", run() {
            game.tempBoost[meRandStat()] = 5; game.tempBoost[meRandStat()] = 5;
            return "Prendi due Poteslot: la squadra parte avvantaggiata per 5 ondate!"; } },
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
      id: "fiery", tier: "COMMON", emoji: "🔥", title: "Passione Ardente",
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
      id: "fightflight", tier: "COMMON", emoji: "⚔️", title: "Lotta o Scappa",
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
      id: "lostsea", tier: "COMMON", emoji: "🌊", title: "Perso nel Mare",
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
      id: "strongstuff", tier: "COMMON", emoji: "🧃", title: "La Roba Forte",
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
      id: "uncommon", tier: "COMMON", emoji: "✨", title: "Una forma non comune",
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
              if (game.party.length < PARTY_MAX) { game.party.push(e._mon); return `Offri ${tolte} bacche: ${e._mon.name} decide di seguirti!`; }
              game.box.push(e._mon); return `Offri ${tolte} bacche: ${e._mon.name} ti segue (va nel box, squadra piena).`; } },
          { label: "Fattelo amico", sub: `${v.name} prova a comunicare`, run() {
              if (v.stats.spatk >= e._mon.stats.spatk) {
                if (game.party.length < PARTY_MAX) { game.party.push(e._mon); return `${v.name} lo tranquillizza: ${e._mon.name} si unisce a te!`; }
                game.box.push(e._mon); return `${v.name} lo tranquillizza: ${e._mon.name} va nel box (squadra piena).`;
              }
              return `${e._mon.name} non si fida e scappa via.`; } },
        ];
      },
    },

    /* ========================= GREAT (9) ========================= */
    {
      // absolute-avarice — il Greedent ti ruba TUTTE le bacche
      id: "avarice", tier: "GREAT", emoji: "🐿️", title: "Cupidigia Assoluta",
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
              if (game.party.length < PARTY_MAX) { game.party.push(e._mon); return "Il Greedent è commosso dalla tua generosità e ti segue!"; }
              game.box.push(e._mon); return "Il Greedent ti segue (va nel box, squadra piena)."; } },
        ];
      },
    },
    {
      // an-offer-you-cant-refuse — ti comprano un Pokemon
      id: "offer", tier: "GREAT", emoji: "🤝", npc: "clerk_m", title: "Un'offerta che non puoi rifiutare",
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
          { label: "Dona uno strumento Coleottero", sub: "cedi un Boost di Tipo · ricevi di meglio",
            cond: () => aliveParty().some(p => p.held && p.held.typeboost && Object.keys(p.held.typeboost).length),
            run() {
              const p = aliveParty().find(x => x.held && x.held.typeboost && Object.keys(x.held.typeboost).length);
              const t = Object.keys(p.held.typeboost)[0];
              p.held.typeboost[t]--; if (!p.held.typeboost[t]) delete p.held.typeboost[t];
              return `Le doni il tuo Boost ${T[t].it}. In cambio: ${encReward("ULTRA")}!`; } },
          { label: "Vai via", run: () => "Riesci a svignartela mentre parla ancora." },
        ];
      },
    },
    {
      // dancing-lessons — l'Oricorio che vuole ballare
      id: "dancing", tier: "GREAT", emoji: "💃", title: "Lezioni di danza",
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
              if (game.party.length < PARTY_MAX) { game.party.push(e._mon); return "L'Oricorio è entusiasmato dalla tua danza e ti segue!"; }
              game.box.push(e._mon); return "L'Oricorio ti segue (va nel box, squadra piena)."; } },
        ];
      },
    },
    {
      // delibirdy — dai qualcosa ai Delibird, ricevi di meglio
      id: "delibirdy", tier: "GREAT", emoji: "🎁", title: "Gruppo di Delibird",
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
      id: "funandgames", tier: "GREAT", emoji: "🎪", title: "Divertimento e Giochi!",
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
              if (!meta.unlocked[preso.speciesId]) { meta.unlocked[preso.speciesId] = preso.shiny ? 2 : 1; saveMeta(); }
              if (game.party.length < PARTY_MAX) game.party.push(preso); else game.box.push(preso);
              return `Giornata proficua: 10 Poké Ball e ${preso.name} catturato nella Zona Safari!`; } },
          { label: "Vai via", run: () => "Il biglietto è troppo caro per oggi." },
        ];
      },
    },
    {
      // slumbering-snorlax — lo Snorlax che blocca la strada
      id: "snorlax", tier: "GREAT", emoji: "😴", title: "Snorlax assopito",
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
              const mon = makeFighter(e._mon, Math.max(START_LEVEL, enemyLevelFor(game.wave) - 2),
                                      { shiny: e._karp ? true : rollShiny() });
              if (!meta.unlocked[e._mon] || (mon.shiny && meta.unlocked[e._mon] < 2)) {
                meta.unlocked[e._mon] = mon.shiny ? 2 : 1; saveMeta();
              }
              if (game.party.length < PARTY_MAX) { game.party.push(mon); return `Affare fatto! ${mon.name} si unisce alla squadra!`; }
              game.box.push(mon); return `Affare fatto! ${mon.name} va nel box (squadra piena).`; } },
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
      id: "trash", tier: "ULTRA", emoji: "🗑️", title: "Da Monnezza a Meraviglia",
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
      id: "clown", tier: "ULTRA", emoji: "🤡", title: "Pagliacciate",
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
            if (!meta.unlocked[k]) { meta.unlocked[k] = mon.shiny ? 2 : 1; saveMeta(); }
            if (game.party.length < PARTY_MAX) game.party.push(mon); else game.box.push(mon);
            encEgg(1);
            return `Ti prendi cura di ${mon.name}! L'allevatrice ti regala anche un buono uovo.`;
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
        { label: "Rifiuta la sfida", sub: "squadra curata · Caramellone", run() {
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
    const npc = enc.npc
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
      // un incontro puo' aver insegnato una MT: prima la sostituzione mossa
      processLearns(nextWave);
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
  let starterTeam = [];     // [{k, ability, moves, shiny, pkrs}]

  // Costo effettivo: base meno le riduzioni comprate con le caramelle (min 1).
  function starterCost(k) {
    const base = S[k] && S[k].starterCost ? S[k].starterCost : 3;
    const cut = (meta.costCut && meta.costCut[k]) || 0;
    return Math.max(1, base - cut);
  }
  function candyOf(k) { return (meta.candy && meta.candy[k]) || 0; }
  // Prezzi in caramelle (come PokeRogue: più il Pokemon è costoso, più caramelle serve)
  function costCutPrice(k) {
    const base = S[k] && S[k].starterCost ? S[k].starterCost : 3;
    const done = (meta.costCut && meta.costCut[k]) || 0;
    return 5 * base * (done + 1);
  }
  function passivePrice(k) {
    const base = S[k] && S[k].starterCost ? S[k].starterCost : 3;
    return 10 * base;
  }
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
  const starterFilters = { gen: 0, type: "", stato: "libero", sort: "dex", q: "" };
  const SORT_IT = { dex: "Num. Dex", cost: "Costo", name: "Nome", candy: "Caramelle" };
  const STATO_IT = { libero: "Schierabili", tutto: "Tutto", visto: "Visti", ignoto: "Mancanti" };
  function starterFiltered() {
    const f = starterFilters;
    const q = f.q.trim().toLowerCase();
    let list = starterDex().filter(k => {
      const sp = S[k];
      if (f.gen && sp.gen !== f.gen) return false;
      if (f.type && !sp.types.includes(f.type)) return false;
      if (f.stato !== "tutto" && starterState(k) !== f.stato) return false;
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
      ? starterTeam.map((e, i) => `<button class="team-slot" data-rm="${i}">${miniIcon(S[e.k].dex, 1.1)}<span>${S[e.k].it}</span><span class="ts-cost">${starterCost(e.k)}</span></button>`).join("")
      : `<div class="meta-sub" style="margin:0">Nessun Pokémon scelto — toccane uno sotto</div>`;
    // conteggio del dex, il numero che interessa davvero a chi colleziona
    // conta gli SBLOCCATI, non i catturati: i 27 di partenza sono giocabili
    // pur non essendo in `meta.unlocked`
    const tot = starterDex().length;
    const presi = starterDex().filter(isSelectable).length;
    const opt = (v, cur, label) => `<option value="${v}"${v == cur ? " selected" : ""}>${label}</option>`;
    showMetaScreen(`
      <div class="meta-title" style="font-size:clamp(19px,5.6vw,29px)">Componi la Squadra</div>
      <div class="budget-bar"><span>Punti: <b>${teamCost()}</b> / ${STARTER_BUDGET}</span>
        <span class="budget-left">${left} disponibili</span></div>
      <div class="starter-team">${teamRow}</div>
      <div class="filter-bar">
        <input id="fq" class="filter-q" type="search" placeholder="🔎 Nome…" value="${f.q.replace(/"/g, "&quot;")}">
        <select id="fgen" class="filter-sel">${opt(0, f.gen, "Gen: tutte")}${[1,2,3,4,5,6,7,8,9].map(g => opt(g, f.gen, "Gen " + g)).join("")}</select>
        <select id="ftype" class="filter-sel">${opt("", f.type, "Tipo: tutti")}${Object.keys(CHART).map(t => opt(t, f.type, T[t].it)).join("")}</select>
        <select id="fstato" class="filter-sel">${Object.keys(STATO_IT).map(s => opt(s, f.stato, STATO_IT[s])).join("")}</select>
        <select id="fsort" class="filter-sel">${Object.keys(SORT_IT).map(s => opt(s, f.sort, "↕ " + SORT_IT[s])).join("")}</select>
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
    bind("fgen", "gen", v => parseInt(v, 10));
    bind("ftype", "type");
    bind("fstato", "stato");
    bind("fsort", "sort");
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
    metaEl().querySelectorAll(".starter-cell[data-k]").forEach(b => b.onclick = () => {
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
    starterCfg = {
      k, shiny, pkrs,
      ability: abilPool[0],
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
    const bs = sp.baseStats;
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
    showMetaScreen(`
      <div class="sd-head">
        <span class="sd-sprite" id="sdSprite"></span>
        <div class="sd-info">
          <div class="sd-name">${c.shiny ? "✨" : ""}${sp.it} ${c.pkrs ? '<span class="sb-pkrs">💜</span>' : ""} ${hasRibbon(c.k) ? "🎀" : ""}</div>
          <div class="sd-types">${sp.types.map(t => `<span class="ticon t-${t}"></span>`).join("")}</div>
          <div class="sd-abrow">Abilità: ${abils}</div>
          ${c.info && c.info.tipo === "ab" ? snippetAbilita(c.info.id) : ""}
          <div class="sd-passive">Passiva: <b>${(ABIL[sp.passive] || {}).it || "—"}</b>${meta.passiveOn && meta.passiveOn[c.k] ? " ✅" : " 🔒"} · Costo: <b>${starterCost(c.k)}</b> punti</div>
          <div class="sd-candy">🍬 ${candyOf(c.k)} caramelle
            <button class="chip candy-btn" data-cc="1" ${candyOf(c.k) >= costCutPrice(c.k) && starterCost(c.k) > 1 ? "" : "disabled"}>−1 costo (${costCutPrice(c.k)})</button>
            <button class="chip candy-btn" data-cp="1" ${!(meta.passiveOn && meta.passiveOn[c.k]) && candyOf(c.k) >= passivePrice(c.k) ? "" : "disabled"}>Sblocca passiva (${passivePrice(c.k)})</button>
          </div>
        </div>
      </div>
      <div class="sd-stats">
        ${statBar("PS", bs.hp)}${statBar("Att", bs.atk)}${statBar("Dif", bs.def)}
        ${statBar("A.Sp", bs.spatk)}${statBar("D.Sp", bs.spdef)}${statBar("Vel", bs.spd)}
      </div>
      <div class="meta-sub">Mosse iniziali (max 4 · scelte ${c.moves.length}/4)</div>
      <div class="move-chips">${moves}</div>
      ${c.info && c.info.tipo === "mv" ? snippetMossa(c.info.id) : ""}
      ${eggNote}
      <div class="meta-actions two-col">
        <button class="meta-btn ghost" data-act="back">Indietro</button>
        <button class="meta-btn primary" data-act="go" ${c.moves.length ? "" : "disabled"}>➕ Aggiungi ${sp.it}</button>
      </div>`);
    // sprite grande
    loadSprite(sp.dex, "front", c.shiny).then(s => {
      const el = document.getElementById("sdSprite"); if (!el || !s) return;
      const k = Math.min(1.4, 88 / s.frame.h, 88 / s.frame.w);
      el.style.width = s.frame.w * k + "px"; el.style.height = s.frame.h * k + "px";
      el.style.background = `url("${s.sheet}") -${s.frame.x * k}px -${s.frame.y * k}px / ${s.sheet_w * k}px ${s.sheet_h * k}px no-repeat`;
      el.style.imageRendering = "pixelated";
    });
    const ccBtn = metaEl().querySelector("[data-cc]");
    if (ccBtn) ccBtn.onclick = () => {
      const price = costCutPrice(c.k);
      if (candyOf(c.k) < price || starterCost(c.k) <= 1) return;
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
    metaEl().querySelectorAll("[data-ab]").forEach(b => b.onclick = () => { c.ability = b.dataset.ab; renderStarterDetail(); });
    metaEl().querySelectorAll("[data-mv]").forEach(b => b.onclick = () => {
      const id = b.dataset.mv, i = c.moves.indexOf(id);
      if (i >= 0) c.moves.splice(i, 1);
      else if (c.moves.length < 4) c.moves.push(id);
      renderStarterDetail();
    });
    // le ⓘ aprono/chiudono lo snippet "cosa fa"
    metaEl().querySelectorAll("[data-i-ab]").forEach(b => b.onclick = () => apriInfo("ab", b.dataset.iAb));
    metaEl().querySelectorAll("[data-i-mv]").forEach(b => b.onclick = () => apriInfo("mv", b.dataset.iMv));
    metaEl().querySelector('[data-act="back"]').onclick = renderStarterSelect;
    metaEl().querySelector('[data-act="go"]').onclick = () => {
      // aggiunge alla squadra iniziale (sistema a punti), poi torna alla scelta
      starterTeam.push({ k: c.k, ability: c.ability, moves: c.moves.slice(), shiny: c.shiny, pkrs: c.pkrs });
      renderStarterSelect();
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
  function addHeld(p, key) { p.held[key] = (p.held[key] || 0) + 1; }
  // Una vitamina: +10% lineare alla statistica base (usata anche dai mystery encounter)
  function boostBase(p, stat) { p.vits[stat] = (p.vits[stat] || 0) + 1; recomputeStats(p); }
  const VITS = ["atk", "def", "spatk", "spdef", "spd", "hp"];
  const VIT_IT = { atk: "ATT", def: "DIF", spatk: "A.SP", spdef: "D.SP", spd: "VEL", hp: "PS" };
  const VIT_NOME = { hp: "Più PS", atk: "Proteina", def: "Ferro", spatk: "Calcio", spdef: "Zinco", spd: "Carburante" };

  // Curamuleto: +10% a ogni cura (HEALING_CHARM dell'originale)
  function healMult() { return 1 + 0.1 * (game.charms.healing || 0); }
  // Cura PS come l'originale: il MAGGIORE fra i punti fissi e la percentuale.
  function hpRestore(p, points, percent) {
    const amt = Math.max(Math.floor(p.maxHp * percent / 100), points);
    p.hp = Math.min(p.maxHp, p.hp + Math.ceil(amt * healMult()));
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
  function applyPpUp(p, stages) {
    for (const m of p.moves) {
      const base = M[m.id].pp;
      const cur = m.ppUp || 0;
      const add = Math.min(stages, 3 - cur);
      if (add <= 0) continue;
      m.ppUp = cur + add;
      const gain = Math.floor(base / 5) * add;
      m.maxPp += gain; m.pp += gain;
    }
  }
  /* Mosse che il Pokemon POTREBBE conoscere dal suo learnset ma non ha:
     e' quello che fa ricordare il Fungorico (MEMORY_MUSHROOM). */
  function mosseDimenticate(p) {
    return (LEARN[p.speciesId] || [])
      .filter(([lv, mv]) => lv <= p.level && M[mv] && !p.moves.some(m => m.id === mv))
      .map(([, mv]) => mv);
  }
  // Etere/Elisir: `moves` = quante mosse (1 = quella piu' scarica), `amount` = -1 pieno
  function restorePp(p, howMany, amount) {
    const list = howMany === 1
      ? [p.moves.slice().sort((a, b) => (a.pp / a.maxPp) - (b.pp / b.maxPp))[0]]
      : p.moves;
    for (const m of list) {
      if (!m) continue;
      m.pp = amount < 0 ? m.maxPp : Math.min(m.maxPp, m.pp + amount);
    }
  }
  function addLevels(p, n) {
    p.level += n + (game.charms.candyJar || 0);   // Caramelliera: +1 livello per caramella
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
     E' quello che fanno Presartigli (al contatto) e Buconero (a ogni turno). */
  function rubaOggetto(ladro, vittima, messages, chi, verbo) {
    // oggetti "inchiodati": il Buconero del boss finale non si può sfilare
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
      nome = `Boost ${T[t].it}`;
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
    lightball:  { it: "Sferapalla",  icon: "light_ball",     stats: ["atk", "spatk"], mult: 2, specie: ["PIKACHU"] },
    thickclub:  { it: "Ossoduro",    icon: "thick_club",     stats: ["atk"],          mult: 2, specie: ["CUBONE", "MAROWAK"] },
    metalpowder:{ it: "Metalpolvere",icon: "metal_powder",   stats: ["def"],          mult: 2, specie: ["DITTO"] },
    quickpowder:{ it: "Velocipolvere",icon:"quick_powder",   stats: ["spd"],          mult: 2, specie: ["DITTO"] },
    deepseascale:{it: "Squamabissi", icon: "deep_sea_scale", stats: ["spdef"],        mult: 2, specie: ["CLAMPERL"] },
    deepseatooth:{it: "Dentebissi",  icon: "deep_sea_tooth", stats: ["spatk"],        mult: 2, specie: ["CLAMPERL"] },
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
    { tier: "COMMON", weight: 3, id: "ether", label: "Etere", desc: "+10 PP a una mossa", icon: "ether",
      target: "mon", valid: needsPp, avail: someone(needsPp), apply: p => restorePp(p, 1, 10) },
    { tier: "COMMON", weight: 3, id: "maxether", label: "Etere Max", desc: "PP pieni a una mossa", icon: "max_ether",
      target: "mon", valid: needsPp, avail: someone(needsPp), apply: p => restorePp(p, 1, -1) },
    { tier: "COMMON", weight: 2, id: "candy", label: "Caramella Rara", desc: "+1 livello", icon: "rare_candy",
      target: "mon", valid: alive, apply: p => addLevels(p, 1) },
    { tier: "COMMON", weight: 2, id: "berry", label: "Bacca", desc: "held: si attiva da sola in lotta", icon: "sitrus_berry",
      target: "mon", valid: alive, dyn: "berry", apply: (p, pk) => addBerry(p, pk.berry) },
    { tier: "COMMON", weight: 4, id: "xitem", label: "Poteslot", desc: "+1 stadio per 5 ondate", icon: "protein",
      target: "run", dyn: "stat", apply: (p, pk) => { game.tempBoost[pk.stat] = 5; } },
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
    { tier: "GREAT", weight: 3, id: "maxpotion", label: "Pozione Max", desc: "PS pieni", icon: "max_potion",
      target: "mon", valid: canHeal, avail: someone(canHeal), apply: p => { p.hp = p.maxHp; } },
    { tier: "GREAT", weight: 3, id: "fullrestore", label: "Cura Totale", desc: "PS pieni e cura lo stato", icon: "full_restore",
      target: "mon", valid: p => canHeal(p) || hasStatus(p), avail: someone(p => canHeal(p) || hasStatus(p)),
      apply: p => { p.hp = p.maxHp; p.status = null; } },
    { tier: "GREAT", weight: 3, id: "fullheal", label: "Antistato", desc: "cura lo stato", icon: "full_heal",
      target: "mon", valid: hasStatus, avail: someone(hasStatus), apply: p => { p.status = null; } },
    { tier: "GREAT", weight: 3, id: "revive", label: "Revitalizzante", desc: "rianima al 50%", icon: "revive",
      target: "mon", valid: isDown, avail: someone(isDown), apply: p => { p.fainted = false; p.hp = Math.floor(p.maxHp / 2); } },
    { tier: "GREAT", weight: 2, id: "maxrevive", label: "Revitalizz. Max", desc: "rianima a PS pieni", icon: "max_revive",
      target: "mon", valid: isDown, avail: someone(isDown), apply: p => { p.fainted = false; p.hp = p.maxHp; } },
    { tier: "GREAT", weight: 1, id: "sacredash", label: "Cenere Magica", desc: "rianima TUTTA la squadra", icon: "sacred_ash",
      target: "party", avail: someone(isDown), apply: () => { for (const q of game.party) if (q.fainted) { q.fainted = false; q.hp = q.maxHp; } } },
    { tier: "GREAT", weight: 3, id: "elisir", label: "Elisir", desc: "+10 PP a tutte le mosse", icon: "elixir",
      target: "mon", valid: needsPp, avail: someone(needsPp), apply: p => restorePp(p, 99, 10) },
    { tier: "GREAT", weight: 3, id: "maxelisir", label: "Elisir Max", desc: "PP pieni a tutte le mosse", icon: "max_elixir",
      target: "mon", valid: needsPp, avail: someone(needsPp), apply: p => restorePp(p, 99, -1) },
    { tier: "GREAT", weight: 2, id: "ppup", label: "PP-Su", desc: "alza i PP massimi di una mossa", icon: "pp_up",
      target: "mon", valid: canPpUp, avail: someone(canPpUp), apply: p => applyPpUp(p, 1) },
    { tier: "GREAT", weight: 3, id: "vit", label: "Vitamina", desc: "+10% a una statistica base", icon: "protein",
      target: "mon", valid: alive, dyn: "stat", apply: (p, pk) => { p.vits[pk.stat] = (p.vits[pk.stat] || 0) + 1; recomputeStats(p); } },
    { tier: "GREAT", weight: 5, id: "nugget", label: "Pepita", desc: "vale dei soldi", icon: "nugget",
      target: "run", apply: () => { game.money += waveMoney(1); } },
    { tier: "GREAT", weight: 4, id: "direhit", label: "Supercolpo", desc: "+1 brutto colpo per 5 ondate", icon: "scope_lens",
      target: "run", apply: () => { game.tempBoost.crit = 5; } },
    { tier: "GREAT", weight: 4, id: "stone", label: "Pietra Evolutiva", desc: "fa evolvere chi può usarla", icon: "fire_stone",
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
    { tier: "GREAT", weight: 3, id: "mushroom", label: "Fungorico", desc: "fa ricordare una mossa dimenticata", icon: "max_mushrooms",
      target: "mon", valid: p => mosseDimenticate(p).length > 0, avail: someone(p => mosseDimenticate(p).length > 0),
      apply: p => { const mv = rndOf(mosseDimenticate(p)); insegnaTm(mv, p); } },

    /* ===================== ULTRA ====================== */
    { tier: "ULTRA", weight: 6, id: "ultraballs", label: "Ultra Ball ×5", desc: "cattura ×2", icon: "ub", ball: true,
      target: "run", apply: () => { game.ultraballs += 5; } },
    { tier: "ULTRA", weight: 9, id: "typeboost", label: "Boost di Tipo", desc: "held: +20% a un tipo", icon: "charcoal",
      target: "mon", valid: alive, dyn: "type",
      apply: (p, pk) => { p.held.typeboost = p.held.typeboost || {}; p.held.typeboost[pk.type] = (p.held.typeboost[pk.type] || 0) + 1; } },
    { tier: "ULTRA", weight: 12, id: "bignugget", label: "Pepitona", desc: "vale molti soldi", icon: "big_nugget",
      target: "run", apply: () => { game.money += waveMoney(2.5); } },
    { tier: "ULTRA", weight: 3, id: "ppmax", label: "PP-Max", desc: "PP massimi al massimo", icon: "pp_max",
      target: "mon", valid: canPpUp, avail: someone(canPpUp), apply: p => applyPpUp(p, 3) },
    { tier: "ULTRA", weight: 4, id: "rarercandy", label: "Caramellone", desc: "+1 livello a TUTTA la squadra", icon: "rarer_candy",
      target: "party", apply: () => { for (const q of game.party) addLevels(q, 1); } },
    { tier: "ULTRA", weight: 4, id: "reviverseed", label: "Seme Rinascita", desc: "held: rianima una volta al 50%", icon: "reviver_seed",
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
    { tier: "ULTRA", weight: 5, id: "candyjar", label: "Caramelliera", desc: "+1 livello per ogni caramella", icon: "candy_jar",
      target: "run", apply: () => { game.charms.candyJar = (game.charms.candyJar || 0) + 1; } },
    { tier: "ULTRA", weight: 8, id: "expcharm", label: "Espamuleto", desc: "+25% esperienza", icon: "exp_charm",
      target: "run", apply: () => { game.charms.exp = (game.charms.exp || 0) + 25; } },
    { tier: "ULTRA", weight: 3, id: "amulet", label: "Monetamuleto", desc: "+20% soldi", icon: "amulet_coin",
      target: "run", apply: () => { game.charms.amulet = (game.charms.amulet || 0) + 1; } },
    { tier: "ULTRA", weight: 2, id: "goldenpunch", label: "Pugno d'Oro", desc: "il danno inflitto frutta soldi", icon: "golden_punch",
      target: "run", apply: () => { game.charms.goldenPunch = (game.charms.goldenPunch || 0) + 1; } },
    { tier: "ULTRA", weight: 4, id: "ivscanner", label: "Scanner IV", desc: "mostra gli IV degli avversari", icon: "iv_scanner",
      target: "run", avail: () => !game.charms.ivScanner, apply: () => { game.charms.ivScanner = 1; } },
    { tier: "ULTRA", weight: 4, id: "rarestone", label: "Pietra Rara", desc: "una pietra evolutiva rara", icon: "sun_stone",
      target: "run", dyn: "stone", avail: () => usefulStones().length > 0, apply: (p, pk) => { game.stones[pk.stone] = (game.stones[pk.stone] || 0) + 1; } },
    { tier: "ULTRA", weight: 11, id: "tmultra", label: "MT", desc: "insegna una mossa forte", icon: "tm_normal",
      target: "run", dyn: "tm", tmTier: "ULTRA", avail: () => !!randomTm("ULTRA"),
      apply: (p, pk) => insegnaTm(pk.tm) },
    { tier: "ULTRA", weight: 4, id: "mint", label: "Menta", desc: "cambia la natura di un Pokémon", icon: "mint",
      target: "mon", valid: alive, dyn: "nature",
      apply: (p, pk) => { p.nature = pk.nature; recomputeStats(p); } },

    /* ===================== ROGUE ====================== */
    { tier: "ROGUE", weight: 6, id: "rogueballs", label: "Rogue Ball ×5", desc: "cattura ×3", icon: "rb", ball: true,
      target: "run", apply: () => { game.rogueballs = (game.rogueballs || 0) + 5; } },
    { tier: "ROGUE", weight: 3, id: "leftovers", label: "Avanzi", desc: "held: rigenera 1/16 a fine turno", icon: "leftovers",
      target: "mon", valid: alive, apply: p => addHeld(p, "leftovers") },
    { tier: "ROGUE", weight: 3, id: "shellbell", label: "Conchiglia", desc: "held: recuperi 1/8 del danno", icon: "shell_bell",
      target: "mon", valid: alive, apply: p => addHeld(p, "shellbell") },
    { tier: "ROGUE", weight: 5, id: "focusband", label: "Bandana", desc: "held: 10% di resistere con 1 PS", icon: "focus_band",
      target: "mon", valid: alive, apply: p => addHeld(p, "focusband") },
    { tier: "ROGUE", weight: 3, id: "kingsrock", label: "Roccia di Re", desc: "held: 10% di far tentennare", icon: "kings_rock",
      target: "mon", valid: alive, apply: p => addHeld(p, "kingsrock") },
    { tier: "ROGUE", weight: 4, id: "scopelens", label: "Mirino", desc: "held: +1 stadio di brutto colpo", icon: "scope_lens",
      target: "mon", valid: alive, apply: p => addHeld(p, "scopelens") },
    { tier: "ROGUE", weight: 7, id: "souldew", label: "Rugiadanima", desc: "held: rinforza l'effetto della natura", icon: "soul_dew",
      target: "mon", valid: p => alive(p) && NATURES[p.nature] && NATURES[p.nature].su,
      apply: p => addHeld(p, "souldew") },
    { tier: "ULTRA", weight: 3, id: "mysticalrock", label: "Rocciamistica", desc: "held: il meteo dura più a lungo", icon: "mystical_rock",
      target: "mon", valid: alive, apply: p => addHeld(p, "mysticalrock") },
    { tier: "ULTRA", weight: 3, id: "leek", label: "Porro", desc: "held: brutto colpo quasi garantito", icon: "leek",
      target: "mon", valid: p => alive(p) && ["FARFETCHD", "SIRFETCHD"].includes(p.speciesId),
      avail: () => aliveParty().some(p => ["FARFETCHD", "SIRFETCHD"].includes(p.speciesId)),
      apply: p => addHeld(p, "leek") },
    { tier: "ROGUE", weight: 4, id: "berrypouch", label: "Bacchiporta", desc: "30% di non consumare le bacche", icon: "berry_pouch",
      target: "run", apply: () => { game.charms.berryPouch = (game.charms.berryPouch || 0) + 1; } },
    { tier: "ROGUE", weight: 2, id: "relicgold", label: "Riccantico", desc: "vale moltissimi soldi", icon: "relic_gold",
      target: "run", apply: () => { game.money += waveMoney(10); } },
    { tier: "ROGUE", weight: 8, id: "superexpcharm", label: "Superespamuleto", desc: "+60% esperienza", icon: "super_exp_charm",
      target: "run", apply: () => { game.charms.exp = (game.charms.exp || 0) + 60; } },
    { tier: "ROGUE", weight: 4, id: "catchingcharm", label: "Presamuleto", desc: "più catture critiche", icon: "catching_charm",
      target: "run", apply: () => { game.charms.catching = (game.charms.catching || 0) + 1; } },
    { tier: "ROGUE", weight: 6, id: "abilitycharm", label: "Abilamuleto", desc: "i selvatici hanno l'abilità nascosta", icon: "ability_charm",
      target: "run", apply: () => { game.charms.ability = (game.charms.ability || 0) + 1; } },
    { tier: "ROGUE", weight: 3, id: "megaRing", label: "Megacerchio", desc: "sblocca la megaevoluzione", icon: "mega_bracelet",
      target: "run", avail: () => !game.hasMegaRing, apply: () => { game.hasMegaRing = true; } },
    { tier: "ROGUE", weight: 3, id: "dynamaxBand", label: "Fascia Dynamax", desc: "sblocca la gigamaxizzazione", icon: "dynamax_band",
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
    { tier: "MASTER", weight: 10, id: "blackhole", label: "Buconero", desc: "held: ruba un oggetto ogni turno", icon: "mini_black_hole",
      target: "mon", valid: alive, apply: p => addHeld(p, "blackhole") },
    { tier: "MASTER", weight: 4, id: "voucherpremium", label: "Buono Uovo Premium", desc: "+10 tiri al gacha", icon: "coupon",
      target: "run", apply: () => { meta.vouchers += 10; saveMeta(); } },

    /* ============ bottino esclusivo dei team cattivi ============ */
    // Non entra nell'estrazione (weight 0): lo si ottiene solo battendoli.
    { tier: "ROGUE", weight: 0, id: "theft", label: "Theft Ball", desc: "ruba un Pokémon a un allenatore", icon: "tb", ball: true,
      target: "run", apply: (p, pk) => { game.theftballs = (game.theftballs || 0) + (pk.qty || 1); } },
  ];
  // Probabilita' del TIER (poi si pesca l'oggetto dentro al tier, coi pesi sopra)
  const TIER_W = { COMMON: 50, GREAT: 34, ULTRA: 13, ROGUE: 3, MASTER: 0.5 };
  // FORTUNA (come PokeRogue): ogni membro della squadra la cui specie e' shiny
  // sbloccata da +1; la fortuna sposta i pesi verso i tier alti.
  function runLuck() {
    let l = 0;
    for (const p of game.party) if (meta.unlocked[p.speciesId] === 2) l++;
    return Math.min(9, l);
  }
  function luckedTierWeights() {
    const L = runLuck();
    if (!L) return TIER_W;
    return { COMMON: Math.max(10, TIER_W.COMMON - L * 4), GREAT: TIER_W.GREAT,
             ULTRA: TIER_W.ULTRA + L * 2.5, ROGUE: TIER_W.ROGUE + L * 1.5,
             MASTER: TIER_W.MASTER + L * 0.3 };
  }
  const TIER_COL = { COMMON: "#7f8ba0", GREAT: "#3a7bd0", ULTRA: "#d0a53a", ROGUE: "#8a4ad0", MASTER: "#c0452a" };

  /* Bacche: si tengono e si attivano DA SOLE in lotta (come nell'originale). */
  const BERRY_DATA = {
    SITRUS: { it: "Baccharanc", icon: "sitrus_berry", desc: "cura il 25% sotto meta' PS" },
    LUM:    { it: "Baccalum",   icon: "lum_berry",    desc: "cura qualsiasi stato" },
    LEPPA:  { it: "Baccamela",  icon: "leppa_berry",  desc: "+10 PP a una mossa esaurita" },
    ENIGMA: { it: "Baccanigma", icon: "enigma_berry", desc: "cura il 25% se colpito superefficace" },
    LIECHI: { it: "Baccalici",  icon: "liechi_berry", desc: "+1 Attacco sotto un quarto di PS" },
    GANLON: { it: "Baccalgan",  icon: "ganlon_berry", desc: "+1 Difesa sotto un quarto di PS" },
    PETAYA: { it: "Baccataya",  icon: "petaya_berry", desc: "+1 Att. Sp. sotto un quarto di PS" },
    APICOT: { it: "Baccapico",  icon: "apicot_berry", desc: "+1 Dif. Sp. sotto un quarto di PS" },
    SALAC:  { it: "Baccalac",   icon: "salac_berry",  desc: "+1 Velocita' sotto un quarto di PS" },
    LANSAT: { it: "Baccalansa", icon: "lansat_berry", desc: "+2 brutto colpo sotto un quarto di PS" },
    STARF:  { it: "Baccastella",icon: "starf_berry",  desc: "+2 a una stat a caso sotto un quarto" },
  };
  const BERRY_KEYS = Object.keys(BERRY_DATA);

  /* -- Icone reali di PokeRogue per oggetti/ball/vitamine/boost ------------ */
  const itemIcon = n => `assets/ui/items/${n}.png`;
  const ballIcon = n => `assets/ui/pokeball/${n}.png`;
  const VIT_ICON = { hp: "hp_up", atk: "protein", def: "iron", spatk: "calcium", spdef: "zinc", spd: "carbos" };
  const TYPEBOOST_ICON = { NORMAL: "silk_scarf", FIRE: "charcoal", WATER: "mystic_water", GRASS: "miracle_seed", ELECTRIC: "magnet", PSYCHIC: "twisted_spoon", FIGHTING: "black_belt", FLYING: "sharp_beak", POISON: "poison_barb", GROUND: "soft_sand", ROCK: "hard_stone", GHOST: "spell_tag", DRAGON: "dragon_fang", DARK: "black_glasses", STEEL: "metal_coat", ICE: "never_melt_ice", BUG: "silver_powder", FAIRY: "fairy_feather" };
  // Icona di una scelta premio. Le scelte "dinamiche" (vitamina, boost di tipo,
  // pietra, bacca) hanno l'icona del pezzo effettivamente estratto.
  function rewardIconSrc(pk) {
    const it = pk.item;
    if (pk.stat && it.id === "vit") return itemIcon(VIT_ICON[pk.stat] || "hp_up");
    if (pk.stat && it.id === "xitem") return itemIcon(VIT_ICON[pk.stat] || "hp_up");
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
      pick.label = item.id === "vit" ? VIT_NOME[pick.stat] : `Poteslot ${VIT_IT[pick.stat]}`;
    } else if (item.dyn === "type") {
      // un tipo fra quelli che la squadra usa davvero, come fa l'originale
      const tipi = [...new Set(game.party.flatMap(p => p.types))];
      pick.type = rnd(tipi.length ? tipi : ["NORMAL"]);
      pick.label = `Boost ${T[pick.type].it}`;
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
  function rollReward(excludeIds) {
    for (let tries = 0; tries < 40; tries++) {
      const W = luckedTierWeights();
      const tot = Object.values(W).reduce((a, b) => a + b, 0);
      let r = Math.random() * tot, tier = "COMMON";
      for (const k in W) { r -= W[k]; if (r <= 0) { tier = k; break; } }
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
    [{ id: "elisir", mult: 1 }, { id: "maxether", mult: 1 }],
    [{ id: "hyperpotion", mult: 0.8 }, { id: "maxrevive", mult: 2.75 }],
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
            <span class="pd-name">${miniIcon(p.dex, 1.1)}${p.shiny ? "✨" : ""}${p.name.replace("✨", "")}<span class="gen g-${p.gender}">${genderSymbol(p)}</span>${st}</span>
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
  function grantItem(pick, done, back) {
    const item = pick.item;
    if (item.target === "mon") chooseTarget(pick, p => { item.apply(p, pick); done(); }, back);
    else { item.apply(game.player, pick); done(); }
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
      // bottino dei team cattivi: Theft Ball garantite, in quantità
      if (game.pendingTheft) {
        const it = REWARD_POOL.find(r => r.id === "theft");
        picks.push({ item: it, label: `Theft Ball ×${game.pendingTheft}`, qty: game.pendingTheft });
      }
      // una cura garantita, ma SOLO se c'e' davvero qualcuno da curare
      const heals = REWARD_POOL.filter(r => r.avail && r.avail() &&
        ["potion", "superpotion", "hyperpotion", "maxpotion", "fullrestore", "fullheal", "revive"].includes(r.id));
      if (heals.length) {
        const g = heals[Math.floor(Math.random() * heals.length)];
        picks.push(fillPick(g));
      }
      while (picks.length < 3) picks.push(rollReward(picks.map(x => x.item.id)));
    }
    // costo del rimescolo come l'originale: ceil(ondata/10) x 250, raddoppia a ogni uso
    const rerollCost = Math.ceil(game.wave / 10) * 250 * Math.pow(2, rerollCount);
    const cards = picks.map((pk, i) =>
      `<button class="shop-card" data-i="${i}" style="background:${TIER_COL[pk.item.tier] || TIER_COL.COMMON};">
        <img class="item-icon" src="${rewardIconSrc(pk)}" alt="">
        <span class="rn">${pk.label}</span><span class="rd">${pk.desc || pk.item.desc}</span></button>`).join("");
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
        <div class="meta-sub">Scegli un premio</div>
        <div class="shop-cards">${cards}
          <button class="shop-card" data-act="reroll" style="background:#3a4250;" ${game.money < rerollCost ? "disabled" : ""}>
            <span class="rn">🎲 Rimescola</span><span class="rd">₽${rerollCost}</span></button>
        </div>
        ${shopBlock}
      </div>`);
    metaEl().querySelector('[data-act="team"]').onclick = () => showPartyOverlay(() => showReward(picks));
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
        () => { game.money -= g.price; game.pendingLearns = []; renderScene(); showReward(picks); },
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
          <div class="pd-top"><span class="pd-name">${miniIcon(p.dex, 1.1)}${p.shiny ? "✨" : ""}${p.name.replace("✨", "")}<span class="gen g-${p.gender}">${genderSymbol(p)}</span>${st}</span><span class="pd-lv">Lv.${p.level}</span></div>
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
    leftovers: "Avanzi", shellbell: "Conchiglia", focusband: "Bandana",
    quickclaw: "Rapidartigli", kingsrock: "Roccia di Re", scopelens: "Mirino",
    widelens: "Grandelente", multilens: "Multilente", eviolite: "Evolcondensa",
    reviverseed: "Seme Rinascita", toxicorb: "Tossicsfera", flameorb: "Fiammosfera",
    souldew: "Rugiadanima", leek: "Porro",
    gripclaw: "Presartigli", blackhole: "Buconero", mysticalrock: "Rocciamistica",
    lightball: "Sferapalla", thickclub: "Ossoduro", metalpowder: "Metalpolvere",
    quickpowder: "Velocipolvere", deepseascale: "Squamabissi", deepseatooth: "Dentebissi",
  };
  // Nome leggibile di un oggetto tenuto (i Boost di Tipo non hanno voce fissa)
  const nomeHeld = k => k === "typeboost" ? "un Boost di Tipo" : (HELD_IT[k] || k);
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
    const team = game.party.map(p => `${p.shiny ? "✨" : ""}${p.name} Lv.${p.level}`).join(" · ");
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

  /* ====================================================================== */
  /*  PREMIO GIF (easter egg) — §25                                         */
  /*                                                                        */
  /*  Tre tocchi di fila sul titolo della Home aprono il selettore di file   */
  /*  del telefono: si sceglie uno ZIP pieno di GIF. Lo zip viene scompattato*/
  /*  in sottofondo (unica traccia visibile: la barra sul bordo basso della  */
  /*  scena) e da quel momento ogni ALLENATORE sconfitto fa comparire una    */
  /*  GIF a schermo intero, per tanti secondi quanta e' l'ondata.            */
  /*                                                                        */
  /*  ⚠️ Il selettore di file era vietato dalle regole storiche del          */
  /*  proprietario: e' stato lui a chiederlo esplicitamente per questa       */
  /*  funzione. Non "correggerlo" per fedelta' al vecchio documento.         */
  /*                                                                        */
  /*  Niente librerie: lo zip si legge a mano (sotto) e i dati compressi si  */
  /*  espandono con DecompressionStream, che il browser ha gia'.             */
  /* ====================================================================== */

  // Estensioni accettate dentro lo zip. Le GIF sono il caso previsto, ma
  // WebP/APNG animate si comportano allo stesso modo dentro un <img>.
  const GIF_EXT = /\.(gif|webp|apng|png|jpe?g)$/i;
  const GIF_MIME = { gif: "image/gif", webp: "image/webp", apng: "image/apng",
                     png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

  const gifs = {
    lista: [],          // { nome, url } gia' pronte all'uso
    usate: new Set(),   // nomi gia' mostrati: non si ripetono finche' ce n'e' altre
    caricando: false,
  };

  const gifBarra = () => document.getElementById("gif-load");

  /* Avanzamento: `fatte` su `totale`. A fine corsa la barra sparisce da sola. */
  function gifProgresso(fatte, totale) {
    const b = gifBarra(); if (!b) return;
    b.hidden = false;
    b.classList.remove("errore");
    b.querySelector("i").style.width = (totale ? (fatte / totale) * 100 : 0) + "%";
    if (fatte >= totale) setTimeout(() => { b.hidden = true; }, 900);
  }
  /* L'unico modo di segnalare un guaio senza scrivere messaggi: barra rossa. */
  function gifErrore(perche) {
    console.warn("[gif]", perche);
    const b = gifBarra(); if (!b) return;
    b.hidden = false;
    b.classList.add("errore");
    setTimeout(() => { b.hidden = true; b.classList.remove("errore"); }, 2200);
  }

  /* ---- Lettura dello ZIP, a mano --------------------------------------
     Uno zip finisce con l'EOCD (End Of Central Directory), che dice dove sta
     l'indice delle voci. Si legge solo la CODA del file: cosi' uno zip da
     centinaia di MB non viene mai caricato tutto in memoria. */
  async function zipIndice(file) {
    const codaLen = Math.min(file.size, 66000);   // 22 byte + commento (max 65535)
    const coda = new DataView(await file.slice(file.size - codaLen).arrayBuffer());
    let eocd = -1;
    for (let i = coda.byteLength - 22; i >= 0; i--) {
      if (coda.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("non sembra un file zip");
    const n = coda.getUint16(eocd + 10, true);
    const cdLen = coda.getUint32(eocd + 12, true);
    const cdOff = coda.getUint32(eocd + 16, true);
    if (n === 0xffff || cdOff === 0xffffffff) throw new Error("zip64 non supportato");

    const cd = new DataView(await file.slice(cdOff, cdOff + cdLen).arrayBuffer());
    const nomi = new TextDecoder();
    const voci = [];
    let p = 0;
    for (let i = 0; i < n && p + 46 <= cd.byteLength; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;      // indice rovinato
      const nomeLen  = cd.getUint16(p + 28, true);
      const extraLen = cd.getUint16(p + 30, true);
      const commLen  = cd.getUint16(p + 32, true);
      const voce = {
        metodo:    cd.getUint16(p + 10, true),
        compressa: cd.getUint32(p + 20, true),
        off:       cd.getUint32(p + 42, true),
        nome: nomi.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nomeLen)),
      };
      p += 46 + nomeLen + extraLen + commLen;
      // fuori: cartelle, roba di sistema di macOS, file che non sono immagini
      if (voce.nome.endsWith("/") || voce.nome.startsWith("__MACOSX/")) continue;
      if (voce.nome.split("/").pop().startsWith(".")) continue;
      if (!GIF_EXT.test(voce.nome)) continue;
      voci.push(voce);
    }
    return voci;
  }

  /* Tira fuori UNA voce come Blob pronto per un <img>.
     ⚠️ Le lunghezze di nome/extra vanno rilette dall'header LOCALE: nell'indice
     centrale possono essere diverse, e sbagliarle significa partire in mezzo ai
     dati. */
  async function zipEstrai(file, voce) {
    const testa = new DataView(await file.slice(voce.off, voce.off + 30).arrayBuffer());
    if (testa.getUint32(0, true) !== 0x04034b50) throw new Error("voce rovinata: " + voce.nome);
    const dati = voce.off + 30 + testa.getUint16(26, true) + testa.getUint16(28, true);
    const pezzo = file.slice(dati, dati + voce.compressa);
    const ext = voce.nome.split(".").pop().toLowerCase();
    const mime = GIF_MIME[ext] || "application/octet-stream";
    // metodo 0 = archiviato senza comprimere, 8 = deflate (il caso normale)
    if (voce.metodo === 0) return pezzo.slice(0, pezzo.size, mime);
    if (voce.metodo !== 8) throw new Error("compressione non gestita: " + voce.metodo);
    const flusso = pezzo.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const espanso = await new Response(flusso).blob();
    // ⚠️ `slice` con il terzo argomento cambia solo il tipo, non ricopia i dati:
    // senza un MIME esplicito il blob: url non viene disegnato dall'<img>.
    return espanso.slice(0, espanso.size, mime);
  }

  /* Scompatta lo zip UNA VOCE ALLA VOLTA lasciando respirare il gioco fra una
     e l'altra: si continua a giocare mentre carica, ed e' gia' possibile
     vincere una GIF fra quelle arrivate finora. */
  async function gifCaricaZip(file) {
    if (gifs.caricando) return;
    gifs.caricando = true;
    try {
      if (typeof DecompressionStream === "undefined") throw new Error("browser senza DecompressionStream");
      const voci = await zipIndice(file);
      if (!voci.length) throw new Error("nessuna immagine nello zip");
      gifProgresso(0, voci.length);
      let fatte = 0;
      for (const voce of voci) {
        try {
          const blob = await zipEstrai(file, voce);
          gifs.lista.push({ nome: voce.nome, url: URL.createObjectURL(blob) });
        } catch (e) {
          console.warn("[gif] salto", voce.nome, e.message);   // una guasta non ferma le altre
        }
        gifProgresso(++fatte, voci.length);
        await new Promise(r => setTimeout(r, 0));
      }
      if (!gifs.lista.length) throw new Error("nessuna immagine leggibile");
    } catch (e) {
      gifErrore(e.message);
    } finally {
      gifs.caricando = false;
    }
  }

  const gifPronte = () => gifs.lista.length > 0;

  /* Pesca una GIF mai vista. Quando sono finite si ricomincia il giro: meglio
     una replica che nessun premio (una run lunga batte piu' allenatori di
     quante GIF ci siano nello zip). */
  function gifPesca() {
    let libere = gifs.lista.filter(g => !gifs.usate.has(g.nome));
    if (!libere.length) { gifs.usate.clear(); libere = gifs.lista.slice(); }
    const scelta = libere[Math.floor(Math.random() * libere.length)];
    gifs.usate.add(scelta.nome);
    return scelta;
  }

  /* Mostra la GIF a schermo intero per `secondi`, poi chiama `poi()`.
     La fase "GIF" blocca il resto: `advanceMessages` risponde solo a "MESSAGE",
     quindi nessun tocco puo' far proseguire la partita sotto l'overlay.
     Il tocco sulla GIF la chiude in anticipo: e' una via d'uscita, non un
     obbligo (all'ondata 190 durerebbe piu' di tre minuti). */
  function gifMostra(secondi, poi) {
    const el = document.getElementById("gif-prize");
    const scelta = gifPesca();
    const fasePrima = game.phase;
    game.phase = "GIF";
    el.innerHTML = `<img src="${scelta.url}" alt="">`;
    el.hidden = false;
    let chiuso = false;
    const chiudi = () => {
      if (chiuso) return;
      chiuso = true;
      clearTimeout(timer);
      el.onclick = null;
      el.hidden = true;
      el.innerHTML = "";              // libera il decoder della GIF
      game.phase = fasePrima;
      if (poi) poi();
    };
    const timer = setTimeout(chiudi, Math.max(1, secondi) * 1000);
    el.onclick = chiudi;
    return scelta.nome;
  }

  /* Tre tocchi entro 700 ms sul titolo della Home = apri il selettore. */
  let gifTocchi = 0, gifTocchiTimer = null;
  function gifTocco() {
    clearTimeout(gifTocchiTimer);
    gifTocchiTimer = setTimeout(() => { gifTocchi = 0; }, 700);
    if (++gifTocchi < 3) return;
    gifTocchi = 0;
    const inp = document.getElementById("gif-zip");
    inp.value = "";                  // stesso file due volte di fila: serve
    inp.click();
  }

  /* hook di debug: il selettore di file non si puo' guidare da uno script, e
     senza questo la funzione sarebbe impossibile da provare in automatico.
       __gif.stato()        quante ne sono pronte, quante gia' usate
       __gif.zip("ZZ.zip")  carica uno zip servito dal server, come se l'avessi scelto
       __gif.prova(3)       mostra subito una GIF per 3 secondi
       __gif.apri()         apre il selettore (come il triplo tocco) */
  window.__gif = {
    stato: () => ({ pronte: gifs.lista.length, usate: gifs.usate.size,
                    caricando: gifs.caricando, nomi: gifs.lista.map(g => g.nome) }),
    zip: (url) => fetch(url).then(r => r.blob()).then(gifCaricaZip),
    prova: (sec) => gifMostra(sec || 3, () => {}),
    apri: () => document.getElementById("gif-zip").click(),
    pesca: () => gifPesca().nome,
  };

  /* ---------------------------------------------------------------------- */
  /*  AVVIO — carica i dati reali, poi comincia                             */
  /* ---------------------------------------------------------------------- */
  const DATA_V = 20;   // versione dei dati: alzala a ogni rigenerazione
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
      // indice delle animazioni: solo l'elenco, i frame arrivano su richiesta
      loadJson("anims-index").catch(() => null),
    ]).then(([types, moves, species, learnsets, chart, abilities, biomes, forms, icons, variants, tmdata, eggmoves, dialoghi, anims]) => {
      T = types; M = moves; S = species; LEARN = learnsets; CHART = chart; ABIL = abilities; BIOMES = biomes; FORMS = forms; ICONS = icons; VARIANTS = variants;
      TMS = tmdata; EGGM = eggmoves; DIAL = dialoghi || {}; ANIMS = anims;
      /* Il tipo ASTRALE non esiste in types.json (i tipi veri sono 18):
         lo si aggiunge a mano perche' Terapagos Stellare e l'Arceus Perfetto
         ce l'hanno, e ogni schermata che stampa un tipo fa `T[tipo].it`. */
      T[ASTRALE] = { it: "Astrale", color: "#dcd2ff" };
      // solo le specie con sprite disponibile (esclude le forme regionali senza asset)
      SPECIES_KEYS = Object.keys(species).filter(k => !species[k].noSprite);
      loadMeta();
      // easter egg delle GIF: lo zip scelto parte subito a scompattarsi (§25)
      document.getElementById("gif-zip").addEventListener("change", (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (file) gifCaricaZip(file);
      });
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
