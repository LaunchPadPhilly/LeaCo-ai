import json,itertools,networkx as nx,pyproj
from shapely.geometry import shape,Point,Polygon
from shapely.ops import unary_union
T=pyproj.Transformer.from_crs(4326,32613,always_xy=True)
G=nx.Graph();names={}
segs=[]
for l in (6,8):
  for f in json.load(open(f'/tmp/roads/tiger_{l}.geojson'))['features']:
    g=shape(f['geometry']);ls=[g] if g.geom_type=='LineString' else list(g.geoms)
    for li in ls: segs.append((li,f['properties']['NAME'] or f['properties']['MTFCC']))
def key(c):return (round(c[0],5),round(c[1],5))
for li,nm in segs:
  cs=list(li.coords)
  for a,b in zip(cs,cs[1:]):
    xa,ya=T.transform(*a);xb,yb=T.transform(*b);d=((xa-xb)**2+(ya-yb)**2)**.5
    G.add_edge(key(a),key(b),w=d,n=nm)
comps=sorted(nx.connected_components(G),key=len,reverse=True)
big=comps[0];print('nodes',G.number_of_nodes(),'components',len(comps),'largest',len(big))
d=json.load(open('combined_data.json'));r=json.load(open('ranch_features.json'))
P={}
for k,h in d['hulls'].items():P[k]=Polygon(h)
P['winkler']=Polygon([f for f in r if f['n'].startswith('Winkler Ranch')][0]['g'][0][1])
P['crawford']=shape(json.load(open('crawford.json'))['crawford'])
lab={'winkler':'Winkler Ranch','rw':'Rhodes & Wills','crawford':'Crawford Ranch','mlmu':'Myers Langlie Mattix','eeu':'East Eumont'}
import numpy as np
nodes=list(big);arr=np.array([T.transform(*n) for n in nodes])
snap={}
for k,p in P.items():
  # nearest network node to polygon boundary (meters)
  bx=[T.transform(*c) for c in p.exterior.coords]
  best=None
  for x,y in bx:
    dd=np.hypot(arr[:,0]-x,arr[:,1]-y);i=dd.argmin()
    if best is None or dd[i]<best[0]:best=(dd[i],nodes[i])
  # also inside
  snap[k]=best[1];print(lab[k],'nearest public road from edge: %.2f mi'%(best[0]/1609.34))
order=['winkler','rw','crawford','mlmu','eeu']
for a,b in zip(order,order[1:]):
  path=nx.shortest_path(G,snap[a],snap[b],weight='w')
  L=0;seq=[]
  for u,v in zip(path,path[1:]):
    e=G[u][v];L+=e['w']
    if not seq or seq[-1][0]!=e['n']:seq.append([e['n'],0])
    seq[-1][1]+=e['w']
  print(f"\n{lab[a]} -> {lab[b]}: {L/1609.34:.1f} mi");print('  ',' > '.join(f"{n} ({m/1609.34:.1f})" for n,m in seq if m>400))
