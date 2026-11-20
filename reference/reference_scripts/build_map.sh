cd /home/claude/geo && python3 -I -c "
t=open('combined_template.html').read()
for k,f in [('__FIELD__','combined_data.json'),('__RANCH__','ranch_features.json'),('__CRAW__','crawford.json'),('__STATE__','stateline.json')]: t=t.replace(k,open(f).read())
assert '__' not in t.split('<script>')[2][:200] if t.count('<script>')>2 else True
open('leaco_map.html','w').write(t)
open('c_test.html','w').write(t.replace('https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js','package/dist/d3.min.js'))
import re; left=re.findall(r'=__[A-Z]+__',t); print('built', len(t)//1024,'KB', 'placeholders left:',left)"
