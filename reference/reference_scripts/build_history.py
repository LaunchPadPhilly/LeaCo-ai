import json, re, csv, io
from collections import Counter

D = json.load(open('/home/claude/geo/daily_parsed.json'))
dates = sorted(D)
C = json.load(open('/home/claude/geo/combined_data.json'))
A = C['assets']

# ---- asset key from the state well name, e.g. "MYERS LANGLIE MATTIX UNIT #141" -> MLMU-141
def key_from_state(sn):
    s = sn.upper().replace('#', ' ')
    rules = [(r'MYERS LANGLIE MATTIX UNIT', 'MLMU'), (r'EAST EUMONT UNIT', 'EEU'), (r'W H RHODES B FEDERAL NCT-?1', 'WHRB'),
             (r'W H RHODES A FEDERAL', 'WHRA'), (r'RHODES YATES COOP FED(?:ERAL)? COM (\d)', 'RYCF'), (r'RHODES NCT COOP FED(?:ERAL)? COM 1', 'RNCF1'),
             (r'RHODES YATES UNIT', 'RYU'), (r'MARY E WILLS A FED(?:ERAL)?', 'MEWAF'), (r'MR WILLS FED(?:ERAL)?', 'MRWF'), (r'WILLS FED(?:ERAL)?', 'WF')]
    for pat, code in rules:
        m = re.match(pat, s)
        if m:
            if code == 'RYCF': code = 'RYCF' + m.group(1)
            n = re.search(r'(\d+)[A-Z]?\s*$', s).group(1)
            return f'{code}-{int(n)}'
    return None

# ---- Amplified asset list (IDs) from the attachment
ids = {}
raw = open('/mnt/user-data/uploads/dc6815c4-attachment.txt', encoding='utf-8').read().replace('\ufeff', '').replace('\r', '').strip('\n')
for r in csv.DictReader(io.StringIO(raw)):
    cid = r['customer_asset_id (customer id)']
    m = re.match(r'([A-Z]+\d?)-(\d+)-(PRD|INJ)$', cid or '')
    if not m: continue
    k = f'{m.group(1)}-{int(m.group(2))}'
    ids.setdefault(k, []).append({'amp_id': r['asset_id (amplified id)'], 'cust_id': cid, 'note': r['notes'], 'name': r['clean_name']})

def clean(s):
    s = re.sub(r'^(INJECTION|OIL|WELLS|RUNNING TOTALS)\s+', '', s.strip())
    return s

# ---- per-asset history
unmatched = []
for a in A:
    k = key_from_state(a['sn']); a['key'] = k
    if not k: unmatched.append(a['sn']); continue
    if k in ids:
        a['n'] = ids[k][0]['name']; a['amp_id'] = ', '.join(x['amp_id'] for x in ids[k]); a['cust_id'] = ', '.join(x['cust_id'] or '' for x in ids[k] if x['cust_id'])
        notes = [x['note'] for x in ids[k] if x['note']]
        if notes: a['id_note'] = notes[0]
    hist = []
    for i, d in enumerate(dates):
        day = D[d]; row = {'d': d[5:]}
        if a['k'] == 'Injector':
            inj = day['injectors'].get(k)
            src = None
            if inj: row['v'] = inj['vol']; row['p'] = inj['psi']; row['nd'] = inj['vol'] is None; src = 'table'
            else:
                # fill from the next report's "prior day" column
                if i + 1 < len(dates):
                    nxt = D[dates[i + 1]]['injectors'].get(k)
                    if nxt and (nxt['vol_prior'] is not None or nxt['psi_prior'] is not None):
                        row['v'] = nxt['vol_prior']; row['p'] = nxt['psi_prior']; src = 'next'
            if src is None: row['o'] = 1   # in the report's "all other injectors" group
        else:
            if k in day['runtime']: row['rt'] = day['runtime'][k]
        ms = [clean(s) for s in day['mentions'].get(k, [])]
        if ms: row['n'] = ms
        hist.append(row)
    a['hist'] = hist

# ---- latest status (as of last report)
last = dates[-1]
for a in A:
    k = a.get('key');
    if not k: continue
    if a['k'] == 'Injector':
        h = a['hist'][-1]
        if 'v' in h or 'p' in h:
            v = h.get('v'); p = h.get('p')
            a['vol'] = 'No Data' if v is None else (f'{v:,.1f}' if v < 10 else f'{v:,.0f}'); a['psi'] = 'No Data' if p is None else f'{p:,.0f}'
            a['st'] = 'nodata' if v is None else ('take' if v >= 1 else ('stuck' if (p or 0) > 500 else 'idle'))
        else:
            a['vol'] = '≈0 (in "all other injectors")'; a['psi'] = 'not reported'; a['st'] = 'idle'
        a['asof'] = last
    else:
        # start from Nov 13 Amplified snapshot, then apply later runtime readings / clear on-off notes
        a['asof'] = '2026-11-13'; a['rt13'] = a.get('rt')
        for h in a['hist']:
            if h['d'] <= '11-13': continue
            txt = ' '.join(h.get('n', [])).lower()
            if 'rt' in h:
                a['rt'] = f"{h['rt']}%"; a['st'] = 'run' if h['rt'] > 0 else 'down'; a['asof'] = '2026-' + h['d']
            elif re.search(r'(shut off|shut down|fully stopped|was stopped|set to "shut off")', txt):
                a['st'] = 'down'; a['asof'] = '2026-' + h['d']; a['rt'] = '0% (per report note)'
            elif re.search(r'(running again|back pumping|switched back on|is running)', txt):
                a['st'] = 'run'; a['asof'] = '2026-' + h['d']
