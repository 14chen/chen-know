  /* 单篇导出 ZIP（本轮契约：md + 该篇引用的图片 + manifest.json） */
  if ((m = /^\/export\/notes\/(\d+)\.zip$/.exec(p))) {
    const buf = Buffer.from(EXPORT_ZIP_B64, 'base64');
    return send(res, 200, buf, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="note-${m[1]}.zip"`,
      'Content-Length': String(buf.length),
    });
  }
  if ((m = /^\/export\/notes\/(\d+)\.md$/.exec(p))) {
