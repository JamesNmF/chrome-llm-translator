/**
 * 沉浸式网页双语对照引擎 (全覆盖无遗漏、工业级防重复、支持 SPA 动态加载与事件保留)
 */

import { LLMClient } from './llm-client.js';

export class BilingualEngine {
  constructor({ settings }) {
    this.settings = settings;
    this.state = 'origin'; // 'origin' | 'dual' | 'translation'
    this.translatedMap = new Map(); // el => { originText, transText, wrapper }
    this.injectedElements = new Set();
    this.observer = null;
    this.mutationObserver = null;
    this.pendingQueue = [];
    this.isTranslating = false;
    this.activeWorkers = 0;
    this.maxConcurrency = 4;
    this.mutationDebounceTimer = null;
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
      this.disconnectMutationObserver();
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

    // 启动初始扫描与动态监听
    this.initMutationObserver();
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

  isIgnoredElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    const tagName = el.tagName.toUpperCase();

    // 严格忽略脚本、样式、输入框与容器
    const ignoredTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'PRE', 'CODE', 'SVG', 'CANVAS', 'MATH', 'IFRAME', 'BODY', 'HTML'];
    if (ignoredTags.includes(tagName)) return true;

    if (el.isContentEditable) return true;
    if (el.getAttribute('translate') === 'no' || el.classList.contains('notranslate')) return true;
    if (el.classList.contains('llm-bilingual-wrapper') || el.closest('#llm-translator-root')) return true;

    // 忽略主站点全局极顶导航（避免破坏 logo 与全站主菜单）
    if (el.closest('nav, [role="navigation"], .navbar, .global-nav, .site-header, .top-nav')) {
      return true;
    }

    return false;
  }

  /**
   * 智能提取网页所有可见正文、标题、卡片、列表与标签
   */
  collectTranslatableNodes(root = document.body) {
    const validTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGCAPTION', 'LI', 'DD', 'DT', 'TD', 'TH', 'DIV', 'SPAN', 'A', 'LABEL', 'BUTTON', 'B', 'STRONG'];
    const rawElements = root.querySelectorAll(validTags.join(','));
    const candidates = [];

    rawElements.forEach(el => {
      if (this.isIgnoredElement(el)) return;
      if (this.translatedMap.has(el)) return;

      const text = el.innerText?.trim();
      // 过滤空、纯数字、纯标点
      if (!text || text.length < 2 || /^[\d\s\p{P}]+$/u.test(text)) return;

      // 检查直接包含的文本内容
      let hasDirectText = false;
      for (let node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length >= 1) {
          hasDirectText = true;
          break;
        }
      }

      // 如果有直接文本，或者子节点是行内标签且数量较少（如一个带粗体的标题），加入候选
      const childElements = Array.from(el.children);
      const isLeafOrInlineBlock = childElements.length === 0 || childElements.every(c => ['SPAN', 'A', 'B', 'STRONG', 'EM', 'I', 'SMALL'].includes(c.tagName));

      if (hasDirectText || isLeafOrInlineBlock) {
        candidates.push(el);
      }
    });

    // ⭐️ 核心树形排他算法：如果父节点是整体段落/标题，保留父节点；如果父节点是大容器，保留具体子标签
    const filteredNodes = candidates.filter(item => {
      // 1. 如果自己内部包含其他候选节点，且自己不是 P / H1-H6，则舍弃自己，保留更具体的子项
      const containsOtherCandidates = candidates.some(other => other !== item && item.contains(other));
      if (containsOtherCandidates && !/^H[1-6]$|^P$/.test(item.tagName)) {
        return false;
      }

      // 2. 如果自己的祖先是已选中的 P / H1-H6 标题段落，则子项不重复收集
      const ancestorIsParagraph = candidates.some(other => other !== item && other.contains(item) && /^H[1-6]$|^P$/.test(other.tagName));
      if (ancestorIsParagraph) {
        return false;
      }

      return true;
    });

    return filteredNodes;
  }

  /**
   * 启动视口加载
   */
  async startPageTranslation() {
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
        rootMargin: '300px 0px' // 提前 300px 预热加载
      });
    }

    candidateNodes.forEach(el => {
      this.observer.observe(el);
    });

    this.processQueue();
  }

  /**
   * 监听 SPA 页面动态加载与 DOM 变化
   */
  initMutationObserver() {
    if (this.mutationObserver) return;

    this.mutationObserver = new MutationObserver(() => {
      if (this.state === 'origin') return;

      clearTimeout(this.mutationDebounceTimer);
      this.mutationDebounceTimer = setTimeout(() => {
        this.startPageTranslation();
      }, 200);
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  disconnectMutationObserver() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
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

      while (this.pendingQueue.length > 0 && batch.length < 5 && totalLength < 1000) {
        const item = this.pendingQueue.shift();
        if (item && !this.translatedMap.has(item) && document.body.contains(item)) {
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
    this.disconnectMutationObserver();
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