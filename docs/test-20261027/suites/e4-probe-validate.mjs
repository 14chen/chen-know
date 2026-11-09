import { launch, newPage, BASE, sleep, shot } from './e4-lib.mjs';
const browser = await launch();
const { ctx, page } = await newPage(browser);
const info = async (label) => {
  const d = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 4).map((b) => ({ t: (b.innerText || '').trim(), dis: b.disabled, type: b.type }));
    const errs = [...document.querySelectorAll('[role=alert], .kb-alert, .kb-field__error, .kb-toast, [class*=error]')].map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return { hash: location.hash, side: !!document.querySelector('aside.kb-sidebar'), btns, errs, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 240) };
  });
  console.log(label + ' => ' + JSON.stringify(d));
  return d;
};
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[name=username]');
await info('LOGIN_EMPTY');

// 只填用户名
await page.fill('input[name=username]', 'admin');
await info('LOGIN_USER_ONLY');
await page.fill('input[name=password]', 'x');
await info('LOGIN_BOTH_FILLED');

// 注册页：空表单状态
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.getByText('注册', { exact: true }).first().click();
await page.waitForSelector('input[name=displayName]');
await info('REG_EMPTY');
await page.fill('input[name=username]', 'ab');
await page.fill('input[name=displayName]', 'x');
await page.fill('input[name=password]', '123');
await info('REG_SHORT_PWD');

// 提交短密码，看服务端/前端提示
await page.getByRole('button', { name: '注册并登录' }).click().catch(() => {});
await sleep(1500);
await info('REG_SHORT_PWD_SUBMIT');
await shot(page, 'probe-注册短密码');

// 重复用户名
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.getByText('注册', { exact: true }).first().click();
await page.waitForSelector('input[name=displayName]');
await page.fill('input[name=username]', 'admin');
await page.fill('input[name=displayName]', '另一个');
await page.fill('input[name=password]', 'other12345');
await page.getByRole('button', { name: '注册并登录' }).click().catch(() => {});
await sleep(1800);
await info('REG_DUP_USERNAME');
await shot(page, 'probe-注册重复用户名');

// 缺邀请码（库中已有用户）
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.getByText('注册', { exact: true }).first().click();
await page.waitForSelector('input[name=displayName]');
await page.fill('input[name=username]', 'carol');
await page.fill('input[name=displayName]', '卡罗尔');
await page.fill('input[name=password]', 'carol12345');
await page.getByRole('button', { name: '注册并登录' }).click().catch(() => {});
await sleep(1800);
await info('REG_NO_INVITE');
await shot(page, 'probe-注册缺邀请码');

// 错误密码登录
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.fill('input[name=username]', 'admin');
await page.fill('input[name=password]', 'wrongpass1');
await page.getByRole('button', { name: '登录', exact: true }).click();
await sleep(1800);
await info('LOGIN_WRONG_PWD');
await shot(page, 'probe-登录错误密码');
await ctx.close(); await browser.close();
