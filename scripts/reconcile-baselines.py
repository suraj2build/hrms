#!/usr/bin/env python3
"""
Heuristic-assisted full reconciliation of all 223 "unresolved" entries across
unbounded-queries-baseline.stable-key.json (151) + tenant-isolation-baseline.stable-key.json (72).

Line numbers drift as files are edited (already documented as ADD-004's own
finding-fingerprint-instability bug) -- so instead of trusting the cited line
exactly, this finds the occurrence of `.from('TABLE')`/`.from("TABLE")` CLOSEST
to the cited line, and inspects a window around THAT occurrence.

Classifications (explicit heuristics, not a hidden black box):
  FIXED_LIKELY  - a .from(TABLE) occurrence exists, with fetchAllRows()/.range()/
                  chunk-by-100 pattern within +/-25 lines of it
  STILL_OPEN    - a .from(TABLE) occurrence exists, no bounding pattern nearby
  NO_FROM_MATCH - file exists, but no .from(TABLE) occurrence found anywhere in
                  it (code likely moved to another file entirely -- needs manual trace)
  NOT_FOUND     - file doesn't exist at all
"""
import json, re, os

ROOT = "/home/user/hrms"

def load(path):
    return json.load(open(os.path.join(ROOT, path)))

def read_lines(filepath):
    full = os.path.join(ROOT, filepath)
    if not os.path.exists(full):
        return None
    with open(full, errors="replace") as f:
        return f.readlines()

UNBOUNDED_OK = re.compile(r"fetchAllRows\(|\.range\(|fetchAllRowsByKeyset\(")
CHUNK_OK = re.compile(r"\+=\s*100\b|\+=\s*ID_CHUNK\b|\+=\s*CHUNK\b|\+=\s*50\b")
TENANT_OK = re.compile(r"\.eq\(\s*['\"]tenant_id['\"]")

def find_from_occurrences(lines, table):
    pat = re.compile(r"\.from\(\s*['\"]" + re.escape(table) + r"['\"]\s*\)")
    return [i for i, l in enumerate(lines) if pat.search(l)]

def classify_entry(entry, mode):
    file_, line_, table = entry.rsplit(":", 2)
    cited_line = int(line_)
    lines = read_lines(file_)
    if lines is None:
        return {"entry": entry, "file": file_, "line": cited_line, "table": table, "status": "NOT_FOUND"}

    occ = find_from_occurrences(lines, table)
    if not occ:
        return {"entry": entry, "file": file_, "line": cited_line, "table": table,
                "status": "NO_FROM_MATCH", "file_len": len(lines)}

    # nearest occurrence (0-indexed) to the cited line (1-indexed)
    nearest = min(occ, key=lambda i: abs((i + 1) - cited_line))
    distance = abs((nearest + 1) - cited_line)

    wstart = max(0, nearest - 25)
    wend = min(len(lines), nearest + 25)
    window = "".join(lines[wstart:wend])

    if mode == "unbounded":
        ok = bool(UNBOUNDED_OK.search(window) or CHUNK_OK.search(window))
    else:
        ok = bool(TENANT_OK.search(window))

    return {"entry": entry, "file": file_, "line": cited_line, "table": table,
            "status": "FIXED_LIKELY" if ok else "STILL_OPEN",
            "nearest_occurrence_line": nearest + 1, "drift": distance}

def main():
    unb = load("scripts/unbounded-queries-baseline.stable-key.json")["unresolved"]
    tiso = load("scripts/tenant-isolation-baseline.stable-key.json")["unresolved"]

    results_unb = [classify_entry(e, "unbounded") for e in unb]
    results_tiso = [classify_entry(e, "tenant") for e in tiso]

    for name, results in [("unbounded-queries", results_unb), ("tenant-isolation", results_tiso)]:
        counts = {}
        for r in results:
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        print(f"\n=== {name} ({len(results)} total) ===")
        for k, v in sorted(counts.items()):
            print(f"  {k}: {v}")

    out = "/tmp/claude-0/-home-user-hrms/73455263-0ad6-56bc-95c6-95c75dd0d601/scratchpad/reconcile-results.json"
    json.dump({"unbounded": results_unb, "tenant_isolation": results_tiso}, open(out, "w"), indent=2)
    print(f"\nFull results: {out}")

if __name__ == "__main__":
    main()
