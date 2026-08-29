/**
 * Content Script (全面集成划词翻译 + 沉浸式全网页双语对照 + 输入框翻译增强)
 */

(async () => {
  // 动态导入模块
  const { DEFAULT_SETTINGS, LANGUAGES, PROMPT_MODES, PROVIDERS } = await import(chrome.runtime.getURL('lib/constants.js'));
  const { LLMClient } = await import(chrome.runtime.getURL('lib/llm-client.js'));
  const { BilingualEngine } = await import(chrome.runtime.getURL('lib/bilingual-engine.js'));
  const { TwinMirrorEngine } = await import(chrome.runtime.getURL('lib/twin-mirror-engine.js'));

  let currentSettings = { ...DEFAULT_SETTINGS };
  let currentAbortController = null;
  let isPinned = false;
  let activeSelectedText = '';
  let activeTranslation = '';

  // 初始化双语引擎与双生分屏引擎
  const bilingualEngine = new BilingualEngine({
    settings: currentSettings,
    onUpdate: () => {
      if (isSplitOpen) renderSplitCards();
    }
  });
  const twinMirrorEngine = new TwinMirrorEngine({ settings: currentSettings });

  // 读取初始配置
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    currentSettings = { ...DEFAULT_SETTINGS, ...stored.settings };
    bilingualEngine.updateSettings(currentSettings);
    twinMirrorEngine.updateSettings(currentSettings);
  }

  // 注入双语对照全局样式
  const bilingualStyleLink = document.createElement('link');
  bilingualStyleLink.rel = 'stylesheet';
  bilingualStyleLink.href = chrome.runtime.getURL('content/bilingual.css');
  document.head.appendChild(bilingualStyleLink);

  // 监听配置实时更新
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      currentSettings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
      bilingualEngine.updateSettings(currentSettings);
      twinMirrorEngine.updateSettings(currentSettings);
      updateFloatBallVisibility();
    }
  });

  // 创建 Shadow DOM 宿主容器 (隔离划词悬浮窗)
  const hostEl = document.createElement('div');
  hostEl.id = 'llm-translator-root';
  document.documentElement.appendChild(hostEl);
  const shadowRoot = hostEl.attachShadow({ mode: 'open' });

  // 注入划词悬浮窗 CSS
  const styleEl = document.createElement('style');
  try {
    const cssUrl = chrome.runtime.getURL('content/content.css');
    const res = await fetch(cssUrl);
    styleEl.textContent = await res.text();
  } catch (e) {
    console.warn('[LLM-Translator] 加载 content.css 失败:', e);
  }
  shadowRoot.appendChild(styleEl);

  let triggerBtn = null;
  let cardModal = null;
  let floatBallEl = null;

  // ==========================================
  // 1. 网页右下角沉浸式悬浮球 (Float Ball)
  // ==========================================
  function createFloatBall() {
    if (floatBallEl) return;
    floatBallEl = document.createElement('div');
    floatBallEl.id = 'llm-bilingual-fab';
    floatBallEl.title = '点击切换全网页沉浸式双语对照 (快捷键 Alt+A)';
    floatBallEl.innerHTML = `<span>译</span>`;

    floatBallEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      const state = await bilingualEngine.toggleFullPage();
      floatBallEl.classList.toggle('active', state !== 'origin');
      showToast(state === 'dual' ? '已开启双语对照' : state === 'translation' ? '已切换为仅译文' : '已恢复原文');
    });

    document.body.appendChild(floatBallEl);
  }

  function updateFloatBallVisibility() {
    if (currentSettings.showFloatBall !== false) {
      if (!floatBallEl && document.body) createFloatBall();
      if (floatBallEl) floatBallEl.style.display = 'flex';
    } else {
      if (floatBallEl) floatBallEl.style.display = 'none';
    }
  }

  if (document.body) {
    updateFloatBallVisibility();
  } else {
    document.addEventListener('DOMContentLoaded', updateFloatBallVisibility);
  }

  // ==========================================
  // 2. 输入框智能增强 (连按3次空格自动翻译)
  // ==========================================
  let spacePressTimestamps = [];
  document.addEventListener('keydown', async (e) => {
    if (!currentSettings.enableInputEnhance) return;
    const target = e.target;
    const isInput = target && (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type === 'text') || target.isContentEditable);
    if (!isInput) return;

    // 监听连续三次空格
    if (e.key === ' ' || e.code === 'Space') {
      const now = Date.now();
      spacePressTimestamps.push(now);
      if (spacePressTimestamps.length > 3) spacePressTimestamps.shift();

      if (spacePressTimestamps.length === 3 && (now - spacePressTimestamps[0] < 900)) {
        spacePressTimestamps = [];
        const rawText = target.isContentEditable ? target.innerText : target.value;
        const textToTranslate = rawText?.trim();
        if (!textToTranslate) return;

        showToast('正在大模型翻译输入框内容...');
        const targetLang = currentSettings.inputTargetLang || 'en';

        try {
          await LLMClient.translateStream({
            text: textToTranslate,
            targetLang,
            mode: 'fluent',
            settings: currentSettings,
            onDone: (translated) => {
              if (target.isContentEditable) {
                target.innerText = translated;
              } else {
                target.value = translated;
              }
              target.dispatchEvent(new Event('input', { bubbles: true }));
              showToast('✅ 输入框翻译替换成功');
            },
            onError: (err) => {
              showToast(`输入框翻译失败: ${err.message}`);
            }
          });
        } catch (err) {}
      }
    } else {
      // 按其他键清空空格计时
      if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt') {
        spacePressTimestamps = [];
      }
    }
  });

  // ==========================================
  // 3. 🪟 网页真·左右分屏阅读器系统 (Split Screen Dual View)
  // ==========================================
  let splitPaneEl = null;
  let isSplitOpen = false;
  let splitWidthVw = 45;
  let isSyncScrollEnabled = true;
  let isSyncing = false;

  function initSplitPane() {
    if (splitPaneEl) return;

    splitPaneEl = document.createElement('div');
    splitPaneEl.className = 'llm-split-pane';
    splitPaneEl.style.width = `${splitWidthVw}vw`;
    splitPaneEl.innerHTML = `
      <div class="llm-split-resizer" id="split-resizer" title="左右拖拽调节分屏宽度"></div>
      <div class="llm-split-header">
        <div class="llm-split-title-group">
          <span class="llm-split-title">🪟 左右分屏对照</span>
          <span class="llm-split-sync-badge" id="split-sync-btn" title="点击开启/关闭左右同步滚动" style="cursor: pointer;">
            🔗 同步滚动: 开
          </span>
        </div>
        <div class="llm-split-actions">
          <button class="llm-split-btn" id="split-copy-all" title="复制右侧全部中文译文">📋 复制全文</button>
          <button class="llm-split-close" id="split-close-btn" title="关闭分屏">✕</button>
        </div>
      </div>
      <div class="llm-split-body" id="split-body">
        <div style="text-align: center; color: #94a3b8; padding: 40px 0;">
          正在同步提取并流式翻译当前页面内容...
        </div>
      </div>
    `;

    shadowRoot.appendChild(splitPaneEl);

    // 绑定关闭按钮
    const btnClose = splitPaneEl.querySelector('#split-close-btn');
    btnClose.addEventListener('click', () => {
      closeSplitPane();
      bilingualEngine.setViewState('origin');
      showToast('📄 已退出分屏模式');
    });

    // 绑定同步滚动开关
    const btnSync = splitPaneEl.querySelector('#split-sync-btn');
    btnSync.addEventListener('click', () => {
      isSyncScrollEnabled = !isSyncScrollEnabled;
      btnSync.textContent = isSyncScrollEnabled ? '🔗 同步滚动: 开' : '⛓️ 同步滚动: 关';
      btnSync.style.color = isSyncScrollEnabled ? '#10b981' : '#94a3b8';
    });

    // 绑定复制全文
    const btnCopyAll = splitPaneEl.querySelector('#split-copy-all');
    btnCopyAll.addEventListener('click', () => {
      const texts = [];
      const cards = splitPaneEl.querySelectorAll('.llm-split-trans-text');
      cards.forEach(c => {
        const t = c.textContent.trim();
        if (t && !t.includes('翻译中') && !t.includes('正在扫描')) texts.push(t);
      });
      if (texts.length > 0) {
        navigator.clipboard.writeText(texts.join('\n\n'));
        showToast('已复制分屏全部译文到剪贴板');
      }
    });

    // 绑定拖拽调节宽度
    const resizer = splitPaneEl.querySelector('#split-resizer');
    let isDragging = false;

    resizer.addEventListener('mousedown', () => {
      isDragging = true;
      resizer.classList.add('dragging');
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const newWidthPx = window.innerWidth - e.clientX;
      let newWidthVw = (newWidthPx / window.innerWidth) * 100;
      newWidthVw = Math.max(25, Math.min(75, newWidthVw));
      splitWidthVw = newWidthVw;
      splitPaneEl.style.width = `${newWidthVw}vw`;
      if (isSplitOpen) {
        document.documentElement.style.marginRight = `${newWidthVw}vw`;
        document.documentElement.style.width = `calc(100vw - ${newWidthVw}vw)`;
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizer.classList.remove('dragging');
        document.body.style.userSelect = '';
      }
    });

    // 绑定双向同步滚动
    const splitBody = splitPaneEl.querySelector('#split-body');

    window.addEventListener('scroll', () => {
      if (!isSplitOpen || !isSyncScrollEnabled || isSyncing) return;
      isSyncing = true;
      const maxWinScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxWinScroll > 0) {
        const ratio = window.scrollY / maxWinScroll;
        const maxBodyScroll = splitBody.scrollHeight - splitBody.clientHeight;
        splitBody.scrollTop = ratio * maxBodyScroll;
      }
      setTimeout(() => { isSyncing = false; }, 40);
    });

    splitBody.addEventListener('scroll', () => {
      if (!isSplitOpen || !isSyncScrollEnabled || isSyncing) return;
      isSyncing = true;
      const maxBodyScroll = splitBody.scrollHeight - splitBody.clientHeight;
      if (maxBodyScroll > 0) {
        const ratio = splitBody.scrollTop / maxBodyScroll;
        const maxWinScroll = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: ratio * maxWinScroll, behavior: 'auto' });
      }
      setTimeout(() => { isSyncing = false; }, 40);
    });
  }

  function openSplitPane() {
    initSplitPane();
    isSplitOpen = true;
    splitPaneEl.classList.add('open');

    // 网页平滑收缩到左半屏，100% 原始排版、按钮完好
    document.documentElement.style.transition = 'margin-right 0.3s cubic-bezier(0.16, 1, 0.3, 1), width 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    document.documentElement.style.marginRight = `${splitWidthVw}vw`;
    document.documentElement.style.width = `calc(100vw - ${splitWidthVw}vw)`;
    document.documentElement.style.overflowX = 'hidden';

    renderSplitCards();
  }

  function closeSplitPane() {
    if (!splitPaneEl) return;
    isSplitOpen = false;
    splitPaneEl.classList.remove('open');
    document.documentElement.style.marginRight = '';
    document.documentElement.style.width = '';
    document.documentElement.style.overflowX = '';
  }

  function renderSplitCards() {
    if (!splitPaneEl) return;
    const splitBody = splitPaneEl.querySelector('#split-body');
    if (!splitBody) return;

    if (bilingualEngine.translatedMap.size === 0) {
      splitBody.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 40px 0;">正在扫描并翻译页面文字...</div>';
      return;
    }

    splitBody.innerHTML = '';
    let cardIdx = 0;
    bilingualEngine.translatedMap.forEach((record, el) => {
      const card = document.createElement('div');
      card.className = 'llm-split-card';
      card.id = `split-card-${cardIdx++}`;
      card.innerHTML = `
        <div class="llm-split-card-header">
          <span>${el.tagName}</span>
          <span>点击对齐原文</span>
        </div>
        <div class="llm-split-origin-hint">${escapeHtml(record.originText)}</div>
        <div class="llm-split-trans-text ${record.transText ? '' : 'translating'}">${escapeHtml(record.transText || '正在翻译中...')}</div>
      `;

      card.addEventListener('click', () => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.querySelectorAll('.llm-focus-target').forEach(e => e.classList.remove('llm-focus-target'));
        el.classList.add('llm-focus-target');
        setTimeout(() => el.classList.remove('llm-focus-target'), 2000);
      });

      card.addEventListener('mouseenter', () => {
        el.classList.add('llm-focus-target');
      });
      card.addEventListener('mouseleave', () => {
        el.classList.remove('llm-focus-target');
      });

      splitBody.appendChild(card);
    });
  }

  // ==========================================
  // 4. 划词翻译与悬浮卡片 (Shadow DOM)
  // ==========================================
  function removeTriggerBtn() {
    if (triggerBtn) {
      triggerBtn.remove();
      triggerBtn = null;
    }
  }

  function removeCardModal() {
    if (cardModal && !isPinned) {
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }
      cardModal.remove();
      cardModal = null;
    }
  }

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'llm-toast';
    toast.textContent = msg;
    shadowRoot.appendChild(toast);
    setTimeout(() => toast.remove(), 1800);
  }

  function renderMarkdown(md) {
    if (!md) return '';
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/### (.*?)\n/g, '<h3>$1</h3>')
      .replace(/## (.*?)\n/g, '<h3>$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^\s*-\s+(.*)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    return '<p>' + html + '</p>';
  }

  function speakText(text, langCode = 'auto') {
    if (!('speechSynthesis' in window)) {
      showToast('当前浏览器不支持语音朗读');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const hasChinese = /[\u4e00-\u9fa5]/.test(text);
    utterance.lang = langCode === 'auto' ? (hasChinese ? 'zh-CN' : 'en-US') : langCode;
    window.speechSynthesis.speak(utterance);
  }

  function showTriggerButton(x, y, text) {
    removeTriggerBtn();
    activeSelectedText = text;

    triggerBtn = document.createElement('div');
    triggerBtn.className = 'llm-trigger-btn';
    triggerBtn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
      </svg>
    `;
    triggerBtn.style.left = `${Math.min(x + 8, window.innerWidth - 45)}px`;
    triggerBtn.style.top = `${Math.max(y - 35, 10)}px`;

    triggerBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });

    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCardAndTranslate(x, y, activeSelectedText);
    });

    shadowRoot.appendChild(triggerBtn);
  }

  function openCardAndTranslate(x, y, text, preferredMode = null) {
    removeTriggerBtn();
    removeCardModal();

    activeSelectedText = text;
    const mode = preferredMode || currentSettings.defaultMode || 'fluent';
    
    // 智能语种双向互译：如果划选内容是中文且默认目标语言是中文，则自动切换为英文 (en)；外文默认翻译为中文 (zh-CN)
    const hasChinese = /[\u4e00-\u9fa5]/.test(text);
    let targetLang = currentSettings.targetLang || 'zh-CN';
    if (hasChinese && (targetLang === 'zh-CN' || targetLang === 'zh-TW')) {
      targetLang = 'en';
    } else if (!hasChinese && (targetLang === 'en' || !targetLang)) {
      targetLang = 'zh-CN';
    }

    cardModal = document.createElement('div');
    cardModal.className = 'llm-card';

    const cardWidth = 380;
    const cardHeight = 280;
    let safeLeft = x + 10;
    let safeTop = y + 15;

    if (safeLeft + cardWidth > window.innerWidth - 16) {
      safeLeft = Math.max(16, window.innerWidth - cardWidth - 16);
    }
    if (safeTop + cardHeight > window.innerHeight - 16) {
      safeTop = Math.max(16, y - cardHeight - 15);
    }

    cardModal.style.left = `${safeLeft}px`;
    cardModal.style.top = `${safeTop}px`;

    const modeOptions = Object.values(PROMPT_MODES).map(m => 
      `<option value="${m.id}" ${m.id === mode ? 'selected' : ''}>${m.icon || '✨'} ${m.name}</option>`
    ).join('');

    const langOptions = LANGUAGES.map(l => 
      `<option value="${l.code}" ${l.code === targetLang ? 'selected' : ''}>${l.name}</option>`
    ).join('');

    cardModal.innerHTML = `
      <div class="llm-header" id="llm-drag-handle">
        <div class="llm-header-left">
          <span class="llm-badge">🤖 ${PROVIDERS[currentSettings.provider]?.name || 'LLM'}</span>
        </div>
        <div class="llm-header-actions">
          <button class="llm-icon-btn" id="llm-btn-retry" title="重新翻译">🔄</button>
          <button class="llm-icon-btn ${isPinned ? 'active' : ''}" id="llm-btn-pin" title="固定窗口">📌</button>
          <button class="llm-icon-btn" id="llm-btn-close" title="关闭">✕</button>
        </div>
      </div>

      <div class="llm-controls">
        <div class="llm-select-group">
          <select class="llm-select" id="llm-select-mode">
            ${modeOptions}
          </select>
          <select class="llm-select" id="llm-select-lang">
            ${langOptions}
          </select>
        </div>
        <div class="llm-select-group">
          <button class="llm-icon-btn" id="llm-btn-speak-source" title="朗读原文">🔊 原文</button>
        </div>
      </div>

      <div class="llm-source-box">
        ${escapeHtml(text.slice(0, 160))}${text.length > 160 ? '...' : ''}
      </div>

      <div class="llm-content-body" id="llm-output-area">
        <div class="llm-loading-bar">
          <div class="llm-spinner"></div>
          <span>AI 思考与流式翻译中...</span>
        </div>
      </div>

      <div class="llm-footer">
        <div class="llm-footer-left" id="llm-footer-status">就绪</div>
        <div class="llm-footer-actions">
          <button class="llm-action-btn" id="llm-btn-speak-target">🔊 朗读</button>
          <button class="llm-action-btn primary" id="llm-btn-copy">📋 复制</button>
        </div>
      </div>
    `;

    shadowRoot.appendChild(cardModal);
    setupCardEvents(cardModal, text);
    executeTranslation(text, targetLang, mode, false);
  }

  function setupCardEvents(card, sourceText) {
    const btnClose = card.querySelector('#llm-btn-close');
    const btnPin = card.querySelector('#llm-btn-pin');
    const btnRetry = card.querySelector('#llm-btn-retry');
    const selectMode = card.querySelector('#llm-select-mode');
    const selectLang = card.querySelector('#llm-select-lang');
    const btnCopy = card.querySelector('#llm-btn-copy');
    const btnSpeakTarget = card.querySelector('#llm-btn-speak-target');
    const btnSpeakSource = card.querySelector('#llm-btn-speak-source');
    const dragHandle = card.querySelector('#llm-drag-handle');

    btnRetry.addEventListener('click', (e) => {
      e.stopPropagation();
      executeTranslation(sourceText, selectLang.value, selectMode.value, true);
    });

    btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      isPinned = false;
      removeCardModal();
    });

    btnPin.addEventListener('click', (e) => {
      e.stopPropagation();
      isPinned = !isPinned;
      btnPin.classList.toggle('active', isPinned);
      showToast(isPinned ? '已固定悬浮窗' : '已取消固定');
    });

    selectMode.addEventListener('change', () => {
      executeTranslation(sourceText, selectLang.value, selectMode.value, false);
    });

    selectLang.addEventListener('change', () => {
      executeTranslation(sourceText, selectLang.value, selectMode.value, false);
    });

    btnCopy.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!activeTranslation) return;
      try {
        await navigator.clipboard.writeText(activeTranslation);
        showToast('✅ 已复制到剪贴板');
      } catch (err) {
        showToast('复制失败');
      }
    });

    btnSpeakTarget.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeTranslation) speakText(activeTranslation, selectLang.value);
    });

    btnSpeakSource.addEventListener('click', (e) => {
      e.stopPropagation();
      speakText(sourceText, 'auto');
    });

    setupDraggable(card, dragHandle);
  }

  function setupDraggable(element, handle) {
    let startX = 0, startY = 0, initX = 0, initY = 0;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button') || e.target.closest('select')) return;
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect();
      initX = rect.left;
      initY = rect.top;

      const onMouseMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        element.style.left = `${Math.max(10, Math.min(window.innerWidth - element.offsetWidth - 10, initX + deltaX))}px`;
        element.style.top = `${Math.max(10, Math.min(window.innerHeight - element.offsetHeight - 10, initY + deltaY))}px`;
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  async function executeTranslation(text, targetLang, mode, forceRefresh = false) {
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();

    const outputArea = cardModal?.querySelector('#llm-output-area');
    const statusEl = cardModal?.querySelector('#llm-footer-status');
    if (!outputArea) return;

    outputArea.innerHTML = `
      <div class="llm-loading-bar">
        <div class="llm-spinner"></div>
        <span>正在调用 ${PROVIDERS[currentSettings.provider]?.name || '大模型'} 流式推理...</span>
      </div>
    `;
    if (statusEl) statusEl.textContent = '翻译中...';

    activeTranslation = '';
    const startTime = performance.now();

    await LLMClient.translateStream({
      text,
      targetLang,
      mode,
      settings: currentSettings,
      forceRefresh,
      signal: currentAbortController.signal,
      onChunk: (chunk, fullText) => {
        activeTranslation = fullText;
        outputArea.innerHTML = renderMarkdown(fullText) + '<span class="llm-cursor"></span>';
        outputArea.scrollTop = outputArea.scrollHeight;
      },
      onDone: (fullText) => {
        activeTranslation = fullText;
        outputArea.innerHTML = renderMarkdown(fullText);
        const duration = Math.round(performance.now() - startTime);
        if (statusEl) statusEl.textContent = `耗时 ${duration}ms`;

        if (currentSettings.autoPronounce) {
          speakText(fullText, targetLang);
        }
      },
      onError: (err) => {
        outputArea.innerHTML = `
          <div class="llm-error-box">
            <strong>⚠️ 翻译出错:</strong><br>
            ${escapeHtml(err.message)}
          </div>
        `;
        if (statusEl) statusEl.textContent = '请求失败';
      }
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 划词监听：鼠标划词后仅显示小浮标图标，用户点击浮标才弹出翻译卡片
  document.addEventListener('mouseup', (e) => {
    if (e.composedPath().includes(hostEl)) return;
    if (currentSettings.enableSelectionBubble === false) return;

    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : '';

    if (!text || text.length < 1) {
      if (!isPinned) removeTriggerBtn();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const clientX = rect.right + window.scrollX;
    const clientY = rect.top + window.scrollY;

    // 默认展示优雅的翻译小浮标，用户点击后才触发翻译
    showTriggerButton(clientX, clientY, text);
  });

  document.addEventListener('mousedown', (e) => {
    if (e.composedPath().includes(hostEl)) return;
    if (!isPinned) {
      removeTriggerBtn();
      removeCardModal();
    }
  });

  // 监听指令
  chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.type === 'TRIGGER_TRANSLATE_SELECTION' && request.text) {
      const selection = window.getSelection();
      let x = window.innerWidth / 2 - 180;
      let y = window.innerHeight / 2 - 100;
      if (selection && selection.rangeCount > 0) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        x = rect.right + window.scrollX;
        y = rect.bottom + window.scrollY;
      }
      openCardAndTranslate(x, y, request.text);
      sendResponse({ received: true });
    } else if (request.type === 'TRIGGER_HOTKEY_TRANSLATE') {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';
      if (text) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        openCardAndTranslate(rect.right + window.scrollX, rect.bottom + window.scrollY, text);
      } else {
        showToast('请先鼠标划选要翻译的文本');
      }
      sendResponse({ received: true });
    } else if (request.type === 'TOGGLE_BILINGUAL_PAGE') {
      // 快捷键 Alt+A 切换全网页双语对照 (四态循环: 原文 -> 上下对照 -> 双生分屏 -> 仅看译文 -> 原文)
      let cur = bilingualEngine.state;
      if (twinMirrorEngine.isActive) cur = 'side_by_side';

      let nextState = 'dual';
      if (cur === 'origin') nextState = 'dual';
      else if (cur === 'dual') nextState = 'side_by_side';
      else if (cur === 'side_by_side') nextState = 'translation';
      else nextState = 'origin';

      if (nextState === 'side_by_side') {
        bilingualEngine.setViewState('origin');
        twinMirrorEngine.activate();
      } else {
        twinMirrorEngine.deactivate();
        await bilingualEngine.setViewState(nextState);
      }

      if (floatBallEl) floatBallEl.classList.toggle('active', nextState !== 'origin');
      showToast(nextState === 'dual' ? '🌐 已开启上下双语对照' : nextState === 'side_by_side' ? '🪟 已开启双生镜像分屏 (左右同步翻滚)' : nextState === 'translation' ? '✨ 已切换为仅显示译文' : '📄 已还原网页原文');
      sendResponse({ state: nextState });
    } else if (request.type === 'SET_BILINGUAL_PAGE_VIEW') {
      // 从 Popup 菜单中直接选择：显示原文 / 上下对照 / 左右分栏 / 仅看译文
      const targetView = request.view;
      if (targetView === 'side_by_side') {
        bilingualEngine.setViewState('origin');
        twinMirrorEngine.activate();
      } else {
        twinMirrorEngine.deactivate();
        await bilingualEngine.setViewState(targetView);
      }

      if (floatBallEl) floatBallEl.classList.toggle('active', targetView !== 'origin');
      showToast(targetView === 'dual' ? '🌐 已开启上下双语对照' : targetView === 'side_by_side' ? '🪟 已开启双生镜像分屏 (左右同步翻滚)' : targetView === 'translation' ? '✨ 已切换为仅显示译文' : '📄 已还原网页原文');
      sendResponse({ state: targetView });
    }
  });

  // ==========================================
  // 6. YouTube / 网页视频原生字幕：全量预拉取 + 零延迟预翻译 + 拒绝占位
  // ==========================================
  function initVideoSubtitleObserver() {
    let lastCaptionText = '';
    let subAbortCtrl = null;
    let debounceTimer = null;
    const subtitleMemCache = new Map();
    let isPrefetching = false;

    // 🚀 核心 1：自动预先拉取接下来整段视频的字幕并后台预翻译 (Lookahead Pre-translation)
    async function tryPreloadFullVideoCaptions() {
      if (isPrefetching || !window.location.hostname.includes('youtube.com')) return;
      
      const videoId = new URLSearchParams(window.location.search).get('v');
      if (!videoId) return;

      isPrefetching = true;
      try {
        // 尝试从当前 YouTube 页面拉取原生字幕轨
        const resp = await fetch(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.events && data.events.length > 0) {
            const rawSubs = data.events
              .filter(e => e.segs && e.segs.length > 0)
              .map(e => e.segs.map(s => s.utf8).join('').trim())
              .filter(t => t.length >= 2 && !/^[\d\s\p{P}]+$/u.test(t));

            // 将所有字幕提前打包送给大模型后台静默批量预翻译
            batchPreTranslateSubtitles(rawSubs);
          }
        }
      } catch (err) {
        // 降级使用实时视口探针
      }
    }

    async function batchPreTranslateSubtitles(subList) {
      const uniqueSubs = Array.from(new Set(subList)).filter(s => !subtitleMemCache.has(s));
      const targetLang = currentSettings.targetLang || 'zh-CN';

      let cursor = 0;
      const batchSize = 15;

      while (cursor < uniqueSubs.length && cursor < 120) { // 预先翻译前 120 句 (覆盖 5~10 分钟)
        const batch = uniqueSubs.slice(cursor, cursor + batchSize);
        cursor += batchSize;

        const combinedPrompt = batch.map((text, i) => `[S${i + 1}] ${text}`).join('\n\n');
        try {
          await new Promise((resolve) => {
            LLMClient.translateStream({
              text: combinedPrompt,
              targetLang,
              mode: 'fluent',
              settings: currentSettings,
              onDone: (responseText) => {
                const regex = /\[S(\d+)\]\s*([\s\S]*?)(?=(?:\[S\d+\]|$))/g;
                let match;
                while ((match = regex.exec(responseText)) !== null) {
                  const idx = parseInt(match[1], 10) - 1;
                  if (batch[idx]) {
                    subtitleMemCache.set(batch[idx], match[2].trim());
                  }
                }
                resolve();
              },
              onError: () => resolve()
            });
          });
        } catch (e) {}
      }
    }

    // 页面 URL 改变时重新预拉取字幕
    window.addEventListener('yt-navigate-finish', () => {
      isPrefetching = false;
      setTimeout(tryPreloadFullVideoCaptions, 1000);
    });
    setTimeout(tryPreloadFullVideoCaptions, 1500);

    // 🚀 核心 2：原生字幕实时捕获与零延迟平滑渲染 (绝不展示“正在翻译”)
    const captionObserver = new MutationObserver(() => {
      if (currentSettings.enableVideoSubtitles === false) return;

      const segments = document.querySelectorAll('.ytp-caption-segment');
      if (!segments || segments.length === 0) return;

      let rawText = '';
      segments.forEach(seg => {
        if (!seg.classList.contains('llm-injected')) {
          rawText += seg.textContent + ' ';
        }
      });
      const fullText = rawText.trim();
      if (!fullText || fullText.length < 2 || fullText === lastCaptionText) return;

      const mainSegment = segments[0];
      mainSegment.classList.add('llm-injected');

      for (let i = 1; i < segments.length; i++) {
        segments[i].style.display = 'none';
      }

      // 1. 如果已预翻译命中：0.00ms 纯零延迟瞬间呈现！
      if (subtitleMemCache.has(fullText)) {
        lastCaptionText = fullText;
        const cachedTrans = subtitleMemCache.get(fullText);
        mainSegment.innerHTML = `
          <div class="llm-yt-sub-wrapper">
            <div class="llm-yt-zh-text">${escapeHtml(cachedTrans)}</div>
            <div class="llm-yt-en-text">${escapeHtml(fullText)}</div>
          </div>
        `;
        return;
      }

      // 2. 如果未命中预翻译：先干净显示原文，绝对不显示“正在翻译...”！
      mainSegment.innerHTML = `
        <div class="llm-yt-sub-wrapper">
          <div class="llm-yt-en-text" style="font-size: 1.15em; font-weight: 600;">${escapeHtml(fullText)}</div>
        </div>
      `;

      if (debounceTimer) clearTimeout(debounceTimer);

      const isSentenceEnd = /[.?!，。？！]\s*$/.test(fullText);
      const delay = isSentenceEnd ? 50 : 150;

      debounceTimer = setTimeout(() => {
        lastCaptionText = fullText;

        if (subAbortCtrl) subAbortCtrl.abort();
        subAbortCtrl = new AbortController();

        LLMClient.translateStream({
          text: fullText,
          targetLang: currentSettings.targetLang || 'zh-CN',
          mode: 'fluent',
          settings: currentSettings,
          signal: subAbortCtrl.signal,
          onChunk: (chunk, trans) => {
            // 流式翻译到达时，平滑注入中文大字，优雅过渡
            mainSegment.innerHTML = `
              <div class="llm-yt-sub-wrapper">
                <div class="llm-yt-zh-text">${escapeHtml(trans)}</div>
                <div class="llm-yt-en-text">${escapeHtml(fullText)}</div>
              </div>
            `;
          },
          onDone: (trans) => {
            mainSegment.innerHTML = `
              <div class="llm-yt-sub-wrapper">
                <div class="llm-yt-zh-text">${escapeHtml(trans)}</div>
                <div class="llm-yt-en-text">${escapeHtml(fullText)}</div>
              </div>
            `;
            subtitleMemCache.set(fullText, trans);
          },
          onError: () => {
            // 失败时保持原文
            mainSegment.innerHTML = `
              <div class="llm-yt-sub-wrapper">
                <div class="llm-yt-en-text">${escapeHtml(fullText)}</div>
              </div>
            `;
          }
        });
      }, delay);
    });

    captionObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  initVideoSubtitleObserver();

})();