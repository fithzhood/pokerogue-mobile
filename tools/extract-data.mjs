/* ============================================================================
   extract-data.mjs — FASE 1: estrazione dati da ../PokeRogue in JSON
   ----------------------------------------------------------------------------
   Parsing TESTUALE (i dati sorgente sono regolari): niente import dei moduli TS.
   Sorgenti (relative a questo file, cartella tools/):
     ../../PokeRogue/src/data/balance/species/generation-01.ts   (151 specie + learnset)
     ../../PokeRogue/src/data/moves/move.ts                        (953 mosse, params)
     ../../PokeRogue/locales/it/pokemon.json | move.json | ability.json  (nomi IT)
   Output (in ../data/):
     species.json  moves.json  learnsets.json  abilities.json  typechart.json  types.json
   Uso:  node tools/extract-data.mjs
   ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = resolve(__dirname, "..");
const PR = resolve(APP, "..", "PokeRogue");
const OUT = resolve(APP, "data");
mkdirSync(OUT, { recursive: true });

const read = p => readFileSync(p, "utf8");
const readJson = p => JSON.parse(read(p));

/* UPPER_SNAKE (enum) -> camelCase (chiave dei locales). Es. KARATE_CHOP -> karateChop */
const toCamel = s => s.toLowerCase().split("_")
  .map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join("");
/* Fallback leggibile se manca la traduzione: KARATE_CHOP -> "Karate Chop" */
const pretty = s => s.toLowerCase().split("_")
  .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/* -- Locales italiani -------------------------------------------------------- */
const locPokemon  = readJson(resolve(PR, "locales/it/pokemon.json"));   // key -> "Nome"
const locMove     = readJson(resolve(PR, "locales/it/move.json"));      // key -> {name,effect}
const locAbility  = readJson(resolve(PR, "locales/it/ability.json"));   // key -> {name,description}

const itPokemon = id => locPokemon[toCamel(id)] || pretty(id);
const itMove    = id => (locMove[toCamel(id)] || {}).name || pretty(id);
const itMoveEff = id => (locMove[toCamel(id)] || {}).effect || "";
const itAbility = id => (locAbility[toCamel(id)] || {}).name || pretty(id);
const itAbilEff = id => (locAbility[toCamel(id)] || {}).description || "";

/* ========================================================================== */
/*  MOSSE — da initMoves() in move.ts                                          */
/* ========================================================================== */
/* Restituisce il contenuto tra la prima '(' dopo `from` e la sua ')' bilanciata. */
function balancedParen(str, from) {
  const open = str.indexOf("(", from);
  if (open < 0) return "";
  let depth = 0, i = open;
  for (; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")" && --depth === 0) break;
  }
  return str.slice(open + 1, i);
}
/* Come sopra ma per una parentesi qualsiasi: serve per leggere `forms: [ ... ]`. */
function balancedBracket(str, from, open, close) {
  const o = str.indexOf(open, from);
  if (o < 0) return "";
  let depth = 0, i = o;
  for (; i < str.length; i++) {
    if (str[i] === open) depth++;
    else if (str[i] === close && --depth === 0) break;
  }
  return str.slice(o + 1, i);
}
/* Divide su virgole di primo livello (rispetta (), [], {}). */
function splitTop(str) {
  const out = []; let depth = 0, last = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) { out.push(str.slice(last, i).trim()); last = i + 1; }
  }
  if (last < str.length) out.push(str.slice(last).trim());
  return out.filter(s => s.length);
}

/* Traduce un attributo di PokeRogue in un "mattoncino" normalizzato del nostro
   motore. Gli attributi non riconosciuti tornano null (ignorati: la mossa fa
   comunque il suo danno base). */
function normalizeAttr(name, a) {
  const S = (x, p) => (x || "").replace(p, "");
  switch (name) {
    case "StatusEffectAttr":     return { kind: "status", status: S(a[0], "StatusEffect.") };
    case "StatStageChangeAttr": {
      const stats = (a[0].match(/Stat\.(\w+)/g) || []).map(s => s.replace("Stat.", ""));
      const stages = Number(a[1]);
      if (!stats.length || !Number.isFinite(stages)) return null;
      return { kind: "statStage", stats, stages, self: a[2] === "true" };
    }
    case "FlinchAttr":           return { kind: "flinch" };
    case "MultiHitAttr":         return { kind: "multiHit", mode: a[0] ? S(a[0], "MultiHitType.") : "_2_TO_5" };
    case "HighCritAttr":         return { kind: "highCrit" };
    case "CritOnlyAttr":         return { kind: "critOnly" };
    case "RecoilAttr":           return { kind: "recoil", ratio: num(a[1]) != null ? num(a[1]) : 0.25 };
    case "HitHealAttr":          return { kind: "drain", ratio: num(a[0]) != null ? num(a[0]) : 0.5 };
    case "HealAttr":             return { kind: "heal", ratio: num(a[0]) != null ? num(a[0]) : 0.5 };
    case "ConfuseAttr":          return { kind: "confuse" };
    case "OneHitKOAttr":         return { kind: "ohko" };
    // --- effetti VOLATILI (protezione, prese, semi, ricarica) --------------
    case "ProtectAttr":          return { kind: "protect", endure: /ENDURING/.test(a[0] || "") };
    case "TrapAttr":             return { kind: "trap", tag: S(a[0], "BattlerTagType.") };
    case "LeechSeedAttr":        return { kind: "leechseed" };
    case "RechargeAttr":         return { kind: "recharge" };
    case "AddBattlerTagAttr": {
      // fra le decine di tag ci interessano quelli che sappiamo gestire.
      // `a[1] === "true"` significa che il tag va su CHI USA la mossa.
      const tag = S(a[0], "BattlerTagType.");
      const self = a[1] === "true";
      switch (tag) {
        case "PERISH_SONG": return { kind: "perish" };
        case "SEEDED":      return { kind: "leechseed" };
        case "TRAPPED":     return { kind: "trap", tag: "TRAPPED" };
        case "INFATUATED":  return { kind: "infatuate" };
        case "ENCORE":      return { kind: "encore" };
        case "TAUNT":       return { kind: "taunt" };
        case "TORMENT":     return { kind: "torment" };
        case "DROWSY":      return { kind: "drowsy" };
        case "NIGHTMARE":   return { kind: "nightmare" };
        case "INGRAIN":     return { kind: "ingrain", self };
        case "AQUA_RING":   return { kind: "aquaring", self };
        case "SALT_CURED":  return { kind: "saltcure" };
        case "CURSED":      return { kind: "curse" };
        default: return null;
      }
    }
    case "TerrainChangeAttr": return { kind: "terrain", terrain: S(a[0], "TerrainType.") };
    default:                     return null;
  }
}

