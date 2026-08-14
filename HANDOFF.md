# HANDOFF — PokéRogue Mobile

Documento per una **nuova sessione di Claude Code**. Leggilo tutto prima di toccare il codice.
Aggiornato: 2026-08-14 · Stato: **rev 47 pubblicata, 0 errori console**.

## 🔴 Leggi questo prima di tutto

Il 31 luglio il proprietario aveva detto: *«ci sono un sacco di cose da sistemare, siamo
lontani anni luce da PokéRogue originale, centinaia di piccole cose»*. Il **13-14 agosto**
quella lista è arrivata davvero, una segnalazione alla volta mentre giocava sul telefono:
**38 segnalazioni, 33 chiuse e pubblicate**.

👉 **Vai al §29**: racconta cosa è cambiato, **le 5 cose che restano** con l'indagine già
fatta, e le trappole in cui si ricasca ogni volta.

✅ **LE 5 SONO TUTTE CHIUSE (2026-08-14).** Più l'**evoluzione a pieno schermo**, chiesta a
voce in corsa. Non resta niente della lista del §29:
1. ~~stato e stadi che persistono fra le ondate~~ → ✅ §30.1
2. ~~animazione di ritiro e uscita dalla ball~~ → ✅ §30.3
3. ~~scelta della natura nella scheda starter~~ → ✅ §31.3
4. ~~consultare mossa e Pokémon in «quale mossa dimentica»~~ → ✅ §31.2
5. ~~le 9 mosse a potenza di ripiego~~ → ✅ §31.1

Cosa resta aperto in tutto il progetto: **le fusioni (DNA Splicers)**, accantonate dal
proprietario — non farle senza chiedere — e la Terastallizzazione, che ha escluso.

🔴 **Prima di indagare una segnalazione, chiedi che revisione sta usando**: la Home mostra
in fondo `rev N · da rete/da APK`. Due volte ha segnalato difetti **già corretti** perché il
telefono era indietro (l'aggiornamento si applica al riavvio *successivo* a quello che lo
scarica).

⚠️ E vale la regola del §23, che qui conta il doppio: **guardare, non leggere il DOM**.
Nessuna delle "centinaia di piccole cose" sarebbe uscita da un'asserzione su `window.__game`.

---

## Dove siamo — leggi prima questo

Le sezioni **1-9** sono la mappa generale; le **10-25** raccontano cosa è stato fatto di
recente e *perché*, con le trappole incontrate. Il §6 è la vecchia lista di cose da fare:
è tutto chiuso, i riquadri ✅ dicono dove.

Se hai poco contesto, **leggi in quest'ordine**: questo riquadro → §2 (file e comandi) →
§7 (regole non negoziabili) → §8 (come lavorare) → poi solo le sezioni che ti servono.

**Chiuso di recente**: animazioni vere delle mosse (§10, §6.1) · oggetti/premi/negozio
rifatti sull'originale (§10) · tutti e 31 gli incontri misteriosi (§11) · nature, MT, meteo,
oggetti di specie (§12) · oggetti tenuti dagli avversari e lotte in doppio (§13) · effetti
volatili, terreni, mosse a due turni (§14, §15) · sesso e sprite femminili (§16) ·
evoluzioni a condizione e giorno/notte (§17) · bioma END (§6.5) · forme/varianti e sprite
cromatici di tutto il dex (§18) · scena ripulita e griglia starter col dex (§19, §21) ·
lotta finale a due fasi (§20) · **rosa di 14 boss finali, uno per generazione (§22)** ·
pedane di END e ordine di sovrapposizione (§23) · Regigigas (§24) ·
**GIF di vittoria da uno zip scelto dall'utente (§25)** ·
**3 slot di salvataggio (§26)** · **giro di collaudo con tre difetti veri corretti (§27)**.

**Fase 9 FATTA (§28)**: il gioco è online su
<https://fithzhood.github.io/pokerogue-mobile/pokerogue.html>, l'APK contiene tutti gli
asset e **si aggiorna da solo dalla rete** senza reinstallazioni.
🔴 **Per pubblicare una modifica c'è UN SOLO comando**: `node tools/pubblica.mjs "…"`.
Farlo a mano dimenticando il manifesto = l'aggiornamento non arriva mai sul telefono.

**Resta aperta 1 cosa**:
- **Fusioni** (DNA Splicers) — accantonate dal proprietario, non farle senza chiedere.
  Restano anche i `BattlerTagType` più esotici e la Terastallizzazione (esclusa da lui).

### Le tre trappole che mi hanno morso più volte

Sono la causa di quasi tutto il tempo perso; valgono più di qualunque altra pagina.

1. **Una regola CSS che ne sovrascrive un'altra solo a metà.** Successo tre volte:
   `.battler-slot[hidden]` (§19), `.held-bar.enemy` senza `bottom: auto` (§24),
   `#game.double .platform` che ridichiarava misure ormai inline (§21). Quando tocchi una
   regola, **controlla sempre la proprietà opposta** (top/bottom, left/right) e se quella
   che stai scrivendo può perdere per specificità.
2. **Gli autopiloti "clicca il primo bottone" mentono.** Si impantanano (schermata premi,
   cattura, cambio forzato) *e* possono scegliere la cosa sbagliata: in §24 sceglievano una
   mossa a danno fisso e sembrava che i turni non girassero. Prima di incolpare l'ambiente,
   **leggi la narrazione e guarda cosa sta davvero facendo**.
3. **Guarda SEMPRE anche la grafica**, non solo i numeri (regola data dal proprietario, §23).
   Due difetti stavano sotto gli occhi in ogni prova mentre io leggevo solo il DOM. Uno
   screenshot per feature costa poco.

---

## 1. Cos'è

Remake personale di **PokéRogue** in **HTML/CSS/JS puri** (no framework, no game engine),
**offline**, **italiano**, **verticale**, per il telefono del proprietario (Samsung Galaxy A25 5G).
Riusa **dati e asset** dell'originale, **non il codice** (quello è TypeScript+Phaser).

- Cartella di lavoro: `Documenti/app/pokerogue-mobile/`
- Sorgente originale (**sola lettura**, per dati/asset): `Documenti/app/PokeRogue/`
- Documenti di progetto già presenti: `PROMPT.md`, `STUDIO-FATTIBILITA.md`,
  `GUIDA-ESTRAZIONE-DATI.md`, `RIFERIMENTO-MATTONCINI.md`, `README.md`

⚠️ **Nota su `PROMPT.md`**: contiene un'imprecisione storica — dice che in PokéRogue si cattura
"a fine lotta". **Falso**: nell'originale la ball è un comando del turno. Il gioco ora implementa
il comportamento corretto (vedi §5). Non tornare indietro basandoti su quel documento.

---

## 2. File e comandi

| File | Cosa |
|---|---|
| `pokerogue.html` (90 righe) | Entry point. **Mai `index.html`** (il proprietario ospita più app insieme) |
| `pokerogue.js` (~6700 righe) | Tutto il gioco, un unico IIFE |
| `pokerogue.css` (~815 righe) | Layout due schermi + tutte le schermate |
| `tools/extract-data.mjs` (~760 righe) | Genera i JSON da `../PokeRogue`. **Unica fonte dei dati** |
| `tools/extract-anims.mjs` (~200 righe) | Genera le animazioni delle mosse (§10) |
| `tools/copy-sprites.mjs` (~120 righe) | Copia da `../PokeRogue` gli sprite mancanti, nei quattro tagli (§18) |
| `data/*.json` | Output degli estrattori (**non editare a mano**) |
| `assets/` | **128 MB reali**: sprite Pokémon (120), animazioni (3,2), allenatori (2,9), UI (1,5) |

⚠️ `du -sh` dice ~158 MB perché conta i **blocchi**: i file sono 13.000 e piccoli, quindi lo
spreco di fine blocco è enorme. Per l'APK conta la dimensione **reale**, 128 MB:
`du -sb --apparent-size assets`.

**Rigenerare i dati:**
```bash
node tools/extract-data.mjs
```

**Riprendere gli sprite mancanti** (idempotente, `--dry` per vedere prima):
```bash
node tools/copy-sprites.mjs
```

**Avviare (dev server già configurato):** `preview_start` con nome `pokerogue-mobile`
→ serve su `http://localhost:5512`, apri **`/pokerogue.html`**.
La config sta in `OneDrive/.claude/launch.json` (python http.server, porta 5512).
⚠️ Se un'altra sessione tiene occupata la 5512 c'è la gemella **`pokerogue-mobile-b` sulla
5513**: usa quella invece di litigare per la porta.

**Cache-proof** (regola del proprietario). ⚠️ **Questo paragrafo era rimasto a un meccanismo
superato** e mi ha fatto perdere un giro (§30.5): da quando c'è `pokerogue-boot.js` (§28)
`pokerogue.html` è solo un guscio e **non contiene più nessun `?v=`**. Il gioco vero viene
caricato dal boot come `pokerogue.css?v=<rev>` / `pokerogue.js?v=<rev>`, dove `rev` è quella
di `versione.json` — e quel file lo rigenera **`node tools/make-manifest.mjs`**.

- **Dopo ogni modifica, prima di provarla nel browser**: `node tools/make-manifest.mjs`
  (è il passo 1 di `pubblica.mjs` e non pubblica niente). Se lo salti, il browser ti serve la
  versione vecchia allo stesso URL e finisci a cercare un bug che hai già corretto.
- `node tools/pubblica.mjs "…"` lo fa da sé: per pubblicare basta quello.
- **I dati** hanno ancora una versione loro, `DATA_V` in `pokerogue.js` (vale sia per
  `data/*.json` sia per `data/anims/*.json`): va alzata **a mano** quando rigeneri i JSON.
- Rileggi sempre i valori veri invece di fidarti di questa riga:
  `head -3 versione.json` e `grep 'const DATA_V' pokerogue.js`.
  (Revisione a fine sessione 2026-08-14: **rev 49 · data v=20**.)

**Debug utile:**
- `?fast` → narrazione a 40ms invece di 780ms (test rapidi)
- `?p=SPECIE` → salta la scelta starter · `?e=SPECIE` → forza il primo nemico
- `window.__game` → stato completo della run (ispezionabile da console)
- **`window.__items`** → il coltellino svizzero per i test, costruito strada facendo:

| Comando | Cosa fa |
|---|---|
| `.pool` · `.roll(n)` | tabella oggetti · n estrazioni di premio |
| `.stock(ondata)` · `.waveMoney(w)` | merce e prezzi del negozio a una data ondata |
| `.stones()` | pietre evolutive utili alla squadra di adesso |
| `.berries(mon)` | fa scattare il controllo bacche e restituisce i messaggi |
| `.danno(mossa, meteo)` | **danno medio su 200 tiri, senza applicarlo** |
| `.encounters` · `.encOk()` · `.showEnc(id)` · `.pickEnc()` | incontri misteriosi |
| `.heldNemico(onda, boss, allenatore)` | distribuzione degli oggetti tenuti dai nemici |
| `.doppia()` | avvia subito una lotta in doppio |
| `.sprite(mon, lato)` | quale file sprite verrebbe caricato (utile per il sesso) |
| `.zona()` | forza il cambio bioma (per provare il salto in END) |
| `.bossFinali()` | la rosa dei 14 boss finali con tutte le fasi risolte (§22) |
| `.finale(livello, "ARCEUS")` | salta all'**ondata 200** con quel boss (senza nome: quello estratto) |
| `.finaleStato()` | fase/forma/tipi/mosse/scudi/stadi del boss in corso |
| `.clamp(danno)` | quanto danno **passerebbe** al boss, senza applicarlo (scudi e blocco a 1 PS) |

### Potenziare la squadra per i test

Il modo che funziona. `recomputeStats` non è esposto, ma non serve: si scrive direttamente
su quello che il motore legge. **Va riapplicato a ogni turno** (il gioco ricalcola le
statistiche ai passaggi di livello).

```js
for (const p of __game.party) {
  p.maxHp = p.hp = 9999999; p.fainted = false;
  p.stats  = { hp:9999999, atk:999999, def:999999, spatk:999999, spdef:999999, spd:99999 };
  p.stages = { atk:0, def:0, spatk:0, spdef:0, spd:0, acc:6, eva:0 };   // precisione piena
  p.moves  = [{ id:"PSYSTRIKE", pp:99, maxPp:99 }, { id:"AURA_SPHERE", pp:99, maxPp:99 }];
}
```

⚠️ **La riga delle mosse è obbligatoria**, non un extra: `finale()` alza il livello ma **non
reinsegna le mosse**, e con quelle di partenza un ciclo che clicca il primo bottone finisce
su una mossa a **danno fisso** (Psiconda) che ignora l'attacco. Il danno resta 0 comunque tu
gonfi le statistiche, e sembra che i turni non girino (§24).

- **`window.__forme`** → le FORME (§18). Le regole dipendono da bioma, ora, sesso e natura:
  a click vorrebbe dire giocare per ore sperando nell'incontro giusto.

| Comando | Cosa fa |
|---|---|
| `.dist("ROTOM", 400)` | distribuzione delle forme su 400 estrazioni |
| `.mon("ROTOM")` | un esemplare: forma, tipi, statistiche, abilità, sprite |
| `.regola("LYCANROC")` | che forma esce **adesso** (bioma e ora correnti) |
| `.evo("BURMY","WORMADAM","trash")` | la forma sopravvive all'evoluzione? |
| `.audit()` | **nessuna mega/gigamax fra le forme estraibili?** deve tornare lista vuota |

---

## 3. Dati estratti (tutti verificati)

| File | Voci | Note |
|---|---|---|
| `species.json` | **1084** | Tutte le 9 generazioni. `dex`, `gen`, `types`, `baseStats`, `abilities`, `passive`, `catchRate`, `eggTier`, `starterCost`, `evolutions` (**con tutte le condizioni**, §17), `noSprite`, **`malePercent`**, **`genderDiffs`** (§16) |
| `moves.json` | 952 | Parametri + `attrs` normalizzati (mattoncini) + effetto IT |
| `learnsets.json` | 1084 | `[[livello, MOSSA], …]` |
| `tms.json` | — | `perSpecie` (1063 specie) + `tier` (319 mosse): quali MT impara chi (§12) |
| `anims-index.json` | — | Indice delle animazioni: fogli sprite, mosse, comuni, cariche, ripieghi (§10) |
| `abilities.json` | 306 | Nomi/descrizioni IT + `attrs` (include le passive) |
| `biomes.json` | 35 | Pool per tier + `links` + colori sfondo. **Copertura 100%** |
| `forms.json` | 114 | 89 mega/primal + 31 gigamax con stat/tipi/abilità reali |
| `icons.json` | 1051 | Mini-icone: `dex → {atlas, x, y, w, h}` |
| `variants.json` | **191** | L'**array ORDINATO** delle forme di ogni specie (607 in tutto, 494 col nome IT ufficiale): `key`, `it`, `types`, `baseStats`, `ability`. ⚠️ **L'ordine è il dato**, vedi §18 |
| `typechart.json`, `types.json` | 18 | Matrice efficacia + nomi/colori IT |

**Trappole dell'estrattore già risolte** (non reintrodurle):
- I file `generation-0X.ts` contengono anche **riferimenti** a specie dentro le `tms` di altre:
  accettare solo le **assegnazioni** (`/^\w+\]\s*=\s*\{/`), altrimenti sovrascrivi i dati (bug PLUSLE).
- I mono-tipo hanno `type2: null` **letterale** → va scartato con `clean()`, altrimenti diventa `"null"`.
- I dex reali vanno letti dall'enum `species-id.ts` (auto-incrementante), non da un contatore.
- **55 specie non hanno sprite** (forme regionali dex 2000+/4000+) → marcate `noSprite:true` ed
  escluse dalle comparse in `SPECIES_KEYS`.

---

## 4. Architettura del gioco

**Layout**: due schermi fissi — `#top-screen` (68%, scena: sprite, barre HP, ritratto allenatore,
vassoio ball, indicatore ondata) e `#bottom-screen` (32%, **tutti** i comandi).
`#meta` è un overlay a schermo intero per home/starter/negozio/incontri/furto.

**Stato**: un solo oggetto `game` (run corrente) + `meta` persistito in `localStorage`
(chiave `pokerogue_mobile_meta_v1`): voucher, uova, starter sbloccati, caramelle, costCut,
passiveOn, IV migliori, record.

**Narrazione scaglionata**: il motore non applica gli effetti "tutti insieme". Durante la
risoluzione costruisce una lista di **eventi** (`makeLog()` → `snapEvent()`: testo + istantanea
di HP/stato/KO/colpo). `playEvents()` li riproduce **uno alla volta** con `TURN_DELAY`,
e `renderScene(frame)` disegna lo stato **di quel momento**. Un tap salta avanti.
→ Se aggiungi un effetto, **aggiungi un messaggio al log**, non modificare la UI direttamente.

**Mattoncini (mosse)**: **450/952** mosse hanno `attrs` riconosciuti — `status`, `statStage`,
`flinch`, `multiHit`, `highCrit`, `critOnly`, `recoil`, `drain`, `heal`, `confuse`, `ohko`,
e i volatili aggiunti dopo: `protect`, `trap`, `leechseed`, `recharge`, `perish`, `infatuate`,
`encore`, `taunt`, `torment`, `drowsy`, `nightmare`, `ingrain`, `aquaring`, `saltcure`,
`terrain`.
Le mosse senza attrs fanno comunque il danno base. Per aggiungerne uno:
`normalizeAttr()` nell'estrattore + un `case` in `applyMoveAttrs()`/`doDamage()`.

**Abilità**: `abAttrs(f)` unisce **abilità normale + passiva**. Attributi implementati:
`onSummonStat`, `statusImmunity`, `protectStats`, `typeImmunity`, `typeAbsorb`, `typeDamageMult`,
`statMult`, `typeBoost`, `lowHpTypeBoost`, `contactStatus`, `contactDamage`, `noRecoil`.
Funzionano anche le abilità che chiamano **meteo** (`WEATHER_ABIL`) e **terreno**
(`TERRAIN_ABIL`) entrando in campo. Restano no-op quelle legate a forme, party e IA.

---

## 5. Feature implementate (tutte verificate nel browser)

**Loop**: home → composizione squadra a punti → ondate → premi/negozio → bioma ogni 10 →
… → onda 200 → vittoria. Game over solo a squadra esaurita.

- **Starter a punti** (PokéRogue): budget **10**, `starterCost` 1-10. La griglia mostra i
  **544 capostipiti** (niente evoluti, §19): all'inizio ne sono sbloccati **27** — i tre di
  ogni regione, come `defaultStarterSpecies` — e gli altri sono **sagome nere** finché non li
  catturi. Filtri per nome/gen/tipo/stato/ordine; lo stato parte su «Schierabili».
  Dettaglio con stat, scelta abilità, scelta 4 mosse, badge ✨shiny/🎀fiocco/💜pokérus.
- **Caramelle**: +1 per cattura, +3 per schiusa. Spendibili per **−1 costo** (`5×base×(volte+1)`)
  e **sbloccare la passiva** (`10×base`). ⚠️ La passiva funziona **solo se sbloccata**.
- **IV** 0-31 per stat, usati nel calcolo. Le catture salvano i **migliori per specie** in
  `meta.ivs` → gli starter futuri li ereditano.
- **Fortuna**: +1 per membro con specie shiny sbloccata → sposta i pesi dei premi verso ULTRA/ROGUE.
- **Cattura fedele** (§domanda del proprietario): la ball è nel menu (**"Ball"**), si lancia
  **in battaglia**, **consuma il turno**, **lanci illimitati**; % da **HP correnti + stato**
  (37% → 100% su bersaglio indebolito e addormentato). Se il selvatico viene *sconfitto* invece
  che catturato → **una sola ultima ball** a fine lotta.
- **Theft Ball** (aggiunta originale, non esiste in PokéRogue): rate Ultra ×2, **droppata solo dai
  team cattivi** come premio garantito (recluta ×1 · admin ×2 · boss ×4, da `game.evilRank`).
  È l'**unica** ball che funziona sui Pokémon degli allenatori; rubando, il mon esce dal loro
  roster e l'allenatore manda il prossimo. **Vietata sul Rivale**.
- **Squadra**: party 6, cambio in lotta (usa il turno), cambio forzato al KO, box, cura dopo i boss.
- **Ondate**: selvatici dai pool bioma · **allenatori a tema** (14 classi con tipi coerenti) alle
  onde ×5 · **boss ogni 10** con scudi a segmenti · **69 capipalestra** di tutte le 9 regioni ogni 30.
- **Lega casuale per run**: `LEAGUES` (9 regioni) → E4 a **182/184/186/188**, Campione a **190**.
- **Team cattivo casuale per run**: 10 organizzazioni; reclute **35/62/64**, admin **66/114/164**,
  boss **115/165**.
