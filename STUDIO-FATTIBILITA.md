# Studio di fattibilità — Remake snello di PokéRogue in HTML/CSS/JS

_Documento di analisi. Nessun codice scritto. Serve a decidere lo scope prima di
generare il prompt per una sessione pulita di Claude Code._

---

## 1. Verdetto in una riga

**Fattibile — ma la difficoltà non è l'engine, è la mole di contenuti.**
Passare a un'app DOM/JS snella elimina alla radice i problemi che ci hanno bloccato
(retrofit del touch, dialogo file bianco da GPU WebGL) e ci dà pieno controllo.
Il costo vero è **riscrivere la logica di mosse/abilità/oggetti**: lì sta il 90% del lavoro,
e si domina solo con uno **scope aggressivo**.

---

## 2. Scope confermato (tue scelte)

- ✅ Riusare gli **asset** di PokéRogue (sprite, audio, animazioni).
- ✅ Gioco **più snello**, con le sole feature essenziali.
- ✅ **Via tutto l'online** (login, account, classifiche, stats server, daily seed condiviso).
- ✅ **Niente pannello impostazioni** — il gioco è pre-configurato come vogliamo noi.
- ✅ **Ricompense GIF esterne** mantenute (e in un'app DOM sono banali e senza rischi).

---

## 3. Anatomia dell'app attuale (numeri reali dal repo)

| Cosa | Quantità |
|---|---|
| Codice TypeScript | **~300.000 righe**, 615 file |
| Specie Pokémon | **1.084** |
| Mosse | **952** (di cui ~937 con effetto codificato a mano) |
| Abilità | **319** (~484 chiamate di costruzione) |
| Oggetti / modifier | **156+** tipi (~282 definizioni) |
| Fasi di battaglia (`phases/`) | **97** file |
| UI (Phaser) | 97 file, ~40.000 righe |
| `data/moves/move.ts` (soli effetti mosse) | **12.766 righe** in un solo file |

**Asset (~817 MB):** audio 443 MB · immagini 306 MB · battle-anims 55 MB · font 7 MB.

Questo spiega perché "ogni volta trovi un problema": la superficie di modifica è enorme,
e ogni schermata/meccanica è un punto dove qualcosa può rompersi.

---

## 4. Il concetto chiave: DATI vs LOGICA vs ASSET

È la distinzione che decide tutto. Le tre categorie hanno costi di riuso opposti:

### 🟢 ASSET — si **copiano** così come sono (costo ≈ 0)
Sprite, audio, animazioni, font. Indipendenti dall'engine. Basta linkarli.
_Nota: sono il grosso del peso (817 MB), non del lavoro._

### 🟢 DATI — si **riusano** quasi direttamente (costo basso)
Sono tabelle/valori, non logica:
- Statistiche base, tipi, altezza/peso delle specie
- Learnset (quali mosse a quale livello) — `data/balance/moves/`
- Evoluzioni — `data/balance/pokemon-evolutions.ts`
- Parametri numerici di ogni mossa (potenza, precisione, PP, tipo, categoria)
- Tabella dei tipi (efficacie/inefficace)

Questi si estraggono dai file del repo (o da PokéAPI) e si convertono in JSON.
**Non c'è bisogno di reinventarli.**

### 🔴 LOGICA — si deve **riscrivere** (costo alto → è "la montagna")
Gli *effetti* non sono dati, sono codice, e sono incollati al sistema a fasi di Phaser:
- L'effetto unico di ~937 mosse (non solo "fai danno": paralizza, ruba oggetto,
  cambia meteo, colpisce due volte, ignora protezioni, ecc.)
- Il comportamento di ~319 abilità
- L'effetto di ~156 oggetti roguelite
- L'IA nemica, il loop a ondate, la generazione dei premi

**Riscrivere questa logica è il progetto.** Non è portabile "copia-incolla" perché
dipende dall'architettura Phaser/phase attuale.

> **Implicazione strategica:** un remake "fedele al 100%" rifà la stessa montagna in un
> linguaggio diverso → più lungo, non più corto. Il senso del remake snello è
> **riusare dati+asset e implementare solo un sottoinsieme curato di logica**, che cresce nel tempo.

---

## 5. Cosa si guadagna passando a DOM/JS snello

| Problema attuale | Con app DOM |
|---|---|
| Touch da retrofittare schermata per schermata | Elementi HTML **nativamente** cliccabili → zero retrofit |
| Dialogo file bianco (GPU WebGL satura) | Nessun canvas WebGL → **il problema non esiste** |
| GIF non animabili nel canvas | `<img>` animate nativamente |
| ~300k righe da capire | Codebase piccolo, **ogni riga la capiamo noi** |
| Login/online da bypassare | Semplicemente non esiste |
| Save legato al sistema PokéRogue | `localStorage` / file JSON, semplice |

---

## 6. Cosa si taglia (snellimento)

