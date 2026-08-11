function trim(s) { gsub(/^[ \t]+/, "", s); gsub(/[ \t]+$/, "", s); return s }
function esc(s) { gsub(/"/, "'", s); return s }
function cleancell(s) { s = stripcomments(s); gsub(/\*\*/, "", s); return trim(s) }
function stripcomments(s) {
  while (match(s, /<!--/)) {
    pre = substr(s, 1, RSTART - 1)
    rest = substr(s, RSTART)
    if (match(rest, /-->/)) rest = substr(rest, RSTART + 3)
    else rest = ""
    s = pre rest
  }
  return trim(s)
}
function addfam(fid, sec, st, lay, ora, rsk, prn, rsn, bby, brem, cov, kl) {
  if (fid in fstat) { dupfam[fid] = 1; return }
  forder[++nf] = fid
  fsec[fid] = sec; fstat[fid] = st; flay[fid] = lay; fora[fid] = ora; frisk[fid] = rsk
  fprune[fid] = prn; freason[fid] = rsn; fbby[fid] = bby; fbrem[fid] = brem; fcov[fid] = cov
  fkl[fid] = kl
}
# AUD-102 (audit rev-2026-08-10): KNOWN-LIMITATION:<finding> markers were invisible
# to the YAML (only BLOCKED: was extracted), hiding F-PT-018 from machine consumers.
function extract_kl(text,   out, t, tok) {
  t = text; out = ""
  gsub(/\*\*/, "", t)
  while (match(t, /KNOWN-LIMITATION:[A-Za-z0-9-]+/)) {
    tok = substr(t, RSTART + 17, RLENGTH - 17)
    if (out == "") out = tok
    else if (index("," out ",", "," tok ",") == 0) out = out "," tok
    t = substr(t, RSTART + RLENGTH)
  }
  return out
}
function extract_blocked(text,   out, t, tok) {
  t = text; out = ""
  gsub(/\*\*/, "", t)
  while (match(t, /BLOCKED:[A-Za-z0-9-]+/)) {
    tok = substr(t, RSTART + 8, RLENGTH - 8)
    if (out == "") out = tok
    else if (index("," out ",", "," tok ",") == 0) out = out "," tok
    t = substr(t, RSTART + RLENGTH)
  }
  return out
}
function prune_token(text,   t) {
  t = text
  gsub(/\*\*/, "", t)
  if (match(t, /PRUNE-[^ ]+/)) {
    t = substr(t, RSTART, RLENGTH)
    sub(/[:.,]$/, "", t)
    return t
  }
  return ""
}
# credit token T against family set; returns space-joined family ids
function credit(T,   out, i, f, pfx) {
  out = ""
  if (T ~ /-\*$/) {
    pfx = substr(T, 1, length(T) - 1)   # keep trailing dash
    for (i = 1; i <= nf; i++) {
      f = forder[i]
      if (index(f, pfx) == 1) out = out " " f
    }
    # base id: prefix minus trailing dash
    f = substr(pfx, 1, length(pfx) - 1)
    if (f in fstat) out = out " " f
    return out
  }
  if (T in fstat) out = out " " T
  for (i = 1; i <= nf; i++) {
    f = forder[i]
    if (length(T) > length(f) && index(T, f "-") == 1) out = out " " f
  }
  return out
}
function note_mention(tid, T,   creds, n, arr, j, f) {
  if (tid == "") return
  creds = credit(T)
  n = split(creds, arr, " ")
  for (j = 1; j <= n; j++) {
    f = arr[j]
    if (f == "") continue
    if (index("," tfam[tid] ",", "," f ",") == 0) {
      tfam[tid] = (tfam[tid] == "" ? f : tfam[tid] "," f)
    }
    if (!(f in fowner)) { fowner[f] = tid }
  }
}
BEGIN { nf = 0; nt = 0; pass = 0 }
FNR == 1 { pass++ }
# ───────────────────────── PASS 1: case-catalog.md ─────────────────────────
pass == 1 {
  line = $0
  if (line ~ /^## /) {
    s = line
    sub(/^## /, "", s)
    sub(/^[0-9]+\. /, "", s)
    p = index(s, " (")
    if (p > 0) s = substr(s, 1, p - 1)
    cursec = s
    next
  }
  if (line !~ /^\| CF/) next
  if (cursec == "Closure statement") next
  n = split(line, c, "|")
  if (n < 6) next
  id = trim(c[2])
  text = cleancell(c[3])
  lay = cleancell(c[4]); ora = cleancell(c[5]); rsk = cleancell(c[6])
  gsub(/\*\*/, "", id)
  cov = ""
  if (match(id, /-\{[^}]*\}$/)) {
    cov = substr(id, RSTART + 2, RLENGTH - 3)
    id = substr(id, 1, RSTART - 1)
    m = split(cov, cv, ",")
    cov = ""
    # sort covers
    for (a = 1; a <= m; a++) for (b = a + 1; b <= m; b++) if (cv[b] < cv[a]) { tmp2 = cv[a]; cv[a] = cv[b]; cv[b] = tmp2 }
    for (a = 1; a <= m; a++) cov = (cov == "" ? cv[a] : cov "," cv[a])
  }
  if (id ~ /-\*$/) sub(/-\*$/, "", id)
  nids = 0
  delete idlist
  if (id ~ /[\/+]/) {
    # split tail after last dash on / and +
    li = 0
    for (q = length(id); q >= 1; q--) if (substr(id, q, 1) == "-") { li = q; break }
    head = substr(id, 1, li)
    tail = substr(id, li + 1)
    m = split(tail, tp, /[\/+]/)
    for (a = 1; a <= m; a++) idlist[++nids] = head tp[a]
  } else {
    idlist[++nids] = id
  }
  isblank = (lay == "—" || lay == "")
  for (a = 1; a <= nids; a++) {
    fid = idlist[a]
    kl = extract_kl(text)
    if (isblank) {
      bb = extract_blocked(text)
      if (bb != "") addfam(fid, cursec, "blocked", "", "", "", "", text, bb, "", cov, kl)
      else addfam(fid, cursec, "pruned", "", "", "", prune_token(text), text, "", "", cov, kl)
    } else {
      addfam(fid, cursec, "implementable", lay, ora, rsk, "", "", "", extract_blocked(text), cov, kl)
    }
  }
  next
}
# ───────────────────────── PASS 2: harness-backlog.md ──────────────────────
pass == 2 {
  line = stripcomments($0)
  if (line ~ /^## /) {
    h = line
    sub(/^## /, "", h)
    if (h ~ /^Wave /) {
      split(h, w, " ")
      curwave = w[2]
    } else {
      split(h, w, " ")
      curwave = tolower(w[1])
    }
    curticket = ""
    next
  }
  # landed markers (ranges then singles)
  t = line
  while (match(t, /HB-[0-9]+\.\.HB-[0-9]+ LANDED/)) {
    r = substr(t, RSTART, RLENGTH)
    split(r, rr, /\.\./)
    lo = rr[1]; sub(/HB-/, "", lo)
    hi = rr[2]; sub(/ LANDED/, "", hi); sub(/HB-/, "", hi)
    for (v = lo + 0; v <= hi + 0; v++) {
      key = sprintf("HB-%03d", v)
      landed[key] = 1
    }
    t = substr(t, RSTART + RLENGTH)
  }
  t = line
  while (match(t, /HB-[0-9P]+[0-9]* LANDED/)) {
    r = substr(t, RSTART, RLENGTH)
    sub(/ LANDED/, "", r)
    if (r !~ /\.\./) landed[r] = 1
    t = substr(t, RSTART + RLENGTH)
  }
  # segmentation + mentions
  rest = line
  while (1) {
    if (match(rest, /\*\*HB-[0-9P]+[0-9]*/)) {
      mstart = RSTART; mlen = RLENGTH
      frag = substr(rest, 1, mstart - 1)
      tid = substr(rest, mstart + 2, mlen - 2)
      rest = substr(rest, mstart + mlen)
      scan_mentions(frag)
      if (!(tid in twave)) { torder[++nt] = tid; twave[tid] = curwave; tfam[tid] = "" }
      curticket = tid
    } else {
      scan_mentions(rest)
      break
    }
  }
  next
}
function scan_mentions(frag,   f2, tok, parts, np, pi, prim, cand, segs, ns, k, pref, si) {
  f2 = frag
  while (match(f2, /CF-[A-Za-z0-9*-]+(\/[A-Za-z0-9*-]+)*/)) {
    tok = substr(f2, RSTART, RLENGTH)
    f2 = substr(f2, RSTART + RLENGTH)
    sub(/[-.,;:]+$/, "", tok)
    np = split(tok, parts, "/")
    for (pi = 1; pi <= np; pi++) {
      p = parts[pi]
      sub(/[-.,;:]+$/, "", p)
      if (p ~ /^CF-/) note_mention(curticket, p)
    }
  }
}
# ───────────────────────── END: emit ───────────────────────────────────────
END {
  print "# case-catalog.yaml — machine-readable companion of case-catalog.md"
  print "# GENERATED 2026-08-10 by the rev-2026-08-10 campaign's extraction of"
  print "# case-catalog.md and harness-backlog.md (regenerate with the same rules"
  print "# whenever either file changes; hand-editing this file is a corpus bug)."
  print "# AUD-102 (audit rev-2026-08-10): known_limitation markers now extracted"
  print "# alongside BLOCKED/PRUNE so every register entry is machine-visible."
  print "schema: validation-architect/case-catalog/v1"
  print "product: cormidia"
  print "generated: 2026-08-10"
  print "source_catalog: ./case-catalog.md"
  print "source_backlog: ./harness-backlog.md"
  print "source_revision: 15708a7ed7ebfd2e24477262daf809c67734d15d"
  print "families:"
  for (i = 1; i <= nf; i++) {
    f = forder[i]
    lineout = "  - {id: " f ", section: \"" esc(fsec[f]) "\", status: " fstat[f]
    if (fstat[f] == "implementable") {
      lineout = lineout ", layers: \"" esc(flay[f]) "\", oracle: \"" esc(fora[f]) "\", risk: \"" esc(frisk[f]) "\""
      if (fbrem[f] != "") lineout = lineout ", blocked_remainder: [" esc(fbrem[f]) "]"
    }
    if (fstat[f] == "pruned") {
      lineout = lineout ", prune: \"" esc(fprune[f]) "\", reason: \"" esc(freason[f]) "\""
    }
    if (fstat[f] == "blocked") {
      lineout = lineout ", blocked_by: \"" esc(fbby[f]) "\", reason: \"" esc(freason[f]) "\""
    }
    if (fkl[f] != "") lineout = lineout ", known_limitation: [" esc(fkl[f]) "]"
    if (fcov[f] != "") lineout = lineout ", covers: [" fcov[f] "]"
    if (f in fowner) {
      ow = fowner[f]
      lineout = lineout ", ticket: " ow ", wave: \"" twave[ow] "\""
    } else if (fstat[f] == "implementable") {
      print "MISSING-OWNER: " f > "/dev/stderr"
    }
    print lineout "}"
  }
  print "tickets:"
  for (i = 1; i <= nt; i++) {
    tid = torder[i]
    key = tid
    if (tid ~ /^HB-[0-9]+$/) { v = tid; sub(/HB-/, "", v); key = sprintf("HB-%03d", v + 0) }
    st = (key in landed || tid in landed) ? "landed" : "pending"
    fl = tfam[tid]
    # sort families csv
    m = split(fl, fa, ",")
    for (a = 1; a <= m; a++) for (b = a + 1; b <= m; b++) if (fa[b] < fa[a]) { tmp2 = fa[a]; fa[a] = fa[b]; fa[b] = tmp2 }
    fl = ""
    for (a = 1; a <= m; a++) if (fa[a] != "") fl = (fl == "" ? fa[a] : fl ", " fa[a])
    print "  - {id: " tid ", wave: \"" twave[tid] "\", status: " st ", families: [" fl "]}"
  }
  for (f in dupfam) print "DUPFAM: " f > "/dev/stderr"
  # derived rollup — computed from the entries just emitted, never hand-edited
  nimp = 0; nprn = 0; nblk = 0
  for (i = 1; i <= nf; i++) {
    f = forder[i]
    if (fstat[f] == "implementable") nimp++
    else if (fstat[f] == "pruned") nprn++
    else if (fstat[f] == "blocked") nblk++
  }
  nland = 0; npend = 0
  for (i = 1; i <= nt; i++) {
    tid = torder[i]
    key = tid
    if (tid ~ /^HB-[0-9]+$/) { v = tid; sub(/HB-/, "", v); key = sprintf("HB-%03d", v + 0) }
    if (key in landed || tid in landed) nland++
    else npend++
  }
  print "# rollup (derived by the generator from the entries above — recompute, never hand-edit):"
  print "#   families: " nf " = " nimp " implementable + " nprn " pruned + " nblk " blocked"
  print "#   tickets: " nt " = " nland " landed + " npend " pending"
}
