/**
 * E1 用例集 1：AUTH（认证）/ ADMIN（管理）/ FOLDER（目录）
 */
import { K, S, C, F, Fx, hasErr, get, log } from './e1-lib.mjs';

export default async function run(R, ctx) {
  const { anon, admin, member, U } = ctx;
  const tag = 'e1' + Date.now().toString(36).slice(-5);
  const nodesOf = (r) => {
    const j = r && r.json;
    if (Array.isArray(j)) return j;
    if (!j) return [];
    return j.items || j.children || j.tree || [];
  };

  /* ================= AUTH ================= */
  await R.tc('TC-AUTH-001', '健康检查：200 且 db=ok（免登录）', async () => {
    const r = await anon.get('/health');
    return [S(r, 200), F(r, 'status', 'ok'), F(r, 'db', 'ok')];
  });
  await R.tc('TC-AUTH-002', '未登录访问 /auth/me → 401 UNAUTHORIZED', async () => {
    const r = await anon.get('/auth/me');
    return [S(r, 401), hasErr(r, 'UNAUTHORIZED')];
  });
  await R.tc('TC-AUTH-003', '注册首人：201 + role=admin', async () => {
    // 首人已由 runner 注册，这里直接查看其用户信息
    const r = await admin.get('/auth/me');
    return [S(r, 200), F(r, 'role', 'admin'), Fx(r, 'username', (v) => String(v || '').startsWith('e1admin'), 'username 以 e1admin 开头')];
  });
  await R.tc('TC-AUTH-004', '注册接口不下发会话（契约 §1 修订）', async () => {
    // 用邀请码注册一个新用户，检查响应头里没有 KB_SESSION
    const inv = await admin.post('/admin/invites', {});
    const r = await ctx.anon2.post('/auth/register', { username: 'e1nosess' + tag, displayName: '会话检查', password: 'Passw0rd!23', inviteCode: get(inv.json, 'code') });
    const setCookies = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    const hasSession = setCookies.some((x) => x.includes('KB_SESSION'));
    // 随后拿这个新账号登录一次，确认账号可用
    const lr = await ctx.anon2.login('e1nosess' + tag, 'Passw0rd!23');
    return [S(r, 201), K(!hasSession, 'Set-Cookie 不含 KB_SESSION', setCookies.join(' | ') || '(无 Set-Cookie)'), S(lr, 200)];
  });
  await R.tc('TC-AUTH-005', '登录成功：200 + Set-Cookie 带 HttpOnly/SameSite=Lax/Path=/', async () => {
    const r = await member.post('/auth/login', { username: U.memberUsername, password: U.memberPassword });
    const raw = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).find((x) => x.includes('KB_SESSION')) || '';
    return [S(r, 200), F(r, 'username', U.memberUsername), F(r, 'role', 'member'),
      K(/HttpOnly/i.test(raw), 'HttpOnly', raw), K(/SameSite=Lax/i.test(raw), 'SameSite=Lax', raw), K(/Path=\//i.test(raw), 'Path=/', raw)];
  });
  await R.tc('TC-AUTH-006', '登录后 /auth/me 返回当前用户', async () => {
    const r = await member.get('/auth/me');
    return [S(r, 200), F(r, 'username', U.memberUsername), Fx(r, 'id', (v) => Number.isInteger(v) && v > 0, 'id 为正整数')];
  });
  await R.tc('TC-AUTH-007', '密码错误 → 401（不泄露账号存在）', async () => {
    const r = await ctx.anon3.post('/auth/login', { username: U.memberUsername, password: 'wrong-pass-1' });
    return [S(r, 401), hasErr(r, 'UNAUTHORIZED')];
  });
  await R.tc('TC-AUTH-008', '用户不存在 → 401（与密码错误同码）', async () => {
    const r = await ctx.anon3.post('/auth/login', { username: 'nobody_' + tag, password: 'whatever-1' });
    return [S(r, 401), hasErr(r, 'UNAUTHORIZED')];
  });
  await R.tc('TC-AUTH-009', '注册 username 过短（2 字）→ 400 field=username', async () => {
    const r = await ctx.anon3.post('/auth/register', { username: 'ab', displayName: '短名', password: 'Passw0rd!23' });
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED', 'username')];
  });
  await R.tc('TC-AUTH-010', '注册 username 非法字符 → 400 field=username', async () => {
    const r = await ctx.anon3.post('/auth/register', { username: 'bad name!', displayName: '非法', password: 'Passw0rd!23' });
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED', 'username')];
  });
  await R.tc('TC-AUTH-011', '注册 password 仅 7 位 → 400 field=password', async () => {
    const r = await ctx.anon3.post('/auth/register', { username: 'e1p7' + tag, displayName: '短密码', password: 'Pass12!' });
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED', 'password')];
  });
  await R.tc('TC-AUTH-012', '注册 displayName 为空 → 400 field=displayName', async () => {
    const r = await ctx.anon3.post('/auth/register', { username: 'e1dn0' + tag, displayName: '', password: 'Passw0rd!23' });
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED', 'displayName')];
  });
  await R.tc('TC-AUTH-013', '注册 displayName 33 字 → 400 field=displayName', async () => {
    const r = await ctx.anon3.post('/auth/register', { username: 'e1dn33' + tag, displayName: '名'.repeat(33), password: 'Passw0rd!23' });
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED', 'displayName')];
  });
  await R.tc('TC-AUTH-014', '注册重复 username（大小写不敏感）→ 409 CONFLICT', async () => {
    const r = await ctx.anon3.post('/auth/register', { username: U.memberUsername.toUpperCase(), displayName: '重名', password: 'Passw0rd!23' });
    return [S(r, 409), hasErr(r, 'CONFLICT')];
  });
  await R.tc('TC-AUTH-015', '库中已有用户时无邀请码注册 → 4xx 拒绝', async () => {
    const r = await ctx.anon3.post('/auth/register', { username: 'e1ncode' + tag, displayName: '无码', password: 'Passw0rd!23' });
    return [K(r.status === 400 || r.status === 403, 'HTTP 400 或 403', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160))];
  });
  await R.tc('TC-AUTH-016', '无效邀请码注册 → 4xx 拒绝', async () => {
    const r = await ctx.anon3.post('/auth/register', { username: 'e1badinv' + tag, displayName: '坏码', password: 'Passw0rd!23', inviteCode: 'deadbeefdeadbeefdeadbeefdeadbeef' });
    return [K(r.status === 400 || r.status === 403 || r.status === 404, 'HTTP 400/403/404', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160))];
  });
  await R.tc('TC-AUTH-017', '有效邀请码注册 → 201 role=member', async () => {
    const inv = await admin.post('/admin/invites', { expiresInHours: 24 });
    const code = get(inv.json, 'code');
    const uname = 'e1inv' + tag;
    const r = await ctx.anon4.post('/auth/register', { username: uname, displayName: '受邀用户', password: 'Passw0rd!23', inviteCode: code });
    ctx.U.invited = uname;
    return [S(r, 201), F(r, 'role', 'member'), F(r, 'username', uname)];
  });
  await R.tc('TC-AUTH-018', '同一邀请码二次使用 → 4xx 拒绝', async () => {
    const inv = await admin.post('/admin/invites', {});
    const code = get(inv.json, 'code');
    const first = await ctx.anon5.post('/auth/register', { username: 'e1inv1' + tag, displayName: '一号', password: 'Passw0rd!23', inviteCode: code });
    const second = await ctx.anon6.post('/auth/register', { username: 'e1inv2' + tag, displayName: '二号', password: 'Passw0rd!23', inviteCode: code });
    return [S(first, 201), K(second.status >= 400 && second.status < 500, '第二次 4xx', 'HTTP ' + second.status + ' ' + JSON.stringify(second.json).slice(0, 160))];
  });
  await R.tc('TC-AUTH-019', '登出 204，之后 /auth/me → 401', async () => {
    const c = new (ctx.ClientCtor)('logout-probe');
    const lr = await c.login(U.memberUsername, U.memberPassword);
    const before = await c.get('/auth/me');
    const out = await c.post('/auth/logout', {});
    const after = await c.get('/auth/me');
    return [S(lr, 200), S(before, 200), S(out, 204), S(after, 401)];
  });
  await R.tc('TC-AUTH-020', '登录方法不支持：GET /auth/login → 405 METHOD_NOT_ALLOWED', async () => {
    const r = await ctx.anon3.get('/auth/login');
    const code = get(r.json, 'error.code');
    return [K(r.status === 405 || code === 'METHOD_NOT_ALLOWED', 'HTTP 405 或 code=METHOD_NOT_ALLOWED', 'HTTP ' + r.status + ' code=' + code)];
  });
  await R.tc('TC-AUTH-021', '注册缺字段（空 body）→ 400', async () => {
    const r = await ctx.anon3.post('/auth/register', {});
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED')];
  });
  await R.tc('TC-AUTH-022', '注册 password 传数字类型 → 400', async () => {
    const r = await ctx.anon3.post('/auth/register', { username: 'e1num' + tag, displayName: '数字密码', password: 12345678 });
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED')];
  });
  await R.tc('TC-AUTH-023', '停用账号登录 → 403 FORBIDDEN', async () => {
    const cu = await admin.post('/admin/users', { username: 'e1dis' + tag, displayName: '待停用', password: 'Passw0rd!23', role: 'member' });
    const uid = get(cu.json, 'id');
    await admin.patch('/admin/users/' + uid, { disabled: true });
    const r = await ctx.anon3.post('/auth/login', { username: 'e1dis' + tag, password: 'Passw0rd!23' });
    return [S(cu, 201), S(r, 403), hasErr(r, 'FORBIDDEN')];
  });
  await R.tc('TC-AUTH-024', '连续登录失败 5 次触发限流 → 429', async () => {
    const cu = await admin.post('/admin/users', { username: 'e1rate' + tag, displayName: '限流测试', password: 'Passw0rd!23', role: 'member' });
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const r = await ctx.anon7.post('/auth/login', { username: 'e1rate' + tag, password: 'bad-pass-' + i });
      statuses.push(r.status);
    }
    const has429 = statuses.includes(429);
    const last = statuses[statuses.length - 1];
    return [S(cu, 201), K(has429, '出现 429', statuses.join(',')), K(last === 429, '第 6 次为 429', '末次=' + last)];
  });

  /* ================= ADMIN ================= */
  await R.tc('TC-ADMIN-001', '管理员看用户列表：200 且含自己', async () => {
    const r = await admin.get('/admin/users?page=1&size=50');
    const items = get(r.json, 'items');
    return [S(r, 200), K(Array.isArray(items), 'items 为数组', typeof items),
      K(Array.isArray(items) && items.some((x) => x.username === U.adminUsername), '列表含管理员自身', JSON.stringify((items || []).map((x) => x.username)))];
  });
  await R.tc('TC-ADMIN-002', '普通用户访问 /admin/users → 403', async () => {
    const r = await member.get('/admin/users');
    return [S(r, 403), hasErr(r, 'FORBIDDEN')];
  });
  await R.tc('TC-ADMIN-003', '未登录访问 /admin/users → 401', async () => {
    const r = await ctx.nobody.get('/admin/users');
    return [S(r, 401), hasErr(r, 'UNAUTHORIZED')];
  });
  await R.tc('TC-ADMIN-004', '管理员创建用户 → 201', async () => {
    const r = await admin.post('/admin/users', { username: 'e1new' + tag, displayName: '新同事', password: 'Passw0rd!23', role: 'member' });
    ctx.U.newUserId = get(r.json, 'id');
    return [S(r, 201), F(r, 'role', 'member'), Fx(r, 'id', (v) => Number.isInteger(v) && v > 0, 'id 为正整数')];
  });
  await R.tc('TC-ADMIN-005', '创建重名用户 → 409', async () => {
    const r = await admin.post('/admin/users', { username: U.memberUsername, displayName: '重名', password: 'Passw0rd!23', role: 'member' });
    return [S(r, 409), hasErr(r, 'CONFLICT')];
  });
  await R.tc('TC-ADMIN-006', '创建用户 role 非法 → 400', async () => {
    const r = await admin.post('/admin/users', { username: 'e1role' + tag, displayName: '错角色', password: 'Passw0rd!23', role: 'root' });
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED')];
  });
  await R.tc('TC-ADMIN-007', 'PATCH 用户 displayName → 200 且生效', async () => {
    const r = await admin.patch('/admin/users/' + ctx.U.newUserId, { displayName: '改名后' });
    const list = await admin.get('/admin/users?page=1&size=200');
    const row = (get(list.json, 'items') || []).find((x) => x.id === ctx.U.newUserId);
    return [S(r, 200), K(row && row.displayName === '改名后', 'displayName=改名后', row && row.displayName)];
  });
  await R.tc('TC-ADMIN-008', 'PATCH 用户密码：旧密码失效、新密码可用', async () => {
    const r = await admin.patch('/admin/users/' + ctx.U.newUserId, { password: 'NewPass!2345' });
    const oldLogin = await ctx.anon3.post('/auth/login', { username: 'e1new' + tag, password: 'Passw0rd!23' });
    const newLogin = await ctx.anon3.post('/auth/login', { username: 'e1new' + tag, password: 'NewPass!2345' });
    return [S(r, 200), S(oldLogin, 401), S(newLogin, 200)];
  });
  await R.tc('TC-ADMIN-009', 'PATCH 用户 role 提升为 admin → 200', async () => {
    const r = await admin.patch('/admin/users/' + ctx.U.newUserId, { role: 'admin' });
    const list = await admin.get('/admin/users?page=1&size=200');
    const row = (get(list.json, 'items') || []).find((x) => x.id === ctx.U.newUserId);
    return [S(r, 200), K(row && row.role === 'admin', 'role=admin', row && row.role)];
  });
  await R.tc('TC-ADMIN-010', '不得停用自己 → 400', async () => {
    const me = await admin.get('/auth/me');
    const r = await admin.patch('/admin/users/' + get(me.json, 'id'), { disabled: true });
    return [K(r.status === 400, 'HTTP 400', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160))];
  });
  await R.tc('TC-ADMIN-011', '不得把自己降级为 member → 400', async () => {
    const me = await admin.get('/auth/me');
    const r = await admin.patch('/admin/users/' + get(me.json, 'id'), { role: 'member' });
    return [K(r.status === 400, 'HTTP 400', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160))];
  });
  await R.tc('TC-ADMIN-012', 'DELETE 用户 → 204，之后不在列表且无法登录', async () => {
    const cu = await admin.post('/admin/users', { username: 'e1del' + tag, displayName: '待删', password: 'Passw0rd!23', role: 'member' });
    const uid = get(cu.json, 'id');
    const del = await admin.del('/admin/users/' + uid);
    const list = await admin.get('/admin/users?page=1&size=200');
    const login = await ctx.anon3.post('/auth/login', { username: 'e1del' + tag, password: 'Passw0rd!23' });
    return [S(del, 204), K(!(get(list.json, 'items') || []).some((x) => x.id === uid), '列表不含被删用户', 'still there'), S(login, 401)];
  });
  await R.tc('TC-ADMIN-013', '不得删除自己 → 400', async () => {
    const me = await admin.get('/auth/me');
    const r = await admin.del('/admin/users/' + get(me.json, 'id'));
    return [K(r.status === 400, 'HTTP 400', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160))];
  });
  await R.tc('TC-ADMIN-014', '生成邀请码 → 201 {code, expiresAt}', async () => {
    const r = await admin.post('/admin/invites', { expiresInHours: 24 });
    return [S(r, 201), Fx(r, 'code', (v) => typeof v === 'string' && v.length === 32, 'code 为 32 位十六进制'), Fx(r, 'expiresAt', (v) => typeof v === 'string' && v.length > 10, 'expiresAt 为 ISO 字符串')];
  });
  await R.tc('TC-ADMIN-015', '邀请码列表含 used/expired 计算字段', async () => {
    const r = await admin.get('/admin/invites?page=1&size=50');
    const items = get(r.json, 'items') || [];
    return [S(r, 200), K(Array.isArray(items) && items.length > 0, 'items 非空', items.length),
      K(items.length > 0 && 'used' in items[0], '含 used 字段', JSON.stringify(Object.keys(items[0] || {}))),
      K(items.length > 0 && 'expired' in items[0], '含 expired 字段', JSON.stringify(Object.keys(items[0] || {})))];
  });
  await R.tc('TC-ADMIN-016', '吊销未使用邀请码 → 204 且不可再注册', async () => {
    const inv = await admin.post('/admin/invites', {});
    const code = get(inv.json, 'code');
    const del = await admin.del('/admin/invites/' + code);
    const reg = await ctx.anon3.post('/auth/register', { username: 'e1rev' + tag, displayName: '吊销后', password: 'Passw0rd!23', inviteCode: code });
    return [S(del, 204), K(reg.status >= 400 && reg.status < 500, '注册 4xx', 'HTTP ' + reg.status)];
  });
  await R.tc('TC-ADMIN-017', '普通用户访问 /admin/invites → 403', async () => {
    const r = await member.get('/admin/invites');
    return [S(r, 403), hasErr(r, 'FORBIDDEN')];
  });
  await R.tc('TC-ADMIN-018', 'PATCH 不存在的用户 → 404', async () => {
    const r = await admin.patch('/admin/users/999999', { displayName: 'x' });
    return [S(r, 404), hasErr(r, 'NOT_FOUND')];
  });

  /* ================= FOLDER ================= */
  const fid = {};
  await R.tc('TC-FOLDER-001', '建根目录 → 201，parentId=null，noteCount=0', async () => {
    const r = await admin.post('/folders', { parentId: null, name: 'F根' + tag });
    fid.root = get(r.json, 'id');
    return [S(r, 201), F(r, 'parentId', null), F(r, 'noteCount', 0), F(r, 'name', 'F根' + tag)];
  });
  await R.tc('TC-FOLDER-002', '建子目录 → 201 且 parentId 正确', async () => {
    const r = await admin.post('/folders', { parentId: fid.root, name: 'F子' + tag });
    fid.child = get(r.json, 'id');
    return [S(r, 201), F(r, 'parentId', fid.root)];
  });
  await R.tc('TC-FOLDER-003', '六层嵌套（无限层级）全部创建成功', async () => {
    let parent = fid.child;
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const r = await admin.post('/folders', { parentId: parent, name: 'F层' + i + tag });
      if (r.status !== 201) return [S(r, 201)];
      ids.push(get(r.json, 'id'));
      parent = get(r.json, 'id');
    }
    fid.deep = ids[ids.length - 1];
    const tree = await admin.get('/folders?tree=true');
    const find = (nodes, id) => {
      for (const n of nodes || []) { if (n.id === id) return true; const s = find(n.children, id); if (s) return true; }
      return false;
    };
    return [K(ids.length === 4, '创建 4 层', ids.length), K(find(nodesOf(tree), fid.deep), '深层目录在树里', '未找到')];
  });
  await R.tc('TC-FOLDER-004', '默认 tree=true 返回嵌套 children', async () => {
    const r = await admin.get('/folders');
    const txt = JSON.stringify(r.json);
    return [S(r, 200), K(txt.includes('"children"'), '含 children 字段', Object.keys(r.json || {}).join(','))];
  });
  await R.tc('TC-FOLDER-005', 'tree=false 返回扁平列表', async () => {
    const r = await admin.get('/folders?tree=false');
    const arr = Array.isArray(r.json) ? r.json : (get(r.json, 'items') || []);
    const flatNode = arr.find((x) => x && x.id === fid.child);
    return [S(r, 200), K(Array.isArray(arr) && arr.length > 0, '返回非空数组', Array.isArray(arr) ? arr.length : typeof r.json),
      K(flatNode ? !('children' in flatNode) || (flatNode.children || []).length === 0 : true, '扁平项无嵌套 children', JSON.stringify(flatNode && Object.keys(flatNode)))];
  });
  await R.tc('TC-FOLDER-006', 'noteCount 仅统计直属笔记（不含子孙）', async () => {
    const n1 = await admin.post('/notes', { folderId: fid.root, title: '直属1', content: 'a' });
    const n2 = await admin.post('/notes', { folderId: fid.root, title: '直属2', content: 'b' });
    const n3 = await admin.post('/notes', { folderId: fid.child, title: '子目录笔记', content: 'c' });
    ctx.U.folderNotes = [get(n1.json, 'id'), get(n2.json, 'id'), get(n3.json, 'id')];
    const tree = await admin.get('/folders');
    const flat = [];
    const walk = (nodes) => { for (const n of nodes || []) { flat.push(n); walk(n.children); } };
    walk(nodesOf(tree));
    const root = flat.find((x) => x.id === fid.root);
    const child = flat.find((x) => x.id === fid.child);
    return [S(n1, 201), S(n2, 201), S(n3, 201), K(root && root.noteCount === 2, '根目录 noteCount=2', root && root.noteCount), K(child && child.noteCount === 1, '子目录 noteCount=1', child && child.noteCount)];
  });
  await R.tc('TC-FOLDER-007', 'PATCH 改名 → 200 且生效', async () => {
    const r = await admin.patch('/folders/' + fid.child, { name: 'F子改名' + tag });
    const tree = await admin.get('/folders');
    return [S(r, 200), K(JSON.stringify(tree.json).includes('F子改名' + tag), '树中出现新名字', '未出现')];
  });
  await R.tc('TC-FOLDER-008', 'PATCH parentId 移动目录 → 树结构变化', async () => {
    const other = await admin.post('/folders', { parentId: null, name: 'F目标' + tag });
    const otherId = get(other.json, 'id');
    const r = await admin.patch('/folders/' + fid.child, { parentId: otherId });
    const tree = await admin.get('/folders');
    const nodes = nodesOf(tree);
    const target = nodes.find((x) => x.id === otherId);
    const moved = target && (target.children || []).some((c) => c.id === fid.child);
    // 移回原处，避免影响后续用例
    await admin.patch('/folders/' + fid.child, { parentId: fid.root });
    return [S(other, 201), S(r, 200), K(!!moved, '被移动目录出现在新父节点 children 里', JSON.stringify(target && (target.children || []).map((x) => x.id)))];
  });
  await R.tc('TC-FOLDER-009', '把目录移进自己的子孙 → 400', async () => {
    const r = await admin.patch('/folders/' + fid.root, { parentId: fid.deep });
    return [K(r.status === 400, 'HTTP 400', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160))];
  });
  await R.tc('TC-FOLDER-010', '把目录移到自己 → 400', async () => {
    const r = await admin.patch('/folders/' + fid.root, { parentId: fid.root });
    return [K(r.status === 400, 'HTTP 400', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160))];
  });
  await R.tc('TC-FOLDER-011', '移动到不存在的父目录 → 404', async () => {
    const r = await admin.patch('/folders/' + fid.child, { parentId: 999999 });
    return [S(r, 404), hasErr(r, 'NOT_FOUND')];
  });
  await R.tc('TC-FOLDER-012', '空 PATCH {} → 400 field=body（契约 §4.4）', async () => {
    const r = await admin.patch('/folders/' + fid.child, {});
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED', 'body')];
  });
  await R.tc('TC-FOLDER-013', '目录名为空 → 400', async () => {
    const r = await admin.post('/folders', { parentId: null, name: '' });
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED')];
  });
  await R.tc('TC-FOLDER-014', '目录名超长（300 字）→ 记录实际行为', async () => {
    const r = await admin.post('/folders', { parentId: null, name: 'N'.repeat(300) });
    // 契约未规定上限：400 视为校验生效，201 视为缺上限（记录不判失败，避免误判）
    return [K(r.status === 400 || r.status === 201, 'HTTP 400 或 201（记录实际）', 'HTTP ' + r.status)];
  });
  await R.tc('TC-FOLDER-015', 'PATCH 不存在的目录 → 404', async () => {
    const r = await admin.patch('/folders/999999', { name: 'x' });
    return [S(r, 404), hasErr(r, 'NOT_FOUND')];
  });
  await R.tc('TC-FOLDER-016', 'PATCH sortOrder 后列表顺序按 sortOrder 升序', async () => {
    const a = await admin.post('/folders', { parentId: null, name: 'S-A' + tag });
    const b = await admin.post('/folders', { parentId: null, name: 'S-B' + tag });
    const pa = await admin.patch('/folders/' + get(a.json, 'id'), { sortOrder: 90 });
    const pb = await admin.patch('/folders/' + get(b.json, 'id'), { sortOrder: 10 });
    const tree = await admin.get('/folders');
    const nodes = nodesOf(tree);
    const ia = nodes.findIndex((x) => x.id === get(a.json, 'id'));
    const ib = nodes.findIndex((x) => x.id === get(b.json, 'id'));
    const sa = nodes[ia], sb = nodes[ib];
    return [S(a, 201), S(b, 201), S(pa, 200), S(pb, 200),
      K(sa && Number(sa.sortOrder) === 90, 'A.sortOrder=90', sa && sa.sortOrder), K(sb && Number(sb.sortOrder) === 10, 'B.sortOrder=10', sb && sb.sortOrder),
      K(ia >= 0 && ib >= 0 && ib < ia, 'sortOrder=10 排在 90 之前', 'ia=' + ia + ' ib=' + ib)];
  });
  await R.tc('TC-FOLDER-017', '未登录访问目录 → 401', async () => {
    const r = await ctx.nobody.get('/folders');
    return [S(r, 401), hasErr(r, 'UNAUTHORIZED')];
  });
  await R.tc('TC-FOLDER-018', '空间隔离（正常路径）：普通用户看不到管理员的目录', async () => {
    const r = await member.get('/folders');
    const txt = JSON.stringify(r.json);
    return [S(r, 200), K(!txt.includes('F根' + tag) && !txt.includes('F子改名'), '不含管理员目录名', txt.slice(0, 200))];
  });
  await R.tc('TC-FOLDER-019', 'DELETE 目录 → 204，子孙与其中笔记一并进回收站', async () => {
    const del = await admin.del('/folders/' + fid.root);
    const trash = await admin.get('/trash');
    const tnotes = (get(trash.json, 'notes') || []).map((x) => x.id);
    const tfolders = (get(trash.json, 'folders') || []).map((x) => x.id);
    const allNotes = ctx.U.folderNotes || [];
    const allIn = allNotes.every((id) => tnotes.includes(id));
    return [S(del, 204), K(tfolders.includes(fid.root) && tfolders.includes(fid.child), '回收站含被删目录与其子目录', JSON.stringify(tfolders)),
      K(allIn, '回收站含其中 3 篇笔记', JSON.stringify(tnotes))];
  });
  await R.tc('TC-FOLDER-020', 'DELETE 不存在的目录 → 404', async () => {
    const r = await admin.del('/folders/999999');
    return [S(r, 404), hasErr(r, 'NOT_FOUND')];
  });
  ctx.fid = fid;
}