- **Tutto l'online**: `api/`, `account.ts`, login, classifiche, stats, voucher server, daily condiviso.
- **Pannello impostazioni** (`system/settings/`): niente UI opzioni; i valori sono fissati nel codice.
- **Engine Phaser/WebGL** e le sue 40k righe di UI → sostituite da DOM+CSS molto più piccolo.
- **i18n multilingua** (`locales/`, i18next): un solo idioma cablato (italiano o inglese).
- **Mystery encounters, sfide, achievement, ribbon, migrazioni salvataggio**: opzionali, tagliabili in v1.
- **Doppie battaglie, forme regionali, mega/gigamax**: candidati al taglio iniziale, riaggiungibili.

---

## 7. "È difficile copiare le mosse e gli effetti?" — la scoperta chiave

**Risposta onesta: copia-incolla-e-funziona no, ma NON si parte da zero — ed è molto meglio di come sembra.**

Ho ispezionato come PokéRogue definisce mosse e abilità. Non sono blocchi di codice monolitici:
**sono già scritte in modo dichiarativo**, come _dati + una lista di "mattoncini" riutilizzabili_.

Esempio reale (dal loro `move.ts`):
```js
new AttackMove(FIRE_PUNCH, FUOCO, FISICA, pot:75, prec:100, PP:15, effetto:10%, prio:0, gen:1)
  .attr(StatusEffectAttr, BURN)   // mattoncino: "infliggi uno stato"
  .punchingMove()                 // flag: "è un pugno"
```
E un'abilità:
```js
new AbBuilder(STATIC, gen:3)
  .attr(PostDefendApplyStatusEffectAbAttr, 30, true, PARALYSIS)  // "quando vieni colpito, 30% paralisi"
  .build()
```

### I numeri che cambiano tutto

| | Definizioni (quasi-dati, **copiabili**) | Mattoncini distinti (logica, **da riscrivere**) |
|---|---|---|
| Mosse | **937** | **219** |
| Abilità | **319** | **224** |

**Cosa significa concretamente:**
- Le **1.256 definizioni** di mosse+abilità sono una lista dichiarativa → si **traducono quasi meccanicamente** (sono dati: potenza, tipo, quali mattoncini, con quali parametri).
- Il lavoro vero e **delimitato** è reimplementare i **~443 mattoncini** nel nostro motore
  (molti sono banali: critico-alto, multi-colpo, infliggi-stato, cambia-statistica, flinch…).
  Un **nucleo di 40-60 mattoncini** copre già la stragrande maggioranza delle mosse comuni.
- **Fatti i mattoncini, tutte le mosse arrivano quasi gratis.** È esattamente il motivo per cui
  "le vorrò tutte" (punto 1) è realistico: aggiungere mosse/specie dopo è **copiare dati**, non scrivere logica.

Quello che *non* è copiabile è il corpo delle classi-mattoncino, perché richiama il motore di
PokéRogue (fasi, `globalScene`, classe Pokemon, battler-tag). Ma quello lo si **legge come specifica**
e lo si riscrive contro il nostro motore, più semplice. È lavoro, ma **finito e prevedibile**, non infinito.

### Strategia consigliata (conferma la §1)
Costruire il motore a mattoncini + i dati **già pensati per la dex completa**, ma **partire spedendo
la Gen 1**. Implementare prima il nucleo di mattoncini che coprono le mosse Gen 1, poi allargare
il vocabolario mano a mano che si aggiungono generazioni. Giocabile presto, crescita a costo lineare.

> **Vincolo di progetto (perché "le vorrò tutte"):** struttura dati e motore vanno disegnati
> **full-dex-ready dal giorno 1** (data-driven), anche se in v1 carichiamo solo la Gen 1.
> Così passare da 150 a 1.084 specie è aggiungere JSON, non rifare l'architettura.

---

## 8. Architettura proposta (bozza)

