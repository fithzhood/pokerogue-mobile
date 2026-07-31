# Prompt — Costruire "PokéRogue Mobile" da zero

> Incolla questo come **primo messaggio** in una sessione **pulita** di Claude Code,
> aperta nella cartella `Documenti/app/pokerogue-mobile`.
> È autosufficiente: non dà per scontato nessun contesto di conversazioni precedenti.

---

## Chi sei e cosa costruisci

Sei uno sviluppatore che parte da zero per creare **un gioco personale, offline, per cellulare**:
un roguelite Pokémon ispirato a **PokéRogue**, riscritto in **HTML + CSS + JavaScript puri** (niente
game engine, niente framework pesanti). Il gioco è **solo per uso personale del proprietario**, non
verrà pubblicato né distribuito.

Nella cartella **sorella `../PokeRogue`** c'è il progetto PokéRogue originale (TypeScript + Phaser/WebGL,
~300.000 righe). **NON copiarne il codice** né la sua architettura: quel codice è accoppiato a Phaser e
al suo sistema a fasi, ed è proprio ciò da cui ci allontaniamo. Usa `../PokeRogue` **solo come
sorgente di DATI e ASSET** (statistiche, mosse, sprite, ecc.), seguendo la guida di estrazione allegata.

> **Perché da zero e non modificando PokéRogue:** tentare di adattare al touch e impacchettare
> l'originale si è rivelato fragile (retrofit del touch schermata per schermata, e un bug del dialogo
> file dovuto al canvas WebGL che satura la GPU). Un'app **basata su DOM** elimina alla radice
> entrambe le classi di problemi: gli elementi HTML sono cliccabili di natura e non c'è WebGL.

---

## Vincoli fissi (NON negoziabili)

1. **Stack**: HTML + CSS + JavaScript (ES modules). UI costruita a mano con elementi DOM.
   È ammesso **Vite** solo come dev-server/bundler e **Capacitor** solo per l'APK finale.
   **Vietati** React/Vue/Angular e qualsiasi game engine (Phaser, Pixi, ecc.).
2. **100% offline**: nessuna rete, nessun login, nessun account, nessuna classifica, nessuna
   telemetria. Il gioco funziona senza connessione, sempre.
3. **Niente pannello impostazioni**: il gioco è pre-configurato. Nessuna schermata opzioni.
4. **Lingua**: **solo italiano**, testi scritti direttamente nel codice (niente sistema i18n).
5. **Orientamento**: **verticale** (portrait). Layout a **due schermi** (vedi sezione dedicata).
6. **Salvataggi**: **3 slot**, in `localStorage`.
7. **Cattura**: in stile PokéRogue (a fine lotta scegli se catturare, non poké ball lanciate in campo).
8. **Audio**: **assente** in v1 (niente versi/cry né BGM). Si potrà aggiungere molto dopo.
9. **Ricompense GIF**: cartella di GIF **impacchettata nel build** (es. `assets/gifs/`); su vittoria
   contro un **allenatore** si mostra una GIF a caso in overlay. **Nessun file picker, mai** (per non
   rischiare blocchi su mobile). Le GIF le mette il proprietario nella cartella prima del build.
10. **Nessuna funzione che possa soft-lockare il gioco.**

---

## Filosofia dati: DATI vs LOGICA vs ASSET

Questa distinzione governa tutto il progetto:

- 🟢 **ASSET** (sprite, immagini): si **copiano** da `../PokeRogue/assets`. Costo ≈ 0.
- 🟢 **DATI** (stat base, tipi, learnset, evoluzioni, parametri delle mosse, tabella tipi): si
  **estraggono** da `../PokeRogue/src/data` in **JSON** e si riusano. Costo basso. Vedi
  `GUIDA-ESTRAZIONE-DATI.md`.
