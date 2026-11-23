import json,networkx as nx,pyproj,numpy as np
from shapely.geometry import shape,Polygon,LineString,MultiLineString,box
from shapely.ops import linemerge,unary_union
T=pyproj.Transformer.from_crs(4326,32613,always_xy=True)
CLS={'S1200':'hwy','S1400':'local','S1500':'trail','S1730':'alley','S1740':'private','S1750':'private','S1630':'ramp','S1710':'walk'}
CLIP=box(-103.42,31.84,-102.98,32.80)
segs=[]
for l in (6,8):
  for f in json.load(open(f'/tmp/roads/tiger_{l}.geojson'))['features']:
    p=f['properties'];g=shape(f['geometry']).intersection(CLIP)
    if g.is_empty:continue
    for li in ([g] if g.geom_type=='LineString' else list(getattr(g,'geoms',[]))):
      if li.geom_type=='LineString':segs.append((li,p['NAME'] or '',p['MTFCC']))
segs=[s for s in segs if s[2] not in('S1710','S1730')]
def mi(g):
  ls=[g] if g.geom_type=='LineString' else list(g.geoms)
  return sum(LineString([T.transform(*c) for c in l.coords]).length for l in ls)/1609.34
# group features
groups={}
for li,nm,m in segs: groups.setdefault((nm,m),[]).append(li)
roads=[]
for (nm,m),ls in groups.items():
  mg=linemerge(ls); parts=[mg] if mg.geom_type=='LineString' else list(mg.geoms)
  if nm:
    sim=[p.simplify(0.00008) for p in parts]
    roads.append({'nm':nm,'c':CLS.get(m,'local'),'mi':round(mi(MultiLineString(parts)),1),'g':[[[round(x,4),round(y,4)] for x,y in p.coords] for p in sim]})
  else:
    for p in parts:
      s=p.simplify(0.00008);roads.append({'nm':'','c':CLS.get(m,'local'),'mi':round(mi(p),2),'g':[[[round(x,4),round(y,4)] for x,y in s.coords]]})
print('road features',len(roads),'size KB',len(json.dumps(roads,separators=(',',':')))//1024)
# ---- routing graph (prefers highways, like a driver would)
G=nx.Graph();key=lambda c:(round(c[0],5),round(c[1],5))
F={'S1200':1.0,'S1400':1.5,'S1500':3,'S1740':2.5,'S1750':2.5,'S1630':1.2}
for li,nm,m in segs:
  cs=list(li.coords)
  for a,b in zip(cs,cs[1:]):
    xa,ya=T.transform(*a);xb,yb=T.transform(*b);d=((xa-xb)**2+(ya-yb)**2)**.5
    pen=F.get(m,1.5)*(1 if nm else 1.4)
    G.add_edge(key(a),key(b),d=d,w=d*pen,n=nm or 'unnamed road',m=m)
big=max(nx.connected_components(G),key=len);nodes=list(big);arr=np.array([T.transform(*n) for n in nodes])
d=json.load(open('combined_data.json'));r=json.load(open('ranch_features.json'))
P={k:Polygon(h) for k,h in d['hulls'].items()}
P['winkler']=Polygon([f for f in r if f['n'].startswith('Winkler Ranch')][0]['g'][0][1])
P['crawford']=shape(json.load(open('crawford.json'))['crawford'])
lab={'winkler':'Winkler Ranch','rw':'Rhodes & Wills','crawford':'Crawford Ranch','mlmu':'Myers Langlie Mattix','eeu':'East Eumont'}
snap={};gaps=[]
for k,p in P.items():
  ring=p.exterior;bx=[ring.interpolate(t,normalized=True).coords[0] for t in np.linspace(0,1,400)]
  best=None
  for c in bx:
    x,y=T.transform(*c);dd=np.hypot(arr[:,0]-x,arr[:,1]-y);i=dd.argmin()
    if best is None or dd[i]<best[0]:best=(dd[i],nodes[i],c)
  snap[k]=best[1]
  if best[0]>150: gaps.append({'a':lab[k],'mi':round(best[0]/1609.34,2),'g':[[round(best[2][0],5),round(best[2][1],5)],[best[1][0],best[1][1]]]})
  print(lab[k],'gap %.2f mi'%(best[0]/1609.34))
routes=[]
for a,b in [('winkler','rw'),('rw','crawford'),('crawford','mlmu'),('mlmu','eeu')]:
  path=nx.shortest_path(G,snap[a],snap[b],weight='w');L=0;seq=[]
  for u,v in zip(path,path[1:]):
    e=G[u][v];L+=e['d']
    if not seq or seq[-1][0]!=e['n']:seq.append([e['n'],0])
    seq[-1][1]+=e['d']
  # collapse tiny pieces
  out=[]
  for n,m in seq:
    if out and out[-1][0]==n: out[-1][1]+=m
    elif m<250 and out: out[-1][1]+=m
    else: out.append([n,m])
  ls=LineString(path).simplify(0.00003)
  routes.append({'a':lab[a],'b':lab[b],'mi':round(L/1609.34,1),'via':[[n,round(m/1609.34,1)] for n,m in out],'g':[[[round(x,5),round(y,5)] for x,y in ls.coords]]})
  print(lab[a],'->',lab[b],round(L/1609.34,1),'|',' > '.join(f'{n} {m/1609.34:.1f}' for n,m in out))
d['roads']=roads;d['routes']=routes;d['rgaps']=gaps
json.dump(d,open('combined_data.json','w'),separators=(',',':'))
# compact encoding: names table + delta-encoded integer coords (1e-4 deg)
names=sorted({x['nm'] for x in roads});ni={n:i for i,n in enumerate(names)};cl=['hwy','local','trail','private','ramp','alley','walk'];
enc=[]
for x in roads:
  ls=[]
  for line in x['g']:
    px=py=0;flat=[]
    for lon,lat in line:
      X=round(lon*1e4);Y=round(lat*1e4);flat+= [X-px,Y-py];px,py=X,Y
    ls.append(flat)
  enc.append([ni[x['nm']],cl.index(x['c']),x['mi'],ls])
d['roads']={'names':names,'cls':cl,'r':enc}
json.dump(d,open('combined_data.json','w'),separators=(',',':'))
print('encoded KB',len(json.dumps(d['roads'],separators=(',',':')))//1024)
