/**
 * 🪟 工业级双生镜像分屏引擎 (In-Situ Twin Mirror Split Engine)
 * 支持三维对齐模式自由切换：
 * 1. 🎯 锚点相对速率插值对齐 (Anchor-based Piecewise Interpolation)
 * 2. 📐 物理等高水平对齐 (Ghost Spacer Height Equalization)
 * 3. ⚡ 线性等比滚动 (Linear Proportional)
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
    
    // 对齐模式: 'anchor' (锚点相对插值) | 'spacer' (物理等高) | 'linear' (线性比例)
    this.alignMode = 'anchor';
    this.anchorPairs = []; // [{ leftEl, rightEl, leftTop, rightTop }]
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
      gap: 12px !important;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      user-select: none !important;
    `;
    topBar.innerHTML = `
      <span style="font-weight: 700; color: #818cf8;">🪟 双生分屏</span>
      
      <div style="display: flex; align-items: center; gap: 4px;">
        <span style="color: #94a3b8; font-size: 11px;">对齐模式:</span>
        <select id="twin-align-select" style="background: #1e293b; border: 1px solid #475569; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; outline: none; cursor: pointer;">
          <option value="anchor" selected>🎯 智能锚点插值 (推荐)</option>
          <option value="spacer">📐 物理等高对齐 (绝对平齐)</option>
          <option value="linear">⚡ 线性等比滚动</option>
        </select>
      </div>

      <span id="twin-trans-progress" style="color: #10b981; font-weight: 600; font-size: 11px;">● 正在全量纯中文翻译...</span>
      
      <button id="btn-twin-exit" style="background: #334155; border: 1px solid #475569; color: #fff; padding: 3px 8px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">
        退出 ✕
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

    // 监听模式切换
    const alignSelect = topBar.querySelector('#twin-align-select');
    alignSelect.addEventListener('change', (e) => {
      this.alignMode = e.target.value;
      this.recalculateAlignment();
    });

    topBar.querySelector('#btn-twin-exit').addEventListener('click', () => {
      this.deactivate();
    });

    // 8. 建立左右节点锚点索引库
    this.buildAnchorMap(leftContent, rightContent);

    // 9. 绑定高阶智能对齐同步滚动驱动器
    this.bindAdaptiveSyncScroll();

    // 10. 绑定分屏宽度拖拽
    this.bindResizer();

    // 11. 执行右侧镜像的 100% 纯正中文整段流式翻译替换
    await this.translateCloneContent(rightContent, topBar.querySelector('#twin-trans-progress'));

    // 翻译完成后刷新锚点坐标
    this.recalculateAlignment();
  }

  /**
   * 建立左右双生节点的锚点映射
   */
  buildAnchorMap(leftRoot, rightRoot) {
    const leftElements = this.collectAllTranslatableNodes(leftRoot);
    const rightElements = this.collectAllTranslatableNodes(rightRoot);

    this.anchorPairs = [];
    const count = Math.min(leftElements.length, rightElements.length);

    for (let i = 0; i < count; i++) {
      const leftEl = leftElements[i];
      const rightEl = rightElements[i];

      leftEl.setAttribute('data-llm-anchor-id', i);
      rightEl.setAttribute('data-llm-anchor-id', i);

      this.anchorPairs.push({
        idx: i,
        leftEl,
        rightEl,
        leftTop: 0,
        rightTop: 0,
        leftHeight: 0,
        rightHeight: 0
      });
    }

    this.updateAnchorCoordinates();
  }

  /**
   * 重新计算所有锚点绝对坐标
   */
  updateAnchorCoordinates() {
    if (!this.leftPane || !this.rightPane) return;
    const leftScrollTop = this.leftPane.scrollTop;
    const rightScrollTop = this.rightPane.scrollTop;
    const leftRect = this.leftPane.getBoundingClientRect();
    const rightRect = this.rightPane.getBoundingClientRect();

    this.anchorPairs.forEach(pair => {
      const lR = pair.leftEl.getBoundingClientRect();
      const rR = pair.rightEl.getBoundingClientRect();

      pair.leftTop = lR.top - leftRect.top + leftScrollTop;
      pair.rightTop = rR.top - rightRect.top + rightScrollTop;
      pair.leftHeight = lR.height;
      pair.rightHeight = rR.height;
    });

    // 排序确保单调递增
    this.anchorPairs.sort((a, b) => a.leftTop - b.leftTop);
  }

  /**
   * 重新应用选定的对齐模式
   */
  recalculateAlignment() {
    this.updateAnchorCoordinates();

    if (this.alignMode === 'spacer') {
      // 📐 模式二：物理等高水平对齐
      this.anchorPairs.forEach(pair => {
        const maxH = Math.max(pair.leftHeight, pair.rightHeight);
        pair.leftEl.style.minHeight = `${maxH}px`;
        pair.rightEl.style.minHeight = `${maxH}px`;
      });
    } else {
      // 清除物理垫高样式
      this.anchorPairs.forEach(pair => {
        pair.leftEl.style.minHeight = '';
        pair.rightEl.style.minHeight = '';
      });
    }

    this.updateAnchorCoordinates();
  }

  /**
   * 自适应智能同步滚动驱动引擎 (含锚点插值、物理等高与线性比例)
   */
  bindAdaptiveSyncScroll() {
    const handleScroll = (sourcePane, targetPane, isFromLeft) => {
      if (this.isSyncing || !sourcePane || !targetPane) return;
      this.isSyncing = true;

      const sourceScroll = sourcePane.scrollTop;
      const sourceMax = sourcePane.scrollHeight - sourcePane.clientHeight;
      const targetMax = targetPane.scrollHeight - targetPane.clientHeight;

      let targetScroll = 0;

      if (sourceScroll <= 2) {
        targetScroll = 0;
      } else if (sourceScroll >= sourceMax - 2) {
        targetScroll = targetMax;
      } else if (this.alignMode === 'anchor' && this.anchorPairs.length >= 2) {
        // 🎯 核心算法：分段动态相对速率插值 (Piecewise Relative Rate Interpolation)
        const anchors = this.anchorPairs;
        let k = 0;

        if (isFromLeft) {
          while (k < anchors.length - 1 && anchors[k + 1].leftTop <= sourceScroll) {
            k++;
          }
          const sStart = anchors[k].leftTop;
          const sEnd = k < anchors.length - 1 ? anchors[k + 1].leftTop : sourceMax;
          const tStart = anchors[k].rightTop;
          const tEnd = k < anchors.length - 1 ? anchors[k + 1].rightTop : targetMax;

          const segLen = sEnd - sStart;
          const ratio = segLen > 0 ? (sourceScroll - sStart) / segLen : 0;
          targetScroll = tStart + ratio * (tEnd - tStart);
        } else {
          while (k < anchors.length - 1 && anchors[k + 1].rightTop <= sourceScroll) {
            k++;
          }
          const sStart = anchors[k].rightTop;
          const sEnd = k < anchors.length - 1 ? anchors[k + 1].rightTop : sourceMax;
          const tStart = anchors[k].leftTop;
          const tEnd = k < anchors.length - 1 ? anchors[k + 1].leftTop : targetMax;

          const segLen = sEnd - sStart;
          const ratio = segLen > 0 ? (sourceScroll - sStart) / segLen : 0;
          targetScroll = tStart + ratio * (tEnd - tStart);
        }
      } else {
        // 📐 物理等高或线性比例模式：按百分比等比平滑
        const ratio = sourceMax > 0 ? sourceScroll / sourceMax : 0;
        targetScroll = ratio * targetMax;
      }

      targetPane.scrollTop = targetScroll;
      requestAnimationFrame(() => { this.isSyncing = false; });
    };

    this.leftPane.addEventListener('scroll', () => handleScroll(this.leftPane, this.rightPane, true), { passive: true });
    this.rightPane.addEventListener('scroll', () => handleScroll(this.rightPane, this.leftPane, false), { passive: true });
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
        this.recalculateAlignment();
      }
    });
  }

  /**
   * 严格整段原子化提取算法
   */
  collectAllTranslatableNodes(root) {
    const blockTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD', 'TH', 'TD'];
    const rawBlocks = root.querySelectorAll(blockTags.join(','));
    const selectedBlocks = [];

    rawBlocks.forEach(el => {
      const text = el.innerText?.trim();
      if (!text || text.length < 2 || /^[\d\s\p{P}]+$/u.test(text)) return;
      selectedBlocks.push(el);
    });

    const cleanBlocks = selectedBlocks.filter(item => {
      const hasBlockChild = selectedBlocks.some(other => other !== item && item.contains(other));
      return !hasBlockChild;
    });

    const otherTags = ['A', 'BUTTON', 'SPAN', 'DIV', 'LABEL'];
    const otherElements = root.querySelectorAll(otherTags.join(','));
    const standAloneElements = [];

    otherElements.forEach(el => {
      const isInsideBlock = cleanBlocks.some(block => block.contains(el));
      if (isInsideBlock) return;

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
        standAloneElements.push(el);
      }
    });

    return [...cleanBlocks, ...standAloneElements];
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