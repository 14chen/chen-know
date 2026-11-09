/**
 * main.js — 应用外壳
 *
 * 启动：GET /api/auth/me → 401 显示登录页；成功进入三栏主界面
 * 视图：从 ./views/<id>.js 动态 import()，模块缺失或抛错一律降级到可见错误卡片
 * 约定：视图模块 default 导出 { id, title, icon, panes?, mount(container, ctx), unmount? }
 */

import { api, setUnauthorizedHandler, ApiError } from './api.js';
import { store, writeLocal, readLocal } from './store.js';
import * as ui from './ui.js';
import { renderMarkdown, toPlainText } from './markdown.js';

const { h, esc, toast, confirmDialog, emptyState, contextMenu } = ui;

/* ------------------------------------------------------------ 视图注册表 */

const DEFAULT_PANES = ['editor'];

const VIEW_REGISTRY = [
  { id: 'notes', title: '笔记', icon: '📝', nav: true, panes: ['tree', 'editor', 'preview'] },
  { id: 'search', title: '搜索', icon: '🔍', nav: true, panes: ['editor'] },
  { id: 'tags', title: '标签', icon: '🏷️', nav: true, panes: ['editor'] },
  { id: 'favorites', title: '收藏', icon: '⭐', nav: true, panes: ['editor'] },
  { id: 'recent', title: '最近浏览', icon: '🕘', nav: true, panes: ['editor'] },
  { id: 'trash', title: '回收站', icon: '🗑️', nav: true, panes: ['editor'] },
  { id: 'stats', title: '统计', icon: '📊', nav: true, panes: ['editor'] },
  { id: 'io', title: '导入导出', icon: '📦', nav: true, panes: ['editor'] },
  { id: 'admin', title: '成员管理', icon: '👥', nav: true, adminOnly: true, panes: ['editor'] },
  { id: 'backlinks', title: '反链', icon: '🔗', nav: false, panes: ['editor'] },
  { id: 'versions', title: '版本历史', icon: '🕰️', nav: false, panes: ['editor'] },
];
const REGISTRY_BY_ID = new Map(VIEW_REGISTRY.map((v) => [v.id, v]));

/* ------------------------------------------------------------ 外壳状态 */

const el = {};
const cleanups = [];
const dirtyChecks = [];
let currentModule = null;
let currentRoute = { view: null, params: {} };
let routeToken = 0;

/* ------------------------------------------------------------ 小工具 */

function cacheElements() {
  el.app = document.getElementById('app');
  el.boot = document.getElementById('boot-overlay');
  el.loginView = document.getElementById('login-view');
  el.mainView = document.getElementById('main-view');
  el.topbarNav = document.getElementById('topbar-nav');
  el.userName = document.getElementById('user-name');
  el.workspace = document.getElementById('workspace');
  el.tree = document.getElementById('tree-pane');
  el.editor = document.getElementById('editor-pane');
  el.preview = document.getElementById('preview-pane');
  el.splitterTree = document.getElementById('splitter-left');
  el.splitterPreview = document.getElementById('splitter-right');
}

function hideBoot() {
  if (window.__kbBootTimer) clearTimeout(window.__kbBootTimer);
  if (el.boot) el.boot.hidden = true;
}

