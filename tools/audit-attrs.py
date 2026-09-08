# -*- coding: utf-8 -*-
"""Quali mosse hanno attrs vuoti da noi ma un effetto vero nell'originale.

   Non basta "attrs vuoti": Azione ha attrs vuoti ed e' giusto cosi', il danno
   e' il comportamento di serie. Il segnale e': l'originale le attacca almeno un
   `.attr(...)` che conta, e noi non l'abbiamo tradotto NE' a mano nel motore.
"""
import io, json, os, re

APP = r"C:\Users\lfili\OneDrive\Documenti\app\pokerogue-mobile"
ORIG = r"C:\Users\lfili\OneDrive\Documenti\app\PokeRogue"

# ---------------------------------------------------------------- i nostri --
mj = json.load(io.open(os.path.join(APP, "data", "moves.json"), encoding="utf-8"))
nostre = mj["moves"] if isinstance(mj, dict) and "moves" in mj else mj
vuote = set(k for k, v in nostre.items() if not v.get("attrs"))

js = io.open(os.path.join(APP, "pokerogue.js"), encoding="utf-8").read()

# ------------------------------------------------------------ l'originale ---
src = io.open(os.path.join(ORIG, "src", "data", "moves", "move.ts"), encoding="utf-8").read()
# ogni voce comincia con `new XxxMove(MoveId.NOME,` e finisce al `new ...Move(` dopo
voci = list(re.finditer(r"new\s+(\w*Move)\s*\(\s*MoveId\.(\w+)\s*,", src))
orig = {}
for i, m in enumerate(voci):
    fine = voci[i + 1].start() if i + 1 < len(voci) else len(src)
    blocco = src[m.start():fine]
    attrs = re.findall(r"\.attr\(\s*([A-Za-z_][\w]*)", blocco)
    orig[m.group(2)] = attrs

# attributi dell'originale che NON sono un "effetto" da tradurre: o li
# copriamo altrove, o non hanno senso da noi.
IGNORA = set("""
MultiHitAttr HighCritAttr ChargeAttr DelayedAttackAttr DisableMoveAttr
FixedDamageAttr TargetHalfHpDamageAttr LevelDamageAttr RandomLevelDamageAttr
ModifiedDamageAttr SurviveDamageAttr OneHitKOAttr OneHitKOAccuracyAttr
StatStageChangeAttr StatusEffectAttr HealAttr SacrificialAttr FlinchAttr
ConfuseAttr RecoilAttr HitHealAttr MultiHitPowerIncrementAttr
MovePowerMultiplierAttr VariablePowerAttr LessPPMorePowerAttr
CompareWeightPowerAttr HpPowerAttr OpponentHighHpPowerAttr
FirstAttackDoublePowerAttr TurnDamagedDoublePowerAttr WeatherBallTypeAttr
TerrainPulseTypeAttr HiddenPowerTypeAttr MatchUserTypeAttr
ForceSwitchOutAttr AddArenaTagAttr AddArenaTrapTagAttr ProtectAttr
SacrificialAttrOnHit RemoveScreensAttr ClearWeatherAttr ClearTerrainAttr
""".split())


PAROLE_JS = set(re.findall(r"[A-Z][A-Z0-9_]{2,}", js))


def gia_a_mano(nome):
    """Il motore la nomina da qualche parte? Vale sia fra virgolette
    (`new Set(["U_TURN"])`) sia come chiave nuda (`ROTOLA = { ROLLOUT: 5 }`)."""
    return nome in PAROLE_JS


sospette = []
for k in sorted(vuote):
    if k not in orig:
        continue
    veri = [a for a in orig[k] if a not in IGNORA]
    if not veri:
        continue
    if gia_a_mano(k):
        continue
    sospette.append((k, nostre[k].get("it", k), nostre[k].get("category"),
                     nostre[k].get("power"), sorted(set(veri))))

print("mosse con attrs vuoti da noi:", len(vuote))
print("...che nell'originale hanno un effetto e non gestiamo a mano:", len(sospette))
print()
for k, it, cat, pw, a in sospette:
    print("%-22s %-22s %-8s p%-4s %s" % (k, it, cat, pw, ",".join(a)))
