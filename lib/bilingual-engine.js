/**
 * 沉浸式双语网页翻译核心引擎 (Bilingual Translation Engine)
 * 智能识别页面段落、视口懒加载、批量并发控制、原生字体排版完美继承与双语 DOM 注入
 */

import { LLMClient } from './llm-client.js';

export class BilingualEngine {
  constructor(options = {}) {
    this.settings = options.settings || {};
    this.state = 'origin'; // 'origin' | 'dual' | 'translation'
    this.theme = this.settings.bilingualTheme || 'dashed';
    this.observer = null;
    this.pendingQueue = [];
    this.activeWorkers = 0;
    this.maxConcurrency = 3;
    this.translatedMap = new WeakMap();
    this.injectedElements = new Set();
    this.isTranslating = false;
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    if (newSettings.bilingualTheme) {
      this.setTheme(newSettings.bilingualTheme);
    }
  }

  setTheme(themeName) {
    this.theme = themeName;
    document.documentElement.setAttribute('data-llm-theme', themeName);
  }

  /**
   * 切换全网页翻译状态 (origin -> dual -> translation -> origin)
   */
  async toggleFullPage(targetState = null) {
    if (targetState) {
      this.state = targetState;
    } else {
      if (this.state === 'origin') {
        this.state = 'dual';
      } else if (this.state === 'dual') {
        this.state = 'translation';
      } else {
        this.state = 'origin';
      }
    }

    document.documentElement.setAttribute('data-llm-state', this.state);
    this.setTheme(this.theme);

    if (this.state !== 'origin') {
      await this.startPageTranslation();
    }
    return this.state;
  }

  /**
   * 检查元素是否应该被忽略
   */
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

  /**
   * 提取页面中所有有意义的文本段落节点
   */
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

  /**
   * 启动页面双语翻译流水线
   */
  async startPageTranslation() {
    if (this.isTranslating && this.pendingQueue.length > 0) return;
    this.isTranslating = true;

    const candidateNodes = this.collectTranslatableNodes();
    console.log(`[LLM-Bilingual] 发现待翻译段落: ${candidateNodes.length} 处`);

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
        rootMargin: '250px 0px' // 提前 250px 预加载，保证向下滚动时无缝展现
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

  /**
   * 并发调度器
   */
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

  /**
   * 批量段落翻译与 DOM 注入 (完美保持原网页标签层级)
   */
  async translateBatch(elements) {
    const texts = elements.map(el => el.innerText.trim());
    if (texts.length === 0) return;

    // 为元素占位注入加载骨架（动态使用与宿主完全兼容的容器）
    const wrappers = elements.map(el => {
      const isHeader = /^H[1-6]$/.test(el.tagName);
      // 如果是标题，使用同等级别的 HTML 容器标签或 div 继承
      const wrapper = document.createElement('div');
      wrapper.className = `llm-bilingual-wrapper llm-bilingual-loading ${isHeader ? 'llm-bilingual-header' : ''}`;
      wrapper.innerHTML = `<span class="llm-bilingual-inner">翻译中...</span>`;
      
      // 插入到原文段落正后方
      el.insertAdjacentElement('afterend', wrapper);
      this.injectedElements.add(wrapper);
      this.translatedMap.set(el, wrapper);
      return wrapper;
    });

    try {
      const combinedPrompt = texts.map((t, idx) => `[P${idx + 1}] ${t}`).join('\n\n');
      const targetLang = this.settings.targetLang || 'zh-CN';

      let fullResponse = '';
      await LLMClient.translateStream({
        text: combinedPrompt,
        targetLang,
        mode: 'fluent',
        settings: this.settings,
        onChunk: (chunk, acc) => {
          fullResponse = acc;
        },
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

  /**
   * 解析大模型返回的批量译文并精准分发回对应段落
   */
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