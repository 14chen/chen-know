// 验收用例：注册成功但自动登录失败时，必须「提示注册成功、请手动登录」且不把人踢回空表单
// 契约依据：docs/API.md §1 —— register 不下发 KB_SESSION，客户端必须再调 login；
//          自动登录失败时提示「注册成功，请手动登录」，不要把人踢回空表单。
const R = [];
const ok = (n, c, d = '') => R.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  :: ' + d : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);

async function waitFor(fn, timeout = 10000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const v = fn(); if (v) return v; } catch { /* 继续等 */ }
    await sleep(120);
  }
  throw new Error('waitFor 超时: ' + (label || ''));
}

try {
  await waitFor(() => $('#login-view') && $('#login-view').hidden === false, 15000, '登录页');
  ok('未登录（mock 令 /api/auth/me → 401）→ 渲染登录页', true);
  await waitFor(() => $('#boot-overlay')?.hidden === true, 10000, '启动遮罩撤下');

  const username = 'noauto_' + String(Date.now()).slice(-6);
  $('#auth-tab-register').click();
  await sleep(150);
  $('#register-username').value = username;
  $('#register-displayname').value = '自动登录失败用例';
  $('#register-password').value = 'pass-1234-5678';
  $('#register-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  await waitFor(() => ($('#login-error')?.textContent || '').length > 0, 15000, '降级提示');
  const msg = $('#login-error').textContent || '';
  ok('提示文案含「注册成功，请手动登录」', msg.includes('注册成功，请手动登录'), msg);
  ok('切到登录页签（不是留在空注册表单）',
    $('#login-form').hidden === false && $('#register-form').hidden === true);
  ok('用户名已预填（不留空表单）', $('#login-username').value === username, $('#login-username').value);
  ok('密码框已清空并聚焦', $('#login-password').value === '' && document.activeElement === $('#login-password'),
    `value="${$('#login-password').value}" active=${document.activeElement?.id}`);
  ok('未进入主界面', $('#main-view').hidden === true);
  ok('无 console 错误', (window.__errors || []).length === 0, JSON.stringify((window.__errors || []).slice(0, 3)));
} catch (e) {
  R.push('FAIL  用例异常  :: ' + (e && e.message));
} finally {
  const failed = R.filter((x) => x.startsWith('FAIL')).length;
  document.getElementById('selftest').textContent = R.join('\n') + `\n\n=== 注册自动登录失败分支：${R.length - failed}/${R.length} 通过 ===`;
}
