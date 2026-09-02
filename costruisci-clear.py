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

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                '..', 'museum', 'clear'))
import clear_kit                                          # noqa: E402

clear_kit.avvia({
    'nome': 'PokeRogue Mobile',
    'sorgenti': [
        ('pokerogue.js',       'pokerogue-clear.js'),
        ('pokerogue.css',      'pokerogue-clear.css'),
        ('pokerogue-app.html', 'pokerogue-clear.html'),
    ],
    'rinomina': [],
    'vietate': [
        # (?![tT]) perche' NATURAL_GIFT e' una mossa vera e contiene "GIF"
        r'(?<!strin)(?-i:gif|Gif|GIF)(?![tT])', 'easter', 'gifTocco', 'gifPronte',
        'gifMostra', 'gifCarica', 'DecompressionStream',
    ],
    'copia': [],
})
