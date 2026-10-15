"""Apply option-text patches: lines 'N | OLD => NEW' (N = 1-based question number in the unit file)."""
import re,sys
unit=int(sys.argv[1]); path=f"src/units/u{unit:02d}.txt"; t=open(path).read()
head,qs=t.split("=== QUESTIONS",1)
blocks=re.split(r"\n(?=@[emh]\s*\n)",qs)
pre,qb=blocks[0],blocks[1:]
# blocks[0] may itself be the first question if no leading text
if pre.strip().startswith("@"): qb=[pre]+qb; pre=""
n=0
for line in open(sys.argv[2]):
    line=line.rstrip("\n")
    if not line.strip() or line.startswith("#"): continue
    num,rest=line.split(" | ",1); old,new=rest.split(" => ",1); i=int(num)-1
    lines=qb[i].split("\n"); hit=0
    for k,l in enumerate(lines):
        if l[:2] in ("+ ","- ") and l[2:].split(" :: ")[0]==old:
            lines[k]=l[:2]+new+" :: "+l[2:].split(" :: ",1)[1]; hit+=1
    if hit!=1: sys.exit(f"patch failed q{num}: {old!r} hits={hit}")
    qb[i]="\n".join(lines); n+=1
open(path,"w").write(head+"=== QUESTIONS"+(pre if pre else "\n")+"\n".join(qb))
print(f"u{unit}: applied {n} patches")
