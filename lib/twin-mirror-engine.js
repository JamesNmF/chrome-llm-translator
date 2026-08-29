/**
 * 🪟 双生镜像分屏引擎 (Twin Mirror Split-Screen Engine)
 * 实现左边 100% 原始网页，右边 100% 相同排版的中文镜像网页，两边像素级同步滚动与联动
 */

import { LLMClient } from './llm-client.js';

export class TwinMirrorEngine {
  constructor({ settings }) {
    this.settings = settings;
    this.isActive = false;
    this.container = null;
    this.leftPane = null;
    this.rightPane = null;
    this.resizer = null;
    this.originalParent = null;
    this.originalNodes = [];
    this.isSyncing = false;
    this.splitRatio = 50; // 百分比
    this.abortController = null;
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
  }

  /**
   * 启动双生镜像分屏
   */
  async activate() {
    if (this.isActive) return;
    this.isActive = true;
    this.abortController = new AbortController();

    // 1. 隐藏页面原有滚动条，创建全屏分屏容器
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    this.container = document.createElement('div');
    this.container.id = 'llm-twin-mirror-root';
    this.container.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 2147483640 !important;
      display: flex !important;
      flex-direction: row !important;
      background: inherit !important;
      box-sizing: border-box !important;
    `;

    // 2. 左侧原文面板 (50%)
    this.leftPane = document.createElement('div');
    this.leftPane.id = 'llm-twin-left';
    this.leftPane.style.cssText = `
      width: ${this.splitRatio}vw !important;
      height: 100vh !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      box-sizing: border-box !important;
      position: relative !important;
    `;

    // 3. 中间可拖拽分割条
    this.resizer = document.createElement('div');
    this.resizer.id = 'llm-twin-resizer';
    this.resizer.style.cssText = `
      width: 6px !important;
      height: 100vh !important;
      background: #4f46e5 !important;
      cursor: col-resize !important;
      flex-shrink: 0 !important;
      z-index: 20 !important;
      box-shadow: 0 0 10px rgba(79, 70, 229, 0.5) !important;
    `;

    // 4. 右侧中文镜像面板 (50%)
    this.rightPane = document.createElement('div');
    this.rightPane.id = 'llm-twin-right';
    this.rightPane.style.cssText = `
      width: calc(100vw - ${this.splitRatio}vw - 6px) !important;
      height: 100vh !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      box-sizing: border-box !important;
      position: relative !important;
    `;

    // 5. 顶部状态悬浮指示条
    const topBar = document.createElement('div');
    topBar.style.cssText = `
      position: fixed !important;
      top: 12px !important;
      right: 24px !important;
      z-index: 2147483646 !important;
      background: rgba(15, 23, 42, 0.9) !important;
      backdrop-filter: blur(8px) !important;
      border: 1px solid #334155 !important;
      border-radius: 20px !important;
      padding: 6px 16px !important;
      color: #f8fafc !important;
      font-size: 12px !important;
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
      font-family: -apple-system, sans-serif !important;
    `;
    topBar.innerHTML = `
      <span style="font-weight: 700; color: #818cf8;">🪟 双生镜像分屏 (左右同步翻滚)</span>
      <span style="color: #10b981; font-weight: 600;">● 同步中</span>
      <button id="btn-close-twin" style="background: #334155; border: none; color: #fff; padding: 2px 8px; border-radius: 10px; cursor: pointer; font-size: 11px;">退出分屏 ✕</button>
    `;

    // 6. 迁移原始 DOM 到左侧，深度克隆到右侧
    this.originalNodes = Array.from(document.body.childNodes).filter(node => {
      return node !== this.container && node.id !== 'llm-translator-root' && node.id !== 'llm-bilingual-fab';
    });

    const leftWrapper = document.createElement('div');
    leftWrapper.className = 'llm-twin-inner-wrapper';
    this.originalNodes.forEach(n => leftWrapper.appendChild(n));
    this.leftPane.appendChild(leftWrapper);

    // 深度克隆生成右侧一模一样的镜像
    const rightWrapper = leftWrapper.cloneNode(true);
    this.rightPane.appendChild(rightWrapper);

    this.container.appendChild(this.leftPane);
    this.container.appendChild(this.resizer);
    this.container.appendChild(this.rightPane);
    this.container.appendChild(topBar);
    document.body.appendChild(this.container);

    topBar.querySelector('#btn-close-twin').addEventListener('click', () => {
      this.deactivate();
    });

    // 7. 绑定左右 100% 同步滚动引擎
    this.bindSyncScroll();

    // 8. 绑定拖拽宽度调节
    this.bindResizer();

    // 9. 对右侧镜像面板中的所有文字执行纯中文就地替换翻译！
    this.translateRightMirror(rightWrapper);
  }

  /**
   * 双向像素级同步滚动引擎
   */
  bindSyncScroll() {
    const handleLeftScroll = () => {
      if (this.isSyncing) return;
      this.isSyncing = true;
      this.rightPane.scrollTop = this.leftPane.scrollTop;
      this.rightPane.scrollLeft = this.leftPane.scrollLeft;
      requestAnimationFrame(() => { this.isSyncing = false; });
    };

    const handleRightScroll = () => {
      if (this.isSyncing) return;
      this.isSyncing = true;
      this.leftPane.scrollTop = this.rightPane.scrollTop;
      this.leftPane.scrollLeft = this.rightPane.scrollLeft;
      requestAnimationFrame(() => { this.isSyncing = false; });
    };

    this.leftPane.addEventListener('scroll', handleLeftScroll, { passive: true });
    this.rightPane.addEventListener('scroll', handleRightScroll, { passive: true });
  }

  /**
   * 拖拽分屏宽度调节
   */
  bindResizer() {
    let isDragging = false;

    this.resizer.addEventListener('mousedown', () => {
      isDragging = true;
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      let ratio = (e.clientX / window.innerWidth) * 100;
      ratio = Math.max(20, Math.min(80, ratio));
      this.splitRatio = ratio;
      this.leftPane.style.width = `${ratio}vw`;
      this.rightPane.style.width = `calc(100vw - ${ratio}vw - 6px)`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = '';
      }
    });
  }

  /**
   * 翻译右侧镜像面板中的所有文字段落
   */
  async translateRightMirror(root) {
    const validTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'FIGCAPTION', 'TD', 'TH', 'DIV', 'SPAN', 'A', 'BUTTON', 'LABEL'];
    const elements = root.querySelectorAll(validTags.join(','));
    const candidates = [];

    elements.forEach(el => {
      const text = el.innerText?.trim();
      if (!text || text.length < 2 || /^[\d\s\p{P}]+$/u.test(text)) return;

      // 仅选取叶子文本块或直接包含文本的节点
      let hasDirectText = false;
      for (let node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length >= 1) {
          hasDirectText = true;
          break;
        }
      }

      if (hasDirectText || el.children.length === 0) {
        candidates.push(el);
      }
    });

    // 树形去重
    const filtered = candidates.filter(item => {
      return !candidates.some(other => other !== item && item.contains(other));
    });

    const targetLang = this.settings.targetLang || 'zh-CN';
    const total = filtered.length;
    let cursor = 0;
    const concurrency = 4;

    const worker = async () => {
      while (cursor < total && this.isActive) {
        const index = cursor++;
        const el = filtered[index];
        const originText = el.innerText?.trim();
        if (!originText) continue;

        try {
          await new Promise((resolve) => {
            LLMClient.translateStream({
              text: originText,
              targetLang,
              mode: 'fluent',
              settings: this.settings,
              signal: this.abortController.signal,
              onDone: (trans) => {
                if (el) {
                  if (el.children.length === 0) {
                    el.textContent = trans;
                  } else {
                    el.innerText = trans;
                  }
                  // 加上柔和的高亮渐变，体现已被翻译
                  el.style.transition = 'color 0.3s ease';
                }
                resolve();
              },
              onError: () => resolve()
            });
          });
        } catch (e) {}
      }
    };

    const workers = [];
    for (let w = 0; w < Math.min(concurrency, total); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }

  /**
   * 关闭双生分屏并还原所有 DOM
   */
  deactivate() {
    if (!this.isActive) return;
    this.isActive = false;
    if (this.abortController) this.abortController.abort();

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';

    if (this.leftPane) {
      const leftWrapper = this.leftPane.querySelector('.llm-twin-inner-wrapper');
      if (leftWrapper) {
        while (leftWrapper.firstChild) {
          document.body.appendChild(leftWrapper.firstChild);
        }
      }
    }

    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }
}