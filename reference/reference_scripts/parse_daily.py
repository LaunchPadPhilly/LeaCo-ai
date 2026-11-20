"""Parse LeaCo daily reports (Nov 7-19) into per-day totals, lease rows, injector rows and per-asset mentions."""
import re, json, subprocess, glob, os

DR = '/tmp/dr'
num = lambda s: None if s in (None, '', 'No Data', 'n/a') else float(s.replace(',', ''))

def text(f):
    return subprocess.run(['pdftotext', '-layout', f, '-'], capture_output=True, text=True).stdout

# Prefixes used in the reports -> canonical lease prefix used for asset keys
PREFIX = [
    (r'MLMU', 'MLMU'),
    (r'Myers Langlie Mattix(?: Unit)?', 'MLMU'),
    (r'East Eumont(?: Unit)?', 'EEU'),
    (r'WH Rhodes B Fed(?:eral)? NCT-?1', 'WHRB'),
    (r'W H Rhodes B Fed(?:eral)? NCT-?1', 'WHRB'),
    (r'WH Rhodes A Fed(?:eral)?', 'WHRA'),
    (r'Rhodes Yates COOP Fed Com (\d)', 'RYCF'),
    (r'Rhodes NCT COOP Fed\.? Com 1', 'RNCF1'),
    (r'Rhodes Yates(?: Unit)?', 'RYU'),
    (r'Mary E Wills A Federal', 'MEWAF'),
    (r'Mr Wills Federal', 'MRWF'),
    (r'Wills Federal', 'WF'),
]
PREFIX_RE = re.compile('|'.join(f'(?P<p{i}>{p})' for i, (p, _) in enumerate(PREFIX)), re.I)

def mentions(sentence):
    """Return list of asset keys mentioned, e.g. 'MLMU-141', carrying the prefix to following bare '#n' tokens."""
    out = []; cur = None; pos = 0
    toks = re.finditer(r'(?P<pre>' + PREFIX_RE.pattern + r')\s*#\s*(?P<n>\d+)\b|#(?P<bare>\d+)\b', sentence, re.I)
    for m in toks:
        if m.group('pre'):
            idx = [i for i in range(len(PREFIX)) if m.group(f'p{i}')][0]
            code = PREFIX[idx][1]
            if code == 'RYCF':
                sub = re.search(r'Com (\d)', m.group('pre')).group(1); code = f'RYCF{sub}'
            cur = code; out.append(f'{code}-{int(m.group("n"))}')
        elif cur:
            out.append(f'{cur}-{int(m.group("bare"))}')
    return out

