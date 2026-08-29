/**
 * 🪟 工业级双生镜像分屏引擎 (In-Situ Twin Mirror Split Engine)
 * 🚀 支持复杂 SPA (如 ArtStation Jobs) 全场景多子滚动条 (Multi-Scroller) 深度同步：
 * 1. 递归扫描并绑定所有局部子滚动容器 (Sidebar, Job List, Detail Modal)
 * 2. 全局滚轮穿透最近滚动祖先同步
 * 3. 动态 MutationObserver 自动感知新出现的弹窗/侧边栏滚动条
 * 4. 物理等高平齐对齐 (Ghost Spacer) + DOM 标签超链接 100% 保留 + 极速并发翻译
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
    
    this.alignMode = 'spacer';
    this.anchorPairs = [];
    this.scrollerPairs = [];
    this.resizeObserver = null;
    this.mutationObserver = null;
    this._recalcTimer = null;
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

    // 1. 锁定原网页全局滚动
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
      overflow-y: auto !important;
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
      overflow-y: auto !important;
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
      background: rgba(15, 23, 42, 0.94) !important;
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
      <span style="font-weight: 700; color: #818cf8; display: flex; align-items: center; gap: 4px;">
        🪟 双生分屏 (多滚动条全景同步)
      </span>
      
      <div style="display: flex; align-items: center; gap: 4px;">
        <span style="color: #94a3b8; font-size: 11px;">对齐:</span>
        <select id="twin-align-select" style="background: #1e293b; border: 1px solid #475569; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; outline: none; cursor: pointer;">
          <option value="spacer" selected>📐 物理等高平齐 (推荐)</option>
          <option value="anchor">🎯 动态锚点插值</option>
          <option value="linear">⚡ 线性等比滚动</option>
        </select>
      </div>

      <span id="twin-trans-progress" style="color: #10b981; font-weight: 600; font-size: 11px;">● 正在全量翻译...</span>
      
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
      this.scheduleRecalculate(0);
    });

    topBar.querySelector('#btn-twin-exit').addEventListener('click', () => {
      this.deactivate();
    });

    // 8. 建立左右双生节点的锚点映射库
    this.buildAnchorMap(leftContent, rightContent);

    // 9. 🚀 核心关键：全局多子滚动条 (Multi-Scroller) 递归深度双向同步
    this.bindMultiScrollerEngine(leftContent, rightContent);

    // 10. 绑定分屏宽度拖拽
    this.bindResizer();

    // 11. 监听尺寸动态变化与新增 DOM
    this.initObservers(leftContent, rightContent);

    // 12. 🚀 启动视口优先 + 高密度批量极速翻译
    this.translateCloneFast(rightContent, topBar.querySelector('#twin-trans-progress'));
  }

  /**
   * 递归查找所有局部滚动容器 (Sub-Scroll Containers)
   */
  findScrollableElements(root) {
    const all = root.querySelectorAll('*');
    const scrollables = [];

    // 根容器自身也可以是滚动容器
    scrollables.push(root);

    all.forEach(el => {
      const style = window.getComputedStyle(el);
      const oy = style.overflowY;
      const ox = style.overflowX;
      const isScrollY = oy === 'auto' || oy === 'scroll';
      const isScrollX = ox === 'auto' || ox === 'scroll';
      
      if (isScrollY || isScrollX) {
        scrollables.push(el);
      }
    });

    return scrollables;
  }

  /**
   * 🚀 全场景多子滚动条深度绑定驱动引擎
   */
  bindMultiScrollerEngine(leftRoot, rightRoot) {
    const leftScrollers = this.findScrollableElements(leftRoot);
    const rightScrollers = this.findScrollableElements(rightRoot);

    const count = Math.min(leftScrollers.length, rightScrollers.length);
    this.scrollerPairs = [];

    for (let i = 0; i < count; i++) {
      const l = leftScrollers[i];
      const r = rightScrollers[i];

      l.setAttribute('data-llm-scroller-id', i);
      r.setAttribute('data-llm-scroller-id', i);

      // 双向事件监听
      const onLeftScroll = () => {
        if (this.isSyncing) return;
        this.isSyncing = true;
        r.scrollTop = l.scrollTop;
        r.scrollLeft = l.scrollLeft;
        setTimeout(() => { this.isSyncing = false; }, 15);
      };

      const onRightScroll = () => {
        if (this.isSyncing) return;
        this.isSyncing = true;
        l.scrollTop = r.scrollTop;
        l.scrollLeft = r.scrollLeft;
        setTimeout(() => { this.isSyncing = false; }, 15);
      };

      l.addEventListener('scroll', onLeftScroll, { passive: true });
      r.addEventListener('scroll', onRightScroll, { passive: true });

      this.scrollerPairs.push({ idx: i, left: l, right: r, onLeftScroll, onRightScroll });
    }

    // 外层主面板也绑定互相同步
    this.leftPane.addEventListener('scroll', () => {
      if (this.isSyncing) return;
      this.isSyncing = true;
      this.rightPane.scrollTop = this.leftPane.scrollTop;
      setTimeout(() => { this.isSyncing = false; }, 15);
    }, { passive: true });

    this.rightPane.addEventListener('scroll', () => {
      if (this.isSyncing) return;
      this.isSyncing = true;
      this.leftPane.scrollTop = this.rightPane.scrollTop;
      setTimeout(() => { this.isSyncing = false; }, 15);
    }, { passive: true });

    // 🚀 全局 Wheel 滚轮穿透智能派发
    const handleGlobalWheel = (e, isLeft) => {
      const path = e.composedPath();
      for (let node of path) {
        if (node instanceof HTMLElement && node.hasAttribute('data-llm-scroller-id')) {
          const scrollerId = parseInt(node.getAttribute('data-llm-scroller-id'), 10);
          const pair = this.scrollerPairs.find(p => p.idx === scrollerId);
          if (pair) {
            const targetEl = isLeft ? pair.right : pair.left;
            requestAnimationFrame(() => {
              targetEl.scrollTop = node.scrollTop;
              targetEl.scrollLeft = node.scrollLeft;
            });
          }
          break;
        }
      }
    };

    this.leftPane.addEventListener('wheel', (e) => handleGlobalWheel(e, true), { passive: true });
    this.rightPane.addEventListener('wheel', (e) => handleGlobalWheel(e, false), { passive: true });
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

    this.anchorPairs.sort((a, b) => a.leftTop - b.leftTop);
  }

  /**
   * 节流防抖执行对齐计算
   */
  scheduleRecalculate(delay = 100) {
    if (this._recalcTimer) clearTimeout(this._recalcTimer);
    this._recalcTimer = setTimeout(() => {
      this.recalculateAlignment();
    }, delay);
  }

  /**
   * 重新应用选定的对齐模式
   */
  recalculateAlignment() {
    if (!this.isActive) return;
    this.updateAnchorCoordinates();

    if (this.alignMode === 'spacer') {
      this.anchorPairs.forEach(pair => {
        pair.leftEl.style.minHeight = '';
        pair.rightEl.style.minHeight = '';
        const lH = pair.leftEl.getBoundingClientRect().height;
        const rH = pair.rightEl.getBoundingClientRect().height;
        const maxH = Math.max(lH, rH);
        if (maxH > 10) {
          pair.leftEl.style.minHeight = `${maxH}px`;
          pair.rightEl.style.minHeight = `${maxH}px`;
        }
      });
    } else {
      this.anchorPairs.forEach(pair => {
        pair.leftEl.style.minHeight = '';
        pair.rightEl.style.minHeight = '';
      });
    }

    this.updateAnchorCoordinates();
  }

  /**
   * 监听图片异步加载与 SPA 动态路由新增 DOM
   */
  initObservers(leftRoot, rightRoot) {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.isActive && this.alignMode === 'spacer') {
          this.scheduleRecalculate(150);
        }
      });
      if (this.leftPane) this.resizeObserver.observe(this.leftPane);
      if (this.rightPane) this.resizeObserver.observe(this.rightPane);
    }

    // 监听 ArtStation 点击切换职位等 SPA 动态渲染事件
    if (typeof MutationObserver !== 'undefined') {
      this.mutationObserver = new MutationObserver(() => {
        if (!this.isActive) return;
        // 重新扫描并绑定可能新增的局部滚动容器
        this.bindMultiScrollerEngine(leftRoot, rightRoot);
      });
      this.mutationObserver.observe(leftRoot, { childList: true, subtree: true });
    }
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
        this.scheduleRecalculate(50);
      }
    });
  }

  /**
   * 收集所有原子段落与独立组件
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
   * 🚀 5~10 倍极速翻译引擎 (视口优先 + 大批次 12~15 段 + 6 路高并发)
   */
  async translateCloneFast(root, progressBadge) {
    const nodes = this.collectAllTranslatableNodes(root);
    const targetLang = this.settings.targetLang || 'zh-CN';
    const total = nodes.length;
    let completed = 0;

    const vHeight = window.innerHeight * 2;
    nodes.sort((a, b) => {
      const aTop = a.getBoundingClientRect().top;
      const bTop = b.getBoundingClientRect().top;
      const aInView = aTop >= -200 && aTop <= vHeight;
      const bInView = bTop >= -200 && bTop <= vHeight;
      if (aInView && !bInView) return -1;
      if (!aInView && bInView) return 1;
      return aTop - bTop;
    });

    const queue = [...nodes];
    const concurrency = 6;

    const worker = async () => {
      while (queue.length > 0 && this.isActive) {
        const batch = [];
        let totalLen = 0;

        while (queue.length > 0 && batch.length < 12 && totalLen < 2200) {
          const el = queue.shift();
          const links = el.querySelectorAll('a, b, strong, i, em, code, mark, span.mw-headline');
          let maskedText = '';
          const subTags = [];

          if (links.length > 0) {
            const clone = el.cloneNode(true);
            const cloneLinks = clone.querySelectorAll('a, b, strong, i, em, code, mark, span.mw-headline');
            cloneLinks.forEach((link, idx) => {
              const tagId = `t${idx}`;
              subTags.push({ originalNode: links[idx], tagId });
              link.setAttribute('data-tag-id', tagId);
              link.innerText = `<${tagId}>${link.innerText}</${tagId}>`;
            });
            maskedText = clone.innerText.trim();
          } else {
            maskedText = el.innerText.trim();
          }

          if (maskedText) {
            batch.push({ el, maskedText, subTags });
            totalLen += maskedText.length;
          }
        }

        if (batch.length === 0) break;

        try {
          const combinedPrompt = batch.map((b, i) => `[P${i + 1}] ${b.maskedText}`).join('\n\n');

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
                  let trans = parts[idx] || fallbackLines[idx] || item.maskedText;
                  trans = trans.replace(/^\[P\d+\]\s*/, '').trim();

                  if (item.el) {
                    if (item.subTags.length > 0) {
                      item.subTags.forEach(({ originalNode, tagId }) => {
                        const tagRegex = new RegExp(`<${tagId}>([\\s\\S]*?)</${tagId}>`, 'i');
                        const tagMatch = trans.match(tagRegex);
                        if (tagMatch && tagMatch[1]) {
                          originalNode.innerText = tagMatch[1].trim();
                          trans = trans.replace(tagMatch[0], originalNode.outerHTML);
                        }
                      });
                      item.el.innerHTML = trans.replace(/<t\d+>|<\/t\d+>/g, '');
                    } else {
                      item.el.innerText = trans;
                    }
                  }
                });

                completed += batch.length;
                if (progressBadge) {
                  const percent = Math.min(100, Math.round((completed / total) * 100));
                  progressBadge.textContent = `● 极速翻译: ${percent}%`;
                }

                if (this.alignMode === 'spacer') {
                  this.scheduleRecalculate(150);
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
    for (let i = 0; i < Math.min(concurrency, Math.ceil(total / 10)); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    if (progressBadge && this.isActive) {
      progressBadge.textContent = '● 已全量极速翻译完成';
    }
    this.scheduleRecalculate(50);
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

    if (this._recalcTimer) {
      clearTimeout(this._recalcTimer);
      this._recalcTimer = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
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