- 🔴 **LOGICA** (gli *effetti* di mosse/abilità/oggetti, l'IA, il loop): si **riscrive** contro il
  nostro motore, più semplice. È il lavoro vero, ma è **finito e prevedibile** (vedi sotto).

### Il motore a "mattoncini" (il cuore tecnico)

In PokéRogue una mossa **non** è codice monolitico: è **dati + una lista di attributi riutilizzabili**.
Esempio reale:
```
FIRE_PUNCH (Fuoco, Fisica, potenza 75, precisione 100, PP 15, 10% effetto)
  → attributo: infliggi stato BURN
  → flag: è un pugno
```
Numeri chiave (misurati nell'originale):
- **937 mosse** = definizioni dichiarative + **219 tipi di attributo** distinti.
- **319 abilità** = definizioni dichiarative + **224 tipi di attributo** distinti.

**Conseguenza operativa:** implementa una volta i **mattoncini** (le classi di attributo) nel nostro
motore, poi ogni mossa/abilità diventa quasi **solo dati** ("questa mossa = questi mattoncini con questi
parametri"), che si traducono quasi meccanicamente dall'originale. Un **nucleo di ~40-60 mattoncini**
copre già la maggior parte delle mosse comuni. Dettagli e percorsi in `RIFERIMENTO-MATTONCINI.md`.

---

## Portata: partire da Gen 1, ma architettura full-dex-ready

- **v1 spedisce i primi 151 Pokémon** (Gen 1) con le loro mosse/abilità.
- **L'obiettivo finale è avere TUTTI i Pokémon presenti in PokéRogue** (~1.084 specie).
- Perciò: **progetta dati e motore data-driven fin dall'inizio**, così passare da 151 a tutti è
  **aggiungere JSON**, non rifare l'architettura. Non prendere scorciatoie che leghino il codice alla
  sola Gen 1.

---

## Layout a due schermi (stile Pokémon Sole/Luna)

Telefono in **verticale**. Lo schermo è diviso in due zone fisse:

```
┌─────────────────────────┐
│                         │
│   SCHERMO SUPERIORE      │  ← scena: sprite dei Pokémon, barre HP, stato,
│   (immagini / scena)     │     meteo, animazioni, overlay GIF-reward.
│                         │     NESSUN comando touch qui.
├─────────────────────────┤
│                         │
│   SCHERMO INFERIORE      │  ← TUTTI i menu e i pulsanti: mosse,
│   (menu / comandi)       │     Lotta/Borsa/Squadra/Fuggi, liste, conferme.
│                         │     Tutto il touch avviene qui.
└─────────────────────────┘
```

- Due contenitori DOM (sopra/sotto), layout flex/grid, unità relative (`vh`, `%`).
- Ogni schermata di gioco cambia **solo** il contenuto del riquadro inferiore; la scena resta sopra.
- I comandi in basso = raggiungibili dal pollice. La separazione netta evita tap ambigui.
- Gli sprite di PokéRogue sono orizzontali: in verticale lo schermo superiore sarà più basso e largo
  (i due lottatori affiancati). Taralo nel primo prototipo.

---

## Fasi di sviluppo (ognuna deve essere giocabile/testabile da sola)

> Regola d'oro: **niente sorprese a fine progetto.** A ogni fase l'app deve girare nel browser e
> mostrare qualcosa di verificabile. Testa nel browser prima di procedere alla fase successiva.

0. **Setup**: struttura cartelle, `index.html`, il layout a due schermi vuoto, dev-server.
1. **Estrazione dati**: script che legge `../PokeRogue/src/data` e produce
   `data/species.json`, `data/moves.json`, `data/abilities.json`, `data/learnsets.json`,
   `data/typechart.json` (per ora solo Gen 1, ma formato full-dex). Copia gli sprite Gen 1.
2. **Lotta 1v1 base**: due Pokémon, 4 mosse, calcolo danno con tabella tipi, PP, KO, messaggi di
   battaglia. Solo scena sopra + menu mosse sotto. Turni gestiti da una macchina a stati.
3. **Motore a mattoncini**: implementa il nucleo di attributi-mossa (stato, buff/debuff statistiche,
   multi-colpo, priorità, critico, flinch, cura, ecc.) e collega le mosse Gen 1 ai loro attributi.
4. **Abilità**: motore attributi-abilità + le abilità della Gen 1.
5. **Loop roguelite**: ondate crescenti, biomi, allenatori, boss; generazione premi tra un'ondata e
   l'altra; oggetti/modifier di base.
6. **Squadra & cattura**: party, cambio Pokémon, cattura in stile PokéRogue, box/deposito.
7. **Uova / gacha / schiusa**: lista uova, gacha, schiusa (fulcro richiesto dal proprietario).
8. **Ricompense GIF**: overlay su vittoria-allenatore da cartella `assets/gifs/` impacchettata.
9. **Rifinitura mobile + APK**: Capacitor, build offline, test sul dispositivo target
   (**Samsung Galaxy A25 5G**, portrait).

---

## Regole di lavoro

- **Semplicità prima di tutto**: preferisci codice che il proprietario possa capire riga per riga.
- **Non rompere** ciò che già funziona quando aggiungi una fase.
- **Data-driven**: nuove specie/mosse = nuovi dati, non nuovo codice speciale.
- **Chiedi** prima di scelte che allargano lo scope o cambiano l'architettura.
- **Testa nel browser** a ogni fase (il gioco è DOM: usa gli strumenti del browser per verificare
  render, tap, console).
- **Vietato**: aggiungere online, pannello impostazioni, file picker, un game engine, o copiare il
  codice Phaser di `../PokeRogue`.

## Come iniziare

Leggi in questa cartella: `STUDIO-FATTIBILITA.md` (analisi completa), `GUIDA-ESTRAZIONE-DATI.md`
(dove sono i dati/asset nell'originale) e `RIFERIMENTO-MATTONCINI.md` (il sistema di attributi).
Poi proponi al proprietario la struttura di cartelle e parti dalla **Fase 0**, poi **Fase 1**,
fermandoti a mostrare risultati verificabili.

> **Suggerimento**: valuta di iniziare con un **prototipo minimo della Fase 2** (una singola lotta
> 1v1 giocabile) per validare subito il layout verticale e la sensazione al tatto, prima di
> investire sul resto.