days = {}
for f in sorted(glob.glob(f'{DR}/LeaCo_Daily_Report_Nov*.pdf'), key=lambda x: int(re.search(r'Nov(\d+)', x).group(1))):
    day = int(re.search(r'Nov(\d+)', f).group(1)); date = f'2026-11-{day:02d}'
    t = text(f); L = t.split('\n')
    D = {'date': date}
    g = lambda pat: (re.search(pat, t) or [None, None])[1]
    D['water'] = num(g(r'Water injected \(bbl/day\)\s+([\d,]+)'))
    D['oil'] = num(g(r'Oil produced \(bbl/day\)\s+([\d,.]+)'))
    D['own_water'] = num(g(r'Own produced water \(bbl/day\)\s+([\d,]+)'))
    D['third_party'] = num(g(r'Third-party water: ([\d,]+) bbl'))
    m = re.search(r'Injectors taking water: (\d+) / (\d+)', t); D['inj_taking'] = [int(m[1]), int(m[2])] if m else None
    m = re.search(r'Wells running: (\d+) / (\d+)', t); D['wells_running'] = [int(m[1]), int(m[2])] if m else None
    m = re.search(r'(\d+) wells flagged[^:]*:([^\n]+(?:\n[^\n•]+)?)', t)
    D['flagged'] = int(m[1]) if m else None
    D['flagged_by_lease'] = {k.strip(): int(v) for v, k in [] } if not m else {re.sub(r'\s+', ' ', a.strip()): int(b) for a, b in re.findall(r'([A-Za-z][A-Za-z .]+?) (\d+)', m[2])}
    # lease table
    D['leases'] = {}
    i0 = next(i for i, l in enumerate(L) if l.strip().startswith('Lease') and 'Yesterday' in l)
    for l in L[i0 + 1:i0 + 10]:
        mm = re.match(r'\s*([A-Za-z][A-Za-z ]+?)\s{2,}([\d,]+)\s+([\d,]+)\s+([\d,.]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*$', l)
        if mm and mm[1] != 'Total':
            D['leases'][mm[1]] = {'water': num(mm[2]), 'water30': num(mm[3]), 'oil': num(mm[4]), 'oil30': num(mm[5]), 'own_water': num(mm[6]), 'own_water30': num(mm[7])}
    # injector table
    D['injectors'] = {}
    try:
        j0 = next(i for i, l in enumerate(L) if l.strip().startswith('Injector') and '(bbl)' in l)
    except StopIteration:
        j0 = None
    if j0 is not None:
        for l in L[j0 + 1:j0 + 30]:
            s = l.strip()
            if s.startswith('All other') or s.startswith('Total'): break
            mm = re.match(r'\s*(.+?#\d+)\s{2,}(\S+(?: Data)?)\s+(\S+(?: Data)?)\s+(.+?)\s{2,}(\S+(?: Data)?)\s+(\S+(?: Data)?)\s+(.+?)\s*$', l)
            if not mm: continue
            keys = mentions(mm[1])
            if not keys: continue
            D['injectors'][keys[0]] = {'name': mm[1], 'vol': num(mm[2]), 'vol_prior': num(mm[3]), 'psi': num(mm[5].replace(',', '')) if mm[5] != 'No Data' else None,
                                       'psi_prior': num(mm[6].replace(',', '')) if mm[6] != 'No Data' else None,
                                       'vol_nodata': mm[2] == 'No', 'raw': re.sub(r'\s{2,}', ' | ', s)}
        mo = re.search(r'All other injectors \((\d+)\)\s+([\d.,]+)', t)
        D['other_injectors'] = {'count': int(mo[1]), 'vol': num(mo[2])} if mo else None
    # narrative sentences (Observations onward), joined lines
    k0 = next(i for i, l in enumerate(L) if l.startswith('Source:')) + 3
    body = []
    for l in L[k0:]:
        if re.match(r'\s*Injector\s+\(bbl\)', l) or re.match(r'\s*(MLMU|East Eumont|Rhodes|WH|All other|Total injected)\b.*\s{2,}[\d,.]+\s', l) and re.search(r'\s{3,}', l.strip()):
            continue  # skip table rows
        if re.search(r'Yesterday\s+Prior day', l) or re.match(r'\s*Injector\s+\(bbl\)', l): continue
        body.append(l.strip())
    prose = re.sub(r'\s+', ' ', ' '.join(body))
    prose = prose.split('NICE-TO-HAVE')[0]
    sents = re.split(r'(?<=[.!?])\s+(?=[A-Z•(])|\s*•\s*', prose)
    D['mentions'] = {}
    for snt in sents:
        snt = snt.strip()
        if len(snt) < 8: continue
        for k in dict.fromkeys(mentions(snt)):
            D['mentions'].setdefault(k, []).append(snt)
    # runtime % per well
    D['runtime'] = {}
    for k, ss in D['mentions'].items():
        for snt in ss:
            # isolate the clause about this asset: from its mention to the next ';' or next other-asset mention
            for pat in [r'ran (\d+)%', r'running (\d+)%', r'\((\d+)% yesterday', r'pumping (\d+)% of the day', r'running at (\d+)%', r'(\d+)% \(up from', r'(\d+)% \(down from', r'again \((\d+)%']:
                for mm in re.finditer(pat, snt):
                    before = snt[:mm.start()]
                    near = mentions(before)
                    if near and near[-1] == k:
                        D['runtime'].setdefault(k, int(mm.group(1)))
    days[date] = D
    print(date, 'water', D['water'], 'oil', D['oil'], 'inj rows', len(D['injectors']), 'leases', list(D['leases']), 'assets mentioned', len(D['mentions']), 'runtimes', len(D['runtime']))

json.dump(days, open('/home/claude/geo/daily_parsed.json', 'w'), indent=1)
