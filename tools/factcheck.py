"""Flag questions whose correct answer relies on names/years not present in the unit's study material.
Study material = lesson + must-know + timeline + cards of the SAME unit (questions may also legitimately
use earlier units' material, so we check the whole guide second and report both)."""
import re, glob, sys
STOP = set("The A An In On Of And Or To For By With From As At Which What Who Why How When It Its This That These Those Both Most Many Some All Only One Two Three Four Five After Before During Under Over Into Unit Their Its He She They His Her First Second Third Last Not No Because Than Then Also Just More Less Much New Old Great Little Peace War Battle Treaty Act Law Revolution Empire Republic Kingdom Party Plan Conference Congress Europe European".split())
def material(t):
    parts=[]
    for sec in ("LESSON","MUSTKNOW","TIMELINE","CARDS"):
        m=re.search(r"=== %s\n(.*?)(?=\n=== |\Z)"%sec,t,re.S)
        if m: parts.append(m.group(1))
    return " ".join(parts)
units={}
for f in sorted(glob.glob('src/units/u*.txt')):
    u=int(f[-6:-4]); units[u]=open(f).read()
allmat=" ".join(material(t) for t in units.values())
flags=0
for u,t in units.items():
    mat=material(t)
    qs=t.split("=== QUESTIONS")[1]
    for block in re.split(r"\n@[emh]\s*\n",qs)[1:]:
        lines=[l for l in block.strip().splitlines() if l.strip()]
        stem=" ".join(l for l in lines if not l.startswith(("+ ","- ")))
        corr=[l for l in lines if l.startswith("+ ")][0][2:]
        ans=corr.split(" :: ")[0]
        toks=set(re.findall(r"\b(?:[A-Z][a-zA-Zéèáíóúüöäçñ'-]+|\d{4})\b",ans))-STOP
        miss_u=[k for k in toks if k not in mat]
        miss_all=[k for k in miss_u if k not in allmat]
        if miss_all or len(miss_u)>=2:
            flags+=1
            print(f"u{u} | {stem[:80]}\n    ANS: {ans}\n    not in unit: {miss_u}  not anywhere: {miss_all}")
print("flagged",flags)
