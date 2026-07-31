# PokéRogue Mobile — materiali di avvio

Cartella di **kickoff** per costruire da zero un roguelite Pokémon personale, offline, per cellulare,
in HTML/CSS/JS puri — ispirato a PokéRogue e che ne riusa **dati e asset** (non il codice).

Il progetto originale sta nella cartella sorella **`../PokeRogue`** e serve **solo** come sorgente di
dati/asset.

## File in questa cartella

| File | A cosa serve |
|---|---|
| **`PROMPT.md`** | **Il prompt da incollare** come primo messaggio in una sessione pulita di Claude Code. Autosufficiente. |
| `STUDIO-FATTIBILITA.md` | Analisi completa: numeri del progetto, cosa è riusabile, rischi, piano a fasi, layout. |
| `GUIDA-ESTRAZIONE-DATI.md` | Percorsi **esatti e verificati** in `../PokeRogue` per estrarre specie, mosse, abilità, tipi, sprite, uova, biomi. |
| `RIFERIMENTO-MATTONCINI.md` | Come funziona il motore ad attributi ("mattoncini") che rende fattibile avere tutte le mosse. |

## Come si comincia

1. Apri una **sessione pulita** di Claude Code nella cartella `pokerogue-mobile`.
2. Incolla il contenuto di **`PROMPT.md`** come primo messaggio.
3. La sessione leggerà gli altri tre documenti e partirà dalla Fase 0 → Fase 1.

## Decisioni già fissate (dal proprietario)

- Stack: **HTML/CSS/JS puri** (no engine, no framework). Vite solo per dev/build, Capacitor per l'APK.
- **Offline totale**, niente online/login. **Niente pannello impostazioni**. **Italiano** unico.
- **Verticale**, layout a **due schermi** (sopra immagini, sotto menu/comandi).
- **3 slot** di salvataggio. **Cattura stile PokéRogue**. **Niente audio** in v1.
- **Ricompense GIF** da cartella impacchettata (niente file picker).
- Si parte dai **primi 151**, ma l'obiettivo è **TUTTI i Pokémon di PokéRogue** (~1.084):
  architettura **data-driven full-dex-ready** dal giorno 1.
- Dispositivo target: **Samsung Galaxy A25 5G**, portrait.
