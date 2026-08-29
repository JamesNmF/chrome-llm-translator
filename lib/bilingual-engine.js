/**
 * 沉浸式网页双语对照引擎 (工业级物理防死锁、防循环自激、全覆盖与事件无损保留)
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
    this.maxConcurrency = 3;
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
    if (el.classList.contains('llm-bilingual-wrapper') || el.closest('#llm-translator-root') || el.closest('.llm-bilingual-wrapper')) return true;

    // 忽略主站点全局极顶导航（避免破坏 logo 与全站主菜单）
    if (el.closest('nav, [role="navigation"], .navbar, .global-nav, .site-header, .top-nav')) {
      return true;
    }

    return false;
  }

  /**
   * 智能提取网页所有可见正文、标题、卡片、列表与标签（物理级 DOM 锁）
   */
  collectTranslatableNodes(root = document.body) {
    const validTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGCAPTION', 'LI', 'DD', 'DT', 'TD', 'TH', 'DIV', 'SPAN', 'A', 'LABEL', 'BUTTON', 'B', 'STRONG'];
    const rawElements = root.querySelectorAll(validTags.join(','));
    const candidates = [];

    rawElements.forEach(el => {
      // ⭐️ 物理防线 1：如果已被处理过或已打上数据锁，直接物理跳过！
      if (el.hasAttribute('data-llm-processed')) return;
      if (this.isIgnoredElement(el)) return;
      if (this.translatedMap.has(el)) return;

      const text = el.innerText?.trim();
      if (!text || text.length < 2 || /^[\d\s\p{P}]+$/u.test(text)) return;

      let hasDirectText = false;
      for (let node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length >= 1) {
          hasDirectText = true;
          break;
        }
      }

      const childElements = Array.from(el.children);
      const isLeafOrInlineBlock = childElements.length === 0 || childElements.every(c => ['SPAN', 'A', 'B', 'STRONG', 'EM', 'I', 'SMALL'].includes(c.tagName));

      if (hasDirectText || isLeafOrInlineBlock) {
        candidates.push(el);
      }
    });

    // 树形去重：大容器保留子项，标题段落保留整体
    const filteredNodes = candidates.filter(item => {
      const containsOtherCandidates = candidates.some(other => other !== item && item.contains(other));
      if (containsOtherCandidates && !/^H[1-6]$|^P$/.test(item.tagName)) {
        return false;
      }

      const ancestorIsParagraph = candidates.some(other => other !== item && other.contains(item) && /^H[1-6]$|^P$/.test(other.tagName));
      if (ancestorIsParagraph) {
        return false;
      }

      return true;
    });

    // ⭐️ 物理防线 2：立刻打上物理 DOM 锁，防止后续被再次捕获
    filteredNodes.forEach(el => {
      el.setAttribute('data-llm-processed', '1');
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
        rootMargin: '300px 0px'
      });
    }

    candidateNodes.forEach(el => {
      this.observer.observe(el);
    });

    this.processQueue();
  }

  /**
   * 监听 SPA 页面动态加载 (带严格的自身事件屏蔽，防止自激死循环)
   */
  initMutationObserver() {
    if (this.mutationObserver) return;

    this.mutationObserver = new MutationObserver((mutations) => {
      if (this.state === 'origin') return;

      // ⭐️ 物理防线 3：检查新增的节点中是否有非插件的真实业务元素！
      let hasRealBusinessNodes = false;
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (!node.classList.contains('llm-bilingual-wrapper') && 
                  !node.closest('.llm-bilingual-wrapper') && 
                  node.id !== 'llm-translator-root' &&
                  !node.hasAttribute('data-llm-processed')) {
                hasRealBusinessNodes = true;
                break;
              }
            }
          }
        }
        if (hasRealBusinessNodes) break;
      }

      // 如果全部是插件自身插入的 wrapper，绝对不触发重新扫描！
      if (!hasRealBusinessNodes) return;

      clearTimeout(this.mutationDebounceTimer);
      this.mutationDebounceTimer = setTimeout(() => {
        this.startPageTranslation();
      }, 300);
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

      // ⭐️ 物理防线 4：若已有同级 wrapper，严禁重复插入！
      let wrapper = el.nextElementSibling;
      if (!wrapper || !wrapper.classList.contains('llm-bilingual-wrapper')) {
        const isHeader = /^H[1-6]$/.test(el.tagName);
        wrapper = document.createElement('div');
        wrapper.className = `llm-bilingual-wrapper llm-bilingual-loading ${isHeader ? 'llm-bilingual-header' : ''}`;
        wrapper.innerHTML = `<span class="llm-bilingual-inner">翻译中...</span>`;
        wrapper.style.display = this.state === 'translation' ? 'none' : 'block';

        el.insertAdjacentElement('afterend', wrapper);
        this.injectedElements.add(wrapper);
      }

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
      el.removeAttribute('data-llm-processed');
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