print('unmatched', unmatched)
print('injector status', Counter(a['st'] for a in A if a['k'] == 'Injector'))
print('well status', Counter(a['st'] for a in A if a['k'] == 'Well'))
print('assets with any daily data', sum(1 for a in A if any(('v' in h or 'p' in h or 'rt' in h or 'n' in h) for h in a.get('hist', []))), 'of', len(A))
print('with IDs', sum(1 for a in A if a.get('amp_id')))

# ---- daily series per area and totals
area_of = {'Myers Langlie Mattix': 'mlmu', 'East Eumont': 'eeu', 'Rhodes': 'rw', 'Mr Wills Federal': 'rw', 'Wills Federal': 'rw'}
series = {'dates': [d[5:] for d in dates], 'total': [], 'areas': {k: [] for k in ['mlmu', 'eeu', 'rw']}}
for d in dates:
    x = D[d]
    series['total'].append({'water': x['water'], 'oil': x['oil'], 'own': x['own_water'], 'tp': x['third_party'], 'inj': x['inj_taking'], 'run': x['wells_running'], 'flag': x['flagged']})
    agg = {k: {'water': 0, 'oil': 0, 'oil30': 0, 'own': 0} for k in series['areas']}
    for lease, v in x['leases'].items():
        ar = area_of.get(lease)
        if not ar: continue
        agg[ar]['water'] += v['water']; agg[ar]['oil'] = round(agg[ar]['oil'] + v['oil'], 1); agg[ar]['oil30'] += v['oil30']; agg[ar]['own'] += v['own_water']
    for k in agg: series['areas'][k].append(agg[k])
C['series'] = series; C['assets'] = A; C['last'] = last
json.dump(C, open('/home/claude/geo/combined_data.json', 'w'), separators=(',', ':'))
print(series['areas']['rw'][-1], series['total'][-1])

# ---- per-day status arrays (for the period selector)
import json as _j
C = _j.load(open('/home/claude/geo/combined_data.json'))
snap = {a['api']: a for a in _j.load(open('/home/claude/geo/ops_data.json'))['assets']}   # Nov 13 Amplified snapshot
i13 = dates.index('2026-11-13')
for a in C['assets']:
    H = a.get('hist', [])
    ds = []
    if a['k'] == 'Injector':
        for h in H:
            if h.get('o'):
                small = any('the other' in s.lower() and 'injectors took' in s.lower() and 'took nothing' not in s.lower() for s in h.get('n', []))
                if small: h['sm'] = 1
                ds.append('take' if small else 'idle')
            elif 'v' in h or 'p' in h:
                v, p = h.get('v'), h.get('p')
                ds.append('nodata' if v is None else ('take' if v >= 1 else ('stuck' if (p or 0) > 500 else 'idle')))
            else: ds.append('idle')
    else:
        cur = 'unk'
        s13 = snap.get(a['api'], {}).get('st', 'nodata')
        for i, h in enumerate(H):
            txt = ' '.join(h.get('n', [])).lower()
            if i == i13 and cur == 'unk': cur = s13
            if i == i13 and 'rt' not in h: cur = s13
            if 'rt' in h: cur = 'run' if h['rt'] > 0 else 'down'
            elif re.search(r'(shut off|shut down|fully stopped|stopped again|was stopped|set to "shut off"|no power)', txt): cur = 'down'
            elif re.search(r'(running again|back pumping|switched back on|is running|still running|ran \d+%)', txt): cur = 'run'
            ds.append(cur)
    a['ds'] = ds
C['dates_full'] = dates
_j.dump(C, open('/home/claude/geo/combined_data.json', 'w'), separators=(',', ':'))
from collections import Counter as _C
L = len(dates) - 1
print('last-day well statuses', _C(a['ds'][L] for a in C['assets'] if a['k'] == 'Well'), '| injectors', _C(a['ds'][L] for a in C['assets'] if a['k'] == 'Injector'))
print('injectors taking per day', [sum(1 for a in C['assets'] if a['k'] == 'Injector' and a['ds'][i] == 'take') for i in range(len(dates))])
print('report header taking   ', [D[d]['inj_taking'][0] for d in dates])
print('wells known per day', [sum(1 for a in C['assets'] if a['k'] == 'Well' and a['ds'][i] != 'unk') for i in range(len(dates))])

# WHRB-20 flag (asset list has #21, not #20)
C = _j.load(open('/home/claude/geo/combined_data.json'))
for a in C['assets']:
    if a.get('key') == 'WHRB-20':
        a['id_note'] = "Not in the Amplified asset list you sent, which has NCT-1 #21 instead. Amplified's Nov 13 report names this well NCT-1 20, and the state has both #020 and #021. Confirm which number Amplified's sensor is on."
_j.dump(C, open('/home/claude/geo/combined_data.json', 'w'), separators=(',', ':'))
