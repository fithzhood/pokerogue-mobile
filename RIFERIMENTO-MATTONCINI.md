# Riferimento — il motore a "mattoncini" (attributi di mosse e abilità)

È il cuore tecnico del gioco. Capirlo bene rende fattibile l'obiettivo "tutti i Pokémon".

---

## L'idea

In PokéRogue una mossa/abilità è **dati + una lista di attributi componibili**. Gli attributi sono
"mattoncini" riutilizzabili: implementati **una volta**, servono a centinaia di mosse.

- Mosse: **937 definizioni** costruite da **219 attributi** (`class *Attr` in `../PokeRogue/src/data/moves/move.ts`).
- Abilità: **319 definizioni** costruite da **224 attributi** (`class *AbAttr` in `../PokeRogue/src/data/abilities/ab-attrs.ts`).

**Non copiare il corpo di quelle classi** (richiamano il motore Phaser dell'originale): leggilo come
**specifica** e reimplementa il mattoncino contro il nostro motore DOM, più semplice.

---

## Come progettare i mattoncini nel nostro motore

Un attributo è una funzione/oggetto con "hook" nei momenti chiave del turno. Interfaccia suggerita:

```js
// Pseudocodice — un attributo di mossa
{
  // quando applicare l'effetto: onHit, onBeforeMove, onMiss, onCharge, ...
  apply(context) {
    // context = { user, target, move, battle, rng, log(...) }
    // muta lo stato di gioco e scrive messaggi nel log di battaglia
  }
}
```

Una mossa nel nostro JSON diventa:
```json
{
  "id": "FIRE_PUNCH", "type": "FIRE", "category": "PHYSICAL",
  "power": 75, "accuracy": 100, "pp": 15, "effectChance": 10, "priority": 0,
  "attrs": [ { "kind": "StatusEffect", "status": "BURN" } ],
  "flags": ["punch", "contact"]
}
```
Il motore, alla risoluzione della mossa, esegue in ordine gli `attrs` registrati.

---

## Nucleo di mattoncini da fare per primi (coprono la maggior parte delle mosse Gen 1)

Priorità alta (senza questi non parte quasi nulla):
- **Danno base** (fisico/speciale con STAB + tipi) — è il calcolo, non un attr
- `StatusEffectAttr` — infliggi stato (burn, paralisi, sonno, veleno, congelamento)
- `StatStageChangeAttr` — modifica statistiche (±1/±2, su sé o bersaglio)
- `MultiHitAttr` — colpi multipli (2, 2-5)
- `FlinchAttr` — tentennamento
- `HighCritAttr` — alta probabilità di critico
- `RecoilAttr` / `HealAttr` — contraccolpo / cura
- `OneHitKOAttr` — KO immediato
- `TrapAttr` — intrappola (bind, wrap…)
- `ChargeAttr` / semi-invulnerabilità (Fly, Dig, Solar Beam)
- `ForceSwitchOutAttr` — costringe al cambio (Whirlwind/Roar)
- Gestione **priorità**, **precisione/mancato colpo**, **PP**, **bersaglio** (self/nemico/tutti)

Priorità media (arricchiscono, ma differibili):
- meteo/terreno, protezioni, assorbimento HP variabile, danno fisso, ricarica,
  raddoppio-danno-contro-tag, danno basato su peso/velocità, ecc.

Bassa/rara: gli attributi molto specifici di poche mosse — implementabili all'occorrenza.

> Regola pratica: implementa un mattoncino **quando serve alla prima mossa che lo usa**. Partendo
> dalla Gen 1 emergerà naturalmente il sottoinsieme necessario.

---

## Abilità

Stesso schema, ma gli hook sono su eventi diversi (all'ingresso, quando vieni colpito, a fine turno,
sul calcolo danno, ecc.). Esempi dall'originale:
```
STATIC     → PostDefendApplyStatusEffectAbAttr(30%, PARALYSIS)   // "se ti colpiscono in contatto, 30% paralisi"
INTIMIDATE → PostSummonStatStageChangeAbAttr(ATK -1, ai nemici)  // "all'ingresso, abbassa Attacco nemico"
LEVITATE   → immunità a mosse di Terra
```
Per la Gen 1 servono poche decine di abilità: implementa prima quelle degli starter e dei Pokémon
più comuni.

---

## Verifica di correttezza

- Il **calcolo del danno** deve seguire la formula standard (livello, atk/def, potenza, STAB, tipi,
  critico, random 85-100%). È ben documentata; l'originale la applica in `src/data/moves/` + `field/`.
- Testa qualche mossa nota a mano (es. un super-efficace, un multi-colpo, uno stato) per validare
  il motore prima di collegare tutte le mosse.
