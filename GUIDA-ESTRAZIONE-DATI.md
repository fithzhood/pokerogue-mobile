# Guida all'estrazione dati e asset da `../PokeRogue`

Percorsi **verificati** nel repo PokéRogue originale (cartella sorella `../PokeRogue`).
Servono alla Fase 1 per generare i JSON del nuovo gioco. Tutti i percorsi sono relativi a `../PokeRogue`.

---

## 1. Specie Pokémon — dati e learnset (TUTTO nello stesso posto)

`src/data/balance/species/generation-01.ts` … `generation-09.ts`

Ogni file esporta `initGenerationX()` e definisce ogni specie come **oggetto strutturato** già pronto.
Esempio reale (Bulbasaur):

```ts
generationOneSpeciesData[SpeciesId.BULBASAUR] = {
  species: new PokemonSpecies({
    id: SpeciesId.BULBASAUR,
    generation: 1,
    category: "Seed Pokémon",
    type1: PokemonType.GRASS,
    type2: PokemonType.POISON,
    height: 0.7, weight: 6.9,
    ability1: AbilityId.OVERGROW, ability2: AbilityId.NONE, abilityHidden: AbilityId.CHLOROPHYLL,
    baseTotal: 318,
    baseHp: 45, baseAtk: 49, baseDef: 49, baseSpatk: 65, baseSpdef: 65, baseSpd: 45,
    catchRate: 45, baseFriendship: 50, baseExp: 64,
    growthRate: GrowthRate.MEDIUM_SLOW, malePercent: 87.5, genderDiffs: false,
  }),
  starter: SpeciesId.BULBASAUR,
  starterCost: 3,
  evolutions: [new SpeciesEvolution({ speciesId: SpeciesId.IVYSAUR, level: 16 })],
  eggTier: EggTier.COMMON,
  passives: AbilityId.GRASSY_SURGE,
  levelMoves: [ [1, MoveId.TACKLE], [1, MoveId.GROWL], [4, MoveId.VINE_WHIP], /* ... */ ],
  tms: [ MoveId.SWORDS_DANCE, MoveId.BODY_SLAM, /* ... */ ],
};
```

**Per la Gen 1** basta `generation-01.ts`. Contiene già: statistiche base, tipi, abilità (normali +
nascosta), altezza/peso, tasso di cattura, growth rate, **learnset (`levelMoves`)**, evoluzioni, egg tier,
costo starter, TM. → si trasforma in `species.json` + `learnsets.json`.

Enum id specie: `src/enums/species-id.ts` (1.084 voci). Servono per mappare id→nome.

---

## 2. Mosse — parametri + composizione ad attributi

`src/data/moves/move.ts` (unico file, ~12.766 righe):
- **Le 219 classi di attributo** (`class *Attr`) stanno nella prima parte del file.
- **La funzione `initMoves()`** (intorno a riga 9476) contiene le **937 definizioni** dichiarative.

Formato costruttore (i primi argomenti sono DATI puri):
```
new AttackMove(MoveId.FIRE_PUNCH, PokemonType.FIRE, MoveCategory.PHYSICAL, 75, 100, 15, 10, 0, 1)
//            id                  tipo               categoria             pot prec PP  eff prio gen
  .attr(StatusEffectAttr, StatusEffect.BURN)   // ← composizione (mattoncino + parametri)
  .punchingMove()                              // ← flag
```
Classi base: `AttackMove`, `StatusMove`, `SelfStatusMove`, `ChargingAttackMove`.
Enum id mosse: `src/enums/move-id.ts` (~952 voci).

→ Estrai i **parametri** in `moves.json`; estrai la **lista di attributi+parametri** come parte
dichiarativa (vedi `RIFERIMENTO-MATTONCINI.md` per come implementarli).

---

## 3. Abilità — stesso schema delle mosse

- Classi di attributo (224): `src/data/abilities/ab-attrs.ts`
- Definizioni (319): `src/data/abilities/init-abilities.ts`, formato:
  ```
  new AbBuilder(AbilityId.STATIC, 3)
    .attr(PostDefendApplyStatusEffectAbAttr, 30, true, StatusEffect.PARALYSIS)
    .build()
  ```
- Enum id: `src/enums/ability-id.ts` (~319 voci).

---

## 4. Tabella dei tipi (efficacie)

`src/data/type.ts` — logica di `getTypeDamageMultiplier` con gli `switch` per tipo attaccante/difensore.
→ Ricostruisci una **matrice 18×18** in `typechart.json` (moltiplicatori 0 / 0.5 / 1 / 2).

---

## 5. Evoluzioni

`src/data/balance/pokemon-evolutions.ts` (condizioni, livelli, oggetti-evolutivi).
Nota: le evoluzioni base per specie sono anche nel campo `evolutions` dei file `generation-0X.ts` (§1).

---

## 6. Oggetti / modifier (per il loop roguelite, Fase 5)

`src/modifier/modifier-type.ts` (~156 tipi). Da qui si prende l'elenco e l'effetto degli oggetti
(cure, potenziamenti, poké ball, ecc.).

---

## 7. Biomi / ondate (Fase 5)

- Pool per bioma: `src/data/balance/biomes/*.ts` (un file per bioma: abyss, badlands, beach, …).
- Struttura modalità/ondate: `src/game-mode.ts`.

---

## 8. Uova / gacha / schiusa (Fase 7)

`src/data/egg.ts` (tier, tassi, generazione) e `src/data/egg-hatch-data.ts`.

---

## 9. Asset grafici

Cartella `assets/images/` (306 MB totali). Struttura sprite Pokémon:

```
assets/images/pokemon/            → sprite fronte, per id: 1.png + 1.json (atlas), 2.png … (front)
assets/images/pokemon/back/       → sprite retro (il tuo Pokémon visto di spalle)
assets/images/pokemon/icons/      → icone piccole (liste/party)
assets/images/pokemon/shiny/      → varianti shiny
assets/images/pokemon/female/     → differenze di genere
assets/images/pokemon/variant/    → varianti di colore
assets/images/pokemon/exp/        → sprite "sperimentali"/alternativi
```

I `.json` accanto ai `.png` sono **atlas di animazione** (frame). Per una v1 semplice puoi anche
usare il singolo frame statico; per l'animazione, leggi l'atlas.
**Per la Gen 1** copia solo gli id 1–151 (front + back + icons) per tenere il peso basso.

Altri asset utili: `assets/images/ui/` (elementi interfaccia), `assets/battle-anims/` (animazioni mosse,
55 MB — opzionali in v1), `assets/fonts/` (i font "pokémon", 7 MB).

---

## Strategia di estrazione consigliata

I file `generation-0X.ts`, `move.ts`, ecc. sono **TypeScript con dati strutturati**. Due approcci:
1. **Script Node** che importa i moduli (via ts-node / tsx) e serializza gli oggetti in JSON.
2. **Parsing testuale** mirato (i dati sono regolari e ripetitivi).

L'approccio 1 è più robusto perché riusa gli enum reali. In ogni caso, genera JSON **con i nomi
leggibili** (non solo id numerici) per facilitare il debug del nuovo gioco.
