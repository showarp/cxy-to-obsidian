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

  // Safari Userscripts 等环境可能不提供 GM API，回退到 localStorage
  const _GM_getValue = typeof GM_getValue !== 'undefined'
    ? GM_getValue
    : (key, defaultValue) => {
        try {
          const v = localStorage.getItem(key);
          return v === null ? defaultValue : JSON.parse(v);
        } catch { return defaultValue; }
      };
  const _GM_setValue = typeof GM_setValue !== 'undefined'
    ? GM_setValue
    : (key, value) => {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
      };
  const _GM_registerMenuCommand = typeof GM_registerMenuCommand !== 'undefined'
    ? GM_registerMenuCommand
    : () => {};

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
    const raw = _GM_getValue(STORAGE_KEY, null);
    if (!raw) return { ...DEFAULTS };
    try { return { ...DEFAULTS, ...JSON.parse(raw) }; }
    catch { return { ...DEFAULTS }; }
  }
  function saveConfig(cfg) { _GM_setValue(STORAGE_KEY, JSON.stringify(cfg)); }
  let config = loadConfig();

  // ---------- Helpers ----------
  const pad = n => String(n).padStart(2, '0');
  const fmtTimestamp = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const lastSeg = s => {
    if (!s) return '';
    const parts = String(s).split('/').map(x => x.trim()).filter(Boolean);
    return parts[parts.length - 1] ?? '';
  };

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
    const seen = new Set();
    const add = raw => {
      const t = sanitizeTag(raw);
      if (t && !seen.has(t)) { seen.add(t); tags.push(t); }
    };
    if (q.category_full_path) {
      q.category_full_path.split('/').forEach(add);
    }
    if (q.题源) add(q.题源);
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
      category_name: lastSeg(q.category_name),
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
      category_name: lastSeg(q.category_name),
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
.cxy-obs-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid rgba(128,128,128,.25);
}
.cxy-obs-group, .cxy-obs-settings-group {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.cxy-obs-btn, .cxy-obs-settings-btn {
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
.cxy-obs-btn:hover, .cxy-obs-settings-btn:hover {
  border-color: #7c3aed;
  color: #7c3aed;
  background: #faf7ff;
  box-shadow: 0 2px 6px rgba(124, 58, 237, .15);
}
.cxy-obs-btn svg, .cxy-obs-settings-btn svg { width: 18px; height: 18px; display: block; }
.cxy-obs-label, .cxy-obs-settings-label {
  font-size: 12px;
  color: #606266;
  line-height: 1;
  user-select: none;
}

/* Dark theme adaptation */
.cxy-obs-wrapper[data-theme="dark"] {
  border-left-color: rgba(255,255,255,.15);
}
.cxy-obs-wrapper[data-theme="dark"] .cxy-obs-btn,
.cxy-obs-wrapper[data-theme="dark"] .cxy-obs-settings-btn {
  background: #1e1e1e;
  border-color: rgba(255,255,255,.12);
  color: #e0e0e0;
}
.cxy-obs-wrapper[data-theme="dark"] .cxy-obs-btn:hover,
.cxy-obs-wrapper[data-theme="dark"] .cxy-obs-settings-btn:hover {
  background: #2a2a2a;
  border-color: #7c3aed;
  color: #a78bfa;
  box-shadow: 0 2px 6px rgba(124, 58, 237, .25);
}
.cxy-obs-wrapper[data-theme="dark"] .cxy-obs-label,
.cxy-obs-wrapper[data-theme="dark"] .cxy-obs-settings-label {
  color: #b0b0b0;
}
`;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = STYLE_CSS;
    document.head.appendChild(s);
  }

  // Detect dark theme by checking page background brightness
  function isDarkTheme() {
    try {
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
      const bg = bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent' ? bodyBg : htmlBg;
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return false;
      const rgb = bg.match(/\d+/g);
      if (!rgb || rgb.length < 3) return false;
      const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
      return brightness < 128;
    } catch { return false; }
  }

  // download-into-tray icon (lucide)
  const ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

  // gear icon (lucide) — used inside the bottom toolbar
  const GEAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

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
      const dark = isDarkTheme();

      const container = document.createElement('div');
      container.className = 'cxy-obs-wrapper';
      container.setAttribute(BTN_FLAG, '1');
      if (dark) container.setAttribute('data-theme', 'dark');

      // Obsidian export button
      const obsGroup = document.createElement('div');
      obsGroup.className = 'action-btn-group cxy-obs-group';
      obsGroup.innerHTML = `
        <button type="button" class="cxy-obs-btn" title="导出到 Obsidian" aria-label="导出到 Obsidian">${ICON_SVG}</button>
        <span class="cxy-obs-label">Obsidian</span>
      `;
      obsGroup.querySelector('button').addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        exportToObsidian(qid);
      });

      // Settings button
      const settingsGroup = document.createElement('div');
      settingsGroup.className = 'action-btn-group cxy-obs-settings-group';
      settingsGroup.innerHTML = `
        <button type="button" class="cxy-obs-settings-btn" title="Obsidian 导出设置" aria-label="Obsidian 导出设置">${GEAR_ICON}</button>
        <span class="cxy-obs-settings-label">设置</span>
      `;
      settingsGroup.querySelector('button').addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        openConfigPanel();
      });

      container.appendChild(obsGroup);
      container.appendChild(settingsGroup);
      target.appendChild(container);
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
    const dark = isDarkTheme();
    const C = dark
      ? { bg: '#1e1e1e', fg: '#e0e0e0', border: 'rgba(255,255,255,.12)', muted: '#888', inputBg: '#2a2a2a', btnBg: '#2a2a2a', btnFg: '#e0e0e0', codeBg: '#333' }
      : { bg: '#fff', fg: '#303133', border: '#dcdfe6', muted: '#909399', inputBg: '#fff', btnBg: '#fff', btnFg: '#606266', codeBg: '#f5f5f5' };

    const modal = document.createElement('div');
    modal.id = 'cxy-obs-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;';

    const card = document.createElement('div');
    card.id = 'cxy-obs-card';
    card.style.cssText = `background:${C.bg};color:${C.fg};width:640px;max-width:92vw;max-height:90vh;overflow:auto;border-radius:8px;padding:22px 24px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;`;
    card.innerHTML = `
      <h2 style="margin:0 0 18px;font-size:18px;font-weight:600;color:${C.fg};">导出到 Obsidian — 配置</h2>
      <div style="display:grid;grid-template-columns:110px 1fr;gap:12px 14px;align-items:center;">
        <label>Vault 名:</label>
        <input id="cxy-cfg-vault" type="text" placeholder="必填,如 MyVault (Obsidian 侧边栏顶端那个名字)" style="padding:6px 10px;border:1px solid ${C.border};border-radius:4px;font-size:13px;background:${C.inputBg};color:${C.fg};">
        <label>目标文件夹:</label>
        <input id="cxy-cfg-folder" type="text" placeholder="如 刷题/数学" style="padding:6px 10px;border:1px solid ${C.border};border-radius:4px;font-size:13px;background:${C.inputBg};color:${C.fg};">
        <label>文件名模板:</label>
        <input id="cxy-cfg-filename" type="text" placeholder="{id}" style="padding:6px 10px;border:1px solid ${C.border};border-radius:4px;font-size:13px;background:${C.inputBg};color:${C.fg};">
        <label>覆盖已有:</label>
        <div style="display:flex;align-items:center;gap:8px;"><input id="cxy-cfg-overwrite" type="checkbox"><span style="color:${C.muted};font-size:12px;">关闭时,同名文件再次导入只会打开旧笔记 (不会覆盖你已写的内容)</span></div>
      </div>
      <div style="margin-top:16px;">
        <label style="display:block;margin-bottom:6px;">Markdown 模板:</label>
        <textarea id="cxy-cfg-template" rows="16" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid ${C.border};border-radius:4px;font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.55;background:${C.inputBg};color:${C.fg};"></textarea>
        <div style="color:${C.muted};font-size:12px;margin-top:6px;line-height:1.7;">
          可用占位符:<br>
          <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{id}</code> <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{题号}</code> <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{题目内容}</code> <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{category_name}</code> <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{category_full_path}</code> <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{题源}</code><br>
          <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{url}</code> <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{timestamp}</code> <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{date}</code> <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{tags}</code><br>
          <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{选项块}</code> <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{答案块}</code> <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{解析块}</code> — 字段为空时整段省略<br>
          <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{答案}</code> <code style="background:${C.codeBg};padding:1px 4px;border-radius:3px;font-size:11px;">{解析}</code> — 原始字段,需要自定义包装时用
        </div>
      </div>
      <div style="margin-top:18px;display:flex;justify-content:space-between;gap:8px;">
        <button id="cxy-cfg-reset" style="padding:7px 14px;border:1px solid ${C.border};border-radius:4px;background:${C.btnBg};cursor:pointer;color:${C.btnFg};font-size:13px;">恢复默认模板</button>
        <div style="display:flex;gap:8px;">
          <button id="cxy-cfg-cancel" style="padding:7px 14px;border:1px solid ${C.border};border-radius:4px;background:${C.btnBg};cursor:pointer;color:${C.btnFg};font-size:13px;">取消</button>
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
  _GM_registerMenuCommand('Obsidian 导出 - 配置', openConfigPanel);

  injectStyle();
  const observer = new MutationObserver(scheduleInject);
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleInject();
})();
