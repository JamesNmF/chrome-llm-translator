/**
 * Options 脚本：配置管理、术语库 CRUD、生词本导出与连通性测试
 */

import { DEFAULT_SETTINGS, LANGUAGES, PROMPT_MODES, PROVIDERS, THEMES } from '../lib/constants.js';
import { LLMClient } from '../lib/llm-client.js';
import { dbInstance } from '../lib/cache-db.js';

document.addEventListener('DOMContentLoaded', async () => {
  // DOM 元素引用
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const toastBanner = document.getElementById('toast-banner');

  const providerSelect = document.getElementById('provider-select');
  const providerTip = document.getElementById('provider-tip');
  const apiKeyInput = document.getElementById('api-key-input');
  const apiKeyLink = document.getElementById('api-key-link');
  const btnToggleKey = document.getElementById('btn-toggle-key');
  const baseUrlInput = document.getElementById('base-url-input');
  const modelInput = document.getElementById('model-input');
  const modelOptions = document.getElementById('model-options');
  const temperatureRange = document.getElementById('temperature-range');
  const tempVal = document.getElementById('temp-val');
  const btnTestApi = document.getElementById('btn-test-api');
  const testResultTag = document.getElementById('test-result-tag');

  const targetLangSelect = document.getElementById('target-lang-select');
  const themeGrid = document.getElementById('theme-grid');
  const enableVideoSubtitles = document.getElementById('enable-video-subtitles');
  const enableCache = document.getElementById('enable-cache');

  // 术语库与生词本
  const enableGlossary = document.getElementById('enable-glossary');
  const glossaryTermInput = document.getElementById('glossary-term-input');
  const glossaryTransInput = document.getElementById('glossary-trans-input');
  const glossaryNoteInput = document.getElementById('glossary-note-input');
  const btnAddGlossary = document.getElementById('btn-add-glossary');
  const glossaryTbody = document.getElementById('glossary-tbody');
  const vocabCount = document.getElementById('vocab-count');
  const vocabTbody = document.getElementById('vocab-tbody');
  const btnExportVocabCsv = document.getElementById('btn-export-vocab-csv');
  const btnExportVocabJson = document.getElementById('btn-export-vocab-json');

  const enableSelectionBubble = document.getElementById('enable-selection-bubble');
  const enableSpaceTranslate = document.getElementById('enable-space-translate');
  const hotkeyBilingual = document.getElementById('hotkey-bilingual');

  const promptModeSelect = document.getElementById('prompt-mode-select');
  const systemPromptTextarea = document.getElementById('system-prompt-textarea');
  const btnResetPrompt = document.getElementById('btn-reset-prompt');

  const btnExportSettings = document.getElementById('btn-export-settings');
  const btnImportSettings = document.getElementById('btn-import-settings');
  const importFileInput = document.getElementById('import-file-input');

  const btnSaveSettings = document.getElementById('btn-save-settings');
  const saveStatus = document.getElementById('save-status');

  let currentSettings = { ...DEFAULT_SETTINGS };

  // 1. Tab 切换
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(i => i.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const targetPanel = document.getElementById(item.dataset.tab);
      if (targetPanel) targetPanel.classList.add('active');

      if (item.dataset.tab === 'glossary-tab') {
        loadGlossaryTable();
        loadVocabTable();
      }
    });
  });

  // 2. 初始化提供商下拉框
  providerSelect.innerHTML = '';
  Object.values(PROVIDERS).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    providerSelect.appendChild(opt);
  });

  // 初始化目标语言
  targetLangSelect.innerHTML = '';
  LANGUAGES.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.code;
    opt.textContent = `${l.name} (${l.code})`;
    targetLangSelect.appendChild(opt);
  });

  // 初始化主题选择
  themeGrid.innerHTML = '';
  THEMES.forEach(t => {
    const item = document.createElement('div');
    item.className = 'theme-item';
    item.dataset.theme = t.id;
    item.innerHTML = `
      <div class="theme-name">${t.name}</div>
      <div class="theme-desc">${t.desc}</div>
    `;
    item.addEventListener('click', () => {
      document.querySelectorAll('.theme-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      currentSettings.theme = t.id;
    });
    themeGrid.appendChild(item);
  });

  // 初始化 Prompt 模式下拉
  promptModeSelect.innerHTML = '';
  Object.values(PROMPT_MODES).forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.name} (${m.desc})`;
    promptModeSelect.appendChild(opt);
  });

  // 3. 读取已保存设置
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    currentSettings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }
  applySettingsToUI(currentSettings);

  function applySettingsToUI(s) {
    providerSelect.value = s.provider || 'deepseek';
    updateProviderMeta(s.provider || 'deepseek');

    apiKeyInput.value = s.apiKey || '';
    baseUrlInput.value = s.baseUrl || '';
    modelInput.value = s.model || '';
    temperatureRange.value = s.temperature ?? 0.3;
    tempVal.textContent = s.temperature ?? 0.3;

    targetLangSelect.value = s.targetLang || 'zh-CN';
    enableVideoSubtitles.checked = s.enableVideoSubtitles !== false;
    enableCache.checked = s.enableBilingualCache !== false;
    enableGlossary.checked = s.enableGlossary !== false;

    enableSelectionBubble.checked = s.enableSelectionBubble !== false;
    enableSpaceTranslate.checked = s.enableSpaceTranslate !== false;
    hotkeyBilingual.value = s.hotkeyBilingual || 'Alt+A';

    // 主题高亮
    const activeThemeEl = document.querySelector(`.theme-item[data-theme="${s.theme || 'dashed'}"]`);
    if (activeThemeEl) activeThemeEl.classList.add('active');

    // Prompt 回显
    updatePromptTextarea(promptModeSelect.value);
  }

  function updateProviderMeta(pId) {
    const meta = PROVIDERS[pId] || PROVIDERS.custom;
    providerTip.textContent = meta.tip || '';
    apiKeyLink.href = meta.docsUrl || '#';
    apiKeyLink.style.display = meta.docsUrl ? 'inline' : 'none';

    // 更新 Datalist 模型备选
    modelOptions.innerHTML = '';
    (meta.models || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      modelOptions.appendChild(opt);
    });

    if (!baseUrlInput.value || Object.values(PROVIDERS).some(p => p.baseUrl === baseUrlInput.value)) {
      baseUrlInput.value = meta.baseUrl || '';
    }
    if (!modelInput.value || Object.values(PROVIDERS).some(p => p.models?.includes(modelInput.value))) {
      modelInput.value = meta.defaultModel || '';
    }
  }

  providerSelect.addEventListener('change', () => {
    updateProviderMeta(providerSelect.value);
  });

  temperatureRange.addEventListener('input', () => {
    tempVal.textContent = temperatureRange.value;
  });

  btnToggleKey.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  promptModeSelect.addEventListener('change', () => {
    updatePromptTextarea(promptModeSelect.value);
  });

  function updatePromptTextarea(modeId) {
    const custom = currentSettings.customPrompts?.[modeId];
    systemPromptTextarea.value = custom || PROMPT_MODES[modeId]?.systemPrompt || '';
  }

  btnResetPrompt.addEventListener('click', () => {
    const modeId = promptModeSelect.value;
    systemPromptTextarea.value = PROMPT_MODES[modeId]?.systemPrompt || '';
    if (currentSettings.customPrompts) {
      delete currentSettings.customPrompts[modeId];
    }
    showToast('已恢复为默认 Prompt');
  });

  // 4. API 连通性测试
  btnTestApi.addEventListener('click', async () => {
    testResultTag.textContent = '正在测试连接...';
    testResultTag.className = 'test-tag';

    const testSettings = {
      provider: providerSelect.value,
      apiKey: apiKeyInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
      model: modelInput.value.trim(),
      temperature: Number(temperatureRange.value)
    };

    const res = await LLMClient.testConnection(testSettings);
    if (res.success) {
      testResultTag.textContent = `✓ 连通成功 (${res.duration}ms)`;
      testResultTag.classList.add('success');
    } else {
      testResultTag.textContent = `✕ ${res.message}`;
      testResultTag.classList.add('error');
    }
  });

  // 5. 术语库管理
  async function loadGlossaryTable() {
    const list = await dbInstance.getGlossaryList();
    glossaryTbody.innerHTML = '';
    if (list.length === 0) {
      glossaryTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94a3b8;">暂无术语对照</td></tr>';
      return;
    }
    list.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(item.term)}</strong></td>
        <td>${escapeHtml(item.translation)}</td>
        <td style="color:#64748b;">${escapeHtml(item.note || '-')}</td>
        <td><button class="btn-del-item" data-id="${item.id}">删除</button></td>
      `;
      tr.querySelector('.btn-del-item').addEventListener('click', async () => {
        await dbInstance.deleteGlossaryTerm(item.id);
        loadGlossaryTable();
      });
      glossaryTbody.appendChild(tr);
    });
  }

  btnAddGlossary.addEventListener('click', async () => {
    const term = glossaryTermInput.value.trim();
    const trans = glossaryTransInput.value.trim();
    const note = glossaryNoteInput.value.trim();
    if (!term || !trans) {
      alert('请填写原文术语与指定译文');
      return;
    }
    await dbInstance.addGlossaryTerm(term, trans, note);
    glossaryTermInput.value = '';
    glossaryTransInput.value = '';
    glossaryNoteInput.value = '';
    loadGlossaryTable();
  });

  // 6. 生词本管理与导出
  async function loadVocabTable() {
    const list = await dbInstance.getVocabularyList();
    vocabCount.textContent = list.length;
    vocabTbody.innerHTML = '';
    if (list.length === 0) {
      vocabTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94a3b8;">暂无收藏生词</td></tr>';
      return;
    }
    list.forEach(item => {
      const tr = document.createElement('tr');
      const timeStr = new Date(item.timestamp).toLocaleDateString();
      tr.innerHTML = `
        <td><strong>${escapeHtml(item.word)}</strong></td>
        <td>${escapeHtml(item.translation || '-')}</td>
        <td style="color:#64748b;">${timeStr}</td>
        <td><button class="btn-del-item" data-id="${item.id}">删除</button></td>
      `;
      tr.querySelector('.btn-del-item').addEventListener('click', async () => {
        await dbInstance.deleteVocabulary(item.id);
        loadVocabTable();
      });
      vocabTbody.appendChild(tr);
    });
  }

  btnExportVocabCsv.addEventListener('click', async () => {
    const list = await dbInstance.getVocabularyList();
    if (list.length === 0) {
      alert('生词本为空，暂无可导出内容');
      return;
    }
    let csv = 'Word,Translation,Context,Date\n';
    list.forEach(item => {
      csv += `"${item.word}","${item.translation}","${item.context}","${new Date(item.timestamp).toLocaleDateString()}"\n`;
    });
    downloadFile(csv, `Vocabulary-${Date.now()}.csv`, 'text/csv;charset=utf-8');
  });

  btnExportVocabJson.addEventListener('click', async () => {
    const list = await dbInstance.getVocabularyList();
    if (list.length === 0) {
      alert('生词本为空，暂无可导出内容');
      return;
    }
    downloadFile(JSON.stringify(list, null, 2), `Vocabulary-${Date.now()}.json`, 'application/json');
  });

  // 7. 保存全部设置
  btnSaveSettings.addEventListener('click', async () => {
    const curModeId = promptModeSelect.value;
    const customPrompts = currentSettings.customPrompts || {};
    if (systemPromptTextarea.value.trim()) {
      customPrompts[curModeId] = systemPromptTextarea.value.trim();
    }

    const newSettings = {
      ...currentSettings,
      provider: providerSelect.value,
      apiKey: apiKeyInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
      model: modelInput.value.trim(),
      temperature: Number(temperatureRange.value),
      targetLang: targetLangSelect.value,
      enableVideoSubtitles: enableVideoSubtitles.checked,
      enableBilingualCache: enableCache.checked,
      enableGlossary: enableGlossary.checked,
      enableSelectionBubble: enableSelectionBubble.checked,
      enableSpaceTranslate: enableSpaceTranslate.checked,
      customPrompts
    };

    await chrome.storage.sync.set({ settings: newSettings });
    currentSettings = newSettings;

    saveStatus.textContent = '✓ 设置已于 ' + new Date().toLocaleTimeString() + ' 成功保存';
    showToast('🎉 设置已成功保存并全局生效！');
  });

  // 8. 导入与导出设置
  btnExportSettings.addEventListener('click', () => {
    const jsonStr = JSON.stringify(currentSettings, null, 2);
    downloadFile(jsonStr, `LLM-Translator-Settings-${Date.now()}.json`, 'application/json');
  });

  btnImportSettings.addEventListener('click', () => importFileInput.click());
  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      currentSettings = { ...DEFAULT_SETTINGS, ...imported };
      await chrome.storage.sync.set({ settings: currentSettings });
      applySettingsToUI(currentSettings);
      showToast('配置导入成功！');
    } catch (err) {
      alert(`导入失败: ${err.message}`);
    }
  });

  function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  function showToast(msg) {
    toastBanner.textContent = msg;
    toastBanner.classList.remove('hidden');
    setTimeout(() => toastBanner.classList.add('hidden'), 2500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
});