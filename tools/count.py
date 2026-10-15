import re,sys,glob
need={1:34,2:24,3:26,4:35,5:47,6:34,7:29,8:38,9:34,10:44,11:34,12:38}
cardneed={1:20,2:12,3:15,4:20,5:28,6:20,7:17,8:22,9:20,10:26,11:20,12:22}
for f in sorted(glob.glob('src/units/u*.txt')):
    u=int(f[-6:-4]);t=open(f).read();q=t.split('=== QUESTIONS')[1]
    d={k:len(re.findall(r'^@'+k+r'\s*$',q,re.M)) for k in 'emh'};n=sum(d.values())
    c=len([l for l in t.split('=== CARDS')[1].split('=== QUESTIONS')[0].splitlines() if ' :: ' in l])
    w=len(t.split('=== LESSON')[1].split('=== MUSTKNOW')[0].split())
    print(f"u{u}: q {n}/{need[u]} {d} ({d['e']/n:.0%}/{d['m']/n:.0%}/{d['h']/n:.0%})  cards {c}/{cardneed[u]}  words {w}")
