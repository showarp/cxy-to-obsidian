// ==UserScript==
// @name         cxyonly 题目导出到 Obsidian
// @namespace    cxy.export.obsidian
// @version      0.1.0
// @description  在 cxyonly.fans 题目卡片旁加按钮，一键以 markdown 笔记形式发送到 Obsidian (obsidian:// URI)
// @match        https://cxyonly.fans/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'cxy_obsidian_config';

  const DEFAULT_TEMPLATE = `---
导入时间: {timestamp}
来源URL: {url}
题源: {题源}
tags:
{tags}
---

# {category_name} · 题{题号}

{题目内容}

{选项块}

{答案块}

{解析块}
`;

  const DEFAULTS = {
    vault: '',
    folder: '刷题/数学',
    filenamePattern: '{id}',
    overwrite: false,
    template: DEFAULT_TEMPLATE,
  };

  // ---------- Config ----------
  function loadConfig() {
    const raw = GM_getValue(STORAGE_KEY, null);
    if (!raw) return { ...DEFAULTS };
    try { return { ...DEFAULTS, ...JSON.parse(raw) }; }
    catch { return { ...DEFAULTS }; }
  }
  function saveConfig(cfg) { GM_setValue(STORAGE_KEY, JSON.stringify(cfg)); }
  let config = loadConfig();

  // ---------- Helpers ----------
  const pad = n => String(n).padStart(2, '0');
  const fmtTimestamp = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  // Obsidian tag rules: letters/digits/_/-/`/`, CJK ok; strip everything else
  function sanitizeTag(s) {
    if (!s) return '';
    return String(s)
      .replace(/[()（）「」\[\]【】]/g, '')
      .trim()
      .replace(/[\s,，、;；:：。.]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function buildTagsBlock(q) {
    const tags = [];
    if (q.category_full_path) {
      q.category_full_path.split('/').map(s => s.trim()).filter(Boolean)
        .forEach(seg => tags.push(seg));
    }
    if (q.题源) {
      const t = sanitizeTag(q.题源);
      if (t) tags.push(t);
    }
    if (tags.length === 0) return '  []';
    return tags.map(t => `  - ${t}`).join('\n');
  }

  function buildOptionsBlock(q) {
    const lines = ['A','B','C','D']
      .map(L => {
        const v = q[`选项${L}`];
        return (v == null || v === '') ? null : `- **${L}.** ${normalizeMath(v)}`;
      })
      .filter(Boolean);
    return lines.length ? lines.join('\n') : '';
  }

  function buildCallout(title, body) {
    if (!body) return '';
    const indented = String(body).replace(/\n/g, '\n> ');
    return `> [!note]- ${title}\n> ${indented}`;
  }

  // Obsidian 的 LaTeX 解析要求 `$...$` 美元符两侧紧贴内容,
  // 但 cxyonly 数据里混着 `$ x $` (有空格) 风格,会被当成普通文本不渲染。
  // 这里把每对 `$` 中间的首尾空格收紧。块级 `$$ x $$` 同理被收成 `$$x$$`。
  function normalizeMath(s) {
    if (!s) return s;
    return String(s).replace(/\$\s*([^$\n]+?)\s*\$/g, (_, e) => `$${e}$`);
  }

  function renderTemplate(tpl, q) {
    const now = new Date();
    const 题目内容 = normalizeMath(q.题目内容 ?? '');
    const 答案 = normalizeMath(q.答案 ?? '');
    const 解析 = normalizeMath(q.解析 ?? '');
    const map = {
      id: q.id,
      题号: q.题号 ?? q.id,
      题目内容,
      category_name: q.category_name ?? '',
      category_full_path: q.category_full_path ?? '',
      题源: q.题源 ?? '',
      url: location.href,
      timestamp: fmtTimestamp(now),
      date: fmtDate(now),
      tags: buildTagsBlock(q),
      选项块: buildOptionsBlock(q),
      答案块: buildCallout('答案', 答案),
      解析块: buildCallout('解析', 解析),
      答案,
      解析,
    };
    let out = tpl.replace(/\{([^{}]+)\}/g, (m, k) => {
      const v = map[k.trim()];
      return v == null ? m : String(v);
    });
    // collapse 3+ blank lines
    out = out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n');
    return out.trim() + '\n';
  }

  function renderFilename(pattern, q) {
    const now = new Date();
    const map = {
      id: q.id,
      题号: q.题号 ?? q.id,
      题源: q.题源 ?? '',
      category_name: q.category_name ?? '',
      category_full_path: q.category_full_path ?? '',
      date: fmtDate(now),
      timestamp: fmtTimestamp(now).replace(/[: ]/g, '-'),
    };
    const filled = (pattern || '{id}').replace(/\{([^{}]+)\}/g, (m, k) => {
      const v = map[k.trim()];
      return v == null ? m : String(v);
    });
    // strip path-traversal & illegal filename chars
    return filled.replace(/[\\\/:*?"<>|]/g, '_').trim() + '.md';
  }

  // ---------- API ----------
  async function fetchQuestion(id) {
    const r = await fetch(`/api/questions/${id}`, { credentials: 'include' });
    if (!r.ok) throw new Error(`API HTTP ${r.status}`);
    const json = await r.json();
    // The endpoint may return raw object or {code,data} wrapper
    return (json && typeof json === 'object' && 'data' in json && json.data?.id) ? json.data : json;
  }

  // ---------- Obsidian URI ----------
  // NOTE: 不要用 URLSearchParams — 它把空格编码成 `+`,Obsidian 用 decodeURIComponent
  // 不会还原 `+` 为空格,导致笔记里到处是 `+`。手工 encodeURIComponent 会把空格编成
  // `%20`,两端都能正确解码。
  function buildObsidianURI(filePath, content, cfg) {
    const parts = [
      `vault=${encodeURIComponent(cfg.vault)}`,
      `file=${encodeURIComponent(filePath)}`,
      `content=${encodeURIComponent(content)}`,
    ];
    if (cfg.overwrite) parts.push('overwrite=true');
    return `obsidian://new?${parts.join('&')}`;
  }

  // ---------- UI ----------
  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.textContent = msg;
    const colors = type === 'error'
      ? { bg: '#fef0f0', fg: '#f56c6c', bd: '#fbc4c4' }
      : { bg: '#f0f9eb', fg: '#67c23a', bd: '#e1f3d8' };
    el.style.cssText = `position:fixed;top:20px;right:20px;z-index:99999;padding:10px 16px;border-radius:6px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.15);background:${colors.bg};color:${colors.fg};border:1px solid ${colors.bd};`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  async function exportToObsidian(qid) {
    if (!config.vault) {
      toast('请先在 Tampermonkey 菜单 → "Obsidian 导出 - 配置" 里填 Vault 名', 'error');
      openConfigPanel();
      return;
    }
    try {
      const q = await fetchQuestion(qid);
      const content = renderTemplate(config.template, q);
      const filename = renderFilename(config.filenamePattern, q);
      const folder = (config.folder || '').replace(/^\/+|\/+$/g, '');
      const filePath = folder ? `${folder}/${filename}` : filename;
      const uri = buildObsidianURI(filePath, content, config);

      if (uri.length > 30000) {
        toast(`URI 长度 ${uri.length},可能超出浏览器限制 — 题目过长`, 'error');
        return;
      }
      window.location.href = uri;
      toast(`已发送到 Obsidian: ${filename}`);
    } catch (e) {
      console.error('[CXY→Obsidian]', e);
      toast(`失败: ${e.message}`, 'error');
    }
  }

  // ---------- Button injection ----------
  const BTN_FLAG = 'data-cxy-obsidian-btn';

  const STYLE_ID = 'cxy-obs-style';
  const STYLE_CSS = `
.cxy-obs-group {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-left: 12px;
}
.cxy-obs-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid #dcdfe6;
  background: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: #606266;
  transition: border-color .18s, color .18s, background .18s, box-shadow .18s;
}
.cxy-obs-btn:hover {
  border-color: #7c3aed;
  color: #7c3aed;
  background: #faf7ff;
  box-shadow: 0 2px 6px rgba(124, 58, 237, .15);
}
.cxy-obs-btn svg { width: 18px; height: 18px; display: block; }
.cxy-obs-label {
  font-size: 12px;
  color: #606266;
  line-height: 1;
  user-select: none;
}
`;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = STYLE_CSS;
    document.head.appendChild(s);
  }

  // download-into-tray icon (lucide)
  const ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

  function injectButtons() {
    document.querySelectorAll('.action-toolbar').forEach(toolbar => {
      if (toolbar.querySelector(`[${BTN_FLAG}]`)) return;

      const wrapper = toolbar.closest('[data-question-id]');
      let qid = wrapper?.getAttribute('data-question-id');
      if (!qid) {
        const m = location.pathname.match(/\/practice\/(\d+)/);
        qid = m?.[1];
      }
      if (!qid) return;

      const target = toolbar.querySelector('.toolbar-right') || toolbar;

      const group = document.createElement('div');
      group.className = 'action-btn-group cxy-obs-group';
      group.setAttribute(BTN_FLAG, '1');
      group.innerHTML = `
        <button type="button" class="cxy-obs-btn" title="导出到 Obsidian" aria-label="导出到 Obsidian">${ICON_SVG}</button>
        <span class="cxy-obs-label">Obsidian</span>
      `;
      group.querySelector('button').addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        exportToObsidian(qid);
      });
      target.appendChild(group);
    });
  }

  let injectTimer = null;
  const scheduleInject = () => {
    clearTimeout(injectTimer);
    injectTimer = setTimeout(injectButtons, 100);
  };

  // ---------- Config panel ----------
  function openConfigPanel() {
    if (document.getElementById('cxy-obs-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'cxy-obs-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;';

    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;width:640px;max-width:92vw;max-height:90vh;overflow:auto;border-radius:8px;padding:22px 24px;color:#303133;font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;';
    card.innerHTML = `
      <h2 style="margin:0 0 18px;font-size:18px;font-weight:600;">导出到 Obsidian — 配置</h2>
      <div style="display:grid;grid-template-columns:110px 1fr;gap:12px 14px;align-items:center;">
        <label>Vault 名:</label>
        <input id="cxy-cfg-vault" type="text" placeholder="必填,如 MyVault (Obsidian 侧边栏顶端那个名字)" style="padding:6px 10px;border:1px solid #dcdfe6;border-radius:4px;font-size:13px;">
        <label>目标文件夹:</label>
        <input id="cxy-cfg-folder" type="text" placeholder="如 刷题/数学" style="padding:6px 10px;border:1px solid #dcdfe6;border-radius:4px;font-size:13px;">
        <label>文件名模板:</label>
        <input id="cxy-cfg-filename" type="text" placeholder="{id}" style="padding:6px 10px;border:1px solid #dcdfe6;border-radius:4px;font-size:13px;">
        <label>覆盖已有:</label>
        <div style="display:flex;align-items:center;gap:8px;"><input id="cxy-cfg-overwrite" type="checkbox"><span style="color:#909399;font-size:12px;">关闭时,同名文件再次导入只会打开旧笔记 (不会覆盖你已写的内容)</span></div>
      </div>
      <div style="margin-top:16px;">
        <label style="display:block;margin-bottom:6px;">Markdown 模板:</label>
        <textarea id="cxy-cfg-template" rows="16" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #dcdfe6;border-radius:4px;font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.55;"></textarea>
        <div style="color:#909399;font-size:12px;margin-top:6px;line-height:1.7;">
          可用占位符:<br>
          <code>{id}</code> <code>{题号}</code> <code>{题目内容}</code> <code>{category_name}</code> <code>{category_full_path}</code> <code>{题源}</code><br>
          <code>{url}</code> <code>{timestamp}</code> <code>{date}</code> <code>{tags}</code><br>
          <code>{选项块}</code> <code>{答案块}</code> <code>{解析块}</code> — 字段为空时整段省略<br>
          <code>{答案}</code> <code>{解析}</code> — 原始字段,需要自定义包装时用
        </div>
      </div>
      <div style="margin-top:18px;display:flex;justify-content:space-between;gap:8px;">
        <button id="cxy-cfg-reset" style="padding:7px 14px;border:1px solid #dcdfe6;border-radius:4px;background:#fff;cursor:pointer;color:#606266;font-size:13px;">恢复默认模板</button>
        <div style="display:flex;gap:8px;">
          <button id="cxy-cfg-cancel" style="padding:7px 14px;border:1px solid #dcdfe6;border-radius:4px;background:#fff;cursor:pointer;font-size:13px;">取消</button>
          <button id="cxy-cfg-save" style="padding:7px 16px;border:none;border-radius:4px;background:#409eff;color:#fff;cursor:pointer;font-size:13px;">保存</button>
        </div>
      </div>
    `;

    modal.appendChild(card);
    document.body.appendChild(modal);

    const $ = sel => card.querySelector(sel);
    $('#cxy-cfg-vault').value = config.vault;
    $('#cxy-cfg-folder').value = config.folder;
    $('#cxy-cfg-filename').value = config.filenamePattern;
    $('#cxy-cfg-overwrite').checked = config.overwrite;
    $('#cxy-cfg-template').value = config.template;

    $('#cxy-cfg-reset').onclick = () => {
      $('#cxy-cfg-folder').value = DEFAULTS.folder;
      $('#cxy-cfg-filename').value = DEFAULTS.filenamePattern;
      $('#cxy-cfg-overwrite').checked = DEFAULTS.overwrite;
      $('#cxy-cfg-template').value = DEFAULTS.template;
    };
    $('#cxy-cfg-cancel').onclick = () => modal.remove();
    $('#cxy-cfg-save').onclick = () => {
      config = {
        vault: $('#cxy-cfg-vault').value.trim(),
        folder: $('#cxy-cfg-folder').value.trim(),
        filenamePattern: $('#cxy-cfg-filename').value.trim() || '{id}',
        overwrite: $('#cxy-cfg-overwrite').checked,
        template: $('#cxy-cfg-template').value || DEFAULT_TEMPLATE,
      };
      saveConfig(config);
      modal.remove();
      toast('配置已保存');
    };
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }

  // ---------- Bootstrap ----------
  GM_registerMenuCommand('Obsidian 导出 - 配置', openConfigPanel);

  injectStyle();
  const observer = new MutationObserver(scheduleInject);
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleInject();
})();
