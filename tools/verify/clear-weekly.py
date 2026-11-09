import json, sys, urllib.request, urllib.error
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8095'
import http.cookiejar
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={'Content-Type': 'application/json'})
    try:
        with op.open(req) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]
print('login:', call('POST', '/api/auth/login', {'username': 'demo', 'password': 'DemoPass123!'})[0])
st, tree = call('GET', '/api/folders?tree=true')
weeks = []
for node_ in tree:
    for child in node_.get('children', []):
        name = child.get('name', '')
        if len(name) == 8 and name[4] == '-' and name[:4].isdigit() and name[5] == 'W':
            weeks.append(child)
print('week folders:', [(w['id'], w['name']) for w in weeks])
total_deleted = 0
for w in weeks:
    st, page = call('GET', '/api/notes?folderId=%d&size=200' % w['id'])
    items = page.get('items', []) if isinstance(page, dict) else []
    for n in items:
        call('DELETE', '/api/notes/%d' % n['id'])
        call('DELETE', '/api/trash/notes/%d' % n['id'])
        total_deleted += 1
    st, after = call('GET', '/api/notes?folderId=%d&size=200' % w['id'])
    print('  %s: %d -> %d' % (w['name'], len(items), after.get('total', -1)))
print('deleted:', total_deleted)
