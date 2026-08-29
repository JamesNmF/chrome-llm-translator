/**
 * Popup 脚本：支持划词快速翻译 + 直接拖入 PDF 极速直达阅读器
 */

import { DEFAULT_SETTINGS, MODES, PROVIDERS } from '../lib/constants.js';
import { LLMClient } from '../lib/llm-client.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 元素引用
  const sourceInput = document.getElementById('source-input');
  const outputContent = document.getElementById('output-content');
  const outputStatus = document.getElementById('output-status');
  const charCount = document.getElementById('char-count');
  const sourceLangSelect = document.getElementById('source-lang-select');
  const targetLangSelect = document.getElementById('target-lang-select');
  const modesContainer = document.getElementById('modes-container');
  const currentModelTag = document.getElementById('current-model-tag');
  const popupDropOverlay = document.getElementById('popup-drop-overlay');

  const btnTranslate = document.getElementById('btn-translate');
  const btnSwapLang = document.getElementById('btn-swap-lang');
  const btnClear = document.getElementById('btn-clear');
  const btnPaste = document.getElementById('btn-paste');
  const btnCopyTarget = document.getElementById('btn-copy-target');
  const btnSpeakTarget = document.getElementById('btn-speak-target');

  const btnOpenOptions = document.getElementById('btn-open-options');
  const btnOpenPdf = document.getElementById('btn-open-pdf');
  const btnOpenEpub = document.getElementById('btn-open-epub');
  const btnHistory = document.getElementById('btn-history');
  const historyDrawer = document.getElementById('history-drawer');
  const btnCloseHistory = document.getElementById('btn-close-history');
  const btnClearHistory = document.getElementById('btn-clear-history');
  const historyList = document.getElementById('history-list');

  // 状态变量
  let currentSettings = { ...DEFAULT_SETTINGS };
  let currentMode = 'fluent';
  let activeAbortController = null;

  // 1. 初始化设置
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    currentSettings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }

  // 渲染模型标签
  const providerMeta = PROVIDERS[currentSettings.provider] || PROVIDERS.custom;
  currentModelTag.textContent = `${providerMeta.name.split(' ')[0]}: ${currentSettings.model || providerMeta.defaultModel}`;

  // 渲染模式选择药丸
  modesContainer.innerHTML = '';
  MODES.forEach(m => {
    const pill = document.createElement('button');
    pill.className = `mode-pill ${m.id === currentMode ? 'active' : ''}`;
    pill.textContent = m.name;
    pill.title = m.desc;
    pill.dataset.mode = m.id;
    pill.addEventListener('click', () => {
      document.querySelectorAll('.mode-pill').forEach(el => el.classList.remove('active'));
      pill.classList.add('active');
      currentMode = m.id;
      if (sourceInput.value.trim()) triggerTranslation();
    });
    modesContainer.appendChild(pill);
  });

  // 渲染目标语言
  const languages = [
    { code: 'zh-CN', name: '简体中文' },
    { code: 'zh-TW', name: '繁體中文' },
    { code: 'en', name: 'English' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'es', name: 'Español' },
    { code: 'ru', name: 'Русский' }
  ];

  targetLangSelect.innerHTML = '';
  languages.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.code;
    opt.textContent = l.name;
    if (l.code === (currentSettings.targetLang || 'zh-CN')) opt.selected = true;
    targetLangSelect.appendChild(opt);
  });

  // 2. ⭐️ 核心新增：在 Popup 中直接拖入 PDF 自动跳转至阅读器
  let dragCounter = 0;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (popupDropOverlay) popupDropOverlay.classList.add('active');
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0 && popupDropOverlay) {
      popupDropOverlay.classList.remove('active');
      dragCounter = 0;
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (popupDropOverlay) popupDropOverlay.classList.remove('active');

    const file = e.dataTransfer.files?.[0];
    if (file && (file.type === 'application/pdf' || file.name.endsWith('.pdf'))) {
      await transferPdfToReader(file);
    }
  });

  async function transferPdfToReader(file) {
    outputStatus.textContent = `正在加载 PDF: ${file.name}...`;
    try {
      const arrayBuffer = await file.arrayBuffer();
      // 使用 IndexedDB 存储 ArrayBuffer
      await savePdfToIndexedDB(file.name, arrayBuffer);
      // 打开 PDF 阅读器并自动加载
      chrome.tabs.create({
        url: chrome.runtime.getURL('pdf/reader.html?auto_load=1')
      });
      window.close(); // 关闭当前 popup
    } catch (err) {
      console.error('[Popup] 传输 PDF 失败:', err);
      alert(`无法打开该 PDF: ${err.message}`);
    }
  }

  function savePdfToIndexedDB(fileName, buffer) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('PdfTransferDB', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pending_files')) {
          db.createObjectStore('pending_files', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('pending_files', 'readwrite');
        const store = tx.objectStore('pending_files');
        store.put({
          id: 'current_pdf',
          name: fileName,
          data: buffer,
          timestamp: Date.now()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // 3. 自动抓取当前标签页选中的文字
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'GET_SELECTION' }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.text) {
          sourceInput.value = res.text;
          updateCharCount();
          triggerTranslation();
        }
      });
    }
  } catch (e) {}

  // 4. 输入框交互与字数统计
  sourceInput.addEventListener('input', updateCharCount);
  function updateCharCount() {
    charCount.textContent = `${sourceInput.value.length} 字`;
  }

  // 5. 翻译触发与流式响应
  btnTranslate.addEventListener('click', triggerTranslation);
  sourceInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      triggerTranslation();
    }
  });

  async function triggerTranslation() {
    const text = sourceInput.value.trim();
    if (!text) return;

    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();

    outputContent.innerHTML = '<span class="cursor"></span>';
    outputStatus.textContent = '正在翻译...';
    btnTranslate.disabled = true;

    const sourceLang = sourceLangSelect.value;
    const targetLang = targetLangSelect.value;
    const startTime = performance.now();

    try {
      await LLMClient.translateStream({
        text,
        sourceLang,
        targetLang,
        mode: currentMode,
        settings: currentSettings,
        signal: activeAbortController.signal,
        onChunk: (chunk, full) => {
          outputContent.textContent = full;
          const cursor = document.createElement('span');
          cursor.className = 'cursor';
          outputContent.appendChild(cursor);
        },
        onDone: (finalText) => {
          outputContent.textContent = finalText;
          const duration = Math.round(performance.now() - startTime);
          outputStatus.textContent = `耗时: ${duration}ms`;
          btnTranslate.disabled = false;
          saveHistory(text, finalText, sourceLang, targetLang);
        },
        onError: (err) => {
          outputContent.innerHTML = `<span style="color: #ef4444;">翻译失败: ${escapeHtml(err.message)}</span>`;
          outputStatus.textContent = '出错了';
          btnTranslate.disabled = false;
        }
      });
    } catch (e) {
      btnTranslate.disabled = false;
    }
  }

  // 6. 辅助操作
  btnOpenPdf.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pdf/reader.html') });
  });

  btnOpenEpub.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('epub/builder.html') });
  });

  btnOpenOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  btnClear.addEventListener('click', () => {
    sourceInput.value = '';
    outputContent.innerHTML = '<div class="empty-placeholder"><span>✨ 输入文本后点击“翻译”</span></div>';
    outputStatus.textContent = '就绪';
    updateCharCount();
  });

  btnPaste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        sourceInput.value = text;
        updateCharCount();
        triggerTranslation();
      }
    } catch (e) {
      alert('请允许剪贴板访问权限');
    }
  });

  btnCopyTarget.addEventListener('click', () => {
    const text = outputContent.textContent;
    if (text) {
      navigator.clipboard.writeText(text);
      const orig = btnCopyTarget.textContent;
      btnCopyTarget.textContent = '✓ 已复制';
      setTimeout(() => btnCopyTarget.textContent = orig, 1200);
    }
  });

  btnSpeakTarget.addEventListener('click', () => {
    const text = outputContent.textContent;
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = targetLangSelect.value;
    speechSynthesis.speak(utterance);
  });

  btnSwapLang.addEventListener('click', () => {
    const s = sourceLangSelect.value;
    const t = targetLangSelect.value;
    if (s === 'auto') return;
    sourceLangSelect.value = t;
    targetLangSelect.value = s;
    const curSource = sourceInput.value;
    const curTarget = outputContent.textContent;
    if (curTarget && !curTarget.includes('输入文本后点击')) {
      sourceInput.value = curTarget;
      updateCharCount();
      triggerTranslation();
    }
  });

  // 7. 历史记录管理
  async function saveHistory(source, target, sLang, tLang) {
    const rec = {
      id: Date.now(),
      source,
      target,
      sLang,
      tLang,
      time: new Date().toLocaleTimeString()
    };
    const stored = await chrome.storage.local.get('history');
    const list = stored.history || [];
    list.unshift(rec);
    if (list.length > 50) list.pop();
    await chrome.storage.local.set({ history: list });
  }

  btnHistory.addEventListener('click', async () => {
    historyDrawer.classList.add('open');
    await loadHistoryList();
  });

  btnCloseHistory.addEventListener('click', () => {
    historyDrawer.classList.remove('open');
  });

  btnClearHistory.addEventListener('click', async () => {
    await chrome.storage.local.set({ history: [] });
    await loadHistoryList();
  });

  async function loadHistoryList() {
    const stored = await chrome.storage.local.get('history');
    const list = stored.history || [];
    historyList.innerHTML = '';
    if (list.length === 0) {
      historyList.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 24px;">暂无历史记录</div>';
      return;
    }
    list.forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div class="history-item-top">
          <span>${item.sLang} → ${item.tLang}</span>
          <span>${item.time}</span>
        </div>
        <div class="history-item-source">${escapeHtml(item.source)}</div>
        <div class="history-item-target">${escapeHtml(item.target)}</div>
      `;
      div.addEventListener('click', () => {
        sourceInput.value = item.source;
        outputContent.textContent = item.target;
        historyDrawer.classList.remove('open');
        updateCharCount();
      });
      historyList.appendChild(div);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
});