/**
 * 🪟 原生级双生镜像分屏引擎 (In-Situ Twin Mirror Split Engine)
 * 在当前真实网页中创建 50:50 独立分屏、像素级同轴同步翻滚、右侧镜像 100% 中文替换
 */

import { LLMClient } from './llm-client.js';

export class TwinMirrorEngine {
  constructor({ settings }) {
    this.settings = settings;
    this.isActive = false;
    this.overlay = null;
    this.leftPane = null;
    this.rightPane = null;
    this.resizer = null;
    this.originalNodes = [];
    this.isSyncing = false;
    this.abortController = null;
    this.splitRatio = 50;
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
  }

  /**
   * 激活双生分屏
   */
  async activate() {
    if (this.isActive) return;
    this.isActive = true;
    this.abortController = new AbortController();

    // 1. 锁定原网页滚动
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    // 2. 创建全屏独立分屏浮层
    this.overlay = document.createElement('div');
    this.overlay.id = 'llm-twin-viewport-overlay';
    
    const bodyBg = window.getComputedStyle(document.body).backgroundColor || '#0f172a';
    const bodyColor = window.getComputedStyle(document.body).color || '#f8fafc';

    this.overlay.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 2147483630 !important;
      display: flex !important;
      flex-direction: row !important;
      background-color: ${bodyBg} !important;
      color: ${bodyColor} !important;
      box-sizing: border-box !important;
      margin: 0 !important;
      padding: 0 !important;
    `;

    // 3. 左侧原网页容器
    this.leftPane = document.createElement('div');
    this.leftPane.id = 'llm-twin-pane-left';
    this.leftPane.style.cssText = `
      width: ${this.splitRatio}vw !important;
      height: 100vh !important;
      overflow-y: scroll !important;
      overflow-x: hidden !important;
      box-sizing: border-box !important;
      position: relative !important;
    `;

    // 4. 中间分割条
    this.resizer = document.createElement('div');
    this.resizer.id = 'llm-twin-pane-resizer';
    this.resizer.style.cssText = `
      width: 5px !important;
      height: 100vh !important;
      background: #6366f1 !important;
      cursor: col-resize !important;
      flex-shrink: 0 !important;
      z-index: 20 !important;
      box-shadow: 0 0 10px rgba(99, 102, 241, 0.5) !important;
    `;

    // 5. 右侧中文镜像容器
    this.rightPane = document.createElement('div');
    this.rightPane.id = 'llm-twin-pane-right';
    this.rightPane.style.cssText = `
      width: calc(100vw - ${this.splitRatio}vw - 5px) !important;
      height: 100vh !important;
      overflow-y: scroll !important;
      overflow-x: hidden !important;
      box-sizing: border-box !important;
      position: relative !important;
    `;

    // 6. 顶部悬浮控制栏
    const topBar = document.createElement('div');
    topBar.style.cssText = `
      position: fixed !important;
      top: 14px !important;
      right: 24px !important;
      z-index: 2147483645 !important;
      background: rgba(15, 23, 42, 0.92) !important;
      backdrop-filter: blur(8px) !important;
      border: 1px solid #334155 !important;
      border-radius: 20px !important;
      padding: 6px 14px !important;
      color: #f8fafc !important;
      font-size: 12px !important;
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      user-select: none !important;
    `;
    topBar.innerHTML = `
      <span style="font-weight: 700; color: #818cf8;">🪟 双生镜像分屏 (左右同步翻滚)</span>
      <span style="color: #10b981; font-weight: 600; font-size: 11px;">● 已同步</span>
      <button id="btn-twin-exit" style="background: #334155; border: 1px solid #475569; color: #fff; padding: 3px 8px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">
        退出分屏 ✕
      </button>
    `;

    // 7. 将原网页内容移入左侧，克隆移入右侧
    this.originalNodes = Array.from(document.body.childNodes).filter(node => {
      return node !== this.overlay && 
             node.id !== 'llm-translator-root' && 
             node.id !== 'llm-bilingual-fab' &&
             node.tagName !== 'SCRIPT' &&
             node.tagName !== 'STYLE';
    });

    const leftContent = document.createElement('div');
    leftContent.className = 'llm-twin-pane-content';
    this.originalNodes.forEach(node => leftContent.appendChild(node));
    this.leftPane.appendChild(leftContent);

    // 深度克隆到右侧
    const rightContent = leftContent.cloneNode(true);
    this.rightPane.appendChild(rightContent);

    this.overlay.appendChild(this.leftPane);
    this.overlay.appendChild(this.resizer);
    this.overlay.appendChild(this.rightPane);
    this.overlay.appendChild(topBar);
    document.body.appendChild(this.overlay);

    topBar.querySelector('#btn-twin-exit').addEventListener('click', () => {
      this.deactivate();
    });

    // 8. 绑定像素级同轴同步滚动
    this.bindSyncScroll();

    // 9. 绑定分屏宽度拖拽
    this.bindResizer();

    // 10. 执行右侧镜像的纯中文流式翻译替换
    this.translateCloneContent(rightContent);
  }

  /**
   * 像素级同轴双向同步滚动驱动器
   */
  bindSyncScroll() {
    const onLeftScroll = () => {
      if (this.isSyncing || !this.rightPane) return;
      this.isSyncing = true;
      this.rightPane.scrollTop = this.leftPane.scrollTop;
      this.rightPane.scrollLeft = this.leftPane.scrollLeft;
      requestAnimationFrame(() => { this.isSyncing = false; });
    };

    const onRightScroll = () => {
      if (this.isSyncing || !this.leftPane) return;
      this.isSyncing = true;
      this.leftPane.scrollTop = this.rightPane.scrollTop;
      this.leftPane.scrollLeft = this.rightPane.scrollLeft;
      requestAnimationFrame(() => { this.isSyncing = false; });
    };

    this.leftPane.addEventListener('scroll', onLeftScroll, { passive: true });
    this.rightPane.addEventListener('scroll', onRightScroll, { passive: true });
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
      this.rightPane.style.width = `calc(100vw - ${ratio}vw - 5px)`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = '';
      }
    });
  }

  /**
   * 批量翻译右侧镜像中的所有文字
   */
  async translateCloneContent(root) {
    const validTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'FIGCAPTION', 'TD', 'TH', 'DIV', 'SPAN', 'A', 'BUTTON', 'LABEL'];
    const elements = root.querySelectorAll(validTags.join(','));
    const candidates = [];

    elements.forEach(el => {
      const text = el.innerText?.trim();
      if (!text || text.length < 2 || /^[\d\s\p{P}]+$/u.test(text)) return;

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
   * 退出双生分屏并安全还原原网页 DOM
   */
  deactivate() {
    if (!this.isActive) return;
    this.isActive = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';

    if (this.leftPane) {
      const leftContent = this.leftPane.querySelector('.llm-twin-pane-content');
      if (leftContent) {
        while (leftContent.firstChild) {
          document.body.appendChild(leftContent.firstChild);
        }
      }
    }

    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}