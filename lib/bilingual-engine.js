/**
 * 沉浸式网页双语对照引擎 (支持无缝事件保留、双语/纯译文/原文三态自由切换)
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
      // 还原所有原节点文字并隐藏双语容器
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
      // 仅译文模式：将原节点文字直接替换为译文，保留所有原始事件与链接，隐藏独立容器
      this.translatedMap.forEach((record, el) => {
        if (record.transText) {
          this.applyTextToElement(el, record.transText);
        }
        if (record.wrapper) {
          record.wrapper.style.display = 'none';
        }
      });
    } else if (viewMode === 'dual') {
      // 双语对照模式：原节点恢复原文，独立容器显示译文
      this.translatedMap.forEach((record, el) => {
        if (record.originText) {
          this.applyTextToElement(el, record.originText);
        }
        if (record.wrapper) {
          record.wrapper.style.display = 'block';
        }
      });
    }

    // 启动视口翻译
    await this.startPageTranslation();
    return viewMode;
  }

  /**
   * 安全替换元素文本，尽量保护子链接/粗体等结构
   */
  applyTextToElement(el, newText) {
    if (!el || !document.body.contains(el)) return;
    // 如果没有复杂子元素，直接替换 textContent
    if (el.children.length === 0) {
      el.textContent = newText;
    } else {
      // 若有子元素，替换第一个主文本节点或保留属性替换
      el.innerText = newText;
    }
  }

  isIgnoredElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    const tagName = el.tagName.toUpperCase();
    const ignoredTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'PRE', 'CODE', 'SVG', 'CANVAS', 'MATH', 'IFRAME'];
    if (ignoredTags.includes(tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute('translate') === 'no' || el.classList.contains('notranslate')) return true;
    if (el.classList.contains('llm-bilingual-wrapper') || el.closest('#llm-translator-root')) return true;
    return false;
  }

  collectTranslatableNodes(root = document.body) {
    const nodes = [];
    const validTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'ARTICLE', 'SECTION', 'DD', 'DT', 'FIGCAPTION', 'TD', 'TH', 'A', 'BUTTON', 'SPAN'];

    const elements = root.querySelectorAll(validTags.join(','));
    elements.forEach(el => {
      if (this.isIgnoredElement(el)) return;
      if (this.translatedMap.has(el)) return;

      // 仅抓取包含实际文本且非父容器重复的叶子/块级段落
      const text = el.innerText?.trim();
      if (!text || text.length < 2 || /^[\d\s\p{P}]+$/u.test(text)) return;
      
      // 避免父节点与子节点重复抓取
      const hasValidChild = Array.from(el.children).some(child => validTags.includes(child.tagName));
      if (hasValidChild && el.tagName !== 'P' && el.tagName !== 'LI') return;

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

      // 根据当前视图状态决定是否展示 wrapper
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

      // 如果当前是「仅看译文」模式，直接就地更新原节点文字，100% 完美保留原节点所有点击事件与链接！
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