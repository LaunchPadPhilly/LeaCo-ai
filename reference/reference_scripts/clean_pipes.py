import json, warnings
warnings.filterwarnings('ignore')
from shapely.geometry import LineString, box
from shapely.ops import linemerge, unary_union, transform
from pyproj import Transformer
from collections import defaultdict, Counter

to_m = Transformer.from_crs(4326, 32613, always_xy=True)
M = lambda g: transform(to_m.transform, g)
d = json.load(open('/home/claude/geo/combined_data.json'))

def lines(g):
    if g.is_empty: return []
    if g.geom_type == 'LineString': return [g]
    if hasattr(g, 'geoms'): return [x for x in g.geoms if x.geom_type == 'LineString']
    return []

def build(groups, tol):
    out = []
    for key, segs in groups.items():
        u = unary_union(segs)
        merged = u if u.geom_type == 'LineString' else linemerge(u)
        ls = [l.simplify(tol) for l in lines(merged)]
        ls = [l for l in ls if M(l).length > 15]
        if not ls: continue
        out.append({**dict(key), 'mi': round(sum(M(l).length for l in ls) / 1609.34, 2),
                    'g': [[[round(x, 5), round(y, 5)] for x, y in l.coords] for l in ls]})
    return out

# --- Texas: RRC permitted pipelines (accurate, Texas only)
G = defaultdict(list); seen = set()
for p in d['pipes']:
    sig = (tuple(map(tuple, p['g'])), p['op'], p['s'])
    if sig in seen: continue
    seen.add(sig)
    key = (('op', p['op']), ('sys', p['sys']), ('c', p['c']), ('t', p['t']), ('s', p['s']), ('dia', p['d'] or ''))
    G[key].append(LineString(p['g']))
tx = build(G, 0.00003)

# --- New Mexico: EIA major lines, clipped to NM (north of 32.0) so they never duplicate RRC lines in Texas
nm_box = box(-104.0, 32.0, -102.0, 33.5)
E = defaultdict(list)
for e in d['eia']:
    clipped = LineString(e['g']).intersection(nm_box)
    for l in lines(clipped):
        key = (('op', e['op']), ('nm', e['nm']), ('c', e['c']), ('s', e['s']))
        E[key].append(l)
nm = build(E, 0.0001)

print('TX features', len(tx), 'from', len(d['pipes']), 'segments | in service', sum(f['s'] == 'In Service' for f in tx), 'abandoned', sum(f['s'] != 'In Service' for f in tx))
print('TX paths', sum(len(f['g']) for f in tx), 'miles', round(sum(f['mi'] for f in tx), 1))
print('NM features', len(nm), 'paths', sum(len(f['g']) for f in nm), 'from', len(d['eia']), 'segments')
print(Counter((f['op'], f['c']) for f in nm).most_common(10))
d['pipes'] = tx; d['eia'] = nm
json.dump(d, open('/home/claude/geo/combined_data.json', 'w'), separators=(',', ':'))
