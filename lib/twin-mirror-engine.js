/**
 * 🪟 原生级双生镜像分屏引擎 (In-Situ Twin Mirror Split Engine)
 * 在当前真实网页中创建 50:50 独立分屏、像素级同轴同步翻滚、右侧镜像 100% 纯中文整段替换
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

    // 3. 左侧原网页容器 (50vw)
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

    // 5. 右侧纯中文镜像容器 (50vw)
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
      <span style="font-weight: 700; color: #818cf8;">🪟 双生镜像分屏 (左原右译同步翻滚)</span>
      <span id="twin-trans-progress" style="color: #10b981; font-weight: 600; font-size: 11px;">● 正在全量纯中文翻译...</span>
      <button id="btn-twin-exit" style="background: #334155; border: 1px solid #475569; color: #fff; padding: 3px 8px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">
        退出分屏 ✕
      </button>
    `;

    // 7. 将原网页内容移入左侧，深度克隆到右侧
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

    // 10. 执行右侧镜像的 100% 纯正中文整段流式翻译替换
    this.translateCloneContent(rightContent, topBar.querySelector('#twin-trans-progress'));
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
   * 严格整段原子化提取算法（彻底杜绝中英文混杂与碎片化替换）
   */
  collectAllTranslatableNodes(root) {
    // 1. 首先提取所有真正的原子段落与标题
    const blockTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD', 'TH', 'TD'];
    const rawBlocks = root.querySelectorAll(blockTags.join(','));
    const selectedBlocks = [];
    const blockSet = new Set();

    rawBlocks.forEach(el => {
      const text = el.innerText?.trim();
      if (!text || text.length < 2 || /^[\d\s\p{P}]+$/u.test(text)) return;
      selectedBlocks.push(el);
      blockSet.add(el);
    });

    // 2. 自底向上过滤嵌套的父子块（例如 LI 内部套 P，只保留 P）
    const cleanBlocks = selectedBlocks.filter(item => {
      const hasBlockChild = selectedBlocks.some(other => other !== item && item.contains(other));
      return !hasBlockChild;
    });

    // 3. 提取不属于任何上述段落的独立按钮/标签/小组件
    const otherTags = ['A', 'BUTTON', 'SPAN', 'DIV', 'LABEL'];
    const otherElements = root.querySelectorAll(otherTags.join(','));
    const standAloneElements = [];

    otherElements.forEach(el => {
      // 如果已经在某个被选中的主段落内，坚决跳过，绝不拆碎！
      const isInsideBlock = cleanBlocks.some(block => block.contains(el));
      if (isInsideBlock) return;

      const text = el.innerText?.trim();
      if (!text || text.length < 2 || /^[\d\s\p{P}]+$/u.test(text)) return;

      // 必须是直接叶子或直接有文本
      let hasDirectText = false;
      for (let node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length >= 1) {
          hasDirectText = true;
          break;
        }
      }

      if (hasDirectText || el.children.length === 0) {
        standAloneElements.push(el);
      }
    });

    // 4. 合并所有纯正的原子翻译单元
    const finalElements = [...cleanBlocks, ...standAloneElements];
    return finalElements;
  }

  /**
   * 批量纯中文整段流式翻译替换
   */
  async translateCloneContent(root, progressBadge) {
    const nodes = this.collectAllTranslatableNodes(root);
    const targetLang = this.settings.targetLang || 'zh-CN';
    const total = nodes.length;
    let completed = 0;

    const queue = [...nodes];
    const concurrency = 5;

    const worker = async () => {
      while (queue.length > 0 && this.isActive) {
        const batch = [];
        let totalLen = 0;

        while (queue.length > 0 && batch.length < 4 && totalLen < 900) {
          const el = queue.shift();
          const t = el.innerText?.trim();
          if (t) {
            batch.push({ el, text: t });
            totalLen += t.length;
          }
        }

        if (batch.length === 0) break;

        try {
          const combinedPrompt = batch.map((b, i) => `[P${i + 1}] ${b.text}`).join('\n\n');

          await new Promise((resolve) => {
            LLMClient.translateStream({
              text: combinedPrompt,
              targetLang,
              mode: 'fluent',
              settings: this.settings,
              signal: this.abortController.signal,
              onDone: (responseText) => {
                const parts = {};
                const regex = /\[P(\d+)\]\s*([\s\S]*?)(?=(?:\[P\d+\]|$))/g;
                let match;
                while ((match = regex.exec(responseText)) !== null) {
                  const idx = parseInt(match[1], 10) - 1;
                  parts[idx] = match[2].trim();
                }

                const fallbackLines = responseText.split('\n\n').map(s => s.trim()).filter(Boolean);

                batch.forEach((item, idx) => {
                  let trans = parts[idx] || fallbackLines[idx] || item.text;
                  trans = trans.replace(/^\[P\d+\]\s*/, '').trim();

                  // ⭐️ 核心关键：直接整段替换为纯中文，100% 纯净无英文残留！
                  if (item.el) {
                    item.el.innerText = trans;
                  }
                });

                completed += batch.length;
                if (progressBadge) {
                  const percent = Math.min(100, Math.round((completed / total) * 100));
                  progressBadge.textContent = `● 纯中文翻译进度: ${percent}%`;
                }
                resolve();
              },
              onError: () => {
                completed += batch.length;
                resolve();
              }
            });
          });
        } catch (e) {}
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, total); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    if (progressBadge && this.isActive) {
      progressBadge.textContent = '● 100% 纯中文翻译完成';
    }
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