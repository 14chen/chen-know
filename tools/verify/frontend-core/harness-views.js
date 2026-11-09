  ok('Ctrl+K 在编辑器内也归全局搜索（不插入 [[ ]]）',
    (!ta || ta.value === before) && document.activeElement === $('#global-search'),
    `changed=${!!ta && ta.value !== before} active=${document.activeElement?.id}`);

  // 编辑器自己的 wiki 链接快捷键改到 Ctrl+Shift+K
  if (ta) {
    ta.value = '链接测试：';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await sleep(150);
  }
  ok('Ctrl+Shift+K 在编辑器内插入 [[ ]]', !!ta && ta.value.includes('[[标题]]'), ta && `"${ta.value}"`);
  const linkBtn = $$('#editor-pane .editor-toolbar .btn').find((b) => b.textContent === '🔗');
  ok('工具条 🔗 按钮 title 注明 Ctrl+Shift+K', /Ctrl\+Shift\+K/.test(linkBtn?.title || ''), linkBtn?.title);
  if (ta) { ta.value = ''; }