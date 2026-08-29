/**
 * 沉浸式网页双语对照引擎 (工业级防重复、正文智能识别与事件无损保留)
 */

import { LLMClient } from './llm-client.js';

export class BilingualEngine {
  constructor({ settings }) {
    this.settings = settings;
    this.state = 'origin'; // 'origin' | 'dual' | 'translation'
    this.translatedMap = new Map(); // el => { originText, transText, wrapper }
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
    this.state = viewMode;
    document.documentElement.setAttribute('data-llm-state', viewMode);

    if (viewMode === 'origin') {
      this.translatedMap.forEach((record, el) => {
        if (record.originText) {
          this.applyTextToElement(el, record.originText);
        }
        if (record.wrapper) {
          record.wrapper.style.display = 'none';
        }
      });
      return 'origin';
    }

    if (viewMode === 'translation') {
      this.translatedMap.forEach((record, el) => {
        if (record.transText) {
          this.applyTextToElement(el, record.transText);
        }
        if (record.wrapper) {
          record.wrapper.style.display = 'none';
        }
      });
    } else if (viewMode === 'dual') {
      this.translatedMap.forEach((record, el) => {
        if (record.originText) {
          this.applyTextToElement(el, record.originText);
        }
        if (record.wrapper) {
          record.wrapper.style.display = 'block';
        }
      });
    }

    await this.startPageTranslation();
    return viewMode;
  }

  applyTextToElement(el, newText) {
    if (!el || !document.body.contains(el)) return;
    if (el.children.length === 0) {
      el.textContent = newText;
    } else {
      el.innerText = newText;
    }
  }

  /**
   * 忽略导航栏、页眉页脚、工具条与非正文区域
   */
  isIgnoredElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    const tagName = el.tagName.toUpperCase();
    
    // 1. 严格忽略代码、表单、多媒体与容器
    const ignoredTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'PRE', 'CODE', 'SVG', 'CANVAS', 'MATH', 'IFRAME', 'ARTICLE', 'SECTION', 'ASIDE', 'MAIN', 'NAV', 'HEADER', 'FOOTER', 'BODY', 'HTML'];
    if (ignoredTags.includes(tagName)) return true;

    if (el.isContentEditable) return true;
    if (el.getAttribute('translate') === 'no' || el.classList.contains('notranslate')) return true;
    if (el.classList.contains('llm-bilingual-wrapper') || el.closest('#llm-translator-root')) return true;

    // 2. 忽略顶部导航栏与菜单容器 (防止菜单按钮被乱翻重叠)
    if (el.closest('nav, header, footer, [role="navigation"], [role="menubar"], .navbar, .nav, .site-header, .site-footer, .global-nav, .menu-container, .toolbar')) {
      return true;
    }

    return false;
  }

  /**
   * 智能提取网页段落并执行严格的“父子互斥去重”
   */
  collectTranslatableNodes(root = document.body) {
    // 仅抓取真正的原子文本块级标签
    const validTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGCAPTION', 'LI', 'DD', 'DT'];
    const rawElements = root.querySelectorAll(validTags.join(','));
    const candidates = [];

    rawElements.forEach(el => {
      if (this.isIgnoredElement(el)) return;
      if (this.translatedMap.has(el)) return;

      const text = el.innerText?.trim();
      // 过滤过短字符、纯数字或标点
      if (!text || text.length < 3 || /^[\d\s\p{P}]+$/u.test(text)) return;

      candidates.push(el);
    });

    // ⭐️ 核心算法：自底向上剔除任何“包含其他候选子节点”的父节点，确保每个词语仅被翻译一次！
    const filteredNodes = candidates.filter(parent => {
      const hasChildInCandidates = candidates.some(child => child !== parent && parent.contains(child));
      return !hasChildInCandidates; // 如果它是大父容器，坚决丢弃；只保留最深层真实子段落！
    });

    return filteredNodes;
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

      while (this.pendingQueue.length > 0 && batch.length < 4 && totalLength < 800) {
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
    const records = [];

    elements.forEach(el => {
      const originText = el.innerText.trim();
      if (!originText) return;

      const isHeader = /^H[1-6]$/.test(el.tagName);
      const wrapper = document.createElement('div');
      wrapper.className = `llm-bilingual-wrapper llm-bilingual-loading ${isHeader ? 'llm-bilingual-header' : ''}`;
      wrapper.innerHTML = `<span class="llm-bilingual-inner">翻译中...</span>`;
      wrapper.style.display = this.state === 'translation' ? 'none' : 'block';

      el.insertAdjacentElement('afterend', wrapper);
      this.injectedElements.add(wrapper);

      const record = { el, originText, transText: '', wrapper };
      this.translatedMap.set(el, record);
      records.push(record);
    });

    if (records.length === 0) return;

    try {
      const combinedPrompt = records.map((r, idx) => `[P${idx + 1}] ${r.originText}`).join('\n\n');
      const targetLang = this.settings.targetLang || 'zh-CN';

      await LLMClient.translateStream({
        text: combinedPrompt,
        targetLang,
        mode: 'fluent',
        settings: this.settings,
        onDone: (finalText) => {
          this.distributeTranslations(records, finalText);
        },
        onError: (err) => {
          records.forEach(r => {
            if (r.wrapper) {
              r.wrapper.classList.remove('llm-bilingual-loading');
              r.wrapper.classList.add('llm-bilingual-error');
              r.wrapper.innerHTML = `<span class="llm-bilingual-inner">⚠️ 翻译失败: ${err.message}</span>`;
            }
          });
        }
      });
    } catch (e) {
      console.warn('[LLM-Bilingual] 批量请求异常:', e);
    }
  }

  distributeTranslations(records, responseText) {
    const parts = {};
    const regex = /\[P(\d+)\]\s*([\s\S]*?)(?=(?:\[P\d+\]|$))/g;
    let match;
    while ((match = regex.exec(responseText)) !== null) {
      const idx = parseInt(match[1], 10) - 1;
      parts[idx] = match[2].trim();
    }

    const fallbackLines = responseText.split('\n\n').map(s => s.trim()).filter(Boolean);

    records.forEach((record, i) => {
      let trans = parts[i] || fallbackLines[i] || responseText;
      trans = trans.replace(/^\[P\d+\]\s*/, '').trim();
      record.transText = trans;

      if (record.wrapper) {
        record.wrapper.classList.remove('llm-bilingual-loading');
        record.wrapper.innerHTML = `<span class="llm-bilingual-inner">${this.escapeHtml(trans)}</span>`;
      }

      if (this.state === 'translation') {
        this.applyTextToElement(record.el, trans);
        if (record.wrapper) record.wrapper.style.display = 'none';
      }
    });
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  clearAllInjected() {
    this.translatedMap.forEach((record, el) => {
      if (record.originText) {
        this.applyTextToElement(el, record.originText);
      }
      if (record.wrapper) {
        record.wrapper.remove();
      }
    });
    this.translatedMap.clear();
    this.injectedElements.clear();
    this.pendingQueue = [];
    this.state = 'origin';
    document.documentElement.removeAttribute('data-llm-state');
  }
}