- **Rivale** alle onde 8/25/55/95/145/195, **uomo o donna al 50%** (sprite e dialoghi coerenti).
- **Boss finale**: una **rosa di 14**, uno estratto a ogni run, almeno uno per generazione
  (§22). Ognuno ha 2 o 3 **fasi**: la prima ha gli scudi e **non può essere sconfitta**, e
  alla caduta dell'ultimo scudo si trasforma e la lotta passa in **doppio**. Battuto →
  schermata 🏆 CAMPIONE. ⚠️ Nell'originale c'è sempre e solo Eternatus: è una deviazione
  voluta dal proprietario.
- **Mega/Gigamax**: 89 mega/primal + 31 gigamax con stat reali e **sprite dedicati**
  (`<dex>-<formKey>`). Si compra Megacerchio o Fascia Dynamax (₽2500), poi pulsante in battaglia;
  consuma il turno, dura una lotta (`revertForm` in `resetForBattle`).
- **Evoluzioni**: a livello (auto), **a pietra** (pietre nel negozio + tasto 🌟 Evolvi),
  amicizia→soglia livello 22.
- **Negozio a schermo intero**: 3 premi con tier pesati, 🎲 Rimescola a costo crescente, Emporio,
  tasto 👥 Squadra. **Held items impilabili**: Avanzi, Conchiglia, Boost di Tipo.
- **Mystery encounter**: tutti e **31** (§11), a peso crescente 3/256.
- **Uova/gacha**: voucher dai boss, 4 tier con pity, schiusa a contatore-ondate **persistente**.
- **Grafica**: sprite front/back + shiny reali, mini-icone nei menu, badge tipo/categoria IT,
  idle animation (bob), sfondi per bioma.
- **Animazioni delle mosse REALI** (§6.1): 843 mosse con i frame originali di PokéRogue su
  canvas, caricate su richiesta. Le particelle per tipo restano solo come ripiego.

---

## 6. Da fare — con i dati già raccolti

### 6.1 Animazioni dedicate per mossa — ✅ **FATTA (2026-07-30), port completo**
Scelta del proprietario: **strada C, port completo di tutte le animazioni**.

**Il peso spaventava a torto**: i 55 MB erano JSON *indentato*. Minificato è 23,9 MB, e
riscrivendo ogni sprite come **array di numeri** (invece di un oggetto con chiavi ripetute)
scende a **4,7 MB**. Gli sprite sono solo **3,0 MB**. Totale aggiunto: **7,7 MB**.

| Cosa | Dove | Peso |
|---|---|---|
| `tools/extract-anims.mjs` | genera tutto da `../PokeRogue` | — |
| `data/anims/<MOSSA>.json` | **843 mosse** + **50 comuni** (`COMMON_*`) + **20 di carica** (`CHARGE_*`) | 4,9 MB |
| `data/anims-index.json` | fogli, elenco mosse/comuni/cariche e tabella `fallback`, **unico file caricato al boot** | 47 KB |
| `assets/anims/*.png` | 492 fogli sprite condivisi (esattamente quelli usati) | 3,2 MB |

**Come funziona il player** (`pokerogue.js`, sezione "ANIMAZIONI DELLE MOSSE"):
- I file si caricano **su richiesta**, mai al boot: `prefetchAnim(move.id)` parte quando si
  risolve il turno e scarica JSON **e fogli sprite** (senza il preload dell'immagine le
  animazioni corte — Graffio, 7 frame = 350 ms — finivano prima che il PNG fosse decodificato).
- Disegna su un `<canvas id="anim-canvas">` sopra la scena. **50 ms per frame** (`getFrameMs(3)`).
- Formato compatto: `[x, y, zoomX, zoomY, opacity, graphicFrame, target, focus, blendType,
  angle, mirror, priority, visible]`, con i default finali tagliati.
- `target`: 0 = chi attacca · 1 = il bersaglio · 2 = la grafica. **I frame muovono anche i
  combattenti** (312 animazioni su 843 lo fanno): slancio, rinculo, sparizione. I frame "a
  riposo" non toccano lo sprite, così resta la scossa del colpo.