function showBootError(message) {
  if (!el.boot) { toast(message, 'error', { duration: 0 }); return; }
  el.boot.hidden = false;
  el.boot.classList.add('is-error');
  const text = el.boot.querySelector('.boot-text');
  if (text) text.textContent = message;
  const retry = document.getElementById('boot-retry');
  if (retry) retry.hidden = false;
  const spinner = el.boot.querySelector('.spinner');
  if (spinner) spinner.hidden = true;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

/* ------------------------------------------------------------ 错误上报 */

const ERROR_TEXT = {
  NETWORK: '无法连接服务器，请确认后端已在 8080 端口启动。',
  UNAUTHORIZED: '用户名或密码错误，或会话已过期。',
  FORBIDDEN: '没有权限执行该操作。',
  CONFLICT: '与现有数据冲突（用户名或标签可能已存在）。',
  TOO_MANY_REQUESTS: '失败次数过多，账号已被临时锁定，请稍后再试。',
};

function describeError(err) {
  if (!err) return '未知错误';
  if (err.field) return `${err.message}（字段：${err.field}）`;
  return ERROR_TEXT[err.code] || err.message || '请求失败';
}

/* ------------------------------------------------------------ 登录页 */

function wireLogin() {
  const tabLogin = document.getElementById('auth-tab-login');
  const tabRegister = document.getElementById('auth-tab-register');
  const formLogin = document.getElementById('login-form');
  const formRegister = document.getElementById('register-form');

  const switchTab = (which) => {
    const isLogin = which === 'login';
    tabLogin.classList.toggle('is-active', isLogin);
    tabRegister.classList.toggle('is-active', !isLogin);
    tabLogin.setAttribute('aria-selected', String(isLogin));
    tabRegister.setAttribute('aria-selected', String(!isLogin));
    formLogin.hidden = !isLogin;
    formRegister.hidden = isLogin;
    showFormError(isLogin ? 'login' : 'register', null);
    setTimeout(() => {
      const first = (isLogin ? formLogin : formRegister).querySelector('input');
      if (first) first.focus();
    }, 0);
  };

  tabLogin.addEventListener('click', () => switchTab('login'));
  tabRegister.addEventListener('click', () => switchTab('register'));

  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-submit');
    if (!username || !password) { showFormError('login', '请填写用户名和密码'); return; }
    btn.disabled = true; btn.classList.add('is-loading'); btn.textContent = '登录中…';
    showFormError('login', null);
    try {
      const user = await api.auth.login({ username, password });
      await enterApp(user);
      toast(`欢迎回来，${user.displayName || user.username}`, 'success');
    } catch (err) {
      showFormError('login', describeError(err));
      if (err.field) highlightField(formLogin, err.field);
    } finally {
      btn.disabled = false; btn.classList.remove('is-loading'); btn.textContent = '登录';
    }
  });

  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value.trim();
    const displayName = document.getElementById('register-displayname').value.trim();
    const password = document.getElementById('register-password').value;
    const inviteCode = document.getElementById('register-invite').value.trim();
    const btn = document.getElementById('register-submit');
    if (!username || !displayName || !password) { showFormError('register', '用户名、显示名、密码均为必填'); return; }
    if (username.length < 3 || username.length > 32 || !/^[A-Za-z0-9_-]+$/.test(username)) {
      showFormError('register', '用户名需为 3–32 位字母、数字、下划线或短横线'); return;
    }
    if (password.length < 8) { showFormError('register', '密码至少 8 位'); return; }

    btn.disabled = true; btn.classList.add('is-loading'); btn.textContent = '注册中…';
    showFormError('register', null);
    try {
      const body = { username, displayName, password };
      if (inviteCode) body.inviteCode = inviteCode;
      const user = await api.auth.register(body);
      // API.md §1：只有 login 承诺下发 KB_SESSION，register 不建立会话 —— 注册后必须再登录一次
      try {
        await api.auth.login({ username, password });
      } catch (loginErr) {
        // 契约 §1：自动登录失败时提示「注册成功，请手动登录」，不要把人踢回空表单
        switchTab('login');
        document.getElementById('login-username').value = username;
        const pwd = document.getElementById('login-password');
        if (pwd) pwd.value = '';
        showFormError('login', `注册成功，请手动登录（自动登录失败：${describeError(loginErr)}）。用户名已填好，请补填密码。`);
        setTimeout(() => { if (pwd) pwd.focus(); }, 0);   // 覆盖 switchTab 的首输入框自动聚焦
        return;
      }
      await enterApp(user);
      toast('注册成功，已登录', 'success');
    } catch (err) {
      showFormError('register', describeError(err));
      if (err.field) highlightField(formRegister, err.field);
    } finally {
      btn.disabled = false; btn.classList.remove('is-loading'); btn.textContent = '注册并登录';
    }
  });

  applyTheme(store.get().theme);
}

function showFormError(which, message) {
  const box = document.getElementById(which === 'login' ? 'login-error' : 'register-error');
  if (!box) return;
  box.textContent = message || '';
  box.hidden = !message;
}

function highlightField(form, field) {
  const input = form.querySelector(`[name="${field}"]`);
  if (input) { input.focus(); input.select && input.select(); }
}

function showLogin(warn) {
  store.set({ user: null, isAdmin: false, view: null });
  el.mainView.hidden = true;
  el.loginView.hidden = false;
  hideBoot();
  if (warn) {
    const text = typeof warn === 'string' ? warn : describeError(warn);
    showFormError('login', text);
    if (warn && warn.code === 'NETWORK') toast(text, 'error', { duration: 0 });
  } else {
    showFormError('login', null);
  }
  setTimeout(() => {
    const first = el.loginView.querySelector('.auth-form:not([hidden]) input');
    if (first) first.focus();
  }, 0);
}

