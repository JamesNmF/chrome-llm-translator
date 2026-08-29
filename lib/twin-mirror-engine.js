/**
 * 🪟 工业级双生镜像分屏引擎 (Twin Mirror Split Engine)
 * 保持原生 DOM 零迁移、左右 50:50 独立分屏、像素级双向同轴同步滚动、原样继承样式与图片
 */

import { LLMClient } from './llm-client.js';

export class TwinMirrorEngine {
  constructor({ settings }) {
    this.settings = settings;
    this.isActive = false;
    this.rightPane = null;
    this.topBar = null;
    this.isSyncing = false;
    this.abortController = null;
    this.styleTag = null;
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

    // 1. 注入动态分屏 CSS (将左侧原网页平滑约束在 50vw，右侧留空)
    if (!this.styleTag) {
      this.styleTag = document.createElement('style');
      this.styleTag.id = 'llm-twin-mirror-styles';
      this.styleTag.textContent = `
        html.llm-twin-mode, html.llm-twin-mode body {
          width: 50vw !important;
          max-width: 50vw !important;
          margin-right: 50vw !important;
          box-sizing: border-box !important;
          border-right: 3px solid #6366f1 !important;
        }
      `;
      document.head.appendChild(this.styleTag);
    }
    document.documentElement.classList.add('llm-twin-mode');

    // 2. 创建右侧 50vw 镜像全屏面板
    this.rightPane = document.createElement('div');
    this.rightPane.id = 'llm-twin-right-mirror';
    
    // 获取当前网页背景颜色
    const bodyBg = window.getComputedStyle(document.body).backgroundColor || '#0f172a';
    const bodyColor = window.getComputedStyle(document.body).color || '#f8fafc';

    this.rightPane.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      width: 50vw !important;
      height: 100vh !important;
      overflow-y: scroll !important;
      overflow-x: hidden !important;
      z-index: 2147483630 !important;
      background-color: ${bodyBg} !important;
      color: ${bodyColor} !important;
      box-sizing: border-box !important;
      padding: 0 !important;
      margin: 0 !important;
    `;

    // 3. 复制网页主体内容到右侧镜像
    const cloneWrapper = document.createElement('div');
    cloneWrapper.className = 'llm-twin-clone-content';
    cloneWrapper.style.cssText = `
      width: 100% !important;
      box-sizing: border-box !important;
      padding: 0 !important;
    `;

    // 抓取主要可见结构
    Array.from(document.body.children).forEach(child => {
      if (child.id !== 'llm-translator-root' && 
          child.id !== 'llm-bilingual-fab' && 
          child.id !== 'llm-twin-right-mirror' &&
          child.tagName !== 'SCRIPT' &&
          child.tagName !== 'STYLE' &&
          child.tagName !== 'LINK') {
        const clonedChild = child.cloneNode(true);
        cloneWrapper.appendChild(clonedChild);
      }
    });

    this.rightPane.appendChild(cloneWrapper);
    document.body.appendChild(this.rightPane);

    // 4. 创建顶部控制条
    this.topBar = document.createElement('div');
    this.topBar.id = 'llm-twin-topbar';
    this.topBar.style.cssText = `
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
    this.topBar.innerHTML = `
      <span style="font-weight: 700; color: #818cf8; display: flex; align-items: center; gap: 4px;">
        🪟 双生镜像分屏 (同轴同步翻滚)
      </span>
      <span style="color: #10b981; font-weight: 600; font-size: 11px;">● 已同步</span>
      <button id="btn-twin-exit" style="background: #334155; border: 1px solid #475569; color: #fff; padding: 3px 8px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">
        退出分屏 ✕
      </button>
    `;
    document.body.appendChild(this.topBar);

    this.topBar.querySelector('#btn-twin-exit').addEventListener('click', () => {
      this.deactivate();
      chrome.runtime.sendMessage({ type: 'NOTIFY_VIEW_CHANGE', view: 'origin' }).catch(() => {});
    });

    // 5. 绑定同轴绝对同步滚动
    this.bindSynchronizedScroll();

    // 6. 对右侧镜像中的所有文字执行纯中文流式翻译替换
    this.translateClonePane(cloneWrapper);
  }

  /**
   * 像素级同轴双向同步滚动
   */
  bindSynchronizedScroll() {
    const syncFromWindow = () => {
      if (this.isSyncing || !this.rightPane) return;
      this.isSyncing = true;
      this.rightPane.scrollTop = window.scrollY;
      requestAnimationFrame(() => { this.isSyncing = false; });
    };

    const syncFromRightPane = () => {
      if (this.isSyncing || !this.rightPane) return;
      this.isSyncing = true;
      window.scrollTo(0, this.rightPane.scrollTop);
      requestAnimationFrame(() => { this.isSyncing = false; });
    };

    this._onWinScroll = syncFromWindow;
    this._onPaneScroll = syncFromRightPane;

    window.addEventListener('scroll', this._onWinScroll, { passive: true });
    this.rightPane.addEventListener('scroll', this._onPaneScroll, { passive: true });

    // 初始位置对齐
    this.rightPane.scrollTop = window.scrollY;
  }

  /**
   * 批量流式翻译右侧镜像中的文字
   */
  async translateClonePane(root) {
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
   * 关闭分屏
   */
  deactivate() {
    if (!this.isActive) return;
    this.isActive = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this._onWinScroll) {
      window.removeEventListener('scroll', this._onWinScroll);
    }

    document.documentElement.classList.remove('llm-twin-mode');

    if (this.rightPane) {
      this.rightPane.remove();
      this.rightPane = null;
    }

    if (this.topBar) {
      this.topBar.remove();
      this.topBar = null;
    }
  }
}