/**
 * 沉浸式网页双语对照引擎 (DOM 遍历、视口观察者、批量队列与多模式切换)
 */

import { LLMClient } from './llm-client.js';

export class BilingualEngine {
  constructor({ settings }) {
    this.settings = settings;
    this.state = 'origin'; // 'origin' | 'dual' | 'translation'
    this.translatedMap = new WeakMap();
    this.injectedElements = new Set();
    this.observer = null;
    this.pendingQueue = [];
    this.isTranslating = false;
    this.activeWorkers = 0;
    this.maxConcurrency = 3;
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
  }

  /**
   * 切换全网页双语状态 (三态循环: origin -> dual -> translation -> origin)
   */
  async toggleFullPage() {
    if (this.state === 'origin') {
      return this.setViewState('dual');
    } else if (this.state === 'dual') {
      return this.setViewState('translation');
    } else {
      return this.setViewState('origin');
    }
  }

  /**
   * 精确设置视图模式 (origin / dual / translation)
   */
  async setViewState(viewMode) {
    if (viewMode === 'origin') {
      this.clearAllInjected();
      this.state = 'origin';
      document.documentElement.removeAttribute('data-llm-state');
      return 'origin';
    }

    this.state = viewMode;
    document.documentElement.setAttribute('data-llm-state', viewMode);
    await this.startPageTranslation();
    return viewMode;
  }

  isIgnoredElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    const tagName = el.tagName.toUpperCase();
    const ignoredTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'PRE', 'CODE', 'SVG', 'CANVAS', 'MATH', 'IFRAME', 'NAV', 'FOOTER', 'BUTTON'];
    if (ignoredTags.includes(tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute('translate') === 'no' || el.classList.contains('notranslate')) return true;
    if (el.classList.contains('llm-bilingual-wrapper') || el.closest('#llm-translator-root')) return true;
    return false;
  }

  collectTranslatableNodes(root = document.body) {
    const nodes = [];
    const validTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'ARTICLE', 'SECTION', 'DD', 'DT', 'FIGCAPTION', 'TD', 'TH'];

    const elements = root.querySelectorAll(validTags.join(','));
    elements.forEach(el => {
      if (this.isIgnoredElement(el)) return;
      if (this.translatedMap.has(el)) return;

      const text = el.innerText?.trim();
      if (!text || text.length < 2 || /^[\d\s\p{P}]+$/u.test(text)) return;

      nodes.push(el);
    });

    return nodes;
  }

  async startPageTranslation() {
    if (this.isTranslating && this.pendingQueue.length > 0) return;
    this.isTranslating = true;

    const candidateNodes = this.collectTranslatableNodes();

    if (!this.observer) {
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const el = entry.target;
            this.observer.unobserve(el);
            this.enqueueElement(el);
          }
        });
      }, {
        rootMargin: '250px 0px'
      });
    }

    candidateNodes.forEach(el => {
      this.observer.observe(el);
    });

    this.processQueue();
  }

  enqueueElement(el) {
    if (this.translatedMap.has(el)) return;
    this.pendingQueue.push(el);
    this.processQueue();
  }

  async processQueue() {
    while (this.activeWorkers < this.maxConcurrency && this.pendingQueue.length > 0) {
      const batch = [];
      let totalLength = 0;

      while (this.pendingQueue.length > 0 && batch.length < 3 && totalLength < 600) {
        const item = this.pendingQueue.shift();
        if (item && !this.translatedMap.has(item)) {
          batch.push(item);
          totalLength += item.innerText.length;
        }
      }

      if (batch.length === 0) break;

      this.activeWorkers++;
      this.translateBatch(batch).finally(() => {
        this.activeWorkers--;
        this.processQueue();
      });
    }
  }

  async translateBatch(elements) {
    const texts = elements.map(el => el.innerText.trim());
    if (texts.length === 0) return;

    const wrappers = elements.map(el => {
      const isHeader = /^H[1-6]$/.test(el.tagName);
      const wrapper = document.createElement('div');
      wrapper.className = `llm-bilingual-wrapper llm-bilingual-loading ${isHeader ? 'llm-bilingual-header' : ''}`;
      wrapper.innerHTML = `<span class="llm-bilingual-inner">翻译中...</span>`;
      
      el.insertAdjacentElement('afterend', wrapper);
      this.injectedElements.add(wrapper);
      this.translatedMap.set(el, wrapper);
      return wrapper;
    });

    try {
      const combinedPrompt = texts.map((t, idx) => `[P${idx + 1}] ${t}`).join('\n\n');
      const targetLang = this.settings.targetLang || 'zh-CN';

      await LLMClient.translateStream({
        text: combinedPrompt,
        targetLang,
        mode: 'fluent',
        settings: this.settings,
        onDone: (finalText) => {
          this.distributeTranslations(elements, wrappers, finalText);
        },
        onError: (err) => {
          wrappers.forEach(w => {
            w.classList.remove('llm-bilingual-loading');
            w.classList.add('llm-bilingual-error');
            w.innerHTML = `<span class="llm-bilingual-inner">⚠️ 翻译失败: ${err.message}</span>`;
          });
        }
      });
    } catch (e) {
      console.warn('[LLM-Bilingual] 批量请求异常:', e);
    }
  }

  distributeTranslations(elements, wrappers, responseText) {
    const parts = {};
    const regex = /\[P(\d+)\]\s*([\s\S]*?)(?=(?:\[P\d+\]|$))/g;
    let match;
    while ((match = regex.exec(responseText)) !== null) {
      const idx = parseInt(match[1], 10) - 1;
      parts[idx] = match[2].trim();
    }

    const fallbackLines = responseText.split('\n\n').map(s => s.trim()).filter(Boolean);

    elements.forEach((el, i) => {
      const wrapper = wrappers[i];
      if (!wrapper) return;

      let trans = parts[i] || fallbackLines[i] || responseText;
      trans = trans.replace(/^\[P\d+\]\s*/, '');

      wrapper.classList.remove('llm-bilingual-loading');
      wrapper.innerHTML = `<span class="llm-bilingual-inner">${this.escapeHtml(trans)}</span>`;
    });
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  clearAllInjected() {
    this.injectedElements.forEach(el => el.remove());
    this.injectedElements.clear();
    this.translatedMap = new WeakMap();
    this.pendingQueue = [];
    this.state = 'origin';
    document.documentElement.removeAttribute('data-llm-state');
  }
}