/* ------------------------------------------------------------ 主界面 */

async function enterApp(user) {
  store.set({ user, isAdmin: user.role === 'admin' });
  el.loginView.hidden = true;
  el.mainView.hidden = false;
  hideBoot();
  renderNav();
  el.userName.textContent = user.displayName || user.username;
  applyLayoutFromStore();
  await refreshTree();
  const route = readRoute();
  await activate(route.view, route.params, { fromBoot: true });
}

function renderNav() {
  const { isAdmin } = store.get();
  el.topbarNav.replaceChildren(...VIEW_REGISTRY
    .filter((v) => v.nav && (!v.adminOnly || isAdmin))
    .map((v) => h('button', {
      type: 'button',
      class: `nav-pill${currentRoute.view === v.id ? ' is-active' : ''}`,
      dataset: { view: v.id },
      title: v.title,
      on: { click: () => navigate(v.id, {}) },
    }, h('span', { class: 'nav-icon', text: v.icon }), h('span', { text: v.title }))));
}

function markActiveNav(viewId) {
  el.topbarNav.querySelectorAll('.nav-pill').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.view === viewId);
  });
}

function wireTopbar() {
  wireGlobalSearch();
  document.getElementById('btn-toggle-tree').addEventListener('click', () => togglePane('tree'));
  document.getElementById('btn-toggle-theme').addEventListener('click', () => {
    store.setTheme(store.get().theme === 'dark' ? 'light' : 'dark');
  });
  document.getElementById('btn-user-menu').addEventListener('click', (e) => {
    const user = store.get().user || {};
    const btn = e.currentTarget;
    btn.setAttribute('aria-expanded', 'true');
    const rect = btn.getBoundingClientRect();
    const close = contextMenu(rect.right - 180, rect.bottom + 6, [
      { label: `${user.displayName || user.username}`, hint: user.role === 'admin' ? '管理员' : '成员', onClick: () => {} },
      { sep: true },
      { label: '切换主题', icon: '◐', onClick: () => store.setTheme(store.get().theme === 'dark' ? 'light' : 'dark') },
      { label: '刷新目录树', icon: '⟳', onClick: () => { refreshTree(); toast('目录树已刷新', 'info'); } },
      { sep: true },
      { label: '退出登录', icon: '⏏', danger: true, onClick: logout },
    ]);
    const onClose = () => { btn.setAttribute('aria-expanded', 'false'); };
    const observer = new MutationObserver(() => { if (document.getElementById('context-menu-root').hidden) { onClose(); observer.disconnect(); } });
    observer.observe(document.getElementById('context-menu-root'), { attributes: true, attributeFilter: ['hidden'] });
    void close;
  });
}

/**
 * 顶栏全局搜索（#global-search）：输入防抖 300ms → 统一走 navigate('search', { q })，
 * URL 的 q 是唯一真源，外壳不维护第二套搜索状态。
 */
function wireGlobalSearch() {
  const input = document.getElementById('global-search');
  if (!input) return;

  const go = ui.debounce(() => {
    const q = input.value.trim();
    if (!q) return;                     // 空关键词：不跳转，也不清空已选中的结果
    navigate('search', { q });
  }, 300);

  input.addEventListener('input', go);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go.flush(); }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      input.blur();
    }
  });
}

async function logout() {
  if (!(await confirmDialog({ title: '退出登录', message: '确定要退出当前账号吗？', confirmText: '退出' }))) return;
  try { await api.auth.logout(); } catch (e) { console.warn('[logout]', e); }
  store.set({ currentNote: null, dirty: false, tree: [], treeLoaded: false });
  showLogin();
  toast('已退出登录', 'info');
}

/* ------------------------------------------------------- 路由与视图加载 */

function readRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!raw) return { view: readLocal('lastView', 'notes'), params: {} };
  const [view, qs] = raw.split('?');
  const params = {};
  new URLSearchParams(qs || '').forEach((v, k) => { params[k] = v; });
  return { view: view || 'notes', params };
}

function routeHash(view, params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') sp.append(k, v);
  const qs = sp.toString();
  return `#/${view}${qs ? `?${qs}` : ''}`;
}

function sameRoute(a, b) {
  return a.view === b.view && JSON.stringify(a.params || {}) === JSON.stringify(b.params || {});
}

