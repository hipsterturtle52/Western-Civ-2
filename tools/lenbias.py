import re,sys,glob
def qblocks(t):
    qs=t.split("=== QUESTIONS")[1]
    return [b for b in re.split(r"\n(?=@[emh]\s*\n)",qs) if b.strip().startswith("@")]
def opts(b):
    return [(l[0], l[2:].split(" :: ")[0]) for l in b.splitlines() if l.startswith(("+ ","- "))]
tot=lon=0
for f in sorted(glob.glob('src/units/u*.txt')):
    u=int(f[-6:-4]); t=open(f).read()
    show = len(sys.argv)>1 and int(sys.argv[1])==u
    ul=0;bl=qblocks(t)
    for i,b in enumerate(bl):
        o=opts(b); L=[len(x[1]) for x in o]; ci=[k for k,x in enumerate(o) if x[0]=='+'][0]
        others=[l for k,l in enumerate(L) if k!=ci]; r=L[ci]/(sum(others)/4)
        is_long = L[ci]==max(L)
        tot+=1; lon+=is_long; ul+=is_long
        if show and (is_long or r>1.2):
            stem=[l for l in b.splitlines()[1:] if not l.startswith(("+ ","- "))][-1]
            print(f"#{i+1} r={r:.2f} {stem[:90]}")
            for s,x in o: print(f"  {s} {x}")
    if not show: print(f"u{u}: longest {ul}/{len(bl)}")
print(f"TOTAL correct-longest {lon}/{tot} = {lon/tot:.0%}")