function extractMoves() {
  const src = read(resolve(PR, "src/data/moves/move.ts"));
  const start = src.indexOf("export function initMoves()");
  const body = src.slice(start);

  // posizioni di ogni costruttore, per ricavare i "blocchi" (params + .attr chain)
  // ⚠️ `ChargingSelfStatusMove` la usa UNA sola mossa (Geomanzia) e senza di lei
  // mancava dalle 952: se ne accorge chi guarda le mosse da uovo di Amaura,
  // Diancie e Milcery, che ce l'hanno.
  const ctorRe = /new (AttackMove|StatusMove|SelfStatusMove|ChargingAttackMove|ChargingSelfStatusMove)\(/g;
  const hits = [];
  let m;
  while ((m = ctorRe.exec(body)) !== null) hits.push({ pos: m.index, cls: m[1] });

  const moves = {};
  for (let h = 0; h < hits.length; h++) {
    const chunk = body.slice(hits[h].pos, h + 1 < hits.length ? hits[h + 1].pos : hits[h].pos + 3000);
    const cls = hits[h].cls;
    const args = splitTop(balancedParen(chunk, 0));
    const id = args[0].replace("MoveId.", "");
    if (id === "NONE") continue;

    const type = args[1].replace("PokemonType.", "");
    let category, power, accuracy, pp, chance, priority, gen;
    if (cls === "AttackMove" || cls === "ChargingAttackMove") {
      // (id, type, category, power, accuracy, pp, chance, priority, gen)
      category = args[2].replace("MoveCategory.", "");
      power = num(args[3]); accuracy = num(args[4]); pp = num(args[5]);
      chance = num(args[6]); priority = num(args[7]); gen = num(args[8]);
    } else {
      // StatusMove / SelfStatusMove: (id, type, accuracy, pp, chance, priority, gen)
      category = "STATUS"; power = 0;
      accuracy = num(args[2]); pp = num(args[3]);
      chance = num(args[4]); priority = num(args[5]); gen = num(args[6]);
    }

    // "mattoncini": tutti i .attr(...) del blocco, normalizzati
    const attrs = [];
    const attrRe = /\.attr\(/g;
    let am;
    while ((am = attrRe.exec(chunk)) !== null) {
      const inner = balancedParen(chunk, am.index);
      const parts = splitTop(inner);
      const norm = normalizeAttr(parts[0], parts.slice(1));
      if (norm) attrs.push(norm);
    }

    moves[id] = {
      id, it: itMove(id), type, category,
      power, accuracy, pp,
      effectChance: chance,        // -1 = nessuno
      priority: priority || 0,
      charging: cls === "ChargingAttackMove" || cls === "ChargingSelfStatusMove",
      contact: category === "PHYSICAL",   // euristica: il fisico fa contatto
      gen,
      attrs,
      effect: itMoveEff(id),
    };
  }
  return moves;
}
function num(s) { const n = Number(s); return Number.isFinite(n) ? n : null; }

/* ========================================================================== */
/*  SPECIE + LEARNSET — da TUTTE le generazioni (01..09)                       */
/* ========================================================================== */

/* Mappa NOME_SPECIE -> numero dex, letta dall'enum (auto-incrementante). */
function readSpeciesDexMap() {
  const src = read(resolve(PR, "src/enums/species-id.ts"));
  const map = {};
  let next = 0;
  // righe tipo "BULBASAUR = 1," oppure "IVYSAUR," (auto-incremento)
  const re = /^\s*([A-Z][A-Z0-9_]*)\s*(?:=\s*(\d+))?\s*,/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const val = m[2] !== undefined ? Number(m[2]) : next;
    map[name] = val;
    next = val + 1;
  }
  return map;
}

const GEN_FILES = [
  ["generation-01.ts", "generationOne", 1], ["generation-02.ts", "generationTwo", 2],
  ["generation-03.ts", "generationThree", 3], ["generation-04.ts", "generationFour", 4],
  ["generation-05.ts", "generationFive", 5], ["generation-06.ts", "generationSix", 6],
  ["generation-07.ts", "generationSeven", 7], ["generation-08.ts", "generationEight", 8],
  ["generation-09.ts", "generationNine", 9],
];

function extractSpecies() {
  const dexMap = readSpeciesDexMap();
  const species = {};
  const learnsets = {};
  const tms = {};
  const abilityIds = new Set();

  for (const [file, varPrefix, genNum] of GEN_FILES) {
    const src = read(resolve(PR, "src/data/balance/species/" + file));
    const parts = src.split(new RegExp(varPrefix + "SpeciesData\\[SpeciesId\\.")).slice(1);
    extractGenParts(parts, genNum, dexMap, species, learnsets, abilityIds, tms);
  }
  return { species, learnsets, abilityIds, tms };
}

function extractGenParts(parts, genNum, dexMap, species, learnsets, abilityIds, tms) {
  for (const part of parts) {
    const id = part.slice(0, part.indexOf("]")).trim();
    // solo le ASSEGNAZIONI "...[SpeciesId.X] = {": i riferimenti (es. dentro le
    // tms di un'altra specie) vanno ignorati, altrimenti sovrascrivono i dati.
    if (!/^\w+\]\s*=\s*\{/.test(part)) continue;
    const dex = dexMap[id] != null ? dexMap[id] : 0;
    if (!dex) continue;               // scarta forme/varianti senza dex valido
    const field = (name) => {
      const mm = part.match(new RegExp(name + ":\\s*([^,\\n]+)"));
      return mm ? mm[1].trim() : null;
    };
    const enumVal = (name, prefix) => {
      const v = field(name);
      return v ? v.replace(prefix, "") : null;
    };
    // "vuoto" = assente, NONE, o il letterale null (i mono-tipo usano `type2: null`)
    const clean = v => (v && v !== "NONE" && v !== "null") ? v : null;

    const type1 = enumVal("type1", "PokemonType.");
    const type2 = clean(enumVal("type2", "PokemonType."));

    const a1 = clean(enumVal("ability1", "AbilityId."));
    const a2 = clean(enumVal("ability2", "AbilityId."));
    const ah = clean(enumVal("abilityHidden", "AbilityId."));
    [a1, a2, ah].forEach(a => { if (a) abilityIds.add(a); });
    { const pm = part.match(/passives:\s*(?:\{[^}]*?)?AbilityId\.(\w+)/); if (pm && pm[1] !== "NONE") abilityIds.add(pm[1]); }

    // evoluzioni: dall'array evolutions:[...] — sia SpeciesEvolution che
    // SpeciesFormEvolution, con livello, pietra (item) e condizione amicizia.
    const evolutions = [];
    const evoBlock = balancedArray(part, "evolutions:");
    if (evoBlock) {
      const evoCtorRe = /new Species(?:Form)?Evolution\(/g;
      const seen = new Set();
      let em;
      while ((em = evoCtorRe.exec(evoBlock)) !== null) {
        const inner = balancedParen(evoBlock, em.index);
        const to = (inner.match(/speciesId:\s*SpeciesId\.(\w+)/) || [])[1];
        if (!to || seen.has(to)) continue;      // dedup: una voce per specie-bersaglio
        seen.add(to);
        const lvlM = inner.match(/level:\s*(\d+)/);
        const itemM = inner.match(/EvolutionItem\.(\w+)/);
        const item = itemM && itemM[1] !== "NONE" ? itemM[1] : null;
        const friendship = /EvoCondKey\.FRIENDSHIP/.test(inner);
        const evo = { to, level: lvlM ? Number(lvlM[1]) : null, item };
        if (friendship) evo.friendship = true;

        /* CONDIZIONI SPECIALI (EvoCondKey). Prima erano ignorate del tutto e
           quelle evoluzioni non scattavano mai. Ora si estraggono tutte:
           il gioco decide poi quali sa verificare. */
        const gm = inner.match(/EvoCondKey\.GENDER[\s\S]*?Gender\.(\w+)/);
        if (gm) evo.gender = gm[1];
        // momento del giorno: time: [TimeOfDay.DUSK, TimeOfDay.NIGHT]
        if (/EvoCondKey\.TIME/.test(inner)) {
          const blocco = inner.slice(inner.indexOf("EvoCondKey.TIME"));
          const t = [...blocco.matchAll(/TimeOfDay\.(\w+)/g)].map(m => m[1]);
          if (t.length) evo.time = [...new Set(t)];
        }
        // conosce una mossa precisa / una mossa di un tipo
        const mvM = inner.match(/EvoCondKey\.MOVE,\s*move:\s*MoveId\.(\w+)/);
        if (mvM) evo.knowsMove = mvM[1];
        const mtM = inner.match(/EvoCondKey\.MOVE_TYPE,\s*pkmnType:\s*PokemonType\.(\w+)/);
        if (mtM) evo.moveType = mtM[1];
        // si trova in certi biomi
        if (/EvoCondKey\.BIOME/.test(inner)) {
          const blocco = inner.slice(inner.indexOf("EvoCondKey.BIOME"));
          const b = [...blocco.matchAll(/BiomeId\.(\w+)/g)].map(m => m[1]);
          if (b.length) evo.biome = [...new Set(b)];
        }
        // Tyrogue: decide in base ad Attacco vs Difesa (la mossa marca il ramo)
        const tyM = inner.match(/EvoCondKey\.TYROGUE,\s*move:\s*MoveId\.(\w+)/);
        if (tyM) evo.tyrogue = tyM[1];
        else if (/EvoCondKey\.TYROGUE/.test(inner)) evo.tyrogue = "TIE";
        // tiene un oggetto
        const hiM = inner.match(/EvoCondKey\.HELD_ITEM,\s*itemKey:\s*"(\w+)"/);
        if (hiM) evo.heldItem = hiM[1];
        // ha una certa natura
        if (/EvoCondKey\.NATURE/.test(inner)) {
          const blocco = inner.slice(inner.indexOf("EvoCondKey.NATURE"));
          const n = [...blocco.matchAll(/Nature\.(\w+)/g)].map(m => m[1]);
          if (n.length) evo.nature = [...new Set(n)];
        }
        // con un certo meteo
        if (/EvoCondKey\.WEATHER/.test(inner)) {
          const blocco = inner.slice(inner.indexOf("EvoCondKey.WEATHER"));
          const w = [...blocco.matchAll(/WeatherType\.(\w+)/g)].map(m => m[1]);
          if (w.length) evo.weather = [...new Set(w)];
        }
        // hai gia' catturato una certa specie
        const scM = inner.match(/EvoCondKey\.SPECIES_CAUGHT,\s*speciesCaught:\s*SpeciesId\.(\w+)/);
        if (scM) evo.speciesCaught = scM[1];
        // hai in squadra un Pokemon di un certo tipo
        const ptM = inner.match(/EvoCondKey\.PARTY_TYPE,\s*pkmnType:\s*PokemonType\.(\w+)/);
        if (ptM) evo.partyType = ptM[1];
        // Shedinja: crea un SECONDO Pokemon invece di trasformare
        if (/EvoCondKey\.SHEDINJA/.test(inner)) evo.shedinja = true;
        // forma casuale (1 su N) e contatore del tesoro (Gimmighoul)
        const rfM = inner.match(/EvoCondKey\.RANDOM_FORM,\s*value:\s*(\d+)/);
        if (rfM) evo.randomForm = Number(rfM[1]);
        const etM = inner.match(/EvoCondKey\.EVO_TREASURE_TRACKER,\s*value:\s*(\d+)/);
        if (etM) evo.treasure = Number(etM[1]);

        evolutions.push(evo);
      }
    }

    // learnset: levelMoves: [ [n, MoveId.X], ... ] — estrai l'array bilanciato
    const lmBlock = balancedArray(part, "levelMoves:");
    const lm = [];
    const lmRe = /\[\s*(-?\d+)\s*,\s*MoveId\.(\w+)\s*\]/g;
    let l;
    while ((l = lmRe.exec(lmBlock)) !== null) lm.push([Number(l[1]), l[2]]);

    // MT insegnabili: `tms: [ MoveId.X, ... ]`. Sono le mosse che la specie puo'
    // imparare da Macchina Tecnica: servono per gli oggetti MT e per gli incontri.
    const tmBlock = balancedArray(part, "tms:");
    const tmList = [...new Set([...tmBlock.matchAll(/MoveId\.(\w+)/g)].map(m => m[1]))];

    species[id] = {
      id, dex, gen: genNum, it: itPokemon(id),
      types: type2 ? [type1, type2] : [type1],
      baseStats: {
        hp:    Number(field("baseHp")),
        atk:   Number(field("baseAtk")),
        def:   Number(field("baseDef")),
        spatk: Number(field("baseSpatk")),
        spdef: Number(field("baseSpdef")),
        spd:   Number(field("baseSpd")),
      },
      abilities: { normal: [a1, a2].filter(Boolean), hidden: ah },
      // PASSIVA: meccanica esclusiva di PokeRogue — si somma all'abilità normale.
      // Alcune specie hanno un oggetto per-forma: prendiamo il primo AbilityId.
      passive: (() => {
        const m = part.match(/passives:\s*(?:\{[^}]*?)?AbilityId\.(\w+)/);
        return m && m[1] !== "NONE" ? m[1] : null;
      })(),
      height: numOrNull(field("height")),
      weight: numOrNull(field("weight")),
      catchRate: numOrNull(field("catchRate")),
      // ESPERIENZA: quanta ne frutta abbatterlo e con che curva sale di livello.
      // Senza questi due il gioco non puo' avere l'EXP vera (§ progressione).
      baseExp: numOrNull(field("baseExp")),
      growthRate: enumVal("growthRate", "GrowthRate."),
      /* RANGO: leggendario / semi-leggendario (le Ultracreature stanno qui) /
         misterioso. L'originale li usa per tenerli fuori dagli incontri e dai
         pool normali. Senza questi campi un venditore all'ondata 5 poteva
         offrire un Guzzlord. */
      leggendario: /\blegendary:\s*true/.test(part) || undefined,
      semiLeggendario: /subLegendary:\s*true/.test(part) || undefined,
      misterioso: /mythical:\s*true/.test(part) || undefined,
      // SESSO: percentuale di maschi (null = senza sesso, come Magnemite).
      // `genderDiffs` marca le specie con lo sprite femminile diverso.
      malePercent: numOrNull(field("malePercent")),
      genderDiffs: /genderDiffs:\s*true/.test(part) || undefined,
      eggTier: enumVal("eggTier", "EggTier."),
      starterCost: numOrNull(field("starterCost")),
      evolutions,
    };
    learnsets[id] = lm;
    if (tmList.length) tms[id] = tmList;
  }
}
function numOrNull(s) { if (s == null) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }

/* Rarita' delle MT: da `tm-pool-tiers.ts` — ogni mossa insegnabile ha un tier
   (COMMON / GREAT / ULTRA) che decide in quale premio MT puo' capitare. */
function extractTmTiers() {
  const src = read(resolve(PR, "src/data/balance/tm-pool-tiers.ts"));
  const out = {};
  for (const m of src.matchAll(/\[MoveId\.(\w+)\]:\s*ModifierTier\.(\w+)/g)) out[m[1]] = m[2];
  return out;
}

/* MOSSE DA UOVO — da `balance/moves/egg-moves.ts`.
   Ogni specie base ha ESATTAMENTE 4 mosse da uovo; la quarta (indice 3) e' la
   "rara". Nell'originale non si scelgono: si sbloccano una alla volta facendo
   schiudere le uova di quella specie. Sono la ragione per cui all'inizio le
   mosse disponibili sono pochissime e crescono giocando. */
function extractEggMoves() {
  const src = read(resolve(PR, "src/data/balance/moves/egg-moves.ts"));
  const out = {};
  for (const m of src.matchAll(/\[SpeciesId\.(\w+)\]:\s*\[([^\]]+)\]/g)) {
    const mosse = [...m[2].matchAll(/MoveId\.(\w+)/g)].map(x => x[1]);
    if (mosse.length === 4) out[m[1]] = mosse;
  }
  return out;
}

/* Estrae l'array [...] bilanciato che segue una chiave (gestisce annidamenti). */
function balancedArray(str, key) {
  const at = str.indexOf(key);
  if (at < 0) return "";
  const open = str.indexOf("[", at);
  if (open < 0) return "";
  let depth = 0, i = open;
  for (; i < str.length; i++) {
    if (str[i] === "[") depth++;
    else if (str[i] === "]" && --depth === 0) break;
  }
  return str.slice(open, i + 1);
}

/* ========================================================================== */
/*  ABILITA' — nomi/descrizioni IT + attributi ("mattoncini") normalizzati     */
/* ========================================================================== */

/* Traduce un ab-attr di PokeRogue in un mattoncino del nostro motore.
   Ignorati (null) quelli fuori scope 1v1 (meteo, forme, party, IA, ...). */
function normalizeAbAttr(name, a) {
  const S = (x, p) => (x || "").replace(p, "");
  const types = s => (s.match(/PokemonType\.(\w+)/g) || []).map(t => t.replace("PokemonType.", ""));
  const statuses = arr => arr.flatMap(x => (x.match(/StatusEffect\.(\w+)/g) || []).map(s => s.replace("StatusEffect.", "")));
  switch (name) {
    case "LowHpMoveTypePowerBoostAbAttr":   return { kind: "lowHpTypeBoost", moveType: types(a[0])[0], mult: 1.5 };
    case "MoveTypePowerBoostAbAttr":        return { kind: "typeBoost", moveType: types(a[0])[0], mult: a[1] ? Number(a[1]) : 1.5 };
    case "PostSummonStatStageChangeAbAttr": {
      const changes = [];
      const re = /stat:\s*Stat\.(\w+),\s*stages:\s*(-?\d+)/g; let m2;
      while ((m2 = re.exec(a[0] || "")) !== null) changes.push({ stat: m2[1], stages: Number(m2[2]) });
      if (!changes.length) return null;
      return { kind: "onSummonStat", changes, self: a[1] === "true" };
    }
    case "PostDefendApplyStatusEffectAbAttr": {
      const st = statuses([a[2] || ""])[0];
      if (!st) return null;
      return { kind: "contactStatus", chance: Number(a[0]) || 0, contact: a[1] === "true", status: st };
    }
    case "StatMultiplierAbAttr":            return { kind: "statMult", stat: S(a[0], "Stat."), mult: Number(a[1]) };
    case "StatusEffectImmunityAbAttr": {
      const sts = statuses(a); if (!sts.length) return null;
      return { kind: "statusImmunity", statuses: sts };
    }
    case "TypeImmunityHealAbAttr":          return { kind: "typeAbsorb", moveType: types(a[0])[0] };
    case "AttackTypeImmunityAbAttr":        return { kind: "typeImmunity", moveType: types(a[0])[0] };
    case "ReceivedTypeDamageMultiplierAbAttr": return { kind: "typeDamageMult", moveType: types(a[0])[0], mult: Number(a[1]) };
    case "PostDefendContactDamageAbAttr":   return { kind: "contactDamage", fraction: Number(a[0]) || 8 };
    case "ProtectStatAbAttr":               return { kind: "protectStats" };
    case "BlockRecoilDamageAttr":           return { kind: "noRecoil" };
    default:                                return null;
  }
}

/* Parsa init-abilities.ts: per ogni AbBuilder, ricava gli attrs normalizzati. */
function extractAbilityAttrs() {
  const src = read(resolve(PR, "src/data/abilities/init-abilities.ts"));
  const ctorRe = /new AbBuilder\(AbilityId\.(\w+)/g;
  const hits = [];
  let m;
  while ((m = ctorRe.exec(src)) !== null) hits.push({ pos: m.index, id: m[1] });
  const map = {};
  for (let h = 0; h < hits.length; h++) {
    const chunk = src.slice(hits[h].pos, h + 1 < hits.length ? hits[h + 1].pos : hits[h].pos + 2000);
    const attrs = [];
    const attrRe = /\.attr\(/g; let am;
    while ((am = attrRe.exec(chunk)) !== null) {
      const parts = splitTop(balancedParen(chunk, am.index));
      const norm = normalizeAbAttr(parts[0], parts.slice(1));
      if (norm) attrs.push(norm);
    }
    map[hits[h].id] = attrs;
  }
  return map;
}

function buildAbilities(ids) {
  const attrMap = extractAbilityAttrs();
  const out = {};
  for (const id of [...ids].sort()) {
    out[id] = { id, it: itAbility(id), attrs: attrMap[id] || [], description: itAbilEff(id) };
  }
  return out;
}

/* ========================================================================== */
/*  ICONE MINI — indice dex -> {atlas, x, y, w, h} dai pokemon_icons_N.json    */
/* ========================================================================== */
/* Le icone stanno in più atlas; i frame si chiamano "<dex>" (base), "<dex>s"
   (shiny), "<dex>-<forma>". Serve per mostrare i mini sprite nei menu. */
function extractIcons() {
  const dir = resolve(APP, "assets/ui/icons");
  const out = {};
  for (let i = 0; i <= 9; i++) {
    const jf = resolve(dir, `pokemon_icons_${i}.json`);
    if (!existsSync(jf)) continue;
    const atlas = readJson(jf);
    const tex = atlas.textures ? atlas.textures[0] : atlas;
    const frames = Array.isArray(tex.frames)
      ? tex.frames
      : Object.entries(tex.frames).map(([k, v]) => Object.assign({ filename: k }, v));
    const sheetW = (tex.size || (atlas.meta && atlas.meta.size) || {}).w;
    const sheetH = (tex.size || (atlas.meta && atlas.meta.size) || {}).h;
    for (const f of frames) {
      const name = String(f.filename).replace(/\.png$/, "");
      // solo il frame base "<dex>" (numerico puro): evita shiny e forme
      if (!/^\d+$/.test(name)) continue;
      const dex = Number(name);
      if (out[dex]) continue;
      out[dex] = { a: i, x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h, sw: sheetW, sh: sheetH };
    }
  }
  return out;
}

/* ========================================================================== */
/*  VARIANTI — l'ARRAY ORDINATO delle forme di ogni specie                     */
/* ========================================================================== */
/* Attenzione: qui l'ORDINE è il dato. Nell'originale la forma di un Pokémon
   che compare è un INDICE nell'array `forms` (getSpeciesFormIndex in
   battle-scene.ts fa `randSeedInt(species.forms.length)` e, per parecchie
   specie, si ferma a un indice preciso per NON pescare le forme da battaglia:
   Pikachu randSeedInt(8) su 9 forme lascia fuori la gigamax, Zygarde
   randSeedInt(4) su 7 lascia fuori Complete, ecc.).
   Se si riordina questo array si rompono tutte quelle regole.

   La forma base ha `formKey: ""` e il suo sprite è "<dex>.png" (senza suffisso);
   le altre "<dex>-<formKey>.png". Quando più forme sono identiche a vedersi
   (le 20 fantasie di Scatterbug, le taglie di Pumpkaboo) l'originale NON ha un
   file per forma: si ricade sullo sprite base, ed è quello che fa anche il gioco.

   Nome italiano da locales/it/pokemon-form.json: chiave = camel(specie) +
   Pascal(formKey), es. pikachuCosplay, rotomHeat. */
const locForm = readJson(resolve(PR, "locales/it/pokemon-form.json"));
/* "PALDEA_TAUROS" + "blaze" -> "paldeaTaurosBlaze" */
function formLocKey(speciesId, formKey) {
  const sp = toCamel(speciesId);
  if (!formKey) return sp;
  const suffix = formKey.split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return sp + suffix;
}

/* Nome della forma, con la stessa catena di ripieghi di getFormNameToDisplay():
   1. Arceus → il nome del TIPO ("Fuoco", "Acqua"…)
   2. mega/gigamax/archeo → tabella battleForm
   3. `<specie><Forma>`; se non c'è, `<specieRadice><Forma>` — è così che
      Sawsbuck eredita le stagioni da Deerling, Gastrodon da Shellos,
      Vivillon da Scatterbug, Wormadam da Burmy…
   4. ultimo ripiego: la chiave stessa resa leggibile. */
const BATTLE_FORM_KEYS = new Set(["mega", "mega-x", "mega-y", "mega-z", "primal",
  "gigantamax", "gigantamax-rapid", "gigantamax-single", "eternamax"]);
function formItName(speciesId, formKey, rootId) {
  if (!formKey) return locForm[formLocKey(speciesId, "")] || null;
  if (speciesId === "ARCEUS") {
    const t = TYPES[formKey.toUpperCase()];
    if (t) return t.it;
  }
  if (BATTLE_FORM_KEYS.has(formKey)) return (locForm.battleForm || {})[toCamel(formKey.replace(/-/g, "_"))] || null;
  const direct = locForm[formLocKey(speciesId, formKey)];
  if (direct) return direct;
  if (rootId && rootId !== speciesId) {
    const viaRoot = locForm[formLocKey(rootId, formKey)];
    if (viaRoot) return viaRoot;
  }
  return pretty(formKey.replace(/-/g, "_"));
}
/* Risale la catena evolutiva fino alla specie base (getRootSpeciesId). */
function buildRootMap(species) {
  const parent = {};
  for (const id in species)
    for (const e of species[id].evolutions || [])
      if (!parent[e.to]) parent[e.to] = id;
  const root = {};
  for (const id in species) {
    let cur = id, guard = 0;
    while (parent[cur] && guard++ < 10) cur = parent[cur];
    root[id] = cur;
  }
  return root;
}

function extractVariants(species) {
  const rootOf = buildRootMap(species);
  const out = {};
  for (const [file, varPrefix] of GEN_FILES) {
    const src = read(resolve(PR, "src/data/balance/species/" + file));
    const parts = src.split(new RegExp(varPrefix + "SpeciesData\\[SpeciesId\\.")).slice(1);
    for (const part of parts) {
      const id = part.slice(0, part.indexOf("]")).trim();
      if (!/^\w+\]\s*=\s*\{/.test(part)) continue;        // solo le ASSEGNAZIONI
      const fIdx = part.search(/\bforms:\s*\[/);
      if (fIdx < 0) continue;
      const block = balancedBracket(part, fIdx, "[", "]");
      const formRe = /new PokemonForm\(/g;
      const list = [];
      let fm;
      while ((fm = formRe.exec(block)) !== null) {
        const inner = balancedParen(block, fm.index);
        const kEnum = inner.match(/formKey:\s*SpeciesFormKey\.(\w+)/);
        const kLit  = inner.match(/formKey:\s*"([^"]*)"/);
        // la forma base ha formKey "" — kLit la cattura, kEnum no
        let key = kEnum ? kEnum[1].toLowerCase().replace(/_/g, "-") : (kLit ? kLit[1] : null);
        if (key === null) continue;
        const num = n => { const m = inner.match(new RegExp(n + ":\\s*(-?[\\d.]+)")); return m ? Number(m[1]) : null; };
        const enumV = (n, p) => { const m = inner.match(new RegExp(n + ":\\s*" + p + "(\\w+)")); return m && m[1] !== "NONE" && m[1] !== "null" ? m[1] : null; };
        const t1 = enumV("type1", "PokemonType\\."), t2 = enumV("type2", "PokemonType\\.");
        const hp = num("baseHp");
        const e = { key, it: formItName(id, key, rootOf[id]) };
        if (t1) e.types = t2 ? [t1, t2] : [t1];
        if (hp != null) e.baseStats = { hp, atk: num("baseAtk"), def: num("baseDef"), spatk: num("baseSpatk"), spdef: num("baseSpdef"), spd: num("baseSpd") };
        const ab = enumV("ability1", "AbilityId\\.");
        if (ab) e.ability = ab;
        list.push(e);
      }
      if (list.length > 1) out[id] = list;   // una forma sola = niente da scegliere
    }
  }
  return out;
}

/* ========================================================================== */
/*  FORME MEGA / GIGAMAX — da PokemonForm(...) dentro i file generation-0X     */
/* ========================================================================== */
/* Per ogni specie raccoglie le forme potenziate (mega/mega-x/mega-y/primal/
   gigantamax) con statistiche, tipi e abilità: servono per la trasformazione
   temporanea in battaglia. Lo sprite è "<dex>-<formKey>.png". */
function extractForms() {
  const wanted = /^(mega|mega-x|mega-y|primal|gigantamax|eternamax)$/;
  const out = {};
  for (const [file, varPrefix] of GEN_FILES) {
    const src = read(resolve(PR, "src/data/balance/species/" + file));
    const parts = src.split(new RegExp(varPrefix + "SpeciesData\\[SpeciesId\\.")).slice(1);
    for (const part of parts) {
      const id = part.slice(0, part.indexOf("]")).trim();
      if (!/^\w+\]\s*=\s*\{/.test(part)) continue;
      const formRe = /new PokemonForm\(/g;
      let fm;
      while ((fm = formRe.exec(part)) !== null) {
        const inner = balancedParen(part, fm.index);
        const keyM = inner.match(/formKey:\s*SpeciesFormKey\.(\w+)/);
        if (!keyM) continue;
        const formKey = keyM[1].toLowerCase().replace(/_/g, "-");
        if (!wanted.test(formKey)) continue;
        const num = n => { const m = inner.match(new RegExp(n + ":\\s*(-?[\\d.]+)")); return m ? Number(m[1]) : null; };
        const enumV = (n, p) => { const m = inner.match(new RegExp(n + ":\\s*" + p + "(\\w+)")); return m && m[1] !== "NONE" && m[1] !== "null" ? m[1] : null; };
        const t1 = enumV("type1", "PokemonType\\."), t2 = enumV("type2", "PokemonType\\.");
        const hp = num("baseHp");
        if (!t1 || hp == null) continue;
        (out[id] = out[id] || []).push({
          formKey,
          it: formKey.startsWith("mega") ? "Mega" : formKey === "primal" ? "Primo" : formKey === "gigantamax" ? "Gigamax" : "Eternamax",
          types: t2 ? [t1, t2] : [t1],
          ability: enumV("ability1", "AbilityId\\."),
          baseStats: { hp, atk: num("baseAtk"), def: num("baseDef"), spatk: num("baseSpatk"), spdef: num("baseSpdef"), spd: num("baseSpd") },
        });
      }
    }
  }
  return out;
}

/* ========================================================================== */
/*  BIOMI — pool di incontro per tier + collegamenti (da biomes/*.ts)          */
/* ========================================================================== */
import { readdirSync } from "node:fs";

// nome italiano + coppia di colori per lo sfondo scena (cielo → terreno)
const BIOME_META = {
  TOWN:{it:"Città",sky:"#a7c8e8",ground:"#b9c9a9"}, PLAINS:{it:"Pianura",sky:"#a7dbf2",ground:"#a9dd93"},
  GRASS:{it:"Prato",sky:"#9fd8ef",ground:"#8fd07f"}, TALL_GRASS:{it:"Erba Alta",sky:"#8fcbe0",ground:"#5faf62"},
  METROPOLIS:{it:"Metropoli",sky:"#9aa7b8",ground:"#8a8f99"}, FOREST:{it:"Foresta",sky:"#7fb890",ground:"#3e7d4b"},
  SEA:{it:"Mare",sky:"#8fc9ef",ground:"#3f7fc9"}, SWAMP:{it:"Palude",sky:"#93a98f",ground:"#5d7050"},
  BEACH:{it:"Spiaggia",sky:"#a5d8f0",ground:"#e8d59e"}, LAKE:{it:"Lago",sky:"#9fd0e8",ground:"#5f9fd0"},
  SEABED:{it:"Fondale",sky:"#3f6f9f",ground:"#274a70"}, MOUNTAIN:{it:"Montagna",sky:"#b0c4d8",ground:"#8f9aa5"},
  BADLANDS:{it:"Calanchi",sky:"#d8b090",ground:"#b07850"}, CAVE:{it:"Grotta",sky:"#6f6a78",ground:"#4a4550"},
  DESERT:{it:"Deserto",sky:"#efd8a5",ground:"#d8b060"}, ICE_CAVE:{it:"Grotta Gelata",sky:"#b8e0f0",ground:"#88c0e0"},
  MEADOW:{it:"Prateria Fiorita",sky:"#b8d8f0",ground:"#a8d090"}, POWER_PLANT:{it:"Centrale",sky:"#d8d890",ground:"#a8a860"},
  VOLCANO:{it:"Vulcano",sky:"#d88060",ground:"#a04030"}, GRAVEYARD:{it:"Cimitero",sky:"#8f8aa0",ground:"#5a5570"},
  DOJO:{it:"Dojo",sky:"#d0b8a0",ground:"#a08060"}, FACTORY:{it:"Fabbrica",sky:"#a8a8b0",ground:"#787880"},
  RUINS:{it:"Rovine",sky:"#c8c0a8",ground:"#988f70"}, WASTELAND:{it:"Landa Desolata",sky:"#a89078",ground:"#786048"},
  ABYSS:{it:"Abisso",sky:"#504868",ground:"#302840"}, SPACE:{it:"Spazio",sky:"#383058",ground:"#181028"},
  CONSTRUCTION_SITE:{it:"Cantiere",sky:"#c8b8a0",ground:"#a08868"}, JUNGLE:{it:"Giungla",sky:"#6fa878",ground:"#2f6838"},
  FAIRY_CAVE:{it:"Grotta Fatata",sky:"#e8c0e0",ground:"#c090c0"}, TEMPLE:{it:"Tempio",sky:"#c0b8d0",ground:"#8880a0"},
  SLUM:{it:"Sobborghi",sky:"#b0a8a0",ground:"#807870"}, SNOWY_FOREST:{it:"Bosco Innevato",sky:"#d8e8f0",ground:"#b8d0c8"},
  ISLAND:{it:"Isola",sky:"#98d0e8",ground:"#88c078"}, LABORATORY:{it:"Laboratorio",sky:"#c0c8d0",ground:"#909aa8"},
  END:{it:"La Fine",sky:"#585068",ground:"#282030"},
};

function extractBiomes() {
  const dir = resolve(PR, "src/data/balance/biomes");
  const out = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts") || file === "init-biomes.ts") continue;
    const id = file.replace(".ts", "").replace(/-/g, "_").toUpperCase();
    const src = read(resolve(dir, file));
    // pool: per ogni sezione BiomePoolTier.X cattura tutte le SpeciesId fino al tier successivo
    const pools = {};
    const tierRe = /\[BiomePoolTier\.(\w+)\]/g;
    const hits = [];
    let m;
    while ((m = tierRe.exec(src)) !== null) hits.push({ tier: m[1], pos: m.index });
    for (let i = 0; i < hits.length; i++) {
      const chunk = src.slice(hits[i].pos, i + 1 < hits.length ? hits[i + 1].pos : src.indexOf("};", hits[i].pos));
      const specs = [...new Set((chunk.match(/SpeciesId\.(\w+)/g) || []).map(s => s.replace("SpeciesId.", "")))];
      pools[hits[i].tier] = [...new Set([...(pools[hits[i].tier] || []), ...specs])];
    }
    // collegamenti: BiomeId.X oppure [BiomeId.X, peso]
    const linksLine = (src.match(/const biomeLinks[^=]*=\s*(\[[\s\S]*?\]);/) || [])[1] || "";
    const links = [...new Set((linksLine.match(/BiomeId\.(\w+)/g) || []).map(s => s.replace("BiomeId.", "")))];
    const metaB = BIOME_META[id] || { it: id, sky: "#a7dbf2", ground: "#a9dd93" };
    out[id] = { id, it: metaB.it, sky: metaB.sky, ground: metaB.ground, pools, links };
  }
  return out;
}

/* ========================================================================== */
/*  TIPI + TYPECHART — matrice 18x18 verificata (riuso dal prototipo)          */
/* ========================================================================== */
const TYPES = {
  NORMAL:{it:"Normale",color:"#9099a1"}, FIRE:{it:"Fuoco",color:"#ff9c54"},
  WATER:{it:"Acqua",color:"#4d90d5"}, GRASS:{it:"Erba",color:"#63bb5b"},
  ELECTRIC:{it:"Elettro",color:"#f3d23b"}, ICE:{it:"Ghiaccio",color:"#74cec0"},
  FIGHTING:{it:"Lotta",color:"#ce4069"}, POISON:{it:"Veleno",color:"#ab6ac8"},
  GROUND:{it:"Terra",color:"#d97845"}, FLYING:{it:"Volante",color:"#8fa8dd"},
  PSYCHIC:{it:"Psico",color:"#f97176"}, BUG:{it:"Coleot.",color:"#90c12c"},
  ROCK:{it:"Roccia",color:"#c7b78b"}, GHOST:{it:"Spettro",color:"#5269ac"},
  DRAGON:{it:"Drago",color:"#0b6dc3"}, DARK:{it:"Buio",color:"#5a5366"},
  STEEL:{it:"Acciaio",color:"#5a8ea1"}, FAIRY:{it:"Folletto",color:"#ec8fe6"},
};
const TYPECHART = {
  NORMAL:{ROCK:.5,GHOST:0,STEEL:.5}, FIRE:{FIRE:.5,WATER:.5,GRASS:2,ICE:2,BUG:2,ROCK:.5,DRAGON:.5,STEEL:2},
  WATER:{FIRE:2,WATER:.5,GRASS:.5,GROUND:2,ROCK:2,DRAGON:.5}, ELECTRIC:{WATER:2,ELECTRIC:.5,GRASS:.5,GROUND:0,FLYING:2,DRAGON:.5},
  GRASS:{FIRE:.5,WATER:2,GRASS:.5,POISON:.5,GROUND:2,FLYING:.5,BUG:.5,ROCK:2,DRAGON:.5,STEEL:.5},
  ICE:{FIRE:.5,WATER:.5,GRASS:2,ICE:.5,GROUND:2,FLYING:2,DRAGON:2,STEEL:.5},
  FIGHTING:{NORMAL:2,ICE:2,POISON:.5,FLYING:.5,PSYCHIC:.5,BUG:.5,ROCK:2,GHOST:0,DARK:2,STEEL:2,FAIRY:.5},
  POISON:{GRASS:2,POISON:.5,GROUND:.5,ROCK:.5,GHOST:.5,STEEL:0,FAIRY:2}, GROUND:{FIRE:2,ELECTRIC:2,GRASS:.5,POISON:2,FLYING:0,BUG:.5,ROCK:2,STEEL:2},
  FLYING:{ELECTRIC:.5,GRASS:2,FIGHTING:2,BUG:2,ROCK:.5,STEEL:.5}, PSYCHIC:{FIGHTING:2,POISON:2,PSYCHIC:.5,DARK:0,STEEL:.5},
  BUG:{FIRE:.5,GRASS:2,FIGHTING:.5,POISON:.5,FLYING:.5,PSYCHIC:2,GHOST:.5,DARK:2,STEEL:.5,FAIRY:.5},
  ROCK:{FIRE:2,ICE:2,FIGHTING:.5,GROUND:.5,FLYING:2,BUG:2,STEEL:.5}, GHOST:{NORMAL:0,PSYCHIC:2,GHOST:2,DARK:.5},
  DRAGON:{DRAGON:2,STEEL:.5,FAIRY:0}, DARK:{FIGHTING:.5,PSYCHIC:2,GHOST:2,DARK:.5,FAIRY:.5},
  STEEL:{FIRE:.5,WATER:.5,ELECTRIC:.5,ICE:2,ROCK:2,STEEL:.5,FAIRY:2}, FAIRY:{FIRE:.5,FIGHTING:2,POISON:.5,DRAGON:2,DARK:2,STEEL:.5},
};


/* ==========================================================================
   DIALOGHI DEGLI ALLENATORI — testi italiani UFFICIALI

   In `locales/it/dialogue.json` ogni tipo di allenatore ha:
     encounter  cosa dice quando ti sfida
     victory    cosa dice quando TU lo batti   ← il dialogo di sconfitta
     defeat     cosa dice quando batte te

   ⚠️ Il nome del campo e' dal punto di vista del GIOCATORE: `victory` e' la
   tua vittoria, cioe' la sconfitta di chi parla.

   Formato dei testi: `@c{espressione}` marca la faccia (da togliere, noi non
   abbiamo i ritratti espressivi), `$` separa una schermata dall'altra, `
`
   e' un a capo dentro la stessa schermata.
   ========================================================================== */
function pulisciDialogo(t) {
  return String(t)
    .replace(/@c\{[^}]*\}/g, "")   // espressioni del ritratto
    .replace(/@d\{[^}]*\}/g, "")   // pause
    .replace(/@f\{[^}]*\}/g, "")
    .trim();
}
/* Una voce -> array di SCHERMATE (una per `$`), ognuna gia' ripulita. */
function schermate(t) {
  if (t == null) return [];
  return String(t).split("$").map(pulisciDialogo).filter(Boolean);
}
function extractDialoghi() {
  const src = readJson(resolve(PR, "locales/it/dialogue.json"));
  const out = {};
  for (const k in src) {
    const v = src[k];
    if (!v || typeof v !== "object") continue;
    const voce = {};
    for (const campo of ["encounter", "victory", "defeat"]) {
      const g = v[campo];
      if (!g) continue;
      // le varianti sono numerate "1","2",...: si tengono tutte, si pesca a caso
      const varianti = Object.keys(g).sort().map(n => schermate(g[n])).filter(a => a.length);
      if (varianti.length) voce[campo] = varianti;
    }
    if (Object.keys(voce).length) out[k] = voce;
  }
  return out;
}

/* ========================================================================== */
/*  MAIN                                                                        */
/* ========================================================================== */
const moves = extractMoves();
const { species, learnsets, abilityIds, tms } = extractSpecies();
const abilities = buildAbilities(abilityIds);

/* Marca le specie SENZA sprite copiato (es. forme regionali dex 2000+/4000+):
   il gioco le esclude dalle comparse, così non appaiono mai i placeholder. */
{
  let noSpr = 0;
  for (const k in species) {
    const p = resolve(APP, "assets/pokemon/front", species[k].dex + ".png");
    if (!existsSync(p)) { species[k].noSprite = true; noSpr++; }
  }
  console.log(`Specie senza sprite (escluse dalle comparse): ${noSpr}`);
}

const write = (name, obj) => {
  writeFileSync(resolve(OUT, name), JSON.stringify(obj, null, 0));
  console.log(`  ${name.padEnd(16)} ${Object.keys(obj).length} voci`);
};

console.log("Estrazione completata:");
write("moves.json", moves);
write("species.json", species);
write("learnsets.json", learnsets);
write("tms.json", { perSpecie: tms, tier: extractTmTiers() });
write("abilities.json", abilities);
write("typechart.json", TYPECHART);
write("types.json", TYPES);
const biomes = extractBiomes();
write("biomes.json", biomes);
const forms = extractForms();
write("forms.json", forms);
const icons = extractIcons();
write("icons.json", icons);
const variants = extractVariants(species);
write("variants.json", variants);
const eggMoves = extractEggMoves();
write("eggmoves.json", eggMoves);
const dialoghi = extractDialoghi();
write("dialoghi.json", dialoghi);
{
  // controllo: le 4 mosse di ogni specie devono esistere fra le nostre
  let mancanti = 0, fuoriDex = 0;
  for (const k in eggMoves) {
    if (!species[k]) fuoriDex++;
    for (const id of eggMoves[k]) if (!moves[id]) mancanti++;
  }
  console.log(`Mosse da uovo: ${Object.keys(eggMoves).length} specie × 4 · ${mancanti} mosse sconosciute · ${fuoriDex} specie fuori dex`);
}
{
  let tot = 0, conIt = 0;
  for (const k in variants) for (const f of variants[k]) { tot++; if (f.it) conIt++; }
  console.log(`Varianti: ${tot} forme su ${Object.keys(variants).length} specie · ${conIt} col nome italiano`);
}
{
  let mega = 0, gmax = 0;
  for (const k in forms) for (const f of forms[k]) { if (f.formKey.startsWith("mega")) mega++; else if (f.formKey === "gigantamax") gmax++; }
  console.log(`Forme potenziate: ${mega} mega/primal · ${gmax} gigamax · su ${Object.keys(forms).length} specie`);
}

// piccolo report di sanita'
const sp = species.CHARIZARD;
console.log("\nCheck CHARIZARD:", sp && `${sp.it} dex${sp.dex} ${sp.types} HP${sp.baseStats.hp} abil:${sp.abilities.normal}`);
console.log("Check FLAMETHROWER:", moves.FLAMETHROWER && `${moves.FLAMETHROWER.it} ${moves.FLAMETHROWER.type} pot${moves.FLAMETHROWER.power}`);
console.log("Learnset BULBASAUR:", (learnsets.BULBASAUR || []).length, "mosse");
const known = new Set(Object.keys(species));
const inDex = arr => (arr || []).filter(s => known.has(s)).length;
const pl = biomes.PLAINS;
console.log("Biome PLAINS: COMMON disponibili =", inDex(pl.pools.COMMON), "| links =", pl.links.join(","));
console.log("Biomi totali:", Object.keys(biomes).length, "| TOWN links:", (biomes.TOWN || {}).links);
// copertura per generazione
const perGen = {};
for (const k in species) perGen[species[k].gen] = (perGen[species[k].gen] || 0) + 1;
console.log("Specie per generazione:", JSON.stringify(perGen));
// quante specie dei pool bioma sono ora coperte (prima solo Gen1)
let poolTot = 0, poolOk = 0;
for (const b of Object.values(biomes)) for (const t in b.pools) for (const s of b.pools[t]) { poolTot++; if (known.has(s)) poolOk++; }
console.log("Copertura pool biomi:", poolOk + "/" + poolTot, "(" + Math.round(poolOk / poolTot * 100) + "%)");