async function navigate(view, params = {}) {
  const reg = REGISTRY_BY_ID.get(view);
  if (!reg) { toast(`未知视图：${view}`, 'error'); return false; }
  const target = routeHash(view, params);
  if (location.hash === target) return activate(view, params);
  location.hash = target;
  return true;
}

async function onHashChange() {
  const route = readRoute();
  if (sameRoute(route, currentRoute)) return;
  if (!(await runDirtyChecks())) {
    suppressNextHash = true;
    location.hash = routeHash(currentRoute.view, currentRoute.params);
    return;
  }
  await activate(route.view, route.params);
}

let suppressNextHash = false;

async function activate(viewId, params = {}, opts = {}) {
  const reg = REGISTRY_BY_ID.get(viewId);
  const token = ++routeToken;

  if (!reg) {
    const fallback = VIEW_REGISTRY.find((v) => v.nav && v.id !== viewId);
    toast(`未知视图「${viewId}」，已回退到${fallback.title}`, 'error');
    if (fallback && !opts.fromBoot) { location.hash = routeHash(fallback.id, {}); }
    else if (fallback) { return activate(fallback.id, {}, opts); }
    return false;
  }

  // 卸载旧视图
  unmountCurrent();
  currentRoute = { view: viewId, params };
  store.set({ view: viewId, params });
  writeLocal('lastView', viewId);
  markActiveNav(viewId);
  applyPanes(reg.panes || DEFAULT_PANES);
  el.editor.replaceChildren();
  el.tree.replaceChildren();

  let view;
  try {
    view = await loadViewModule(viewId);
    if (token !== routeToken) return false; // 期间又切换了视图
  } catch (err) {
    console.error(`[shell] 视图 ${viewId} 加载失败`, err);
    renderViewFailure(viewId, err);
    return false;
  }

  const ctx = createContext(viewId, params, reg);
  try {
    await view.mount(el.editor, ctx);
  } catch (err) {
    console.error(`[shell] 视图 ${viewId} 挂载失败`, err);
    renderViewFailure(viewId, err);
    return false;
  }
  if (token !== routeToken) { try { view.unmount && view.unmount(); } catch { /* noop */ } return false; }

  currentModule = view;
  return true;
}

const moduleCache = new Map();

async function loadViewModule(id) {
  if (moduleCache.has(id)) return moduleCache.get(id);
  const promise = import(`./views/${id}.js`).then((mod) => {
    const view = mod && mod.default;
    if (!view || typeof view.mount !== 'function') {
      throw new Error(`视图模块 ./views/${id}.js 未导出带 mount(container, ctx) 的 default 对象`);
    }
    return view;
  });
  moduleCache.set(id, promise);
  try {
    return await promise;
  } catch (err) {
    moduleCache.delete(id);
    throw err;
  }
}

function renderViewFailure(viewId, err) {
  const message = err instanceof ApiError ? describeError(err) : (err && err.message) || String(err);
  el.tree.replaceChildren();
  el.editor.replaceChildren(emptyState({
    icon: '🧩',
    title: `「${viewId}」视图加载失败`,
    hint: `${message}。其余功能不受影响，可切换到其它视图，或修复后重试。`,
    action: h('button', {
      class: 'btn', text: '重试', on: {
        click: async () => {
          moduleCache.delete(viewId);
          await activate(currentRoute.view, currentRoute.params);
        },
      },
    }),
  }));
  toast(`视图「${viewId}」加载失败：${message}`, 'error');
}

function unmountCurrent() {
  if (currentModule && typeof currentModule.unmount === 'function') {
    try { currentModule.unmount(); } catch (e) { console.error('[shell] unmount 异常', e); }
  }
  currentModule = null;
  while (cleanups.length) {
    const fn = cleanups.pop();
    try { fn(); } catch (e) { console.error('[shell] cleanup 异常', e); }
  }
  dirtyChecks.length = 0;
  ui.dismissContextMenu();
}

async function runDirtyChecks() {
  for (const fn of [...dirtyChecks]) {
    let ok = true;
    try { ok = await fn(); } catch (e) { console.error('[shell] 脏检查异常', e); }
    if (!ok) return false;
  }
  return true;
}

/* ------------------------------------------------------------ 视图上下文 */

