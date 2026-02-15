import json
from pathlib import Path
from tf.fabric import Fabric

TF_DIR = Path("/Users/marciasuzuki/Documents/New project/bhsa/tf/2021")
OUTPUT = Path(__file__).resolve().parent.parent / "src" / "data" / "ruth_bhsa.json"

FEATURES = [
    "book", "chapter", "verse",
    "g_word", "g_word_utf8", "g_lex", "g_lex_utf8", "g_cons", "g_cons_utf8",
    "lex", "sp", "vt", "vs", "ps", "gn", "nu",
    "prs", "prs_ps", "prs_gn", "prs_nu",
    "gloss", "language",
    "typ", "function", "rela",
]


def main():
    tf = Fabric(locations=str(TF_DIR), modules=[""])
    api = tf.load(" ".join(FEATURES))
    if api is None:
        raise SystemExit("Failed to load BHSA TF data")

    F, T, L = api.F, api.T, api.L

    ruth_node = T.nodeFromSection(("Ruth",))
    verses = L.d(ruth_node, otype="verse")

    data = {
        "meta": {
            "source": "BHSA TF 2021",
            "book": "Ruth",
            "features": FEATURES,
        },
        "book": "Ruth",
        "chapters": {},
    }

    for verse_node in verses:
        book, chapter, verse = T.sectionFromNode(verse_node)
        chapter = str(chapter)
        verse = str(verse)

        chapter_entry = data["chapters"].setdefault(chapter, {"verses": {}})

        words = L.d(verse_node, otype="word")
        word_entries = []
        for idx, w in enumerate(words, start=1):
            word_entries.append({
                "id": w,
                "index": idx,
                "hebrew": F.g_word_utf8.v(w),
                "translit": F.g_word.v(w),
                "consonants": F.g_cons_utf8.v(w),
                "lexeme": F.lex.v(w),
                "lexemeTranslit": F.g_lex.v(w),
                "lexemeHebrew": F.g_lex_utf8.v(w),
                "gloss": F.gloss.v(w),
                "lang": F.language.v(w),
                "sp": F.sp.v(w),
                "vt": F.vt.v(w),
                "vs": F.vs.v(w),
                "ps": F.ps.v(w),
                "gn": F.gn.v(w),
                "nu": F.nu.v(w),
                "prs": F.prs.v(w),
                "prs_ps": F.prs_ps.v(w),
                "prs_gn": F.prs_gn.v(w),
                "prs_nu": F.prs_nu.v(w),
            })

        clauses = L.d(verse_node, otype="clause")
        clause_entries = []
        for c in clauses:
            clause_entries.append({
                "id": c,
                "typ": F.typ.v(c),
                "rela": F.rela.v(c),
                "wordIds": L.d(c, otype="word"),
                "phraseIds": L.d(c, otype="phrase"),
            })

        phrases = L.d(verse_node, otype="phrase")
        phrase_entries = []
        for p in phrases:
            phrase_entries.append({
                "id": p,
                "function": F.function.v(p),
                "typ": F.typ.v(p),
                "rela": F.rela.v(p),
                "wordIds": L.d(p, otype="word"),
            })

        verse_entry = {
            "ref": f"{book} {chapter}:{verse}",
            "words": word_entries,
            "clauses": clause_entries,
            "phrases": phrase_entries,
        }

        chapter_entry["verses"][verse] = verse_entry

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
