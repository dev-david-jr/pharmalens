import openpyxl, json, sys
# Uso: python3 scripts/gerar_json.py Lista_PMC.xlsx public/data/lista_pmc.json public/data/pmc.json  (requer: pip install openpyxl)
src, full_out, app_out = sys.argv[1:4]
wb=openpyxl.load_workbook(src,read_only=True)
ws=wb['Lista PMC']
rows=ws.iter_rows(values_only=True)
h=[str(x).strip() if x else '' for x in next(rows)]
cols=['SUBSTÂNCIA','PRODUTO','CLASSE TERAPÊUTICA','TIPO DE PRODUTO (STATUS DO PRODUTO)','TARJA']
idx=[h.index(c) for c in cols]
eidx=[h.index(c) for c in ('EAN 1','EAN 2','EAN 3')]
eans={}
def clean(v):
    v='' if v is None else ' '.join(str(v).split())
    return '' if v=='-' else v
full=[]; seen={}
for r in rows:
    vals=[clean(r[i]) for i in idx]
    if not any(vals): continue
    full.append(dict(zip(cols,vals)))
    seen[tuple(vals)]=1
    for e in eidx:
        v=''.join(ch for ch in str(r[e] or '') if ch.isdigit())
        if len(v)>=8: eans[v]=tuple(vals)
json.dump(full,open(full_out,'w',encoding='utf-8'),ensure_ascii=False,indent=1)
# compact: dictionary-encode
uniq=list(seen)
upos={u:i for i,u in enumerate(uniq)}
dicts=[sorted({u[k] for u in uniq}) for k in range(5)]
pos=[{v:i for i,v in enumerate(d)} for d in dicts]
json.dump({'cols':cols,'dict':dicts,'rows':[[pos[k][u[k]] for k in range(5)] for u in uniq],'ean':{e:upos[u] for e,u in eans.items()}},open(app_out,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print(len(full),'linhas,',len(uniq),'combinações,',len(eans),'EANs')