function createContext(viewId, params, reg) {
  const user = store.get().user;
  const ctx = {
    /* 能力 */
    api,
    store,
    toast: ui.toast,
    confirmDialog: ui.confirmDialog,
    promptDialog: ui.promptDialog,
    formDialog: ui.formDialog,
    contextMenu: ui.contextMenu,
    openModal: ui.openModal,
    el: ui.h,
    esc: ui.esc,
    skeleton: ui.skeleton,
    emptyState: ui.emptyState,
    errorBox: ui.errorBox,
    formatDate: ui.formatDate,
    relativeTime: ui.relativeTime,
    formatBytes: ui.formatBytes,
    debounce: ui.debounce,
    copyText: ui.copyText,
    renderMarkdown,
    toPlainText,

    /* 导航与数据 */
    navigate,
    openNote: (id, opts) => openNoteFromAnywhere(id, opts),
    refreshTree,
    refreshTitleIndex,

    /* 当前用户与路由 */
    currentUser: user,
    isAdmin: !!user && user.role === 'admin',
    route: { view: viewId, params, meta: reg },

    /* 面板访问 */
    panes: { tree: el.tree, editor: el.editor, preview: el.preview },
    showPanes: (list) => applyPanes(list),
    setPaneVisible: (name, visible) => setPaneVisible(name, visible),

    /* 生命周期 */
    onCleanup(fn) { if (typeof fn === 'function') cleanups.push(fn); },
    onDirtyCheck(fn) {
      if (typeof fn !== 'function') return () => {};
      dirtyChecks.push(fn);
      return () => { const i = dirtyChecks.indexOf(fn); if (i >= 0) dirtyChecks.splice(i, 1); };
    },
  };
  return ctx;
}

async function openNoteFromAnywhere(id, opts = {}) {
  if (id === undefined || id === null) return;
  if (currentRoute.view === 'notes' && currentModule && typeof currentModule.openNote === 'function') {
    return currentModule.openNote(String(id), opts);
  }
  return navigate('notes', { note: String(id) });
}

async function refreshTree() {
  try {
    const tree = await api.folders.tree();
    store.set({ tree: Array.isArray(tree) ? tree : [], treeLoaded: true });
  } catch (err) {
    console.warn('[shell] 目录树加载失败', err);
    store.set({ tree: [], treeLoaded: true });
    if (!err.isUnauthorized) toast(`目录树加载失败：${describeError(err)}`, 'error');
  }
  await refreshTitleIndex();
}

async function refreshTitleIndex() {
  try {
    const res = await api.notes.list({ size: 200, sort: 'updated' });
    const items = (res && res.items) || [];
    const index = new Map();
    for (const n of items) if (n.title) index.set(String(n.title).toLowerCase(), n.id);
    store.setNoteIndex(index, new Set(index.keys()));
  } catch { /* 标题索引仅用于 [[链接]] 缺失标记，失败静默 */ }
}

/* ------------------------------------------------------------ 面板与布局 */

const PANE_MAP = {
  tree: { node: () => el.tree, splitter: () => el.splitterTree },
  preview: { node: () => el.preview, splitter: () => el.splitterPreview },
};

function setPaneVisible(name, visible, opts = {}) {
  const entry = PANE_MAP[name];
  if (!entry || !entry.node()) return;
  const node = entry.node();
  const splitter = entry.splitter();
  node.hidden = !visible;
  if (splitter) splitter.hidden = !visible;
  if (opts.persist !== false) {
    if (name === 'tree') { store.set({ treeVisible: visible }); writeLocal('layout.treeVisible', visible); }
    if (name === 'preview') { store.set({ previewVisible: visible }); writeLocal('layout.previewVisible', visible); }
  }
}

function applyPanes(list) {
  const s = store.get();
  setPaneVisible('tree', list.includes('tree') && s.treeVisible, { persist: false });
  setPaneVisible('preview', list.includes('preview') && s.previewVisible, { persist: false });
}

function togglePane(name) {
  const reg = REGISTRY_BY_ID.get(currentRoute.view);
  const allowed = (reg && reg.panes ? reg.panes : DEFAULT_PANES).includes(name);
  if (!allowed) { toast('当前视图没有该面板', 'info'); return; }
  const map = { tree: 'treeVisible', preview: 'previewVisible' };
  const next = !store.get()[map[name]];
  setPaneVisible(name, next);
  if (name === 'preview' && currentModule && typeof currentModule.setPreviewVisible === 'function') {
    currentModule.setPreviewVisible(next);
  }
}