- **Nessun game engine.** HTML + CSS + JS "vanilla" (o un filo di libreria leggera solo se serve).
- **UI a schermate DOM**: titolo → battaglia → premi → squadra → uova. Ognuna è markup + CSS.
- **Stato di gioco** in un oggetto JS centrale + `localStorage` per il salvataggio (**3 slot**).
- **Dati** come JSON generati una volta dai file del repo (script di estrazione), **full-dex-ready**.
- **Asset** serviti da cartella locale (nell'APK sono impacchettati → offline pieno).
- **Ricompense GIF**: cartella `gifs/` **impacchettata al build** (niente file picker, niente softlock).
- **Loop di battaglia** come semplice macchina a stati a turni (niente sistema a 97 fasi).
- **Lingua**: solo **italiano**, testi cablati (niente i18next).

### 8b. Layout verticale a due "schermi" (stile Pokémon Sole/Luna)

Telefono tenuto in **verticale**. Lo schermo è diviso in due zone fisse, come i due schermi del 3DS:

```
┌─────────────────────────┐
│                         │
│   SCHERMO SUPERIORE      │  ← scena: sprite Pokémon, HP, meteo,
│   (immagini / scena)     │     animazioni, GIF-reward. Nessun tocco qui.
│                         │
├─────────────────────────┤
│                         │
│   SCHERMO INFERIORE      │  ← menu e pulsanti: mosse, Lotta/Borsa/
│   (menu / comandi)       │     Squadra/Fuggi, liste. Tutto il touch qui.
│                         │
└─────────────────────────┘
```

Perché è la scelta giusta:
- **Ergonomia touch**: i comandi stanno in basso, nella zona raggiungibile dal pollice.
- **Separazione netta** scena/comandi → niente più tap che finiscono sulla scena sbagliata
  (uno dei problemi peggiori del retrofit sull'app attuale).
- **Mappa 1:1 col DOM**: due contenitori `<div>` (sopra/sotto) con layout flex/grid; ogni schermata
  cambia solo il contenuto del riquadro inferiore.
- **Coerente con l'immaginario Pokémon** che conosci (doppio schermo).

Nota: gli sprite di PokéRogue sono pensati per orizzontale; in verticale lo "schermo superiore"
sarà più basso e largo. Va benissimo per una scena di lotta (i due lottatori affiancati),
ma è un parametro di layout da tarare in fase di prototipo.

---

## 9. Piano a fasi (proposta di MVP → crescita)

1. **Estrazione dati**: script che legge il repo e produce `species.json`, `moves.json`, `learnsets.json`, `typechart.json`.
2. **Battaglia 1v1 base**: 2 Pokémon, 4 mosse, danno + tipi + PP + KO. Solo DOM.
3. **Motore effetti a mattoncini**: stati, buff/debuff, multi-colpo, priorità.
4. **Loop roguelite**: ondate crescenti, allenatori, boss, cattura.
5. **Squadra & party**: gestione, cambio, cattura, box.
6. **Uova / gacha / schiusa** (il tuo fulcro).
7. **Ricompense GIF** (bundle).
8. **Rifinitura mobile + APK offline.**

Ogni fase è giocabile e testabile da sola: niente più "sorprese a fine progetto".

---

## 10. Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| Rifare la stessa montagna | Scope aggressivo (strada A), sottoinsieme di specie/mosse |
| "Scope creep" verso il full-dex | Fasi con giocabilità a ogni step; espansione solo dopo un MVP solido |
| Peso asset (817 MB) | Includere solo gli asset delle specie scelte; audio opzionale/compresso |
| Estrazione dati laboriosa | Script una tantum; in alternativa PokéAPI |
| Bilanciamento del gioco | È un gioco personale: si tara sul tuo gusto, non serve equilibrio competitivo |

---

## 11. Licenza / uso personale

- **Codice** PokéRogue: **AGPL-3.0** (Pagefault Games). Riusare *dati* estratti e scrivere codice
  nuovo è un discorso diverso dal copiare il loro codice; per un progetto **personale non distribuito**
  non è un problema pratico.
- **Asset / IP Pokémon**: proprietà Nintendo/Game Freak. **Uso personale e offline**, nessuna
  pubblicazione o distribuzione. Resta una tua scelta, ma per un'app solo-per-te è la prassi comune.

---

## 12. Decisioni fissate

1. **Dex**: si parte dalla **Gen 1**, ma architettura **full-dex-ready** (obiettivo: tutte, 1.084).
2. **Mosse**: strada a **mattoncini** (motore di attributi riusabili) — confermata.
3. **Lingua**: **italiano**, unico, testi cablati.
4. **Roguelite v1**: **battaglia + ondate + uova/gacha**.
5. **Sprite**: quelli di **PokéRogue** (riuso asset).
6. **Salvataggi**: **3 slot**.
7. **Layout**: verticale, **due schermi** (sopra immagini, sotto menu/comandi) — vedi §8b.

### Micro-decisioni residue (le fissiamo al volo prima del prompt, o le lascio come default sensati)
- Cattura in stile PokéRogue (a fine lotta, non con le poké ball in campo) o classica?
- Nella dex Gen 1: 151 base, oppure includere subito evoluzioni cross-gen legate (es. scelte tue)?
- Audio: includere i versi/cry e le BGM (pesano) o partire muti e aggiungerli dopo?

---

## 13. Prossimo passo

Le decisioni principali ci sono. Il passo successivo è **generare il prompt completo e
autosufficiente** per la sessione pulita di Claude Code, che includerà:
obiettivo, vincoli (offline, no online, no impostazioni, GIF bundle, italiano, 3 slot),
il **layout a due schermi**, l'architettura data-driven full-dex-ready, il **motore a mattoncini**,
lo script di estrazione dati, e l'**ordine delle fasi** (dati → lotta 1v1 → mattoncini → ondate →
squadra/cattura → uova/gacha → GIF → APK).

Da decidere solo: partire subito col prompt, o prima un **prototipo mono-schermata** (una lotta 1v1
giocabile) per validare il layout verticale e la sensazione al tatto prima di impegnarsi sul resto.
