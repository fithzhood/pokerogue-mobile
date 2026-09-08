# -*- coding: utf-8 -*-
"""Genera la versione "clear" di PokeRogue Mobile: stesso gioco, senza l'uovo.

       python costruisci-clear.py

   Segue i marcatori [via]/[fine]/[riga]/[metti] dentro pokerogue.js/.css e
   pokerogue-app.html. Motore in ..\\museum\\clear\\clear_kit.py.

   Due cose diverse dalle altre app:
     · `pokerogue-app.html` non e' una pagina ma il corpo che il guscio
       inietta; i [metti] in cima e in fondo ne fanno una pagina intera.
     · gli sprite e i dati (180 MB) NON si copiano nel repo clear: il <base>
       li fa leggere dal repo del gioco, che sta sullo stesso dominio.
"""

import io
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                '..', 'museum', 'clear'))
import clear_kit                                          # noqa: E402

def timbra_revisione():
    """Scrive la revisione dentro la pagina clear.

    La clear non passa dal guscio `pokerogue-boot.js`: carica il JS con un
    <script src> normale, quindi `window.PR` non esiste e la riga in fondo alla
    Home diceva "rev 0 - da APK". Aprendola dal Museum era l'unica cosa che si
    vedeva scritta male.

    Qui si legge `versione.json` (gia' aggiornato: make-manifest gira prima) e
    si inietta un PR minimo PRIMA dello script del gioco. Niente `file`, quindi
    il caricatore degli asset continua a leggere dal disco come faceva.

    Stessa passata mette il `?v=<rev>` su JS e CSS. Senza, la clear era l'unica
    app di casa fuori dalla regola: il guscio della versione normale versiona i
    suoi file da solo, qui i riferimenti erano nudi e la CDN di Pages serviva il
    gioco vecchio per ore. Visto succedere: la pagina arrivava aggiornata (PR
    con la revisione nuova) e il JS era ancora quello di prima.
    """
    with io.open('versione.json', encoding='utf-8') as f:
        rev = json.load(f).get('rev', 0)
    nome = 'pokerogue-clear.html'
    with io.open(nome, encoding='utf-8', newline='') as f:
        html = f.read()
    ancora = '<script src="/pokerogue-clear/pokerogue-clear.js"></script>'
    if ancora not in html:
        print('   ! non trovo lo script della clear: revisione non timbrata')
        return
    tag = '<script>window.PR={rev:%d,clear:true};</script>\n' % rev
    html = html.replace(ancora,
                        tag + '<script src="/pokerogue-clear/pokerogue-clear.js?v=%d"></script>' % rev)
    html = html.replace('href="/pokerogue-clear/pokerogue-clear.css"',
                        'href="/pokerogue-clear/pokerogue-clear.css?v=%d"' % rev)
    with io.open(nome, 'w', encoding='utf-8', newline='') as f:
        f.write(html)
    print('   revisione %d timbrata nella clear (JS e CSS versionati)' % rev)


# ⚠️ `clear_kit.avvia` finisce con `sys.exit()`: quello che sta scritto dopo di
# lei non gira mai. Per fare qualcosa a generazione avvenuta bisogna prenderne
# l'uscita al volo, e ripropagarla se e' un errore.
try:
    clear_kit.avvia({
        'nome': 'PokeRogue Mobile',
        'sorgenti': [
            ('pokerogue.js',       'pokerogue-clear.js'),
            ('pokerogue.css',      'pokerogue-clear.css'),
            ('pokerogue-app.html', 'pokerogue-clear.html'),
        ],
        'rinomina': [],
        'vietate': [
            # Tre ritagli, tutti per parole VERE che contengono "gif":
            #   (?<!strin)   -> JSON.stringify
            #   (?![tT])     -> NATURAL_GIFT, che e' una mossa
            #   (?<![fF]ug)  -> Fuggifuggi, che e' un'abilita': fug-GIF-uggi.
            #                   Scoperto pubblicando: il guardiano ha bloccato la
            #                   clear per un commento che nominava l'abilita'.
            r'(?<!strin)(?<![fF]ug)(?<!FUG)(?-i:gif|Gif|GIF)(?![tT])',
            'easter', 'gifTocco', 'gifPronte',
            'gifMostra', 'gifCarica', 'DecompressionStream',
        ],
        'copia': [],
    })
except SystemExit as uscita:
    if uscita.code:
        raise
timbra_revisione()
