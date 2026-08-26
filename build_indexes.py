#!/usr/bin/env python3
import json, os, re
BASE=os.path.dirname(os.path.abspath(__file__))
DATA=os.path.join(BASE,"data")

# Seed English->Persian entries used immediately even before a larger Persian corpus is added.
seed={
"dark":{"translation":"تاریک؛ تیره","definition":"Having very little or no light; not bright.","example":"It was dark outside.","pos":"adjective","phonetic":"dɑːrk","synonyms":["dim","gloomy","black"]},
"hollow":{"translation":"توخالی؛ گود؛ پوچ","definition":"Having a hole or empty space inside; not solid.","example":"The tree was hollow inside.","pos":"adjective","phonetic":"ˈhɑːloʊ","synonyms":["empty","cavity"]},
"reluctant":{"translation":"بی‌میل؛ مردد؛ با اکراه","definition":"Unwilling or hesitant to do something.","example":"He was reluctant to speak.","pos":"adjective","phonetic":"rɪˈlʌktənt","synonyms":["hesitant","unwilling"]},
"with":{"translation":"با؛ همراهِ؛ به‌وسیلهٔ","definition":"Accompanied by; using; having or carrying.","example":"She went with Leo.","pos":"preposition","phonetic":"wɪð","synonyms":["alongside"]}
}
# Preserve an existing Persian index if the user already built one.
persian_path=os.path.join(DATA,"persian-index.json")
if os.path.exists(persian_path):
    try:
        old=json.load(open(persian_path,encoding="utf-8"))
        if isinstance(old,dict): seed.update(old)
    except Exception: pass
json.dump(seed,open(persian_path,"w",encoding="utf-8"),ensure_ascii=False,indent=2)

# OEWN extraction. wn is intentionally used inside .venv.
# Merges into offline-dictionary.json (the file the plugin actually reads),
# without overwriting the words already provided by the bundled Wordset-based dictionary.
offline_path=os.path.join(DATA,"offline-dictionary.json")
existing={}
if os.path.exists(offline_path):
    try:
        existing=json.load(open(offline_path,encoding="utf-8"))
    except Exception:
        existing={}

try:
    import wn
    lex=wn.Wordnet("oewn:2025-plus")
    added=0
    for lemma in lex.les():
        key=lemma.replace("_"," ").lower()
        if key in existing:
            continue
        senses=lex.senses(key)
        if not senses: continue
        syns=[];defs=[];examples=[];pos=""
        for s in senses[:6]:
            e=s.entry()
            syns.extend([l.replace("_"," ") for l in e.lemmas()])
            if getattr(s,"definition",None):
                defs.append(s.definition())
            if getattr(s,"examples",None):
                examples.extend(s.examples())
            pos=getattr(e,"pos","") or pos
        if not defs: continue
        existing[key]={
          "translation": "",
          "definition": defs[0] if defs else "",
          "example": examples[0] if examples else "",
          "pos": pos,
          "phonetic": "",
          "synonyms": list(dict.fromkeys(x for x in syns if x.lower()!=key))[:12]
        }
        added+=1
    json.dump(existing,open(offline_path,"w",encoding="utf-8"),ensure_ascii=False,separators=(",",":"))
    print(f"Added {added} new word(s) from OEWN. Total offline entries: {len(existing)}")
except Exception as exc:
    print("OEWN build warning (offline-dictionary.json left unchanged):",exc)

