import json,urllib.request,urllib.parse,os,sys
B="https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/%d/query"
bbox="-103.42,31.84,-102.98,32.80"
for lid in [2,6,8]:
    feats=[];off=0
    while True:
        q=dict(where="1=1",geometry=bbox,geometryType="esriGeometryEnvelope",inSR=4326,spatialRel="esriSpatialRelIntersects",
               outFields="NAME,MTFCC,RTTYP,OBJECTID",returnGeometry="true",outSR=4326,f="geojson",resultOffset=off,resultRecordCount=1000)
        r=json.load(urllib.request.urlopen(B%lid+"?"+urllib.parse.urlencode(q),timeout=90))
        fs=r.get("features",[]);feats+=fs
        if len(fs)<1000 and not r.get("exceededTransferLimit"):break
        if not fs:break
        off+=len(fs)
    json.dump({"type":"FeatureCollection","features":feats},open(f"/tmp/roads/tiger_{lid}.geojson","w"))
    from collections import Counter
    print(lid,len(feats),Counter(f["properties"]["MTFCC"] for f in feats))
