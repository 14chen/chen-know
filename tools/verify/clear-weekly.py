# -*- coding: utf-8 -*-
"""清空测试实例的「开源周报」周目录，让 weekly 验收脚本可重复跑。

用法：
    python clear-weekly.py http://127.0.0.1:8095
    python clear-weekly.py            # 默认读环境变量 KBPORT，默认 8095

注意：只在临时测试实例上跑；正式数据的归档目录不要动。
"""
import json, os, sys, urllib.request, urllib.error
import http.cookiejar

DEFAULT_PORT = os.environ.get('KBPORT', '8095')
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:' + DEFAULT_PORT).rstrip('/')
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    try:
        with op.open(req) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]


status, _ = call('POST', '/api/auth/login',
                 {'username': 'demo', 'password': 'DemoPass123!'})
if status != 200:
    print('log in failed (need a demo account on the test instance):', status)
    sys.exit(2)
print('login:', status, 'base:', BASE)

status, tree = call('GET', '/api/folders?tree=true')
if status != 200 or not isinstance(tree, list):
    print('folder tree read failed:', status, tree)
    sys.exit(2)

weeks = []
for node in tree:
    for child in node.get('children', []):
        name = child.get('name', '')
        if len(name) == 8 and name[4] == '-' and name[:4].isdigit() and name[5] == 'W':
            weeks.append(child)
print('week folders:', [(w['id'], w['name']) for w in weeks])

total_deleted = 0
failed = False
for week in weeks:
    status, page = call('GET', '/api/notes?folderId=%d&size=200' % week['id'])
    items = page.get('items', []) if isinstance(page, dict) else []
    for note in items:
        s1, _ = call('DELETE', '/api/notes/%d' % note['id'])
        s2, _ = call('DELETE', '/api/trash/notes/%d' % note['id'])
        if s1 not in (200, 204) or s2 not in (200, 204):
            print('  failed to delete note', note['id'], s1, s2)
            failed = True
        else:
            total_deleted += 1
    status, after = call('GET', '/api/notes?folderId=%d&size=200' % week['id'])
    remaining = after.get('total', -1) if isinstance(after, dict) else -1
    print('  %s: %d -> %d' % (week['name'], len(items), remaining))
    if remaining != 0:
        failed = True

print('deleted:', total_deleted)
if failed:
    print('FAILED: week folders are not empty; rerun before weekly verification')
    sys.exit(1)
print('OK: week folders are empty')