- `focus`: 1 = ancorato al bersaglio · 2 = a chi attacca · 3 = lungo la linea fra i due
  (`transformPoint` dell'originale) · 4 = schermo. Ancore dell'editor: utente (106,116),
  bersaglio (234,52), spazio logico **320×180** (= 1920/6).
- **Variante avversario**: 303 file hanno due animazioni; `[1]` si usa quando attacca il nemico
  (come `isOppAnim()` nell'originale).
- I `frameTimedEvents` sono quasi tutti **suoni** → scartati (v1 è muta); restano gli sfondi.
- Il messaggio in narrazione **aspetta la fine dell'animazione** (max 1,5 s). Con `?fast`
  il ritmo resta serrato per i test.
- Mosse senza animazione → ripiega su `spawnMoveFx` (le vecchie particelle per tipo), che resta.

**Verificato**: traiettoria di Braciere misurata frame per frame — parte fra i due, avanza in
diagonale ed esplode **esattamente sul nemico** (368,240 = centro dello sprite); Riduttore fa
caricare Charmander addosso al bersaglio (translate 42→168 px); il contrattacco nemico si
anima sul giocatore. Validazione offline su **tutte le 843 animazioni**: 33.854 frame,
179.127 sprite, 0 errori di struttura, nessun foglio mancante, tutti i valori di
focus/target/blend fra quelli gestiti.

⚠️ Due trappole già risolte, non reintrodurle:
- I fogli rifilati (es. Energy Ball 480×286) perdono l'ultima riga se si usa `floor(h/96)`:
  l'indice usa `round` e salva `k` = celle totali.
- ~60 sprite (su 110.000) chiedono una cella che il foglio non ha: succede **anche
  nell'originale**, dove Phaser ripiega sul primo fotogramma. Il player fa lo stesso.

**COPERTURA COMPLETA — nessuna mossa e nessuno stato senza animazione** (secondo giro, 2026-07-30):
- **50 animazioni comuni** (`data/anims/COMMON_*.json`, da `common-<kebab>.json`): stati, cure,
  oggetti, meteo, terreni, prese. Nell'originale utente e bersaglio sono **lo stesso Pokémon**
  (`CommonBattleAnim`: `super(user, target || user)`), quindi si ancorano al Pokémon colpito —
  **funziona identico per il giocatore e per l'avversario**, verificato su entrambi i lati.
- **20 animazioni di carica** (`CHARGE_*.json`, da `<kebab>-charging.json`). Da noi le mosse a
  due turni colpiscono subito, ma la carica si vede lo stesso: se carica e colpo cadono sullo
  **stesso evento** vengono riprodotte **in fila** (`playMoveAnim(..., onDone)`), non sovrapposte.
- **Ripiego per le 109 mosse senza file**, con la regola autentica di `initMoveAnim`:
  attacco → **Azione**, stato su sé → **Focalenergia**, altro stato → **Colpocoda**.
  Sta in `anims-index.json` → `fallback`. Risultato: **952/952 mosse coperte, 0 scoperte**.
- Anche le **mosse di stato** ora hanno la loro animazione (prima l'aveva solo chi faceva danno).
- Agganci nel motore: `applyStatus`, `applyConfuse`, `endOfTurnResidual` (danno residuo e Avanzi),
  `canAct` (blocchi da gelo/sonno/paralisi/confusione), `heal` e `drain` → `COMMON_HEALTH_UP`.
  Si marcano con `messages.anim(chiave, lato)`, gemello di `messages.fx(...)`.

⚠️ Le mosse **Z e G-Max non hanno animazione in PokéRogue**: le 109 senza file sono quelle, e
ora usano il ripiego. Se un giorno le vuoi animate davvero, vanno inventate da zero.

⚠️ **Trappola Windows, mi ha morso davvero**: il filesystem è *case-insensitive*. In
`assets/anims/` c'erano 639 PNG orfani coi nomi originali maiuscoli; cancellandoli confrontando
le **stringhe** ho eliminato anche 4 fogli che servivano (`003-Attack01.png` **è** lo stesso file
di `003-attack01.png`). Ripristinati rieseguendo l'estrattore. Se ripulisci quella cartella,
confronta i nomi **in minuscolo**.

### 6.2 Pokémon con meccaniche speciali — ✅ **FATTA (2026-07-30)**, dettagli in §17
*(Segue il testo originale della richiesta, tenuto come contesto storico.)*
L'originale usa `EvoCondKey` con questi casi: `SHEDINJA`, `TYROGUE`, `WEATHER`, `TIME`,
`SPECIES_CAUGHT`, `RANDOM_FORM`, `PARTY_TYPE`, `NATURE`, `MOVE_TYPE`, `MOVE`, `HELD_ITEM`,
`GENDER`, `FRIENDSHIP`, `EVO_TREASURE_TRACKER`, `BIOME`.
L'estrattore attuale cattura **solo** livello, `item` e `friendship`: tutte le altre condizioni
sono ignorate (quelle evoluzioni semplicemente non scattano).
- **Shedinja**: `generation-03.ts` → Nincada evolve a 20 con `condition:{key:EvoCondKey.SHEDINJA}`;
  nell'originale crea un **secondo** Pokémon se c'è spazio in squadra.
- **Forme** (Calyrex, Unown, Castform, Rotom…): ✅ **fatte, vedi §18** — `variants.json` è
  stato rigenerato dai sorgenti e ora le forme cambiano davvero sprite, tipi, statistiche
  e abilità, con le regole di comparsa dell'originale.
Prossimo passo suggerito: estendere `normalizeEvoCondition` nell'estrattore + gestire i casi
in `checkLevelUps`, partendo da Shedinja (il più iconico) e Tyrogue.

### 6.3 Premi legati alla squadra — ✅ **FATTO (2026-07-30)**
`usefulStones()` raccoglie gli oggetti evolutivi che almeno un membro della squadra può
davvero usare; gli oggetti con `avail()` falso non entrano proprio nell'urna dei premi.
Verificato: Bulbasaur da solo → nessuna pietra proposta; con Eevee in squadra → esattamente
le sue 5 (Idrica, Tuono, Focaia, Foglia, Gelo).

### 6.4 Più oggetti tenuti per Pokémon — ✅ **FATTO (2026-07-30)**
Il catalogo è passato da 3 a 13 oggetti tenuti + 11 bacche. Vedi §10.

### 6.5 Specie delle ultime ondate — **verificato**
Il bioma `END` dell'originale contiene i **Pokémon Paradosso** + Eternatus:
`GREAT_TUSK, IRON_TREADS, FLUTTER_MANE, ROARING_MOON, IRON_VALIANT, RAGING_BOLT, GOUGING_FIRE,
IRON_CROWN, IRON_BOULDER, IRON_LEAVES, SCREAM_TAIL, BRUTE_BONNET, SANDY_SHOCKS, SLITHER_WING,
IRON_MOTH, IRON_HANDS, IRON_JUGULIS, IRON_THORNS, IRON_BUNDLE, ETERNATUS`.

✅ **FATTO (2026-07-30).** END **non è un nodo del grafo dei biomi**: non ha collegamenti in
entrata né in uscita, di proposito. Nell'originale (`select-biome-phase.ts`) c'è un salto
scritto a mano — `isWaveFinal(nextWaveIndex + 9)`, cioè **alla fine dell'ondata 190 si entra
in END e ci si resta fino alla 200**. Riprodotto con `versoEND()`; da END non si esce più e
non viene chiesta la scelta nemmeno con la Mappa.
Verificato: a ondata 100 chiede ancora, a 190 salta in END, a 200 ci resta; il pescatore del
gioco in END tira fuori **solo Pokémon Paradosso** (tutti e 20).

⚠️ **DECISIONE DEL PROPRIETARIO — diversa dall'originale.** Nell'originale questi Pokémon
sono **non catturabili** in Classica (`noPokeballForce` / `noPokeballForceFinalBoss`, condizionato
all'aver già catturato la specie e all'aver completato quasi tutto il dex degli starter).
**Qui NON si vuole quel blocco**: Paradosso ed Eternatus devono essere **catturabili**, con un
**tasso di cattura basso ma non impossibile** — difficile e memorabile, mai negato.
Implementazione suggerita: `catchRate` molto basso per queste specie (o un moltiplicatore
riduttivo applicato nel bioma END), così indebolire + stato + Ultra/Master Ball resta la
strategia vincente. **Non** aggiungere `ballBlockReason` per il boss finale.

### 6.6 Fasi finali del piano originale — **ne resta aperta una sola**
- **Fase 8**: ✅ **FATTA (2026-07-31), ma in un modo DIVERSO da come era scritta qui.**
  Il piano diceva «GIF impacchettate in `assets/gifs/`, mai un file picker». Il
  proprietario ha **cambiato idea e sovrascritto quella regola**: le GIF ora arrivano da
  uno **zip che sceglie lui** con il selettore di file del telefono, sbloccato da un
  easter egg. Dettagli in **§25**. Non esiste nessuna cartella `assets/gifs/` e non serve.
- **Fase 9**: APK con Capacitor. Nella cartella **non c'è nessun progetto Capacitor**
  (niente `package.json`, `android/`, `capacitor.config`). Gli asset sono **128 MB reali**
  (`du -sb --apparent-size assets`). Esiste la skill `webapp-deploy-apk` con la pipeline già
  pronta del proprietario (GitHub `fithzhood`).
  ⚠️ Se serve tagliare peso, **non toccare gli sprite cromatici**: il proprietario l'ha
  bocciato esplicitamente (§16) — una femmina cromatica è già rarissima, vederla col modello
  sbagliato sarebbe il momento peggiore per risparmiare. Si taglia altrove.

---

## 6bis. Dove ci siamo allontanati dall'originale — **DI PROPOSITO**

Sono scelte del proprietario, non sviste: se una nuova sessione le "corregge" per fedeltà,
sta rompendo il gioco. Ognuna è motivata nella sezione indicata.

| Cosa | Nell'originale | Da noi | Dove |
|---|---|---|---|
| Boss finale | sempre Eternatus | **rosa di 14**, uno per run | §22 |
| Baby Pokémon | Pichu **e** Pikachu schierabili | **solo il capostipite** (Pichu) | §19 |
| Boss finale catturabile | bloccato | **catturabile**, a tasso basso | §6.5 |
| Theft Ball | non esiste | nostra, ruba ai Pokémon degli allenatori | §5 |
| GIF di vittoria | non esistono | nostre, da uno zip scelto dall'utente | §25 |
| GIF conservate | — | **mai**: si riscelgono a ogni avvio, di proposito | §25 |
| Cattura | solo comando del turno | in lotta **+ un'ultima ball** a fine lotta | §5 |
| Arceus Perfetto | non esiste | tipo Astrale + mosse sempre superefficaci | §22 |
| Lugia/Ho-Oh Ombra | esistono solo in uno spin-off | ricolorati da noi | §22 |
| Terastallizzazione | c'è | **esclusa** dal proprietario | — |
| Fusioni (DNA Splicers) | ci sono | **accantonate**, non farle senza chiedere | — |

---

## 7. Regole del proprietario (non negoziabili)

1. **Nomi file specifici dell'app**, mai `index.html`/`style.css`.
2. **Cache-proof**: versiona *sempre* i riferimenti e incrementa a ogni modifica.
3. **Offline totale**: niente rete, login, telemetria. Niente pannello impostazioni.
4. **Solo italiano**, testi cablati.
5. **Verticale**, layout a due schermi; comandi solo in basso.
6. ~~**Niente file picker**~~ → **regola revocata dal proprietario il 2026-07-31**: il
   premio GIF (§25) usa apposta il selettore di file del telefono. Vale ancora ovunque
   altro: nessun'altra funzione deve chiedere file. **Niente audio** in v1.
7. **Niente softlock**: garantire sempre almeno una mossa da danno.
8. **Testare nel browser** a ogni modifica: l'app è DOM, si verifica con gli strumenti browser.
9. Il codice deve restare **leggibile riga per riga** dal proprietario (commenti in italiano).

---

## 8. Come lavorare (metodo che ha funzionato)

- **Studia prima l'originale**, non andare a memoria: il proprietario tiene molto alla fedeltà e
  più volte le mie assunzioni erano sbagliate (cattura, capipalestra, Lega fissa, passive sempre attive).
- **Verifica nel browser guidando il DOM** da `javascript_tool`: `window.__game` + click sui
  bottoni reali. Gli screenshot a volte vanno in timeout: le asserzioni sul DOM sono più affidabili.
- Attenzione agli **harness di test**: molti "bug" erano artefatti dei miei script
  (stato sporco, `g.wave` cambiato a metà lotta, PP azzerati sotto una schermata già disegnata).
  Prima di dichiarare un bug, ricarica pulito e riprova.
- **Un bug reale trovato così**: doppia offerta di cattura dopo aver catturato in battaglia
  (risolto con `game.capturedThisWave`).
- Trappola CSS: dentro un attributo `style="…"` usa `url('…')` con **apici singoli** —
  le doppie chiudono l'attributo (mi ha bruciato un giro sulle mini-icone).

**Lezioni dalla sessione del 30-31 luglio** (mi hanno fatto perdere tempo, non ripeterle):

- ⚠️ **Gli autopiloti "clicca il primo bottone" si impantanano sempre** — schermata premi,
  offerta di cattura, cambio forzato. Ho provato tre volte a farne uno che reggesse una run
  lunga e ogni volta si è bloccato. **Non insistere**: usa `window.__items` per provare le
  cose in modo deterministico, e le lotte guidate solo per il colpo d'occhio finale.
- ⚠️ **I test a click non reggono i tempi della narrazione** e danno numeri falsi (misuravo
  danni "0" perché il turno non era ancora partito). Per qualsiasi misura numerica usa
  `.danno()` o leggi lo stato, mai i pixel dopo un `setTimeout` a occhio.
- ⚠️ **Verificare una parte non è verificare la cosa.** Ho dichiarato il meteo "funzionante"
  avendo controllato solo i moltiplicatori sulle mosse: il danno di Tempesta e Grandine non
  scattava affatto, perché `endOfTurnResidual` usciva prima con `if (!f.status) return;`.
  Quando aggiungi qualcosa a fine turno, **controlla dove sono le uscite anticipate**.
- ⚠️ **Nei test non dare ai Pokémon nomi che sembrino testo dell'app**: avevo chiamato i cloni
  "Alleato1" e il proprietario ha giustamente pensato che il gioco usasse quella parola al
  posto del nome. Usa nomi palesemente finti.
- ⚠️ **Il motore legge sempre `M[moveInst.id]`**: modificare `accuracy` su una copia della
  mossa non ha alcun effetto. Se in un test una mossa "manca" il bersaglio, è la sua
  precisione vera.
- ⚠️ **Niente stime in ore o minuti.** Non ho una percezione del tempo e le stime che davo
  erano parole vuote (ho detto "mezz'ora scarsa" per una modifica di due righe). Descrivi
  quanto è grosso l'intervento, non quanto dura.

**Aggiunte del 31 luglio** (le tre principali stanno in cima, qui i dettagli):

- ⚠️ **Prima di dare la colpa all'ambiente, guarda cosa sta facendo il test.** Ho scritto
  nell'handoff che i turni non giravano per un problema del pannello del browser: **era
  falso**, il test sceglieva una mossa a danno fisso (§24). Il pannello *ha* davvero problemi
  (screenshot in timeout, `requestAnimationFrame` che non scatta), ma non erano quelli.
- ⚠️ **Attenzione agli stati dedotti invece che contati.** Ricavavo "quanti scudi restano"
  dai PS del boss: bastava che si curasse con una bacca perché uno scudo già rotto tornasse
  intero e la fase non cambiasse mai (§20). Ora c'è un contatore che scende e basta.
- ⚠️ **Fra un test e l'altro ricarica la pagina.** Lo stato sporco fa fallire prove che
  funzionano benissimo da sole: tre boss su tre "non passavano di fase" solo per quello.
- ⚠️ **Le mie asserzioni sul DOM leggono elementi che il ridisegno ha staccato.**
  `getComputedStyle` su una cella presa prima di un `renderStarterSelect()` torna vuoto e
  sembra che il CSS non si applichi. Dopo un ridisegno, **ri-interroga il DOM**.

---

## 9. Memoria persistente

La cronologia completa delle decisioni sta in
`~/.claude/projects/C--Users-lfili-OneDrive/memory/`:
- `pokerogue-mobile-remake.md` — diario del progetto, fase per fase (**leggilo**)
- `pokerogue-mechanics-reference.md` — meccaniche dell'originale (cattura, uova, biomi, oggetti)
- `unique-app-filenames.md`, `cache-proof-webapps.md`, `deploy-workflow-github-pages.md` — regole

## 10. Oggetti, premi e negozio — rifatti sull'originale (2026-07-30)

Prima erano 19 premi con valori inventati; ora la tabella `REWARD_POOL` segue
`modifier-type.ts` (effetti) e `init-modifier-pools.ts` (tier e pesi).

**Schema di ogni oggetto**: `tier` · `weight` (peso *dentro* il tier) · `target`
(`mon` = si sceglie a chi darlo · `party` · `run`) · `valid(p)` (chi può riceverlo) ·
`avail()` (se falso non entra nell'estrazione) · `dyn` (seconda scelta: quale
vitamina/tipo/pietra/bacca).

⚠️ **Le cure NON vanno per forza all'attivo.** `chooseTarget()` apre la schermata
"A chi lo dai?" e disabilita chi non può riceverlo (già a PS pieni, non esausto, PP
pieni…). Vale anche per gli acquisti in negozio. Se aggiungi un oggetto che agisce su
un singolo Pokémon, mettigli `target: "mon"` e un `valid`.

**Valori ora fedeli**: Pozione = max(20 PS, 10%) · Superpozione max(50, 25%) ·
Iperpozione max(200, 50%) · Pozione Max e Cura Totale 100% · Revitalizzante 50% ·
Revitalizz. Max e Cenere Magica 100% · Etere +10 PP a **una** mossa · Elisir +10 a tutte ·
Caramella Rara **+1** livello · Caramellone +1 a **tutta** la squadra ·
**Vitamine LINEARI** (`base × (1 + 0,1 × pezzi)`, conteggio in `p.vits` così
sopravvivono a evoluzioni e cambi forma) · Avanzi 1/16 · Conchiglia 1/8 · Boost tipo +20% ·
ball +5 (Master +1) con moltiplicatori 1 / 1,5 / 2 / **3 (Rogue)** / garantita.

**Nuovi**: 13 oggetti tenuti (Bandana, Rapidartigli, Roccia di Re, Mirino, Grandelente,
Multilente, Evolcondensa, Seme Rinascita, Tossicsfera, Fiammosfera…), **11 bacche** che si
attivano da sole in lotta (`checkBerries`, con Bacchiporta al 30% di non consumo),
amuleti di run in `game.charms` (Espamuleto, Monetamuleto, Cromamuleto, Presamuleto,
Abilamuleto, Curamuleto, Caramelliera, Pugno d'Oro, Scanner IV), pepite, Poteslot e
Supercolpo a tempo (`game.tempBoost`, 5 ondate), **41 oggetti evolutivi** col nome italiano
ufficiale, Megacerchio e Fascia Dynamax **come premi ROGUE** (non più merce).

**NEGOZIO** (`shopStock()`), come `getPlayerShopModifierTypeOptionsForWave`:
vende **solo consumabili**; le righe si sbloccano con `ceil((ondata + 10) / 30)`;
**chiuso sulle ondate multiple di 10**; prezzi = multipli del denaro d'ondata
(`waveMoney()`, la formula vera). Rimescolo = `ceil(ondata/10) × 250 × 2^usi`.
Verificato: ondata 1 → Pozione ₽30 · ondata 45 → 5 voci · ondata 171 → 13 voci · ondata 50 → chiuso.

⚠️ **Conseguenza voluta**: ball e pietre **non si comprano più**, arrivano solo dai premi.
È come l'originale, ma cambia il ritmo della run.

**MAPPA**: la scelta del bioma ora c'è **solo se possiedi la Mappa** (come `MapModifier`);
senza, la zona successiva è estratta a caso fra i collegamenti.

**Debug**: `window.__items` → `.stock(ondata)`, `.stones()`, `.roll(n)`, `.waveMoney(w)`,
`.berries(mon)`, `.encOk()`, `.showEnc(id)`. Serve per provare pool, prezzi e incontri
senza dover giocare fino all'ondata giusta.

## 11. Incontri misteriosi — TUTTI E 31 (2026-07-30)

L'originale ne ha 31 in `src/data/mystery-encounters/encounters/`: **ci sono tutti**,
con lo stesso tier, le stesse opzioni, gli stessi requisiti d'onda e i **testi italiani
ufficiali** presi da `locales/it/mystery-encounters/`.

**Selezione** (`pickEncounter`): prima il tier coi pesi veri di
`mystery-encounter-tier.ts` — **COMMON 66 · GREAT 40 · ULTRA 19 · ROGUE 3** — poi uno
di quel tier fra gli ammessi. Un tier già visto nella run pesa meno (−6 COMMON, −4 GREAT,
come l'originale) e un incontro già capitato non si ripete finché non sono finiti tutti.
Verificato su 600 estrazioni: 57/29/12/2% contro il 52/32/15/2 teorico.

| Tier | Incontri |
|---|---|
| **COMMON** (13) | Commerciante di Vitamine · Forziere Misterioso · Bacche in Abbondanza · Promozioni al Centro Commerciale · Gita Scolastica · Passione Ardente · Lotta o Scappa · La GTS · Perso nel Mare · Lavoro Part-Time · Avventure col Teletrasporto · La Roba Forte · Una forma non comune |
| **GREAT** (9) | Cupidigia Assoluta · Un'offerta che non puoi rifiutare · La Fan n.1 del tipo Coleottero · Lezioni di danza · Gruppo di Delibird · Divertimento e Giochi! · Sfidanti Misteriosi · La Zona Safari · Snorlax assopito |
| **ULTRA** (5) | Il Venditore di Pokémon · Sessione di Allenamento · Da Monnezza a Meraviglia · Pagliacciate · L'Allevatrice di Pokémon Esperta |
| **ROGUE** (4) | La prova di un allenatore · Offerta Oscura · La Sfida della Famiglia Vinci · ??? (weird dream) |

**Infrastruttura nuova** (serve se ne aggiungi altri):
- `encBattle(mon, testo, premio)` — l'incontro sfocia in una **lotta vera**; `premio` è una
  funzione eseguita alla vittoria e il suo testo entra nei messaggi di fine ondata
  (aggancio: `game.encReward`, consumato in `onWaveCleared`).
- Un'opzione che **ritorna `null`** significa "ho avviato una lotta": il runner non mostra
  la schermata di esito.
- Aiutanti: `encReward(tier, n)` · `encGive(id, n)` · `encBerries(n)` · `encMoney(mult)` ·
  `encEgg(n)` · `encDamageParty(frazione)` · `encFoe(specie, molt, opts)` ·
  `encSoglia(k)` per le prove di statistica · `bestBy(stat)` / `fastest()` / `strongest()`.
- `waves: [min, max]` sull'incontro replica `withSceneWaveRangeRequirement`.

⚠️ **Adattamenti dove ci manca la meccanica** (l'alternativa scelta è la più vicina):
- **nature**: non esistono → il Commerciante di Vitamine non le randomizza; nella Sessione
  di Allenamento il livello "Intermedio" potenzia una statistica base invece della natura.
- **MT / mosse insegnabili**: non esistono → al Centro Commerciale il reparto MT vende
  bacche; la Fan dei Coleottero e le Lezioni di danza danno oggetti/statistiche invece
  di insegnare una mossa.
- **Zona Safari**: niente mini-gioco di catture; dà ball e un Pokémon raro.

**Debug**: `window.__items.showEnc(id)` apre un incontro a comando, `.encOk()` elenca quelli
ammessi ora, `.pickEnc()` fa un'estrazione. Verificato: 31/31 si aprono, **91 opzioni
eseguite senza errori**, e la catena incontro → lotta → premio funziona end-to-end.

## 12. Meccaniche di fondo aggiunte dopo (2026-07-30)

Quattro sistemi che prima mancavano e bloccavano oggetti e incontri.

**NATURE** (`NATURES`, 25 voci coi nomi italiani ufficiali). +10% a una statistica
e −10% a un'altra, mai i PS; 5 sono neutre. Assegnata a ogni Pokémon in `makeFighter`,
applicata in `recomputeStats`, mostrata nella vista squadra.
Sblocca: **Menta** (oggetto ULTRA), la randomizzazione della natura del Commerciante di
Vitamine e il livello "Intermedio" della Sessione di Allenamento.
Verificato: Decisa +10% ATT / −10% A.SP esatti.

**MT** (`data/tms.json`: `perSpecie` per 1063 specie + `tier` per 319 mosse, da
`tm-pool-tiers.ts`). Gli oggetti **MT** COMMON/GREAT/ULTRA propongono solo mosse che
qualcuno in squadra **può davvero imparare** (`randomTm` filtra come l'originale);
`insegnaTm` aggiunge la mossa se c'è posto, altrimenti passa dalla schermata di
sostituzione che il gioco già aveva (`processLearns`).
Sblocca anche: **Fungorico** (fa ricordare una mossa del learnset), il reparto MT del
Centro Commerciale, l'insegnamento della Fan dei Coleottero e le Lezioni di danza.

**METEO** (`WEATHER`): Sole (Fuoco ×1,5 · Acqua ×0,5), Pioggia (l'opposto), Tempesta e
Grandine (1/16 a fine turno a chi non è immune per tipo). Dura **5 turni**, **8 con la
Rocciamistica**. Lo chiamano le mosse (`WEATHER_MOVES`) e le abilità in entrata
(`WEATHER_ABIL`: Siccità, Piovischio, Sabbiafiume, Nevischio…). Si azzera fra le lotte.
Mostrato nell'indicatore in alto. Verificato: Lanciafiamme ×1,51 col sole, ×0,51 in
pioggia; le mosse Normali non sono toccate.

**OGGETTI LEGATI ALLA SPECIE** (`SPECIE_BOOST`): Sferapalla (Pikachu), Ossoduro
(Cubone/Marowak), Metalpolvere e Velocipolvere (Ditto), Squamabissi e Dentebissi
(Clamperl) — raddoppiano una statistica **solo alla specie giusta**, e vengono proposti
solo se ce l'hai in squadra. Più **Porro** (+2 stadi di brutto colpo a Farfetch'd/Sirfetch'd)
e **Rugiadanima** (amplifica la natura di 10 punti per pezzo, come `PokemonNatureWeightModifier`).

Totale oggetti ora: **71** (9 COMMON · 20 GREAT · 21 ULTRA · 16 ROGUE · 5 MASTER).

## 13. Oggetti degli avversari e lotte in doppio (2026-07-30)

**OGGETTI TENUTI DAGLI AVVERSARI** — con la formula esatta di `battle-scene.ts`:
`occasioni = ceil(ondata / 10)` (×2,5 sul boss finale); per ogni occasione **1 possibilità
su 18** (**su 6** se è un boss); i boss ne ricevono comunque almeno `floor(occasioni / 2)`.
I pool sono quelli dedicati e **separati da quelli del giocatore**:
- *selvatici* (`POOL_SELVATICO`): bacche, vitamine, boost di tipo
- *allenatori* (`POOL_ALLENATORE`): quelli sopra **più** Bandana, Rapidartigli, Presartigli,
  Grandelente, Roccia di Re, Avanzi, Conchiglia, Mirino

Verificato: a onda 150 un boss riceve 7 oggetti (= `floor(15/2)`), un selvatico 0,61.

**SÌ, l'originale li MOSTRA**: ha una `ModifierBar` per lato. Riprodotta con `.held-bar`:
oggetti del giocatore **in basso a sinistra**, dell'avversario **in alto a destra**,
con l'icona vera e il contatore `×N`.

**FURTO** (`rubaOggetto`): **Presartigli** ruba al contatto (10% per pezzo), **Buconero**
ruba a ogni fine turno. Rubano anche bacche e boost di tipo, e le statistiche si
ricalcolano subito dopo lo scambio.

**LOTTE IN DOPPIO** — `game.double` accende i secondi slot `game.player2` / `game.enemy2`.
⚠️ **Scelta di progetto importante**: gli slot **primari restano** `game.player`/`game.enemy`,
così i 137 riferimenti sparsi nel file continuano a funzionare senza toccarli. Il singolo
non è stato riscritto: è esattamente il codice di prima con `game.double = false`.
- Probabilità come l'originale: **1 su 8**, mai sulle ondate ×10; le **Esche** la alzano
  (divisore `8 − 2 × esche`, fino a 3 esche).
- **Comandi ENTRAMBI i tuoi Pokémon**, uno dopo l'altro: `game.chooser` (0 o 1) dice chi
  sta scegliendo, `game.queued` conserva l'azione del primo finché non decidi per il secondo.
  Il prompt mostra "(1°)" / "(2°)", e dal secondo c'è **↩ Rifai la prima scelta**.
  Ball/Squadra/Fuggi valgono per tutto il turno, quindi sono attivi solo sul primo comando.
- Il turno raccoglie fino a **4 azioni** e le ordina tutte insieme per priorità e velocità.
- Se una mossa ha due bersagli possibili appare **"Chi vuoi colpire?"** con PS e livello.
  Se il bersaglio cade prima del colpo, si ripiega automaticamente sull'altro.
- Quando un avversario cade il suo slot sparisce e la lotta continua; quando il primario
  cade, il secondo prende il suo posto. Un alleato caduto è rimpiazzato dalla panchina.
- CSS: `#game.double` allarga il campo e rimpicciolisce pannelli e pedane.

**Debug**: `window.__items.doppia()` avvia subito una lotta in doppio,
`.heldNemico(ondata, boss, allenatore)` misura la distribuzione degli oggetti nemici.

## 14. Effetti volatili (2026-07-30)

L'estrattore ora riconosce anche `ProtectAttr`, `TrapAttr`, `LeechSeedAttr`, `RechargeAttr`
e l'`AddBattlerTagAttr` dell'Ultimocanto. Vivono in `f.volatile`, che si azzera a ogni lotta.

| Effetto | Mosse | Comportamento |
|---|---|---|
| **Protezione** | 10 (Protezione, Individua, Scudo Reale…) | Para il colpo per un turno. Usarla di fila riesce **1 volta su 3^usi**, come `timesUsed` in `move.ts`. La variante *Resistenza* non para: fa sopravvivere con 1 PS |
| **Prese** | 10 (Legatutto, Turbofuoco, Mulinello…) | 4-5 turni, **1/8 dei PS max** a fine turno, e **non ci si può ritirare** |
| **Semebomba** | Parassiseme, Bombafrush | **1/8 dei PS max** rubati e passati a chi l'ha piantato. Non attacca i tipi Erba |
| **Ricarica** | 10 (Iper Raggio, Idrocannone…) | Il turno dopo si salta |
| **Ultimocanto** | Ultimocanto | Dopo 3 turni vanno KO tutti quelli in campo |

⚠️ **Bug trovato mentre li aggiungevo, occhio se tocchi `endOfTurnResidual`**: la funzione
usciva prima con `if (!f.status) return;`, quindi tutto quello che sta in fondo — prese,
semi, Ultimocanto **e il danno da meteo** — non scattava mai su un Pokémon senza stato.
Ora l'uscita anticipata non c'è più.

## 15. Terreni, mosse a due turni e altri volatili (2026-07-30)

**TERRENI** (`TERRAINS`), da `terrain.ts` e `arena.ts`. Valgono **solo per chi tocca terra**
(`isGrounded`: né tipo Volante né Levitazione). Durano 5 turni, 8 con la Rocciamistica.

| Terreno | Effetti |
|---|---|
| ⚡ Campo Elettrico | mosse Elettro **×1,3** · chi sta a terra non si addormenta |
| 🌿 Campo Erboso | mosse Erba **×1,3** · chi sta a terra rigenera 1/16 a fine turno |
| 🔮 Campo Psichico | mosse Psico **×1,3** |
| 🌫️ Campo Nebbioso | mosse Drago **×0,5** · chi sta a terra è immune agli stati |

Lo stendono le 5 mosse `TerrainChangeAttr` e le abilità in entrata (`TERRAIN_ABIL`:
Elettromanto, Erbomanto, Psicomanto, Nebbiomanto…). Si vede nell'indicatore in alto.
Verificato: Elettro su Campo Elettrico ×1,30 · Drago su Nebbioso ×0,52 · Normale ×0,98 ·
**un Volante lo ignora (×1,02)**.

**MOSSE A DUE TURNI VERE**: `move.charging` ora carica davvero. Il primo turno il Pokémon
esegue il testo giusto ("*Charmander si alza in volo!*", "*si immerge!*", "*scava
sottoterra!*"…), e per **Volo, Sub, Fossa, Rimbalzo, Spettrotuffo, Oscurotuffo, Sfidacielo**
diventa **irraggiungibile** (`SEMI_INVULN`): chi lo attacca si sente dire "*Ma X è
irraggiungibile!*". Il secondo turno riappare e colpisce.
⚠️ Il nome italiano di `DIVE` è **Sub**, non "Sott'acqua".

**ALTRI VOLATILI** estratti da `AddBattlerTagAttr` (nomi italiani ufficiali):

| Effetto | Mossa | Comportamento |
|---|---|---|
| Attrazione | Attrazione | 50% di non agire, **solo fra sessi opposti** (vedi §16) |
| Ripeti | Ripeti | Costringe a ripetere l'ultima mossa per 3 turni |
| Provocazione | Provocazione | Niente mosse di stato per 3 turni |
| Attaccalite | Attaccalite | Non si può ripetere la stessa mossa due volte di fila |
| Sbadiglio | Sbadiglio | Ci si addormenta al turno dopo |
| Incubo | Incubo | 1/4 dei PS a turno, ma solo mentre dorme |
| Radicamento | Radicamento | Rigenera 1/16 · **non ci si può ritirare** |
| Acquanello | Acquanello | Rigenera 1/16 |
| Sotto Sale | Sotto Sale | 1/8 a turno, **1/4** su Acqua e Acciaio |
| Maledizione | — | 1/4 a turno |

**Sui nomi in doppio**: il gioco usa già il nome vero del Pokémon
("*Cosa deve fare Bulbasaur? (2°)*"). Gli "Alleato1" nei test erano cloni creati dagli
script di verifica, non testo del gioco.

## 16. Sesso dei Pokémon e sprite femminili (2026-07-30)

`species.json` ha ora **`malePercent`** (percentuale di maschi; `null` = senza sesso) e
**`genderDiffs`** (la specie ha uno sprite femminile diverso). Il sesso si estrae in
`makeFighter` con `rollGender`, esattamente come `generateGender()` dell'originale.

- **924 specie con sesso · 160 senza** (Magnemite, Voltorb, Staryu…).
  Verificato: Bulbasaur 89% ♂ (atteso 87,5), Pikachu 49/51, **Chansey 100% ♀**,
  **Tauros 100% ♂**, Magnemite senza sesso.
- Il simbolo **♂/♀** compare accanto al nome nel pannello PS e nelle viste squadra
  (azzurro/rosa, classe `.gen`).

**SPRITE FEMMINILI**: le **98 specie con `genderDiffs`** hanno un aspetto diverso da femmina
(la coda a cuore di Pikachu, i baffi di Meowstic…). Copiati **392 file** (+19 MB) in
`assets/pokemon/femmina/{front,back,shiny/front,shiny/back}`.
`loadSprite(dex, side, shiny, femmina)` li usa quando serve; `usaSpriteFemmina(f)` decide.
⚠️ Le **forme estetiche e le mega hanno la precedenza**: un Pikachu cosplay usa il suo sprite,
non quello femminile — come nell'originale.
Verificato: `femmina/front/25.png`, `femmina/back/25.png`, `femmina/shiny/front/25.png` per
una Pikachu femmina; Bulbasaur (senza `genderDiffs`) usa lo stesso sprite per entrambi.

**ATTRAZIONE** ora è fedele: funziona **solo fra sessi opposti** e mai su chi non ha sesso.
Verificato in gioco: ♂ su ♂ → "*Ma non ha effetto*"; ♂ su ♀ → infatuato.

**EVOLUZIONI PER SESSO**: l'estrattore prende anche `EvoCondKey.GENDER`. Sono **9**:
Kirlia→Gallade (♂), Snorunt→Froslass (♀), Burmy→Mothim (♂) / Wormadam (♀),
Combee→Vespiquen (♀), Espurr→Meowstic (♀), Salandit→Salazzle (♀),
Basculin→Basculegion (♀), Lechonk→Oinkologne (♀).

⚠️ **Peso**: gli sprite femminili aggiungono 19 MB. **NON si tagliano gli shiny femminili**
(decisione del proprietario): una femmina cromatica è già rarissima, trovarne una e vederla
col modello sbagliato sarebbe il momento peggiore in cui risparmiare spazio. Se all'APK
serve spazio, si taglia altrove.

⚠️ **Restano fuori**: **fusioni** (accantonate), i `BattlerTagType` più esotici
(Rimbombo, Furia, Stipacolpi, Telecinesi…) e la Terastallizzazione (esclusa da te).

**Debug**: `window.__items.danno(mossa, meteo)` calcola il danno medio su 200 tiri senza
applicarlo — è il modo affidabile per verificare meteo, boost e nature (i test a click
sulla UI non reggono i tempi della narrazione).

## 17. Evoluzioni a condizione + giorno e notte (2026-07-30)

**SÌ, PokéRogue ha il giorno e la notte** — e non dipende dall'ora vera: è un ciclo di
**40 ondate** (`getTimeOfDay()` in `arena.ts`).

```
ciclo = (ondata + offset) % 40      offset casuale a ogni run
 0-14 → ☀️ Giorno   15-19 → 🌇 Tramonto   20-34 → 🌙 Notte   35-39 → 🌄 Alba
```
Il bioma **ABISSO è sempre notte**. Si vede nell'indicatore in alto.
Verificato: 15/5/15/5 esatti su un ciclo completo.

**LE CONDIZIONI DI EVOLUZIONE ORA CI SONO TUTTE.** Prima l'estrattore prendeva solo
livello, pietra e amicizia: **81 evoluzioni non scattavano mai**. Ora `evoConditionOk(p, e)`
verifica tutto:

| Condizione | Quante | Come |
|---|---|---|
| `time` | 37 | momento del giorno del ciclo sopra |
| `knowsMove` / `moveType` | 21 | conosce quella mossa, o una mossa di quel tipo |
| `gender` | 9 | sesso (vedi §16) |
| `tyrogue` | 3 | **quale delle tre mosse** conosce (Low Sweep/Mach Punch/Rapid Spin) — è così anche nell'originale, non per statistiche |
| `speciesCaught` | 3 | quella specie è già nel dex (`meta.unlocked`) |
| `heldItem` | 2 | tiene Dentebissi / Squamabissi |
| `weather` | 2 | meteo in corso (vedi §12) |
| `randomForm` | 2 | 1 su N, **fisso per quell'esemplare** |
| `biome` · `nature` · `partyType` · `treasure` | 4 | dove sei · natura · un compagno di quel tipo · contatore di Gimmighoul |

⚠️ **SHEDINJA non è un'evoluzione normale**: Nincada diventa Ninjask **e in più** compare
Shedinja come secondo Pokémon. Come nell'originale (`validateShedinjaEvo`) serve **posto in
squadra e almeno una Poké Ball**, che viene consumata.
Verificato: con le ball → Ninjask + Shedinja e una ball in meno; senza → solo Ninjask.

⚠️ **Anche le evoluzioni a PIETRA passano dal verificatore**: la pietra da sola non basta.
Eevee con la Pietrabrillo diventa Sylveon solo se conosce una mossa Folletto.

Verificato in gioco: Eevee → **Espeon** di giorno, **Umbreon** di notte, **Sylveon** con una
mossa Folletto; Tyrogue → Hitmonlee / Hitmonchan / Hitmontop secondo la mossa.
Nessun errore su tutte le **513 voci di evoluzione** delle 1084 specie.

## 18. Forme / varianti, rifatte sull'originale (2026-07-31)

Era la voce "dato caricato ma poco usato" del §3. Andando a guardarla non era poco usata:
era usata **male**, e nascondeva tre difetti seri.

### Cosa c'era che non andava

1. **`variants.json` non lo generava nessuno.** Non usciva da `extract-data.mjs`: era stato
   scritto da uno script usa-e-getta di una sessione precedente, leggendo i **nomi dei file
   sprite** presenti sul disco. Da lì tutto il resto. (Si vedeva dalla data del file, più
   vecchia di tutti gli altri `data/*.json`.)
2. **Comparivano forme che nell'originale non compaiono mai.** Siccome l'elenco veniva dagli
   sprite, dentro c'erano anche le forme da battaglia: si potevano incontrare come se fossero
   mantelli colorati **Terapagos Cristallino, Calyrex Cavaliere Spettrale, Necrozma Ultra,
   Zygarde Perfetto, Urshifu Gigamax, Ogerpon Teracristal, le Starmobili di Revavroom**.
3. **Le forme erano solo una pelle.** Il gioco cambiava lo sprite e basta: **111 delle 249
   forme che comparivano cambiano invece tipi, statistiche o abilità**. Un Rotom Lavaggio
   sembrava una lavatrice ma combatteva da Elettro/Spettro con 440 di totale base invece di
   Acqua/Elettro con 520. Lo sprite mentiva.

Di riflesso ne è saltato fuori un quarto, più grosso e slegato dalle forme: **gli sprite
cromatici c'erano solo per la prima generazione**. Dalla seconda in poi un cromatico non
trovava il file e finiva a **rettangolo colorato** — 87% del dex, e proprio nel momento più
raro del gioco.

### Come funziona adesso

**La regola vera è `getSpeciesFormIndex()`** (`src/battle-scene.ts` dell'originale), ed è una
**lista chiusa**: solo le specie elencate lì prendono una forma a caso, **tutte le altre usano
sempre la forma 0**. Non si estrae "una forma qualsiasi fra quelle che hanno uno sprite".

⚠️ **L'indice è il dato.** Per parecchie specie il sorteggio si ferma *prima* della fine
dell'array, ed è esattamente così che l'originale tiene fuori le forme da battaglia:

| Specie | Forme in tutto | Estraibili | Cosa resta fuori |
|---|---|---|---|
| Pikachu | 9 | `randSeedInt(8)` | Gigamax |
| Zygarde | 7 | `randSeedInt(4)` | Perfetto, 10% Perfetto, Mega |
| Tatsugiri | 6 | `randSeedInt(3)` | le tre Mega |
| Alcremie | 10 | `randSeedInt(9)` | Gigamax |
| Urshifu | 4 | `randSeedInt(2)` | le due Gigamax |
| Magearna | 4 | `randSeedInt(2)` | Mega, Mega Originale |

Se riordini `variants.json` rompi tutte queste regole in silenzio. `__forme.audit()` è lì
apposta: deve tornare **lista vuota**.

Le altre regole, tutte riprodotte perché avevamo già i dati che servono:

| Regola | Specie | Da cosa dipende |
|---|---|---|
| bioma | Burmy, Wormadam | Spiaggia → Sabbia · Sobborghi → Scarti · resto → Pianta |
| ora del giorno | Lycanroc | Giorno/Alba → Giorno · Notte → Notte · Tramonto → Crepuscolo |
| sesso | Meowstic, Indeedee, Basculegion, Oinkologne | ♀ → forma 1 |
| natura | Toxtricity | 12 nature "pacate" → Discordia |
| 1 su N | Sinistea & c. (1/16), Pichu (1/8) | la forma rara |
| tipo dell'allenatore | Wormadam, Rotom, Oricorio, Tauros di Paldea, Arceus, Silvally | il Mangiafuoco manda Rotom Calore, il Pescatore Rotom Lavaggio |

⚠️ **`ignoreArena`**: nell'originale bioma e orario valgono **solo per chi incontri**. I
Pokémon **del giocatore** (starter, squadra iniziale) passano `ignoreArena` e sorteggiano,
perché il bioma di adesso non c'entra nulla con un Pokémon che è già tuo. Verificato: Burmy
selvatico in Pianura è **sempre** Pianta, il Burmy del giocatore esce nei tre manti.

**Le forme ora agiscono davvero.** `makeFighter` risolve la forma **prima** delle statistiche
(perché le cambia) e ne applica `types`, `baseStats` e `ability`. Il nome porta la forma fra
parentesi come `appendForm.generic` dell'originale — "Rotom (Lavaggio)" — tranne quando la
forma *è* il sesso, che si vede già dal ♂/♀.

**I nomi sono quelli italiani ufficiali** (`locales/it/pokemon-form.json`, 297 chiavi), con la
stessa catena di ripieghi di `getFormNameToDisplay()`: chiave diretta → **chiave della specie
radice** → chiave grezza. È il ripiego sulla radice che fa ereditare a Sawsbuck le stagioni di
Deerling, a Gastrodon i versanti di Shellos, a Vivillon le fantasie di Scatterbug, a Wormadam
i manti di Burmy. Senza, 494 nomi su 607 restavano in inglese.

**La forma sopravvive all'evoluzione**, portandosi dietro l'**indice** come fa l'originale
(`doEvolution` lo lascia invariato se l'evoluzione non ne impone un altro): Deerling Autunno →
Sawsbuck Autunno, Scatterbug Savana → Spewpa → Vivillon Savana, e **Burmy Sabbia → Wormadam
Sabbia**, che è Coleottero/Terra con statistiche sue. Se la nuova specie ha meno forme si
ricade sulla base, come la rete di sicurezza di `getFormKey()`.

### Sprite

`tools/copy-sprites.mjs` (nuovo, idempotente) ha aggiunto **2.538 file, +12,3 MB**:
gli sprite cromatici di **tutto il dex** (mancavano dalla gen 2 in poi) e i quattro tagli di
ogni forma, **mega e gigamax comprese** — anche un Charizard cromatico che megaevolve deve
restare cromatico, e prima non lo restava.

Due accorgimenti che tengono basso il peso, utili quando si arriverà all'APK:
- gli atlas dell'originale sono **indentati** e descrivono tutti i 144 fotogrammi
  dell'animazione di riposo, ma il gioco legge **solo il frame 0** (`atlasFrame0`, il ritaglio
  lo fa il CSS): copiandoli si tiene solo quello, e **8,1 MB di JSON diventano 0,1**;
- le forme identiche a vedersi (le 20 fantasie di Scatterbug, le taglie di Pumpkaboo) **non
  hanno un file nemmeno nell'originale** e ricadono sullo sprite base: 370 file non copiati.

`loadSprite` ora prova una **catena** invece di arrendersi: femmina cromatica → cromatica →
femmina → base. L'ultimo anello serve a non mostrare **mai** il rettangolo colorato: 4 specie
(Koraidon, Miraidon, Poltchageist Autentica, Sinistcha Capolavoro) non hanno lo sprite
cromatico nemmeno nell'originale, e il modello giusto coi colori normali è comunque meglio.
La cache si ricorda anche i **buchi**, altrimenti ogni Scatterbug ripeteva la stessa 404.

`loadFormSprite` è sparita: faceva quello che `loadFighterSprite` già sa fare.

### Verificato

- `__forme.audit()` → **0 forme da battaglia estraibili** (prima erano decine).
- Distribuzioni su centinaia di estrazioni: Rotom 6 forme uniformi · Pikachu 8 senza Gigamax ·
  Zygarde 4 senza Perfetto · Pichu 699/101 ≈ 1 su 8 · Sinistea 1501/99 ≈ 1 su 16 ·
  Meowstic 50/50 per sesso · **Terapagos e Charizard sempre forma base**.
- Rotom: i 6 sprite, i 6 tipi e i 520 di totale base tutti giusti.
- Evoluzioni: Deerling/Scatterbug/Spewpa mantengono la fantasia; Burmy Scarti → Wormadam
  Scarti (Coleottero/Acciaio, atk 69) e Burmy Sabbia → Sabbia (Coleottero/Terra, atk 79).
- **3.087 combattenti creati su tutte le 1.029 specie con sprite: 0 errori**, nessun tipo
  vuoto, nessuna statistica anomala.
- Lotta vera giocata: Pikachu (Cosplay grinta) contro Rotom (Vortice), sprite giusti,
  danno normale, **0 errori console**.
- Cattura: "🦋 Nuova forma: Primavera (1/4 di Deerling)" — nome ufficiale e denominatore
  giusto (le 4 stagioni, non tutte le voci dell'array).
- Sweep offline: **4.832 combinazioni specie × forma × taglio**, 0 che finiscono a segnaposto.
- Rilanciati estrattore e copia-sprite: **il risultato non cambia** (pipeline riproducibile).

⚠️ **Trappola già presa una volta e ripresa qui**: pulendo gli sprite orfani va confrontato
tutto **in minuscolo** (Windows è case-insensitive). Ne sono stati tolti 8, i
`888-behemoth-blade` / `889-behemoth-bash` che il vecchio elenco citava ma che non
corrispondono a nessun `PokemonForm` dei sorgenti.

⚠️ **Nota su `du`**: dopo questa aggiunta `du -sh assets` dice ~158 MB ma i byte reali sono
**128 MB**. Sono 13.000 file piccoli e lo spreco di fine blocco è enorme. Per l'APK usa
`du -sb --apparent-size`.

⚠️ **Il server di sviluppo**: se un'altra sessione tiene occupata la porta 5512, in
`launch.json` c'è ora anche **`pokerogue-mobile-b` sulla 5513**, identica.

## 19. Scena ripulita e griglia starter col dex (2026-07-31)

Due segnalazioni del proprietario: *«i due Pokémon sono troppo ravvicinati e ci sono
artefatti a schermo: cerchi, ombre senza senso»* e *«nel menu di selezione i Pokémon non
sbloccati dovrebbero avere la silhouette nera e ci dovrebbero essere dei filtri»*.

### Gli "artefatti": due slot fantasma

Il sospetto sulla lotta in doppio era giusto. `slot2()` nascondeva i secondi slot con
l'attributo `hidden`, ma **`[hidden]{display:none}` dello user-agent perde contro la regola
di classe** `.battler-slot{display:flex}`. Quindi in **ogni lotta singola** gli slot
`enemy2`/`ally2` restavano disegnati e vuoti: il loro `.sprite` senza immagine mostrava lo
stile del segnaposto — bordo bianco (i "cerchi") e `box-shadow` (le "ombre") — più la pedana
scura. Una riga risolve:

```css
.battler-slot[hidden] { display: none; }
```

⚠️ Vale per qualsiasi elemento del gioco con una classe che imposta `display`: `hidden` da
solo non basta. Stesso motivo per `.hp-panel[hidden]`.

### Le distanze: erano i riquadri PS a rubare lo spazio

Misurando: i due sprite si sovrapponevano di ~11px e il 40% in alto era cielo vuoto. La
causa vera non erano le posizioni ma il fatto che **il riquadro PS stava nel flusso**, sopra
(nemico) o sotto (alleato) lo sprite. Due riquadri da **67px** = 134px, il **24% della
scena**, tolti agli sprite.

Ora i riquadri sono **sovrapposti alla scena** come nell'originale, ognuno **dalla parte
opposta al proprio Pokémon**: nemico in alto a sinistra, giocatore in basso a destra.
Gli slot dei combattenti delimitano quindi lo spazio dei soli sprite:

| | prima | dopo |
|---|---|---|
| slot nemico | `top:26% right:12%` | `top:5% right:7%` |
| slot alleato | `bottom:3% left:19%` | `bottom:5% left:5%` |
| stacco fra i due sprite più grandi | **−11px (si toccavano)** | **+55px** |
| cielo vuoto in alto | 195px | 27px |

⚠️ **I `maxH` in `pokerogue.js` e le percentuali degli slot in `pokerogue.css` vanno letti
insieme**: `fascia = 1 − 5% − 5% = 0,90` deve restare maggiore di `0,42 + 0,38 = 0,80`.
Il caso peggiore **non è teorico**: 54 sprite del giocatore e 9 del nemico arrivano davvero
al tetto (Tyranitar, Wyrdeer). Se tocchi uno dei due file, ricontrolla l'altro.

Altro sistemato nella stessa passata:
- **in doppio gli sprite si rimpicciolivano di nulla** e i due alleati si accavallavano:
  ora `spriteCfg()` stringe i tetti di `DOUBLE_SHRINK = 0.72` quando `game.double`.
  Verificato: nessuna sovrapposizione fra i quattro.
- **le pedane dei secondi slot non avevano l'arte del bioma** (restava l'ovale scuro):
  `setPlatform` usava `querySelector` (solo il primo) e i selettori `.ally`/`.enemy` non
  toccano `.ally2`/`.enemy2`. Ora usa `querySelectorAll` con entrambi i selettori.
- `#game.double .platform` ridichiarava `width/height`, che però **sono inline** (li scrive
  `setPlatform` ritagliando l'arte): non aveva alcun effetto. Ora usa `transform: scale()`.
- `clearSlot` **nascondeva** il riquadro invece di solo svuotarlo: da sovrapposto, un
  riquadro vuoto sarebbe rimasto un rettangolo scuro appeso — lo stesso tipo di artefatto.

### Griglia starter: tre stati e filtri

Prima la griglia mostrava **solo** ciò che potevi schierare (546 voci): di quello che ti
mancava non c'era traccia. Ora mostra **tutto il dex** (1029 specie con sprite) con i tre
stati dell'originale (`starter-select-ui-handler.ts`):

| Stato | Nell'originale | Da noi | Si tocca? |
|---|---|---|---|
| catturato / sbloccato | `clearTint()` | a colori, nome e costo | sì |
| visto ma non tuo | `setTint(0x808080)` | `filter: grayscale(1) brightness(.62)` | no |
| mai incontrato | `setTint(0)` | `filter: brightness(0)` — **sagoma nera** | no |

⚠️ Il grigio ha richiesto un dato nuovo: l'originale ha `seenAttr` **e** `caughtAttr`, noi
avevamo solo `meta.unlocked`. Aggiunto **`meta.seen`** con `registerSeen()`, chiamato in
`renderScene` sui due slot nemici — un punto solo, ma ci passano selvatici, boss, squadre
degli allenatori e incontri misteriosi.

⚠️ **Di un Pokémon che non hai non si svela nulla**: la cella mostra solo la sagoma e il
numero (`#12`), non il nome, il costo o il tipo. Per coerenza **la ricerca per nome cerca
solo fra quelli scoperti**: altrimenti scrivendo "char" si scopriva che #5 e #6 si chiamano
Charmeleon e Charizard.

**Filtri** (`.filter-bar`), coi nomi italiani ufficiali di `locales/it/filter-bar.json`:
ricerca per nome · **Gen** 1-9 · **Tipo** (18) · stato (Tutto / Disponibili / Visti /
Mancanti) · **Ordina** (Num. Dex / Costo / Nome / Caramelle). Sotto, il contatore del dex
(`Dex 7/1029`). La ricerca ridisegna dopo 250ms di pausa, non a ogni tasto.

Verificato: Gen 1 → 151 · Gen 1 + Fuoco → 12 · tutti i Drago → 70 · ordina per costo →
Weedle/Rattata/Spearow · per nome → Abra/Absol/Acquecrespe · incontrato Butterfree → passa
da sagoma a grigio e compare nel filtro "Visti" · flusso completo ricerca → scelta →
dettaglio → avvio run · **ridisegno di 1029 celle in ~20ms**, 0 errori console.

⚠️ **Sugli screenshot in questa sessione**: il pannello del browser non compositava, quindi
`computer{screenshot}` andava in timeout **e `requestAnimationFrame` non scattava mai** (un
test che lo usava è morto per timeout). Non erano difetti del gioco. Con il pannello
nascosto, misura tutto con `getBoundingClientRect` e tempi sincroni.

⚠️ Un errore mio da non rifare: ho letto `getComputedStyle` su celle **staccate dal DOM**
(prese prima di un ridisegno della griglia) e tornava vuoto, facendomi credere che il CSS
delle sagome non si applicasse. Dopo un ridisegno, ri-interroga il DOM.

### Solo capostipiti fra gli starter (correzione del proprietario)

Non bastava nascondere gli evoluti: catturando un Venusaur diventava **schierabile lui**,
perché `isSelectable` accettava tutto ciò che stava in `meta.unlocked`. Regola nuova:

```js
isSelectable(k) = !S[k].noSprite && isRoot(k)   // niente preevoluzione
```

⚠️ **SCELTA DEL PROPRIETARIO, DIVERSA DALL'ORIGINALE.** In PokéRogue i **baby** sono
un'eccezione: `speciesStarterCosts` dà un costo sia a Pichu sia a Pikachu e li puoi schierare
**entrambi**. Qui vale **solo il baby**. Non è servito un elenco di eccezioni: nei dati
**l'unica specie evoluta con un costo starter è proprio Pikachu**, quindi la regola "è
radice della catena" ottiene la deviazione da sola.

Numeri: **544 schierabili** (tutte le radici con sprite, tutte con un `starterCost` — 0 senza),
485 non schierabili. Verificato: Pichu sì / Pikachu no / Raichu no · Bulbasaur sì /
Ivysaur no / Venusaur no · e tutti e **18 i baby** (Cleffa, Igglybuff, Togepi, Tyrogue,
Smoochum, Elekid, Magby, Azurill, Wynaut, Budew, Chingling, Bonsly, Mime Jr., Happiny,
Munchlax, Riolu, Mantyke) risultano schierabili al posto delle loro evoluzioni.

**Catturare un evoluto sblocca il capostipite** (`rootOf`): senza questo, prendere un
Butterfree non avrebbe più dato niente. Vale anche per il cromatico — un Venusaur cromatico
sblocca Bulbasaur cromatico. Messaggio: *«📖 Butterfree nel dex — sbloccato Caterpie come
starter!»*. `meta.unlocked` resta il registro del dex (segna **entrambi**), ma la
schierabilità non lo guarda più.

Quarto stato nella griglia: **`catturato`** = evoluto e già preso → a colori e col nome, ma
non si tocca, e sotto compare `↳ <capostipite>` per dire chi giocare al suo posto. Il filtro
di stato ora è Tutto / Schierabili / Catturati / Visti / Mancanti.

Il salvataggio iniziale sblocca **PICHU** al posto di Pikachu, per coerenza.
Cache: **css v=46 · js v=88**.

### Solo i 27 starter regionali sono sbloccati (correzione del proprietario)

Chiarimento: *«il menù iniziale di PokéRogue prevede di poter selezionare solo i tre starter
di ogni regione, gli altri Pokémon base (root) hanno la silhouette nera»*. Corretto, ed è
`defaultStarterSpecies` in `src/constants.ts` dell'originale: **27 specie**, 3 per ognuna
delle 9 regioni. Riportate in `DEFAULT_STARTERS`.

Regola finale della griglia, in due pezzi:

```js
starterDex()   = solo i CAPOSTIPITI (544)          // gli evoluti non ci sono proprio
isSelectable() = capostipite && (uno dei 27 || meta.unlocked[k])
```

- **Gli evoluti spariscono dalla griglia**, nemmeno come sagoma: erano 485 caselle che non si
  potevano toccare. Verificato: Ivysaur e Venusaur non compaiono affatto.
- **517 capostipiti partono come sagoma nera** e si sbloccano catturandoli — direttamente o
  prendendo una loro evoluzione, visto che `registerCaught` sblocca il capostipite
  (Butterfree → Caterpie).
- Restano i tre stati: sbloccato (a colori) · visto ma non preso (grigio) · mai incontrato
  (sagoma nera), col filtro di stato che **parte su «Schierabili»**: aprendo la schermata si
  vedono solo i Pokémon effettivamente giocabili, e le sagome si richiamano con «Tutto».

Verificato da salvataggio pulito: **27 schierabili** (esattamente Bulbasaur…Quaxly), 517
sagome; catturato un Butterfree → 28 schierabili e Caterpie a colori; incontrato un Pigey
senza prenderlo → passa a grigio. Il contatore dice **«Sbloccati 27/544»**.

⚠️ `defaultMeta().unlocked` ora parte **vuoto**: i 27 sono giocabili perché stanno in
`DEFAULT_STARTER_SET`, non perché siano segnati come catturati. Chi conta gli starter
disponibili deve usare `isSelectable`, non `Object.keys(meta.unlocked).length` (il contatore
della home e quello della griglia lo fanno).

### Tasto di azzeramento

In fondo alla Home: **⚠️ Azzera tutto**. Apre una schermata di conferma che **elenca cosa si
perde** (starter sbloccati, specie con caramelle, specie con IV salvati, uova e voucher,
record) e ha due tasti: *«↩ No, torna indietro»* per primo ed evidenziato, *«Sì, cancella
tutto»* in rosso per secondo. Confermando: `localStorage.removeItem(META_KEY)` +
`meta = defaultMeta()` + salvataggio, poi una schermata di esito.
Verificato: annullando non si perde nulla; confermando la griglia torna a 27 schierabili.

### Sul «taglio a destra» nel browser

**Non è il gioco.** Misurato a **320, 375 e 1280 px**, sia in Home sia nella scelta squadra:
`scrollWidth == clientWidth` (nessun overflow) e **nessun elemento sporge dalla cornice**.
A 1280 il gioco è perfettamente centrato (480px, 400 di nero per lato: è il `max-width` di
`#game`, voluto per non deformare su PC).

Il taglio viene dal **pannello del browser dell'IDE**, che in questa sessione non stava
compositando: gli screenshot fallivano con *«the Browser pane is not displayed»* e
`requestAnimationFrame` non scattava mai. Per un controllo visivo vero, aprire
`http://localhost:5513/pokerogue.html` in una finestra normale del browser.

## 20. La lotta finale contro Eternatus, rifatta sull'originale (2026-07-31)

Verifica chiesta dal proprietario. **Non era implementata**: c'era un boss a 5 scudi con
moveset dal learnset, che si batteva e basta. Nell'originale è uno scontro **a due fasi**.

### Com'è nell'originale

Fonti: `battle-scene.ts` (`initFinalBossPhaseTwo`, `getEncounterBossSegments`),
`field/pokemon.ts` (`damage`, `getMinimumSegmentIndex`, `handleBossSegmentCleared`,
`generateAndPopulateMoveset`), `constants.ts`, `dialogue-final-boss.json`.

| | Fase 1 — Eternatus | Fase 2 — Dynamax Infinito |
|---|---|---|
| Tipi | Veleno/Drago | Veleno/Drago |
| Totale base | 690 | **1125** (255 PS, 250 Dif, 250 Dif.Sp) |
| Mosse (fisse) | Raggio Infinito · Fangobomba · Lanciafiamme · Cosmoforza | Cannone Dynamax · Velenocroce · Lanciafiamme · Ripresa |
| Scudi | 4 | nessuno |
| Si può sconfiggere? | **No**: il danno è tagliato a `hp − 1` | Sì |
| Campo | singolo | **doppio** |

Il passaggio scatta quando **cade l'ultimo scudo** (`bossSegmentIndex < 1`), non a un certo
numero di PS. I PS **non si riempiono**: `calculateStats` aggiunge alla vita corrente solo
l'aumento del massimo (`hp += nuovoMax − vecchioMax`), quindi il Dynamax Infinito riparte
da poco meno di due terzi di barra.

Scudi: `2, +1 se livello ≥ 100, +1 se totale base ≥ 670, +1 ogni 250 ondate` → **4** per
Eternatus all'ondata 200 (prima ne mettevamo 5 a occhio).

### Cosa è stato aggiunto

- `bossSegmentsFor()` con la formula vera · `setSegments()` · `ETERNATUS_MOVES` (le due serie
  fisse) · `eternamaxTransform()` (statistiche, tipi, abilità, sprite `890-eternamax`, mosse,
  passaggio in doppio) · dialoghi coi **testi italiani ufficiali**
  (`«Capisco. La presenza che avvertivo era reale.»`, `«Non deludermi.»`, `«…magnifico.»`,
  e il monologo d'incontro).
- **Bonus da rottura scudo, per TUTTI i boss** (`handleBossSegmentCleared`, mancava del
  tutto): +1 stadio a una statistica a caso non ancora al massimo, pesata sul suo valore;
  **+2** sull'ultimo scudo se gli scudi erano ≥3, e sui penultimi se erano ≥5.
  ⚠️ I boss degli **allenatori non lo prendono** (`doStatBoost = !hasTrainer()`).

### ⚠️ Trappola trovata in prova: gli scudi si CONTANO, non si deducono dai PS

Primo tentativo: ricavavo "quanti scudi restano" cercando il primo confine sotto la vita
attuale. Sbagliato — **il boss si cura**. In prova una bacca ha riportato Eternatus da 1 a
451 PS e uno scudo già rotto è tornato intero, quindi la fase non cambiava mai. Ora c'è
`f.segBroken`, un contatore che sale e basta (è il `bossSegmentIndex` dell'originale), e il
prossimo confine è `segBounds[segBroken]`.
**Va inizializzato a 0 ovunque si creino gli scudi**: `makeFighter` (boss normali) e
`setSegments` (boss finale). Se resta `undefined`, `segBounds[undefined]` è `undefined` e
gli scudi non si rompono **mai**.

### Verificato

Con la sonda `window.__items.clamp(danno)`, che dice quanto danno passerebbe senza applicarlo:

| Situazione | Chiesto | Passa | Esito |
|---|---|---|---|
| primo scudo intero | 999999 | 596 | si ferma **esatto** sul confine (1378), scudo rotto, +1 Dif.Sp |
| fase 1, scudi finiti | 999999 | 49 | resta a **1 PS**: non può morire |
| fase 2 | 999999 | 999999 | si può battere |

E in lotta guidata: ultimo scudo rotto → `spd+2` (bonus doppio dell'ultimo scudo) → dialogo →
`👑 Eternatus (Dynamax Infinito)`, forma `eternamax`, sprite `890-eternamax.png`, 0 scudi,
mosse della fase 2, **`doppio: true`** con il secondo Pokémon mandato in campo, PS 1552/2351.
Boss normali: `scudiRotti: 0` inizializzato (Onix e Snorlax boss). 0 errori console.

**Debug**: `__items.finale(livello)` salta all'ondata 200 · `__items.finaleStato()` mostra
fase/forma/mosse/scudi/stadi · `__items.clamp(danno)` prova il taglio senza applicarlo.

⚠️ Ricordarsi che gli **autopiloti a click si impantanano** (è successo di nuovo qui, timeout
di 30s su un ciclo di lotte): per queste verifiche valgono le sonde, non le run automatiche.

### Buconero (aggiunto su richiesta, 2026-07-31)

L'avevo lasciato fuori come scelta di bilanciamento; il proprietario ha chiesto la fedeltà
piena, quindi c'è: entrando in fase 2 Eternatus riceve il **Buconero**, che gli fa rubare un
oggetto tenuto a ogni fine turno. È **non cedibile** come nell'originale
(`setTransferrableFalse`): `_heldFisso = ["blackhole"]` lo esclude da `rubaOggetto`, così non
lo si può riprendere nemmeno coi Presartigli.
Verificato: in tre turni ha svuotato la borsa del giocatore (Avanzi e Presartigli) e il
Buconero è rimasto suo.

⚠️ **Due difetti di testo trovati proprio grazie a questa prova**, che valevano per ogni furto:
- `HELD_IT` non aveva `gripclaw`, `blackhole` e `mysticalrock` → il messaggio diceva
  «ruba **gripclaw**» invece di «Presartigli», e quegli oggetti sparivano anche dal
  riepilogo della squadra (`heldSummary` elenca solo le chiavi presenti in `HELD_IT`).
- il verbo era fisso al plurale: «Il Buconero **rubano**». Ora `rubaOggetto` prende il verbo
  concordato dal chiamante («I Presartigli rubano», «Il Buconero ruba»).

## 21. Disposizione della lotta in doppio (2026-07-31)

Il proprietario ha passato uno screenshot di un doppio della terza generazione come
riferimento. La regola, che vale su **entrambi i lati**: **il Pokémon di destra sta più in
basso di quello di sinistra**, così la coppia si legge in diagonale e si capisce chi è
davanti e chi dietro.

Il lato nemico era già giusto; **quello alleato era invertito** (il destro stava più in alto).

| | sinistra | destra |
|---|---|---|
| nemici | `.enemy2` `top: 12%` | `.enemy` `top: 28%` (più in basso) |
| alleati | `.ally` `bottom: 19%` | `.ally2` `bottom: 3%` (più in basso) |

⚠️ Attenzione al verso: per i nemici "più in basso" vuol dire **`top` più grande**, per gli
alleati **`bottom` più piccolo**. È facile sbagliarsi e ottenere l'effetto opposto.

⚠️ `.ally2` sta a `left: 34%` e non oltre: la coppia di alleati deve restare nella metà
sinistra, come nei giochi veri, altrimenti il secondo finisce **sotto i riquadri PS** in basso
a destra (con `left: 46%` succedeva).

Verificato con le misure: nemici 137 → 216 px, alleati 444 → 529 px (destra sempre più in
basso), e **zero sovrapposizioni** fra i quattro sprite e fra sprite e riquadri.

## 22. Una ROSA di boss finali, non solo Eternatus (2026-07-31)

⚠️ **DEVIAZIONE VOLUTA DALL'ORIGINALE**, chiesta dal proprietario: in PokéRogue all'ondata 200
c'è **sempre** Eternatus e la partita finisce ogni volta allo stesso modo. Qui i boss sono
**14**, uno estratto a inizio run (`game.finalBossIdx`, come già Lega e team cattivo), con
almeno uno per generazione. Restano tutti nei pool delle ondate normali: la versione da boss
si distingue per scudi, fasi e repertorio fisso.

### Come è fatta

Tutto passa da `FINAL_BOSSES`, una tabella. Ogni boss ha 2 o 3 **fasi**; ogni fase può avere:

| campo | cosa fa |
|---|---|
| `forma` | chiave in `forms.json`/`variants.json` (sprite `<dex>-<chiave>`). Può essere una **funzione** per estrarla a caso (Mewtwo X/Y, Kyurem Nero/Bianco) |
| `boost` | moltiplicatore sulle statistiche base |
| `tipi` | sovrascrive i tipi |
| `nome`, `grida` | come si chiama, e le battute alla trasformazione |
| `filtro` | classe CSS sullo sprite (le versioni Ombra) |
| `fx`, `superEff` | effetto permanente e mosse sempre superefficaci |
| `buconero` | l'oggetto non cedibile di Eternatus |

`applicaFase()` scrive tutto sul combattente, `avanzaFaseFinale()` generalizza la vecchia
`eternamaxTransform`. La regola resta quella dell'originale: **finché non è all'ultima fase
non può essere sconfitto** (danno tagliato a `hp − 1`), e si passa avanti quando cade
l'ultimo scudo.

### La rosa

| Gen | Boss | Fasi |
|---|---|---|
| 1 | Mewtwo → Mega X **o** Y | 2 |
| 2 | Lugia → **Lugia Ombra** · Ho-Oh → **Ho-Oh Ombra** | 2 |
| 3 | Rayquaza → Mega | 2 |
| 4 | Giratina · Dialga · Palkia → forma Originale (+18%) | 2 |
| 4 | **Arceus → Arceus Perfetto** | 2 |
| 4 | **un Regi a caso → Regigigas** | preludio + 2 |
| 5 | Kyurem → Nero **o** Bianco | 2 |
| 6 | **Zygarde** 10% → 50% → Perfetto | **3** |
| 7 | **Necrozma** → Criniera/Ali → Ultra | **3** |
| 8 | Eternatus → Dynamax Infinito | 2 |
| 9 | **Terapagos** → Terastal → Stellare | **3** |

### Le tre cose nuove per il motore

**Tipo ASTRALE.** Non sta in `types.json` (i tipi veri sono 18): `typeMultiplier` lo tratta a
parte — chi ce l'ha non viene **mai** colpito in super efficacia e non resiste a niente, come
nell'originale dove in difesa vale sempre 1. ⚠️ Va aggiunto a mano a `T` al boot, o ogni
schermata che stampa un tipo (`T[tipo].it`) crolla; e il filtro tipi della selezione starter
deve ciclare su `CHART`, non su `Object.keys(T)`, o comparirebbe "Astrale" fra i 18.

**Mosse sempre superefficaci** (`superEff`): in `computeDamage` l'efficacia viene alzata a
almeno 2. Le **immunità restano tali**. Spunto dalla Lastra Legum di Leggende: Arceus, che in
PokéRogue esiste ma non fa nulla (`LEGEND_PLATE, // TODO: Find a potential use for this`).

**Versioni Ombra.** Non esistono nei dati (vengono da Pokémon XD, uno spin-off): si ricolora
lo sprite normale. ⚠️ **`hue-rotate` da solo NON funziona** — su Lugia (bianco/azzurro) vira
al **verde**, su Ho-Oh dà un viola da pagliaccio. Serve `grayscale(1) sepia(1) hue-rotate(…)
saturate(…)`, che appiattisce prima e poi ricolora, così la tinta non dipende dai colori di
partenza. Provato sui due sprite veri prima di scegliere i valori. Prezzo da sapere: il
filtro è monocromatico, quindi il **cromatico di quella specie diventa indistinguibile**.

### ⚠️ Trappole trovate in prova

- **Il rettangolo attorno alle forme Ombra**: `renderSprite` azzera bordo/sfondo/box-shadow
  solo quando lo sprite **c'è**. Al cambio forma `spr` torna `null` per un istante e si vede
  il **segnaposto**, che quel bordo ce l'ha: col filtro sopra diventava un rettangolo scuro.
  Ora le classi `ombra`/`stelle` si applicano **solo a sprite caricato**.
- **Il guardiano di Regigigas aveva 16 scudi**: `makeFighter` li dà con `2 + livello/25` e
  all'ondata 200 il livello supera 350. Ora usa `bossSegmentsFor`, come il boss finale (→ 4).
- **L'ingrandimento va applicato DOPO il restringimento del doppio**, o si annullano: la
  lotta finale è sempre in doppio. `BOSS_FINALE_SCALA = 1.55` × `DOUBLE_SHRINK 0.72` ≈ 1,12.
  Eternamax finale: **+60% rispetto alla sua prima fase**, 39% dell'altezza della scena.
  Tocca l'alleato per 48×45px, il **4,6%** della sua area — angoli trasparenti, si legge come
  profondità. Se un giorno desse fastidio, si abbassa quella costante.

### Stato delle verifiche

Provati **tutti e 13** i boss della tabella con `provaBoss()`: fasi attese = fasi raggiunte,
forme/tipi/statistiche/mosse applicate, sprite con le classi giuste, passaggio in doppio,
**0 errori console**. Le tre-fasi (Zygarde 10%→50%→Perfetto, Necrozma →Criniera→Ultra,
Terapagos →Terastal→Stellare) arrivano tutte in fondo.

✅ **Regigigas verificato fino in fondo** (vedi §24): guardiano → Regigigas → Regigigas
Scatenato → schermata CAMPIONE.

**Debug**: `__items.bossFinali()` elenca la rosa con tutte le fasi risolte ·
`__items.finale(livello, "ARCEUS")` salta all'ondata 200 con quel boss ·
`__items.finaleStato()` · `__items.clamp(danno)`.

## 23. Pedane del bioma END e ordine di sovrapposizione (2026-07-31)

Due difetti grafici segnalati dal proprietario con uno screenshot della lotta finale.

### Le pedane sbagliate all'ondata 200

`setPlatform` dava per scontato che ogni arena fosse **320×132** e ritagliava la pedana da un
angolo con coordinate fisse. Vero per **72 file su 74** — ma non per il bioma **END**:

| file | dimensioni | cos'è davvero |
|---|---|---|
| `town_a/b.png` e gli altri 70 | 320×132 | una scena, con la pedana in un angolo |
| `end_a.png` | **155×155** | una **striscia verticale di ~5 fotogrammi**: la pedana è ANIMATA |
| `end_b.png` | **170×170** | idem |

Ritagliare quelle due con le coordinate del formato largo prendeva una fetta **a cavallo di
più fotogrammi**: da lì le forme rossastre e stirate sotto i Pokémon.

Ora `setPlatform` legge `naturalWidth/naturalHeight`: se l'arena non è 320×132 la tratta come
una striscia e ne prende il **primo fotogramma**, trovandone l'altezza con `primoFotogramma()`
— che scandisce le righe completamente trasparenti su un canvas. Vale anche per eventuali
altre arene fuori formato che dovessero saltare fuori.

### Le animazioni coprivano tutto

`#anim-canvas` stava a **z-index 7**, sopra ogni cosa: certe mosse nascondevano l'intera
schermata, Pokémon compresi. Le animazioni devono stare **sopra lo sfondo ma sotto i
combattenti**. Ordine della scena, dal basso in alto:

```
#arena / sfondo (auto) < #anim-canvas (3) < .battler-slot (4)
      < riquadri PS (5) < oggetti tenuti (6) < overlay #meta (20)
```

`.battler-slot` non aveva z-index: gliene serviva uno esplicito, o restava sotto il canvas.

### Corretto anche l'aggancio di debug

`__items.finale()` cambiava `game.biome` **senza** chiamare `applyBiomeBackground()`: le
pedane restavano quelle del bioma precedente e il test **non riproduceva lo stato vero** —
infatti al primo controllo il difetto non si vedeva. Ora lo chiama.

⚠️ **Regola di lavoro data dal proprietario**: durante i test **guardare sempre anche la
grafica**, non solo i numeri. Questi due difetti erano sotto gli occhi in ogni prova della
lotta finale, ma stavo leggendo solo statistiche e fasi dal DOM. Uno screenshot per feature
costa poco e li avrebbe presi subito.

## 24. Regigigas visto in campo, e perché prima non ci riuscivo (2026-07-31)

Il proprietario ha chiesto di insistere finché non lo vedevo davvero, con una squadra
potenziata. Fatto: **guardiano → Regigigas → Regigigas Scatenato → 🏆 CAMPIONE**.

```
t1: Regieleki 1217 -> 912   scudi rotti 1
t2: Regieleki  912 -> 912   scudi rotti 2
t3: Regieleki  912 -> 304   scudi rotti 3
t4: Regieleki  304 -> Regigigas (torpido) 1276   *** entra il boss ***
t1: Regigigas 1276 -> 760   scudi rotti 1
t2: Regigigas  760 -> Regigigas Scatenato 1270   *** fase 2 ***
t3: Regigigas Scatenato 1270 -> 0                *** CAMPIONE ***
```

### Perché i tentativi precedenti fallivano

**Non era il pannello del browser**, come avevo supposto: era il moveset. `__items.finale()`
alza il livello ma **non reinsegna le mosse**, quindi Mewtwo restava con quelle di livello 5 e
il ciclo di prova sceglieva sempre il **primo** bottone — che era **Psiconda**, una mossa a
danno fisso che **ignora l'attacco**. Con qualunque potenziamento alle statistiche il danno
restava zero, il boss non scendeva mai e sembrava che i turni non girassero.

⚠️ **Lezione**: quando un test "non fa danno", guardare **quale mossa** sta usando prima di
dare la colpa all'ambiente. Bastava leggere la narrazione — diceva solo la mossa del nemico.

### Come si potenzia una squadra per i test

`recomputeStats` non è esposto, ma non serve: si scrive direttamente su ciò che il motore
legge davvero.

```js
p.maxHp = p.hp = 9999999;
p.stats = { hp:9999999, atk:999999, def:999999, spatk:999999, spdef:999999, spd:99999 };
p.stages = { atk:0,def:0,spatk:0,spdef:0,spd:0, acc:6, eva:0 };   // precisione piena
p.moves = [{ id:"PSYSTRIKE", pp:99, maxPp:99 }, …];               // ⚠️ mosse VERE
```

Va riapplicato a ogni turno (il gioco ricalcola le statistiche ai passaggi di livello).

### Un difetto grafico trovato guardando lo screenshot

Quattro icone di oggetti **fluttuavano a metà scena**, in mezzo ai Pokémon. Causa:

```css
.held-bar        { left: 4px; bottom: 4px; }
.held-bar.enemy  { left: auto; right: 4px; top: 4px; }   /* manca bottom: auto! */
```

Con **top e bottom insieme** la barra del nemico si stirava per **tutta l'altezza della
scena** (541px su 552); con `flex-wrap` la seconda riga di icone finiva a metà schermo.
Aggiunti `bottom: auto` e `align-content: flex-start`: ora è alta 20px e le icone stanno su
una riga sola. ⚠️ È lo stesso tipo di svista di `.battler-slot[hidden]` (§19): una regola
che ne sovrascrive un'altra **solo a metà**.

Trovato applicando la regola del §23 — **guardare sempre anche la grafica** — che alla prima
occasione ha già reso.

---

## 25. Premio GIF: le GIF di vittoria, da uno zip scelto dall'utente (2026-07-31)

È la **Fase 8**, ma non come stava scritta nel piano. Il proprietario ha dato indicazioni
nuove che **sovrascrivono l'handoff**, compresa la regola «niente file picker» (§7.6).

### Com'è

1. **Tre tocchi di fila sul titolo** della Home (`.meta-title`, entro **700 ms** l'uno
   dall'altro) aprono il **selettore di file del telefono**.
2. Si sceglie un **file `.zip` pieno di GIF**.
3. Lo zip si scompatta **in sottofondo**, una voce alla volta: si continua a giocare, e
   l'unica cosa visibile è una **barra di caricamento sul bordo basso dello SCHERMO**.
4. Battuto un **allenatore**, compare **a schermo intero** una GIF **estratta a caso fra
   quelle già pronte e non ancora usate**.
5. Dura **tanti secondi quanta è l'ondata** (ondata 15 → 15 secondi). Poi la partita
   riprende da sola.

### Dove sta nel codice

| Pezzo | Dove |
|---|---|
| Tutto il modulo | `pokerogue.js`, blocco «PREMIO GIF (easter egg)», prima di «AVVIO» |
| Lettura dello zip | `zipIndice()` + `zipEstrai()` |
| Caricamento in sottofondo | `gifCaricaZip()`, barra in `gifProgresso()` / `gifErrore()` |
| Scelta e visione | `gifPesca()` / `gifMostra(secondi, poi)` |
| Triplo tocco | `gifTocco()`, agganciato in `showHome()` |
| Aggancio alla vittoria | `onWaveCleared()` — vedi sotto |
| HTML | `#gif-load` (figlia di `#game`), `#gif-prize`, `<input id="gif-zip">` |
| CSS | blocco «PREMIO GIF» in fondo a `pokerogue.css` |

**`onWaveCleared()` è stata spezzata in due.** Adesso è solo il guardiano del premio GIF;
il corpo di sempre si chiama **`vittoriaOndata()`**. Se cerchi la logica di fine ondata
(soldi, livelli, uova, cattura, negozio) è lì.

### Niente librerie: lo zip si legge a mano

Il gioco è offline, quindi nessun `pako` da CDN. Il formato zip però è semplice:

- si legge **solo la coda** del file per trovare l'EOCD (firma `0x06054b50`), che dice dove
  sta l'indice — così uno zip enorme non finisce mai tutto in memoria;
- si scorre l'indice centrale (firma `0x02014b50`) e si tengono solo le immagini;
- per ogni voce si rilegge l'**header locale** (firma `0x04034b50`), perché
  ⚠️ **le lunghezze di nome ed extra lì possono essere diverse da quelle dell'indice**: darle
  per uguali significa partire in mezzo ai dati;
- i dati compressi si espandono con **`DecompressionStream("deflate-raw")`**, che il browser
  ha già (metodo 8 = deflate, metodo 0 = archiviato senza comprimere).

⚠️ **Il MIME va rimesso a mano.** `new Response(flusso).blob()` restituisce un blob **senza
tipo**, e un `blob:` url senza `Content-Type` **non viene disegnato dall'`<img>`**. Si usa
`blob.slice(0, blob.size, "image/gif")`, che cambia solo l'etichetta senza ricopiare i dati.

**Non gestito di proposito**: zip64 (oltre 65535 voci o 4 GB) e i metodi di compressione
diversi da 0 e 8 — entrambi danno barra rossa e nient'altro.

### Scelte prese, che una sessione nuova non deve "correggere"

- 🔴 **Le GIF stanno in memoria per la sessione e NON vanno salvate su disco.**
  Riscegliere lo zip a ogni avvio è **voluto**: gliel'ho proposto di conservarle in
  IndexedDB dopo che aveva provato l'app sul telefono, e ha risposto di no —
  *«è giusto che vadano ricaricate ad ogni partita se si vuole usare l'easter egg»*.
  Fa parte del gioco: l'easter egg si riattiva ogni volta. **Non "sistemarlo".**
- **Quando le GIF sono finite si ricomincia il giro** (`gifs.usate` si svuota): una run
  lunga batte più allenatori di quante GIF ci siano in uno zip normale.
- **Un tocco sulla GIF la chiude in anticipo.** Non era richiesto: è una via d'uscita,
  perché con la durata legata all'ondata il Campione dell'ondata 190 terrebbe la GIF ferma
  **più di tre minuti**. ⚠️ **Se il proprietario dice che va tolto, si toglie** — è l'unico
  pezzo di questa funzione che non ha chiesto lui.
- **`object-fit: contain`**, quindi la GIF non viene mai tagliata né deformata: le
  panoramiche lasciano molto nero sopra e sotto. Con `cover` riempirebbe tutto ma
  taglierebbe i bordi. Se preferisce il pieno, si cambia quella sola riga.
- **Vale per gli allenatori, non per i boss selvatici**: la condizione è
  `game.enemy.trainer`, quindi ci rientrano anche Rivale, capipalestra, team cattivi,
  Superquattro e Campione. Il boss finale non è un allenatore e non dà GIF.

### ⚠️ Due trappole nuove

- **`max-width: 100%` non ingrandisce.** Prima le GIF (250×169 quelle di prova) restavano a
  grandezza naturale in mezzo a uno schermo nero: sembrava che l'overlay non funzionasse.
  Serve **`width/height: 100%` + `object-fit: contain`**.
- **La barra deve stare SOPRA `#meta` (z-index 30, non 8).** Lo zip si sceglie dalla Home,
  che è una schermata meta a z-index 20: con un valore più basso la barra resta nascosta
  proprio mentre carica. Funziona perché `#top-screen` non crea un contesto di impilamento.
- ⚠️ **Correzione dal telefono (2026-07-31)**: stava dentro `#scene`, quindi si appoggiava al
  bordo basso del CAMPO DI LOTTA — a metà altezza del telefono, sul confine coi comandi.
  Ora è figlia di `#game` e `position: fixed`, cioè sul bordo basso dello schermo. Regge
  perché nessun antenato ha `transform`/`filter`, che degraderebbero `fixed` ad `absolute`.

### Come si prova (il selettore di file NON si guida da script)

Hook nuovo **`window.__gif`**:

```js
__gif.zip('ZZ.zip')   // carica uno zip servito dal server, come se l'avessi scelto
__gif.stato()         // quante pronte, quante usate, i nomi
__gif.prova(3)        // mostra subito una GIF per 3 secondi
__gif.apri()          // apre il selettore, come il triplo tocco
```

Il percorso vero (`change` sull'input) si prova costruendo un `File` e un `DataTransfer` e
lanciando l'evento a mano: l'unica parte non provabile è la finestra di sistema.

⚠️ **Nel pannello del browser i tempi non tornano.** Misurando la durata venivano
sistematicamente **+1 secondo**: la pagina è `visibilityState: "hidden"` e Chrome allinea i
timer al secondo (un `setTimeout` da 50 ms ne impiegava 1000). **Non è un difetto del
codice**: verificarlo con un timer nudo prima di andare a caccia.

### Verificato (2026-07-31)

- Zip di prova del proprietario (`ZZ.zip`, 40 MB, 24 GIF + 1 WebP, tutte deflate):
  **25 su 25 estratte e disegnate**, ~5 s in tutto.
- **25 estrazioni di fila senza un doppione**; tutte inquadrate al 100% della larghezza,
  nessuna sbordante, nessuna deformata.
- Triplo tocco: 2 tocchi non aprono, il 3° sì, e si riarma; tocchi lenti (>700 ms) no.
- File non-zip → barra rossa, sparisce da sola, GIF già caricate intatte.
- **Run guidata fino all'ondata 30**: GIF alle ondate **5, 8, 15, 25, 30** (Scienziato,
  Rivale, Bellezza, Rivale, **Brock**) e **su nessun'altra** — niente sui selvatici né sul
  boss dell'ondata 10. Dopo la GIF la narrazione riprende («Ti fermi a riposare…»).
- Guardato anche a occhio (regola del §23): screenshot della GIF in mezzo alla lotta (nero
  pieno, nessun pezzo di gioco che trapela) e della barra sul bordo della scena.
- **0 errori console.** Cache: **css v=55, js v=106**.

### Rimasto in sospeso

- **`ZZ.zip` sta nella cartella dell'app** ed è lo zip di prova del proprietario: 40 MB che
  **non devono finire nell'APK né in un deploy**. Va escluso o spostato.

---

## 26. Tre slot di salvataggio (2026-07-31)

Era una decisione presa al primo giorno («3 slot salvataggio») e mai realizzata: fino a ieri
una partita interrotta era persa.

### Come funziona

Il progresso e' diviso in due, **come nell'originale**:

- **`meta`** — una sola copia (chiave `pokerogue_mobile_meta_v1`): starter sbloccati,
  caramelle, IV migliori, uova, voucher, record. **E' condiviso da tutti e tre gli slot.**
- **Gli SLOT** — tre, indipendenti (`pokerogue_mobile_save_1|2|3`): una partita in corso
  ciascuno.

Home → **▶ Gioca** (che dice quante partite sono in corso) → schermata **Salvataggi** con
le tre caselle: quella vuota avvia una run nuova, quella piena apre **Riprendi / Nuova run
(cancella questa) / Indietro**. Cancellare chiede conferma: una partita da 100 ondate non
si butta con un tocco.

### Quando si salva

**All'inizio di ogni ondata**, in cima a `nextWave()` e **prima** dell'incremento: lo slot
contiene sempre «ondate completate». Lo slot si **svuota da solo** a fine partita, sia per
sconfitta (`gameOver`) sia per vittoria (`renderRunVictory`).

⚠️ **Non si salva a meta' battaglia, ed e' voluto.** Riprendendo si rigioca l'ondata da capo
con un avversario nuovo. Serializzare turni, code di eventi e animazioni in corso sarebbe
fragile e non vale il rischio: al massimo si perde l'ondata in corso.

### Cosa viene salvato

`CAMPI_RUN` (ball di ogni tipo, soldi, pietre, amuleti, potenziamenti a tempo, bioma,
indici di Lega/Team cattivo/boss finale, sesso del Rivale, Megacerchio/Fascia, starter) piu'
**squadra e box** completi. Restano fuori di proposito:

- `player` / `enemy` — si ricreano;
- `events` / `timer` / `afterEvents` — roba di narrazione;
- **`encReward`** — ⚠️ e' una **funzione**, non sopravvive a JSON. Va rimessa a `null`.

Un Pokemon e' gia' quasi tutto JSON. Le due eccezioni le gestiscono `monSalva`/`monCarica`:

- **`spr`** (i dati dell'immagine) si butta e si ricarica;
- **`ability` e `passiveAbility` sono RIFERIMENTI dentro `ABIL`**: si salva il loro `id` e si
  riaggancia al caricamento. ⚠️ Salvandoli com'erano si otterrebbe una copia scollegata e i
  confronti per identita' fallirebbero.

Peso reale: **~1,3 KB** per una squadra di uno, pochi KB a squadra piena.

### Provarlo senza chiudere l'app

```js
__save.stato()       // cosa c'e' nei tre slot
__save.salva()       // forza il salvataggio adesso
__save.riprendi(2)   // ricarica lo slot 2
__save.peso()        // quanti byte occupano
__save.cancella(1)
```

### Verificato

Run portata all'ondata 12, **ricaricata la pagina**, ripresa dallo slot: confronto campo per
campo di ondata, bioma, soldi, ball, amuleti, pietre, Lega, Team cattivo, boss finale, sesso
del Rivale, starter e dell'intera squadra (nome, livello, PS, abilita', natura, IV, vitamine,
oggetti tenuti, bacche, mosse con i PP) → **zero differenze**. I tre slot restano
indipendenti; a fine partita lo slot si libera.

---

## 27. Giro di collaudo: tre difetti veri, trovati e corretti (2026-07-31)

Richiesta del proprietario prima dell'APK. Il metodo che ha reso: **sonde deterministiche
sui dati**, non run automatiche (una run tocca 40 specie, una sonda le tocca tutte e 1084).

### 27.1 🔴 55 specie senza sprite — e un difetto CIRCOLARE negli strumenti

Il piu' grosso. `species.json` marcava `noSprite: true` **55 specie** (tutte le forme di
Alola/Galar/Hisui, numeri dex 2000+/4000+). Conseguenze in gioco:

- **il bioma Isola era svuotato**: su 26 voci del pool ne restavano **6**, e nel tier COMMON
  **1 sola su 8** — ma le altre uscivano lo stesso, come **segnaposto colorati**, perche'
  `biomePick` filtrava con `arr.filter(k => S[k])`, cioe' «la specie esiste», non «si puo'
  disegnare». **56 casi su 35 biomi.**
- **12 evoluzioni** portavano a una specie non disegnabile: Cubone → Marowak di Alola al
  Lv.28 di notte, Pikachu + Pietrastella → Raichu di Alola, ecc. Stesso controllo mancante in
  `checkLevelUps`, `usefulStones`, `compatibleStoneEvos`, `evolvedFormFor`.

🔴 **La causa era un giro chiuso fra i due strumenti**: `extract-data.mjs` mette `noSprite`
quando il file **non c'e' fra i nostri asset**, e `copy-sprites.mjs` aveva in cima
`if (species[id].noSprite) continue;` con la spiegazione «forme regionali che l'originale non
disegna». **Falso**: nel sorgente ci sono tutte, coi quattro tagli e le mini-icone. Chi era
marcato non veniva mai copiato, e non essendo copiato restava marcato.

**Corretto in tre punti**: `copy-sprites.mjs` ora considera tutte le specie (220 file, **0,4
MB**); rigenerati i dati (**`noSprite` da 55 a 0**, nient'altro cambiato in `species.json`);
e aggiunti `specieUsabile()` / `evoUsabile()` come rete permanente nei cinque punti che
sceglievano una specie. Verificato: Isola torna a 13 specie pescabili, **0 casi su 35 biomi**,
**0 evoluzioni rotte**, e il Vulpix di Alola si vede in campo (screenshot).

### 27.2 🔴 «Cannot set properties of null (setting 'timer')» nelle partite lunghe

Un centinaio di eccezioni intorno all'ondata 101. In `playMoveAnim` il ciclo `step()` puo'
ripartire **molto dopo**, dal listener `load` del foglio sprite; se nel frattempo la
narrazione e' andata avanti, `stopMoveAnim()` ha gia' messo `animRun = null` e l'ultima riga
faceva `animRun.timer = …` su `null`.

Corretto dando un'**identita' a ogni riproduzione** (`const run = {…}; animRun = run;`) e
uscendo subito se `animRun !== run`. Copre anche il caso in cui un vecchio listener guidasse
l'animazione nuova. Verificato: la stessa run che ne produceva ~100 ora arriva **all'ondata
200 con 0 errori**.

### 27.3 Sfondo del bioma stirato

`#arena` aveva `background-size: 100% 100%` **sotto un commento che prometteva «aspetto
naturale, nessuna distorsione»**: l'arte e' 320×180 e la scena in verticale 393×590, quindi
veniva tirata più di tre volte in altezza. Ora `cover`, che riempie senza deformare.
⚠️ **Le bande orizzontali del terreno restano**: non sono distorsione, sono la texture
dell'arte ingrandita 3×, inevitabile in verticale. Provato anche `100% auto` (proporzioni
perfette) ma lascia il Pokemon avversario **sospeso in cielo**: scartato.

### La sonda nuova — `window.__audit`

Vale piu' di qualunque run automatica e va **rilanciata dopo ogni modifica ai dati**:

```js
__audit.specie(25)   // ogni specie: mosse, danno, statistiche, abilita', tipi, sprite
__audit.mosse()      // ogni mossa: nome, tipo, PP, animazione (chiave RISOLTA)
__audit.biomi()      // ogni bioma: pool pescabile e collegamenti
__audit.tutto()      // i tre insieme, in breve
__items.pesca("ISLAND", 400) · __items.pescaTutti() · __items.evoRotte()
```

Esito attuale: **1084 specie ai livelli 5, 25 e 100 → 0 problemi** (nessuna senza mossa da
danno: la rete che aggiunge Azione regge), **952 mosse → 0**, **35 biomi → 0**.

⚠️ **Trappola in cui sono cascato scrivendo la sonda**: chiedevo `animAvailable(id)` sull'id
crudo e mi diceva «109 mosse senza animazione». Il motore risolve prima il **ripiego**
(`animKeyForMove`), quindi va chiesto su quella chiave. Era un falso allarme mio.

### ⚠️ Cose che sembravano difetti e NON lo erano

Tre volte l'autopilota si e' impiantato e tre volte il gioco aveva ragione:

- mossa a **PP 0** → il tasto e' `disabled` (opacita' 0,45), giusto cosi';
- **«a chi lo dai?»** per un Revitalizzante → solo l'esausto e' cliccabile, gli altri
  `disabled`;
- menu che mostrava mosse diverse da quelle di `game.player` → era una **lotta in doppio**,
  il menu era del secondo alleato (`game.chooser === 1`).

**Regola per l'autopilota, da non riscoprire**: filtrare sempre `b.disabled` prima di
cliccare, e ricordare che la fase `MESSAGE` ospita anche la schermata «quale mossa
dimentica?» (li' non c'e' `.msgbox`) e che `BIOME` sta in `#commands`, non nell'overlay.

### Collaudo finale

Run guidata **dall'ondata 1 alla 200 con vittoria** (🏆 CAMPIONE), passando per allenatori,
capipalestra, Superquattro, Campione, boss finale, lotte in doppio, incontri misteriosi,
furti, negozio e cambi di bioma: **0 errori console**, 37 GIF di vittoria mostrate, lo slot
liberato a fine partita.

---

## 28. L'APK e l'aggiornamento a caldo (2026-07-31) — Fase 9

Richiesta del proprietario: **«se facciamo delle modifiche al gioco quelle devono arrivare
sul cellulare senza ricreare l'APK e reinstallarlo»**. E, nella stessa occasione, ha
**revocato la regola «offline totale»**: riguardava solo l'assenza di login e password, non
il divieto di usare la rete. Le regole del §7 vanno lette con questa correzione.

### Com'e' fatto

Il gioco e' spezzato in due, e i due pezzi viaggiano per strade diverse:

| Pezzo | Dove sta | Come si aggiorna |
|---|---|---|
| **Asset** — sprite, animazioni, arene, icone (135 MiB, 14.700 file) | dentro l'APK | serve un **APK nuovo** |
| **Cervello** — `pokerogue-app.html` + `.css` + `.js` + `data/*.json` (2,3 MB) | dentro l'APK **e** su GitHub Pages | **da solo, dalla rete** |
| **Guscio** — `pokerogue.html` + `pokerogue-boot.js` | dentro l'APK | serve un **APK nuovo** (voluto: e' lui che decide cosa caricare) |

Il perche' di questa divisione: dei 142 MB, **126,7 sono sprite** che ormai non cambiano
piu' (il dex e' completo). Quello che tocchiamo davvero a ogni sessione sta in meno di
2,3 MB, e una modifica tipica al solo motore muove **~400 KB**.

### Il giro completo

1. All'avvio `pokerogue-boot.js` guarda in IndexedDB se c'e' uno strato scaricato valido.
   Se c'e' lo usa, altrimenti usa i file dell'APK. **Il gioco parte comunque**, anche senza
   rete.
2. Passati 4 secondi — a gioco gia' avviato — se c'e' rete scarica `versione.json` dal sito.
   Se la revisione e' piu' alta, prende i file cambiati in sottofondo.
3. **L'aggiornamento si applica al riavvio successivo**, mai a meta' partita.

I file sono salvati con **chiave = impronta del contenuto**, e il manifesto si scrive per
**ultimo**: se lo scarico si interrompe non resta mai uno strato a meta', e i file non
cambiati non si riscaricano (provato: una modifica al solo `pokerogue.js` scarica **1 file
su 15**).

### 🔴 Il cane da guardia — la parte che conta davvero

Un push sbagliato non deve poter lasciare il telefono con un gioco che non si apre.

- Prima di avviare uno strato di rete si scrive la sua revisione in `pokerogue_ota_try`.
- Il gioco, quando e' davvero su, chiama `PR.avvioRiuscito()` che la cancella
  (ultima riga di `boot()` in `pokerogue.js`).
- Se all'avvio dopo quella sentinella c'e' ancora, quella revisione **non era partita**:
  finisce in `pokerogue_ota_bad`, lo strato viene buttato e si torna a quello dell'APK.
  Non verra' nemmeno riscaricata.

⚠️ **Il primo tentativo era sbagliato e l'ho scoperto solo provandolo davvero.**
`avvioRiuscito()` cancellava la sentinella **sempre**, anche quando il gioco era partito
dalla copia dell'APK dopo un fallimento. Risultato: la revisione guasta non veniva mai
bocciata e si ritentava al riavvio dopo — il telefono avrebbe **oscillato fra "si apre" e
"schermo nero"** all'infinito. Ora la sentinella la cancella solo chi l'ha scritta
(`revInProva`), e chi fallisce entra nella lista dei bocciati.

Sequenza verificata per intero, in browser, con un finto sito remoto:
rev 1 (APK) → **rev 2 buona, applicata** → **rev 4 con errore di sintassi**: primo avvio
schermo nero, secondo avvio la butta e riparte dall'APK → **rev 5 buona, applicata**.
Cioe': un push sbagliato costa **un avvio**, si ripara da solo, e non blocca i push
successivi.

### Come si pubblica una modifica — UN SOLO COMANDO

```bash
node tools/pubblica.mjs "cosa ho cambiato"
node tools/pubblica.mjs "nuovi sprite" --assets
```

Fa manifesto → copia nel repo → commit → push, in quest'ordine.
🔴 **Non fare i passaggi a mano**: saltare `make-manifest.mjs` significa che il telefono
**non si accorge di niente** e l'aggiornamento non arriva mai. E' l'errore piu' facile da
fare e il piu' difficile da diagnosticare.

`--assets` alza `assetsRev` e serve quando si toccano sprite/animazioni/arene: quella roba
sta solo nell'APK, quindi va rifatto il pacchetto.

### Il progetto Android

`C:\Users\lfili\CapacitorApps\pokerogue-mobile` (fuori da OneDrive, come da pipeline).

⚠️ **Qui si diverge dalla pipeline abituale del proprietario**, che fa APK con
`server.url` puntato a Pages (guscio vuoto che scarica tutto). Qui **no**: `capacitor.config.json`
non ha `server`, e `webDir: "www"` contiene tutto il gioco. Serve perche' il gioco deve
partire e funzionare anche senza campo.

- **Schermo intero vero** (richiesta esplicita: niente barre ne' sopra ne' sotto):
  `MainActivity.java` usa `WindowInsetsControllerCompat.hide(systemBars())` con
  `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`, piu' `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`
  per arrivare sotto il foro della fotocamera. ⚠️ Va rimesso in
  `onWindowFocusChanged`: dopo una notifica o una strisciata le barre tornerebbero.
- `android:screenOrientation="portrait"` nel manifesto, solo permesso INTERNET.
- **`www/index.html` e' un trampolino di due righe** verso `pokerogue.html`: Capacitor apre
  `index.html` e basta. La regola «mai index.html» riguarda il SITO, dove convivono piu'
  app; dentro l'APK c'e' solo questo gioco e i suoi file tengono i loro nomi.
- Icona: da `pokerogue.jpeg` (554×554, ball su bianco) via `tools/`… no, via lo script in
  `icone/` — bianco tolto con riempimento dai bordi **piu' un'erosione di 2 px**, altrimenti
  la compressione JPEG lascia un alone chiaro che su fondo scuro si vede benissimo.
  Applicata anche la correzione nota della pipeline: l'inset del 16,7% va tolto dal solo
  `<background>` in `ic_launcher.xml`, e `capacitor-assets` lo riscrive a ogni run.

### Trappole trovate montando tutto questo

- 🔴 **`DOMContentLoaded` non scatta piu'.** Il guscio inserisce `pokerogue.js` **dopo** che
  l'evento e' gia' passato, quindi `boot()` non partiva e restava la schermata di
  caricamento. Ora: `if (document.readyState === "loading") …addEventListener… else boot()`.
- Le animazioni (`data/anims/`, 913 file, 4,7 MB) sono state **escluse dal manifesto**:
  non passano da `loadJson` ma da `prefetchAnim`, che le legge dall'APK. Metterle dentro
  voleva dire far scaricare 7 MB per non usarli. Contano come asset.
- Il browser normale **non** usa niente di tutto questo: i file del sito sono gia' gli
  ultimi. L'aggiornatore si accende solo in app, o con `?ota` per provarlo.

### Agganci di debug

```js
__ota.stato()      // cosa sta usando, cosa e' pronta, quali revisioni ha bocciato
__ota.controlla()  // forza il controllo adesso, senza aspettare i 4 secondi
__ota.azzera()     // butta lo strato scaricato e la lista dei bocciati
__ota.remoto()     // il versione.json del sito
```

E per provare tutto il giro da PC, senza aspettare che Pages ripubblichi:
`pokerogue.html?ota&remoto=http://localhost:5514/una-cartella-finta/`

### Indirizzi

- Repo: <https://github.com/fithzhood/pokerogue-mobile> (pubblico)
- Sito: <https://fithzhood.github.io/pokerogue-mobile/pokerogue.html>

---

## 29. La lista del proprietario (2026-08-13/14) — rev 47, e le 5 cose che restano

Il riquadro "stato REALE" in cima diceva: *parti dalla lista dei difetti del proprietario*.
È successo. Luca ha giocato sul telefono e ha segnalato i difetti **uno alla volta** mentre
lavoravo: **38 segnalazioni, 33 chiuse e pubblicate**. Questo capitolo serve a chi riprende:
le 5 che restano, con l'indagine già fatta, e le lezioni del giro.

### Come si è lavorato (rifallo così)

Una segnalazione alla volta → si studia il sorgente originale PRIMA di decidere → si verifica
**con uno screenshot**, non solo col DOM → si pubblica subito con `node tools/pubblica.mjs "…"`.
Il ciclo corto ha funzionato: 15 pubblicazioni in una sessione, e Luca ha potuto provare
mentre andavo avanti.

🔴 **La cosa più importante imparata**: Luca ha segnalato **due volte difetti già corretti**,
perché il telefono era su una revisione vecchia — l'aggiornamento a caldo si applica al
riavvio **successivo** a quello che lo scarica, quindi con molte pubblicazioni di fila si
resta indietro. Ora la Home mostra in fondo `rev N · da rete/da APK` (`etichettaRevisione()`).
**Prima di indagare una segnalazione, chiedi che revisione legge.**

### Cosa è cambiato di grosso (serve per capire il codice che trovi)

- **Narrazione a TOCCO**, non più automatica (`NARRAZIONE_AUTO` solo con `?fast`).
  Un evento può portare **più righe**: `makeLog.add(t)` e `stessoMomento(messages, t)`
  attaccano la frase al momento precedente invece di aprire una schermata nuova. La regola
  sta nel commento sopra `stessoMomento`, e va rispettata quando aggiungi messaggi:
  **insieme** l'annuncio della mossa e com'è andata; **a parte** il KO, gli stati, i danni di
  fine turno e tutto ciò che chiede una decisione.
- ⚠️ Conseguenza: l'evento porta l'istantanea **dopo** il colpo, quindi `riallinea()` conserva
  quella di prima in `e.pre` e `nextEvent` la mostra **durante l'animazione**, applicando il
  danno alla fine (`applicaColpo`). Se tocchi la riproduzione non rompere questo: è ciò che fa
  cadere la barra dei PS al momento dell'impatto.
- **EXP vera** con le curve per specie e il **tetto di livello per ondata** (`livelloMassimo`).
  Il livello nemico ora è `1 + O/2 + (O/25)²`, non più lineare.
- Code nuove, tutte figlie dello stesso schema (metti in coda, anima dopo la narrazione):
  `pendingEvos` → `processEvos`, `pendingHatches` → `processHatches`, oltre alla già esistente
  `pendingLearns` → `processLearns`. Ordine in `vittoriaOndata`: evoluzioni → schiuse → mosse.
- Dati nuovi: `data/eggmoves.json` (571×4), `data/dialoghi.json` (277 allenatori), e su
  `species.json` i campi `baseExp`, `growthRate`, `leggendario`, `semiLeggendario`, `misterioso`.

---

### RESTA 1 — Consultare mossa e Pokémon nella schermata «quale mossa dimentica»

**Chiesto**: quando un Pokémon con 4 mosse potrebbe impararne una nuova si vedono solo i nomi.
Serve leggere la descrizione della mossa NUOVA e delle quattro già note, e anche le statistiche
del Pokémon, per capire se la mossa gli è adatta (fisica o speciale rispetto ad Att e Att.Sp).

**Dove**: `processLearns` (cerca `Quale mossa dimentica`). Oggi disegna quattro `.move-btn` più
«Rinuncia a X».

**Come, senza inventare niente**: c'è già tutto.
- `snippetMossa(id)` produce il riquadro con potenza/precisione/PP/effetto, e
  `effettiInParole(mv)` traduce i mattoncini in italiano. Sono usati nella scheda starter.
- Il meccanismo della ⓘ che apre e chiude è `apriInfo(tipo, id)` + `aperto(tipo, id)`, ma è
  legato a `starterCfg`: qui serve uno stato locale suo (es. `learnInfo`), non `starterCfg`.
- Per le statistiche: `statBar` in `renderStarterDetail` disegna già le sei barre.
  Basta una riga sopra i pulsanti, con Att e Att.Sp in evidenza.

⚠️ La schermata sta nella fascia comandi e **non ci sta**: portala a schermo intero con
`showMetaScreen`, come Squadra, Ball e scheda mosse. E metti `flex: 0 0 auto` sulle carte, o
`overflow: hidden` taglia il pulsante in fondo (è già successo tre volte).

---

### RESTA 2 — Le 9 mosse che usano ancora una potenza di ripiego

**Stato**: delle 75 mosse con `power: -1`, 36 sono mosse Z (mai in gioco) e 30 hanno la loro
formula vera in `DANNO_FISSO` / `POTENZA_VARIABILE`. Ne restano **9** che usano
`POTENZA_RIPIEGO = 60`, perché servirebbe uno stato che il motore non tiene:

| mossa | cosa servirebbe |
|---|---|
| Contrattacco, Specchiovelo, Metalscoppio, Ritorsione | il danno SUBITO in questo turno, e da chi |
| Pazienza | danno accumulato su due turni |
| Picchiaduro | numero e Attacco base dei membri della squadra |
| Sfoghenergia | quante volte si è usato Accumulo |
| Dononaturale, Lancio | l'OGGETTO TENUTO (bacca o strumento) |

**Come**: aggiungere al combattente `p.dannoSubitoTurno = { fisico, speciale, da }`, azzerato
a inizio turno in `risolviTurno` e riempito in `doDamage`. Le prime quattro diventano allora
banali (Contrattacco = 2× il danno fisico subito, Specchiovelo = 2× lo speciale,
Metalscoppio/Ritorsione = 1,5× qualunque). Le altre cinque valgono molto meno la pena.

---

### RESTA 3 — Stato e stadi che PERSISTONO fra le ondate

🔴 **Scelta esplicita del proprietario, DIVERSA dall'originale.** Chiesta il 2026-08-14:

> «i problemi di stato, i boost e i debuff devono rimanere tra un'ondata e l'altra, con
> l'eccezione delle lotte contro gli allenatori: in quel caso i Pokémon vengono prima rimessi
> nelle pokeball e poi riestratti, guariti dai problemi di stato (ma non negli HP) e con le
> stats iniziali.»

Quindi:
- **ondata normale → ondata normale**: `status` e `stages` **restano**; si azzerano solo i
  volatili (confusione, protezione, presa, tentennamento), che sono della singola battaglia.
- **prima di una lotta con ALLENATORE**: richiamo e riemissione → `status = null`, `stages` a
  zero, **HP invariati**.

**Dove**: `resetForBattle(p)` oggi azzera tutto, ed è chiamata sia a inizio ondata sia ai
cambi. Servono **due** comportamenti distinti: "entra in campo" (solo volatili) e "richiamato
nella ball" (stato + stadi). Le chiamate sono in `nextWave`, `doSwitch`, `forceSwitchTo`,
`playerSwitch`, `__items.doppia` e nella trasformazione del boss finale.

⚠️ Il richiamo+riemissione va messo in `startTrainerBattle`, PRIMA dei messaggi di sfida.
⚠️ `monSalva` copia tutto: `status` e `stages` finiscono già nello slot, e con la persistenza
diventano parte dello stato salvato. È giusto così.
⚠️ **Equilibrio**: veleno e scottatura fanno danno a fine turno, quindi un Pokémon avvelenato
ora attraversa le ondate perdendo PS. È voluto, ma le cure diventano molto più importanti:
guarda come si comporta una run vera prima di dire che è a posto.

---

### RESTA 4 — Animazione di ritiro e uscita dalla ball

**Chiesto** nello stesso messaggio della 3, e va fatto **insieme**: il richiamo prima di un
allenatore è proprio il momento in cui si vede.

**Serve**: il Pokémon che rientra (si rimpicciolisce verso la ball) e che esce (la ball si apre
con un lampo e lui compare).

**Dove**: `doSwitch`, `forceSwitchTo`, `deployEnemy`, il primo schieramento in
`beginRunWithTeam`, e il richiamo/riemissione della RESTA 3.

**Come, senza partire da zero**: `animaBall(ballKey, esito, onDone)` fa già volare la ball,
**risucchiare** lo sprite (`transform: scale(.05)` + `opacity: 0`), farla cadere e dondolare.
Per ritiro/uscita serve una versione ridotta: niente volo, niente dondolii, solo il risucchio
e il lampo. In CSS il lampo è `.ball-lancio.aperta`.
⚠️ `pulisciBallScena()` esiste già e rimette a posto `transform`/`opacity` dello sprite:
**chiamala sempre in uscita**, o un Pokémon resta invisibile.

---

### RESTA 5 — Scelta della NATURA nella scheda starter

**Chiesto**: nella scheda del singolo Pokémon si sceglie abilità e mosse; deve potersi
scegliere anche la **natura, fra quelle sbloccate per quella specie**.

**Nell'originale**: il dex tiene `dexEntry.natureAttr`, una maschera di bit
(`natureAttr |= 1 << (nature + 1)` in `setPokemonCaught`), e lo starter select offre solo le
nature registrate. Si sbloccano catturando o schiudendo esemplari con quella natura.

**Da noi**: le 25 nature ci sono già (`NATURES`, nomi italiani ufficiali, +10%/−10% su una
stat, mai i PS) e `makeFighter` ne estrae una a caso, ma **non si registrano** da nessuna
parte. Serve:
1. `meta.nature[specie]` come maschera, scritta in `registerCaught` e nella schiusa —
   esattamente come è stato fatto per `meta.abils` con le abilità (usa quello come modello,
   comprese le due funzioni `registraAbilita` / `abilitaSbloccate`).
2. Nella scheda: chip come quelli delle abilità, con l'effetto scritto (`+Att, −Vel`) e il 🔒
   su quelle non sbloccate. Modello: `abilitaSbloccate(k)` e i chip `.ab-chip`.
3. `beginRunWithTeam` deve applicare la natura scelta: oggi passa solo `ability` e `moves`.

⚠️ **Equilibrio**: con la natura a piacere lo starter diventa più forte. Nell'originale è così,
ed è proprio per questo che le nature vanno **sbloccate** una per una.

---

### Trappole che mi hanno morso in questa sessione (tutte già note, tutte ricadute)

1. ⚠️ **`z-index` dichiarato due volte nella stessa regola CSS.** `.hp-panel` aveva 9 in cima e
   5 in fondo: vinceva l'ultimo, e la pioggia copriva i riquadri PS. Trovata **solo guardando
   uno screenshot**. Controllo pronto da incollare:
   `node -e "const c=require('fs').readFileSync('pokerogue.css','utf8');for(const r of c.split('}'))if((r.match(/z-index\s*:/g)||[]).length>1)console.log('DOPPIO:',r.split('{')[0].trim())"`
2. ⚠️ **Le carte-pulsante prendono il NERO di default del browser**: un `<button>` senza
   `color` esplicito è illeggibile su fondo scuro (successo nella scelta del destinatario di un
   oggetto). E in una colonna flex le carte si **schiacciano**: senza `flex: 0 0 auto`
   l'`overflow: hidden` taglia il pulsante in fondo.
3. ⚠️ **Gli autopiloti mentono, ancora.** Un ciclo "clicca il msgbox" ha stampato sette volte
   lo stesso messaggio: era il msgbox **stale sotto l'overlay**. E due test si sono impantanati
   perché la mossa scelta era Azione contro uno Spettro, o Palla Ombra contro un immune.
   **Quando un test non fa danno, guarda QUALE MOSSA sta usando.**
4. ⚠️ **Verifica la causa prima di correggerla.** Il "Guzzlord da uovo comune" non veniva dalle
   uova (nel dato è EPIC e il pool comune è pulito) ma dagli **incontri misteriosi**, che
   pescavano fra tutte le 1084 specie. E le "tre doppie di fila" non erano un difetto: la
   probabilità è 1/8, identica all'originale. Due segnalazioni su tre avevano una causa diversa
   da quella che sembrava.

### Una cosa NON verificata dal vivo

Il **ritratto dell'allenatore durante il dialogo di sconfitta** (rev 46): il codice c'è e la
logica è la stessa del ritratto d'ingresso, che funziona — ma due tentativi di raggiungere una
lotta con allenatore con l'autopilota si sono impantanati e non l'ho visto a schermo.
**Guardalo alla prima occasione.**

---

## 30. Stato persistente, ritiro/uscita dalla ball, evoluzione a pieno schermo (2026-08-14)

Chiuse le RESTA 1 e 2 del §29 (che nel riquadro in cima erano le voci 1 e 2), più una
richiesta arrivata a voce mentre lavoravo: **l'evoluzione a pieno schermo**.

### 30.1 Stato e stadi che PERSISTONO fra le ondate

🔴 **Scelta del proprietario, diversa dall'originale.** Il modello scelto è **fisico** e si
regge da solo: *stato e stadi appartengono al Pokémon finché sta in campo*. Chi non viene
mai richiamato se li porta dietro da un'ondata all'altra; chi rientra nella ball perde gli
stadi. Prima una sola funzione, `resetForBattle`, azzerava tutto a ogni ondata **e a ogni
cambio**. Ora sono tre:

| funzione | quando | cosa fa |
|---|---|---|
| `entraInCampo(f)` | inizio ondata, cambi, rimpiazzi | **solo i volatili** (confusione, protezione, prese, tentennamento) + `fainted` + Poteslot |
| `richiamaNellaBall(f, curaStato)` | quando un Pokémon rientra | azzera gli **stadi** e la forma mega. Cura lo **stato** solo con `curaStato` |
| `fineBattaglia()` | inizio ondata | meteo, terreno e forme mega — cose della singola lotta |

- **ondata normale → ondata normale**: `status` e `stages` **restano**.
- **prima di una lotta con ALLENATORE** (`startTrainerBattle`): tutta la squadra viene
  richiamata con `curaStato` → stato curato, stadi a zero, **PS invariati**. È l'unico punto
  in cui l'attrito accumulato si ferma.
- ⚠️ **Interpretazione**: «i Pokémon vengono rimessi nelle pokeball» l'ho letta come **tutta
  la squadra**, non solo l'attivo (l'animazione però si vede solo su chi è in campo). Se
  voleva dire solo l'attivo, è una riga: il `for` in `startTrainerBattle`.
- ✅ **Un bug rientrato di striscio**: `resetForBattle` azzerava `game.weather`/`game.terrain`
  **a ogni cambio**, quindi cambiare Pokémon spazzava via il meteo a metà lotta. Ora quella
  roba sta in `fineBattaglia()`, chiamata solo a inizio ondata.

**Verificato**: veleno + 4 stadi sopravvivono alle ondate 2→3→4 mentre la confusione (volatile)
si azzera; la run ripresa da un salvataggio ha ancora il veleno (`monSalva` copia tutto, ed è
giusto); davanti all'allenatore, `atk3 def2 spatk2 spd-2` + POISON + un compagno addormentato
→ **stadi «nessuno», stato `null`, PS 8/22 invariati**.

⚠️ **Equilibrio da guardare in una run vera**: veleno e scottatura ora fanno danno ondata dopo
ondata. È voluto, ma le cure contano molto di più di prima.

### 30.2 Chi c'è in campo *in quel momento* (serviva alle animazioni)

`renderScene` disegnava sempre `game.player`, che al cambio è **già il Pokémon nuovo**: si
leggeva «Ritirati, Ivysaur!» mentre a schermo c'era l'altro. Ora `snapEvent` fotografa anche
**quali combattenti** erano in campo (`pmon`/`emon`/`p2mon`/`e2mon`, aggiunti a `CAMPI_SNAP`)
e `renderScene(frame)` disegna quelli. Correggeva già da solo un disallineamento vecchio: il
riquadro PS del Pokémon uscente sotto lo sprite di quello entrante.

### 30.3 Animazione di ritiro e uscita dalla ball

`animaBallSlot(verso, lato, onDone)` — versione ridotta di `animaBall`: niente volo e niente
dondolii (quelli raccontano un *tiro*), solo il lampo della ball e il Pokémon che si
rimpicciolisce o si materializza. `verso` = `"ritiro"` | `"uscita"`, `lato` = `player` |
`enemy` | `player2` | `enemy2`.

- Si aggancia alla **frase**, non al momento in cui il motore cambia Pokémon: `conBall(testo,
  verso, lato)` marca il messaggio e `nextEvent` fa partire l'animazione. Funziona sia sui
  log di battaglia sia sugli **array di messaggi semplici**, perché passano entrambi da
  `snapEvent` (che ora accetta anche oggetti `{text, ball}`).
- ⚠️ **`dentroLaBall`**: chi è rientrato deve restare invisibile anche quando la scena si
  ridisegna — fra richiamo e riemissione, davanti a un allenatore, passano tutte le frasi
  della sfida e ognuna chiama `renderScene`. Per questo la sparizione è uno **stato**
  riapplicato da `applicaDentroLaBall()` in fondo a `renderScene`, non una `opacity` inline
  che il primo ridisegno cancellerebbe. `liberaDallaBall()` in `nextWave` è la rete di
  sicurezza: un'animazione interrotta a metà lascerebbe un Pokémon invisibile per sempre.
- `chiudiBallSlot()` (chiamata in cima a `nextEvent`, come `stopMoveAnim`) conclude di colpo
  l'animazione in corso se si tocca per andare avanti.
- Agganci: cambio in singolo e in doppio, cambio forzato, allenatore che manda il prossimo,
  furto con la Theft Ball, richiamo/riemissione dell'allenatore, e la **prima uscita
  dell'ondata 1**. ⚠️ Dalla seconda ondata in poi il tuo Pokémon **non** riesce da una ball:
  è proprio il non essere richiamato che gli fa portare dietro stato e stadi.
- ⚠️ Niente `requestAnimationFrame` (nel pannello a volte non scatta, §24): un timer da 20 ms
  fa partire la transizione, e `concludi()` mette comunque lo stato finale.

### 30.4 Evoluzione a PIENO SCHERMO con lo sprite frontale

Richiesta del proprietario. Prima l'overlay stava dentro `#scene` (il 68% in alto) e usava lo
sprite **di spalle**: il Pokémon si evolveva dandoti le spalle, dentro un riquadro.

- `#evo-overlay` ora è `position: fixed; inset: 0; z-index: 40` (sopra anche gli overlay meta,
  che stanno a 20 — un'evoluzione può scattare subito dopo una schermata di premi) e viene
  appeso a `#game`, non a `#scene`.
- Sprite **frontali** di entrambe le forme via `loadFighterSprite`, non `loadSprite`: così
  valgono cromatico, sprite femminile e **forma**. Per il "dopo" si passa da un combattente
  finto con la forma che l'evoluzione produrrà (stessa regola di `evolve`).
- La misura la detta la finestra (`min(66vw, 42vh)`), non più un tetto fisso di 150 px: a
  pieno schermo il Pokémon sarebbe rimasto minuscolo in mezzo al nero.
- Il tasto «✖ Interrompi» è passato **dentro** l'overlay (la fascia comandi ora ci sta sotto),
  con `flex: 0 0 auto` o in colonna si schiaccia.
- ⚠️ **Il fondo va OPACO.** Col fondo velato i riquadri PS e l'indicatore d'ondata (z-index 9,
  dentro `#scene`) restavano leggibili sotto e **si sovrapponevano alla scritta**. Visto solo
  guardando lo screenshot: è la terza volta che la regola «guarda anche la grafica» paga.

### 30.5 Due sonde nuove in `window.__items`

Gli autopiloti si sono impantanati **quattro volte** in questa sessione (schermata premi,
offerta di cattura, e una volta su un msgbox stale sotto l'overlay). Invece di insistere:

| Comando | Cosa fa |
|---|---|
| `__items.allenatore(quanti)` | avvia subito una lotta con un allenatore e **restituisce stato/stadi/PS prima e dopo il richiamo** |
| `__items.evoluzione(specie, quale)` | mostra subito l'animazione di evoluzione (default: il primo della squadra, prima evoluzione possibile) |

Arrivarci giocando voleva dire quattro ondate a click per l'allenatore, e per l'evoluzione
azzeccare **due** condizioni insieme (Pokémon sotto la soglia **e** tetto di livello
dell'ondata abbastanza alto — a ondata 4 un Lv.15 non prende esperienza affatto).

⚠️ **Per guardare un'animazione**, rallenta i timer invece di rincorrerla con gli screenshot:

```js
window.__st = window.setTimeout;
window.setTimeout = (fn, ms) => window.__st(fn, ms > 15 ? ms * 20 : ms);
// ... fai partire l'animazione, fotografa ...
window.setTimeout = window.__st;
```

⚠️ **La trappola della cache ha morso di nuovo**: il boot carica `pokerogue.css?v=<rev>` e
`rev` cambia solo rigenerando il manifesto. Ho modificato il CSS, ricaricato, e il browser mi
ha servito il vecchio: `#evo-overlay` risultava ancora `absolute; z-index 8` e sembrava che la
regola nuova non si applicasse. **Fra una modifica e una prova, lancia
`node tools/make-manifest.mjs`** (solo il passo 1 di `pubblica.mjs`, non pubblica niente).

---

## 31. Le ultime tre del §29 (2026-08-14) — la lista è finita

### 31.1 Le 9 mosse che usavano una potenza di ripiego

Al motore mancavano tre memorie. Aggiunte tutte e tre, e le nove mosse sono diventate vere.

**`p.dannoSubitoTurno = { fisico, speciale, da }`** — azzerato in `azzeraDannoSubito()`, che
gira all'inizio di ogni turno (`risolviTurno` **e** il ramo singolo di `playerSwitch`, che il
turno lo consuma lo stesso), e riempito da `segnaDannoSubito()` in `doDamage` e nel ramo a
danno fisso di `dannoSenzaPotenza`.

| mossa | ora fa | verificato |
|---|---|---|
| Contrattacco | 2× il danno **fisico** subito nel turno | 80 con 40 incassati |
| Specchiovelo | 2× il danno **speciale** | 60 con 30 incassati |
| Metalscoppio · Ritorsione | 1,5× **qualsiasi** danno | 105 con 70 incassati |

Sono `DANNO_FISSO`, non potenza: nei giochi restituiscono esattamente quel numero. Se non hai
incassato niente **falliscono**, come devono.

**`volatile.bide`** — Pazienza è una mossa a due turni vera: `{ turni: 2, danno: 0 }`, e
`segnaDannoSubito` fa massa dentro. Al terzo turno restituisce il doppio.
⚠️ Non passa da `move.charging` (quello sceglie un bersaglio e poi colpisce): qui il Pokémon
incassa e basta, e il contatore va avanti anche nei turni in cui non lo tocca nessuno.
Verificato in gioco: 16 → 31 accumulati → «sfoga tutto in una volta! perde 62 PS».

**`volatile.accumulo`** — Accumulo/Sfoghenergia/Introenergia vanno tenute insieme: senza la
prima la seconda non può funzionare. Accumulo sale fino a 3 e dà +1 Dif e +1 Dif.Sp per
carica; scaricando si restituiscono gli stadi. Sfoghenergia = 100 × cariche, Introenergia cura
1/4, 1/2 o tutto.

**Le altre tre**:
- **Picchiaduro**: `rollMultiHit` ora gestisce `mode: "BEAT_UP"` → un colpo per ogni membro
  sano della squadra. ⚠️ Il dato lo marcava **già** come multi-colpo e quel modo non era
  gestito: finiva nella distribuzione casuale 2-5. La potenza è la **media** di
  `Attacco base / 10 + 5` dei membri — sommarla avrebbe contato la squadra due volte.
- **Dononaturale**: la bacca tenuta ne detta **tipo e potenza** (tabella `BACCA_DONO` per le
  nostre 11 bacche, valori dei giochi), e si consuma. Senza bacca fallisce.
  ⚠️ Il tipo si cambia passando una **copia** della mossa a `doDamage`: `M[...]` è condiviso
  da tutti e non si tocca (§8).
- **Lancio**: potenza dall'oggetto tenuto (`FLING_POT`, 10-90), che si consuma e fa
  ricalcolare le statistiche. Senza oggetto fallisce.

`POTENZA_RIPIEGO` resta in codice ma **nessuna mossa in gioco ci finisce più**: è la rete di
sicurezza se un domani ne arriva una senza formula.

**Sonda**: `__items.mosse9()` prepara le condizioni di ciascuna, le esegue sul motore vero
contro un bersaglio di paglia da 100.000 PS e stampa il danno **davvero inflitto**.
⚠️ Il bersaglio robusto serve: col Patrat vero da 18 PS ogni mossa restituiva «18» e i numeri
non dicevano niente.

### 31.2 «Quale mossa dimentica», consultabile

Prima erano quattro nomi nella fascia comandi: per decidere bisognava ricordarsi a memoria
cosa facesse ognuna, e soprattutto se la mossa nuova fosse fisica o speciale.

- Portata a schermo intero con `showMetaScreen` (nella fascia non ci stava — è la quarta volta:
  Squadra, Ball, scheda Mosse, e ora questa).
- Una **ⓘ** per la mossa nuova e una per ciascuna delle quattro: aprono `snippetMossa`, lo
  stesso riquadro della scheda starter (potenza, precisione, PP, effetto in italiano).
- Sopra, le **statistiche vere dell'esemplare** (livello, IV, natura, vitamine — non quelle
  base della specie), con **Att o A.Sp evidenziata in oro** secondo la categoria della mossa
  nuova. È il confronto che serve davvero.
- Mini sprite frontale, per sapere di chi si sta parlando.
- ⚠️ Lo stato del riquadro aperto è **suo** (`learnInfo`), non `starterCfg`: quello appartiene
  alla scheda starter, che è un'altra schermata.
- Rinunciare ora dice «X rinuncia a imparare Y» invece di uscire in silenzio.

**Sonda**: `__items.impara("SOLAR_BEAM")` riempie le mosse fino a quattro e apre la schermata.

### 31.3 Scelta della NATURA nella scheda starter

Modello identico alle abilità (`meta.abils`), perché è lo stesso meccanismo dell'originale
(`dexEntry.natureAttr`, maschera di bit):

- `meta.nature[specie]` è una maschera su `NATURE_KEYS`. La scrivono `registraNatura()`
  chiamata da **`registerCaught`** (che ora prende la natura come 7° parametro) e dalla
  **schiusa**. Come per le abilità si registra sul **capostipite**, che è quello che si
  schiera. Messaggio: «🌱 Nuova natura sbloccata per X: Decisa».
- `natureSbloccate(k)` torna quelle scegliibili. **Le 5 neutre sono sempre disponibili**: non
  danno alcun vantaggio, e senza almeno una la scheda di una specie mai catturata resterebbe
  vuota.
- `beginRunWithTeam` passa la natura a `makeFighter` — non basta assegnarla dopo, serve nel
  calcolo delle statistiche.
- ⚠️ **Le nature sono VENTICINQUE.** Metterle tutte in elenco come le tre abilità riempiva
  mezza schermata e spingeva le mosse fuori campo (visto a schermo, non dedotto). Ora si
  vedono solo quelle che hai più un chip **«🔒 +20 da scoprire»** che apre l'elenco completo
  col lucchetto e l'effetto scritto (`+Att −A.Sp`).

**Verificato**: la scheda sta tutta in una schermata; scegliendo Seria lo starter parte
davvero Seria; catturare un Patrat Timida scrive `PATRAT: 1024` (= `1 << 10`, l'indice di
TIMID) nel dex.

⚠️ **Equilibrio**: con la natura a piacere lo starter è più forte. È proprio per questo che
vanno conquistate una alla volta — non regalarle tutte.

### Nota di metodo

Anche stavolta le sonde hanno fatto tutto il lavoro (`mosse9`, `impara`, più `allenatore` ed
`evoluzione` del §30). Le uniche cose trovate a occhio sono state le due di layout: i 25 chip
che sfondavano la scheda starter e il fondo velato dell'evoluzione. **Le sonde dicono se
funziona, lo screenshot dice se si può usare.**

---

## 32. Suspense della ball e indicatore «ce l'hai già» (2026-08-14)

Due segnalazioni del proprietario mentre giocava. Entrambe partite da una diagnosi che ha
smentito il sospetto iniziale — vale la pena leggere *come*, non solo *cosa*.

### 32.1 I dondolii della ball: la variazione c'era, ma non si sentiva

**Segnalazione**: «l'animazione della pokeball è sempre la stessa quando un Pokémon fugge,
dovrebbe avere un diverso numero di oscillazioni per la suspense».

**Prima cosa fatta: misurare.** `__items.scosse(mult, prove)` tira la cattura N volte e
stampa la distribuzione. Su un selvatico a piena vita (44% di cattura): **0 scosse 34% · 1
scossa 26% · 2 scosse 22% · 3 scosse 18%**. Il tiro variava eccome — il difetto era a valle.

**Le due cause vere, trovate confrontando con `attempt-capture-phase.ts` dell'originale:**
1. Con **zero** scosse la ball si apriva *all'istante*: nessun momento di sospensione, e
   siccome è il caso più frequente (34%) è quello che si vede sempre. L'originale ha un
   `repeatDelay: 500` **prima** del primo controllo, quindi anche il fallimento immediato ha
   il suo battito d'attesa.
2. Tutte le oscillazioni erano **identiche** (460 ms, ±22°), quindi due o tre si somigliavano.

**Fatto**: beat d'attesa prima del primo controllo; oscillazioni che **crescono** in ampiezza
e durata (15°/380 ms → 21°/470 ms → 27°/580 ms, da `--dondolo-amp` e `--dondolo-dur` passate
dal JS al CSS); e un **silenzio finale proporzionale** alle scosse (`240 + 150 × n` ms) — una
ball che si è fermata dopo la terza tiene col fiato sospeso, una che non ha dondolato va
liquidata in fretta.

Durata totale misurata a schermo: **0 scosse 1,8 s · 1 scossa 2,5 s · 3 scosse 4,2 s.**

⚠️ **Trovato per strada, NON corretto — decisione del proprietario.** L'originale fa **3**
controlli di scossa (`onRepeat` con `shakeCount++ < 3`), noi ne facciamo **4**: la nostra
probabilità di cattura è `p⁴` invece di `p³`, cioè **più bassa dell'originale**. Correggerlo
alzerebbe tutte le percentuali di cattura del gioco — è un cambio di bilanciamento, non una
svista da sistemare di nascosto. Le percentuali mostrate sono coerenti col nostro tiro, quindi
niente è "rotto".

### 32.2 Pokéball accanto al nome: «questo ce l'hai già»

**Segnalazione**: i Pokémon incontrati (selvatici **e degli allenatori**) devono dire se sono
già disponibili come starter; l'originale usa una pokéball accanto al nome.

Confermato in `src/ui/battle-info/enemy-battle-info.ts`: c'è `ownedIcon` (`icon_owned`),
visibile se `dexEntry.caughtAttr`, e **tinta di grigio** (`0x808080`) se mancano ancora forme,
generi o l'abilità di quell'esemplare. Copiata l'icona vera (7×7 px, 143 byte) in
`assets/ui/icon_owned.png`.

Stessa regola, con quello che il nostro dex tiene (`meta.unlocked`, `abils`, `nature`,
`formsSeen`) — la funzione è `statoDex(f)`:

| a schermo | significa |
|---|---|
| nessuna icona | **non ce l'hai**: catturarlo lo sblocca come starter |
| ball **grigia** | ce l'hai, ma QUESTO ha ancora qualcosa (abilità, natura, forma, cromatico) |
| ball **piena** | ce l'hai già tutto: è solo un avversario |

Vale anche per i Pokémon degli allenatori (verificato sul Larvesta del Mangiafuoco): con la
Theft Ball si rubano, quindi l'informazione serve lo stesso.

### 32.3 «Ora puoi usarlo come starter» detto a sproposito

Il colpevole era la **schiusa**: `const extra = ["${S[sp].it} è sbloccato come starter!"]` era
**incondizionato**, quindi ogni uovo lo annunciava anche per una specie posseduta da un pezzo.
Ora la frase esce solo se la nascita sblocca davvero qualcosa (specie nuova, o primo
cromatico); altrimenti dice solo le caramelle.

Stesso trattamento alla cattura: il ramo «📖 registrato nel dex!» scattava su qualunque
duplicato, perché la condizione guardava `meta.unlocked[specie]` **dopo** averlo già
aggiornato. Ora `specieNuova` si calcola PRIMA della scrittura.
Verificato rubando un Larvesta già posseduto: dice solo «🕶 Rubato! … 🍬 +1 Caramella …
📈 Nuovi IV migliori», niente starter, niente dex.

### 32.4 Sonde nuove e una trappola in cui sono ricascato

| Comando | Cosa fa |
|---|---|
| `__items.scosse(mult, prove)` | distribuzione delle scosse della ball sul nemico in campo |
| `__items.dex(f)` | perché la pokéball accanto al nome è assente / grigia / piena, con cosa manca |
| `__meta()` | il dex persistente. **È una funzione**: `meta` viene riassegnata da `loadMeta()` e da «Azzera tutto», un riferimento fisso punterebbe all'oggetto sbagliato |

⚠️ **Ho perso un giro leggendo un pannello che non era stato ridisegnato.** Cambiavo `meta` e
rileggevo `#enemy-hp-panel`, concludendo che la logica fosse sbagliata: era giusta, ma il
pannello si ridisegna solo quando gira un turno — aprire e chiudere «Squadra» non basta. È la
stessa trappola del §8 (*«le mie asserzioni sul DOM leggono elementi che il ridisegno ha
staccato»*). **Prima di dare la colpa al codice, verifica che il DOM sia stato riscritto
davvero** — un marcatore `dataset` sull'elemento lo dice in due righe.