function applyLayoutFromStore() {
  const { layout, treeVisible, previewVisible } = store.get();
  const sizes = { tree: 288, preview: 420, ...(layout || {}) };
  el.workspace.style.setProperty('--tree-w', `${sizes.tree}px`);
  el.workspace.style.setProperty('--preview-w', `${sizes.preview}px`);
  el.tree.hidden = !treeVisible;
  el.preview.hidden = !previewVisible;
  el.splitterTree.hidden = !treeVisible;
  el.splitterPreview.hidden = !previewVisible;
  store.setLayout({ tree: sizes.tree, preview: sizes.preview });
}

const SIZE_LIMIT = {
  tree: { prop: '--tree-w', min: 190, max: 560, def: 288, key: 'tree' },
  preview: { prop: '--preview-w', min: 240, max: 760, def: 420, key: 'preview' },
};

function wireSplitters() {
  [[el.splitterTree, 'tree'], [el.splitterPreview, 'preview']].forEach(([node, name]) => {
    if (!node) return;
    const limit = SIZE_LIMIT[name];
    let dragging = false;
    let startX = 0;
    let startW = 0;

    node.addEventListener('pointerdown', (e) => {
      if (node.hidden) return;
      dragging = true;
      startX = e.clientX;
      startW = parseFloat(getComputedStyle(el.workspace).getPropertyValue(limit.prop)) || limit.def;
      node.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      node.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    node.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const delta = name === 'tree' ? dx : -dx;
      const width = Math.min(limit.max, Math.max(limit.min, startW + delta));
      el.workspace.style.setProperty(limit.prop, `${width}px`);
      sizeDraft[name] = Math.round(width);
    });

    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      node.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing');
      if (node.hasPointerCapture && node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
      if (sizeDraft[name]) store.setLayout({ [limit.key]: sizeDraft[name] });
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);

    node.addEventListener('dblclick', () => {
      el.workspace.style.setProperty(limit.prop, `${limit.def}px`);
      store.setLayout({ [limit.key]: limit.def });
    });

    node.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 40 : 12;
      let delta = 0;
      if (e.key === 'ArrowLeft') delta = name === 'tree' ? -step : step;
      if (e.key === 'ArrowRight') delta = name === 'tree' ? step : -step;
      if (!delta) return;
      e.preventDefault();
      const cur = parseFloat(getComputedStyle(el.workspace).getPropertyValue(limit.prop)) || limit.def;
      const width = Math.min(limit.max, Math.max(limit.min, cur + delta));
      el.workspace.style.setProperty(limit.prop, `${width}px`);
      store.setLayout({ [limit.key]: Math.round(width) });
    });
  });
}

const sizeDraft = {};

/* ------------------------------------------------------------ 键盘 */

function wireKeyboard() {
  const searchInput = () => document.getElementById('global-search');

  // Ctrl+K 聚焦全局搜索（捕获阶段：优先于编辑器内的同名快捷键）
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (e.key.toLowerCase() !== 'k') return;
    const input = searchInput();
    if (!input) return;
    e.preventDefault();
    e.stopPropagation();
    if (document.activeElement === input) input.select();   // 已聚焦 → 全选
    else { input.focus(); input.select(); }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === '\\' || e.code === 'Backslash')) {
      e.preventDefault();
      togglePane('tree');
    }
  });
  window.addEventListener('hashchange', () => {
    if (suppressNextHash) { suppressNextHash = false; return; }
    onHashChange();
  });
  window.addEventListener('beforeunload', (e) => {
    if (store.get().dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

/* ------------------------------------------------------------ 启动 */

async function boot() {
  cacheElements();
  applyTheme(store.get().theme);
  store.subscribe((state, changed) => {
    if (changed.includes('theme')) applyTheme(state.theme);
  });

  wireLogin();
  wireTopbar();
  wireSplitters();
  wireKeyboard();

  setUnauthorizedHandler(() => {
    if (store.get().user) toast('登录已过期，请重新登录', 'error');
    store.set({ user: null, isAdmin: false, dirty: false });
    showLogin();
  });

  try {
    const user = await api.auth.me({ silent: true });
    await enterApp(user);
  } catch (err) {
    if (err && (err.isUnauthorized || err.code === 'UNAUTHORIZED')) {
      showLogin();
    } else {
      // 后端未就绪也要给出可操作界面，而不是白屏
      showLogin(err);
    }
  } finally {
    hideBoot();
  }
}

boot().catch((err) => {
  console.error('[shell] 启动失败', err);
  showBootError(`界面启动失败：${(err && err.message) || err}`);
});

/* 供调试使用 */
window.__kb = { api, store, ui, renderMarkdown };
