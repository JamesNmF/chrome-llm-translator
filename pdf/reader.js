/**
 * PDF 双语阅读引擎 (集成目录大纲、Vision 多模态扫描件翻译与划词生词本)
 */

import { DEFAULT_SETTINGS, PROVIDERS } from '../lib/constants.js';
import { LLMClient } from '../lib/llm-client.js';
import { dbInstance } from '../lib/cache-db.js';

if (window.pdfjsLib) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
  } catch (e) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '../lib/pdf.worker.min.js';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // DOM 元素引用
  const fileInput = document.getElementById('file-input');
  const btnUpload = document.getElementById('btn-upload');
  const btnOpenDialog = document.getElementById('btn-open-dialog');
  const dropOverlay = document.getElementById('drop-overlay');

  const btnPrevPage = document.getElementById('btn-prev-page');
  const btnNextPage = document.getElementById('btn-next-page');
  const pageNumInput = document.getElementById('page-num-input');
  const pageCountText = document.getElementById('page-count-text');
  const leftPageLabel = document.getElementById('left-page-label');
  const rightPageLabel = document.getElementById('right-page-label');

  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const zoomText = document.getElementById('zoom-text');

  const btnToggleOutline = document.getElementById('btn-toggle-outline');
  const btnCloseOutline = document.getElementById('btn-close-outline');
  const outlineSidebar = document.getElementById('outline-sidebar');
  const outlineTree = document.getElementById('outline-tree');

  const btnTranslatePage = document.getElementById('btn-translate-page');
  const btnTranslateAll = document.getElementById('btn-translate-all');
  const btnPrintPdf = document.getElementById('btn-print-pdf');

  const canvasLeft = document.getElementById('pdf-canvas-left');
  const ctxLeft = canvasLeft.getContext('2d');
  const canvasRightBg = document.getElementById('pdf-canvas-right-bg');
  const ctxRightBg = canvasRightBg.getContext('2d');

  const leftPaper = document.getElementById('left-paper');
  const rightPaper = document.getElementById('right-paper');
  const paraOverlay = document.getElementById('para-overlay');

  const vocabBubble = document.getElementById('vocab-bubble');
  const vocabWordText = document.getElementById('vocab-word-text');
  const vocabTransText = document.getElementById('vocab-trans-text');
  const btnSaveVocab = document.getElementById('btn-save-vocab');
  const btnCopyVocab = document.getElementById('btn-copy-vocab');

  const statusText = document.getElementById('status-text');
  const currentModelTag = document.getElementById('current-model-tag');

  // 状态变量
  let pdfDoc = null;
  let pageNum = 1;
  let scale = 1.0;
  let currentSettings = { ...DEFAULT_SETTINGS };
  const pageParaMap = new Map();
  let isBatchTranslating = false;
  let activeAbortController = null;
  let renderTaskLeft = null;
  let renderTaskRight = null;
  let currentSelectedWord = '';
  let currentSelectedTrans = '';

  // 读取配置
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    currentSettings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }
  const providerMeta = PROVIDERS[currentSettings.provider] || PROVIDERS.custom;
  currentModelTag.textContent = `${providerMeta.name.split(' ')[0]}: ${currentSettings.model || providerMeta.defaultModel}`;

  // 打开/收起大纲侧栏
  btnToggleOutline.addEventListener('click', () => {
    outlineSidebar.classList.toggle('open');
  });
  btnCloseOutline.addEventListener('click', () => {
    outlineSidebar.classList.remove('open');
  });

  // 打开与上传 PDF
  btnUpload.addEventListener('click', () => fileInput.click());
  btnOpenDialog.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadPdfFile(file);
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type === 'application/pdf' || file.name.endsWith('.pdf'))) {
      loadPdfFile(file);
    }
  });

  btnPrintPdf.addEventListener('click', () => {
    window.print();
  });

  async function loadPdfBuffer(buffer, fileName = 'document.pdf') {
    statusText.textContent = `正在解析: ${fileName}...`;
    try {
      const loadingTask = pdfjsLib.getDocument({
        data: buffer,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
        cMapPacked: true
      });
      pdfDoc = await loadingTask.promise;
      pageCountText.textContent = pdfDoc.numPages;
      pageNumInput.max = pdfDoc.numPages;
      pageNum = 1;
      dropOverlay.classList.add('hidden');
      await renderPage(pageNum);
      await loadPdfOutline();
      statusText.textContent = `已打开: ${fileName} (共 ${pdfDoc.numPages} 页)`;
    } catch (err) {
      alert(`无法打开该 PDF: ${err.message}`);
      statusText.textContent = '打开失败';
    }
  }

  async function loadPdfFile(file) {
    try {
      const buffer = await file.arrayBuffer();
      await loadPdfBuffer(buffer, file.name);
    } catch (err) {
      alert(`读取文件失败: ${err.message}`);
    }
  }

  // 加载大纲目录树
  async function loadPdfOutline() {
    try {
      const outline = await pdfDoc.getOutline();
      outlineTree.innerHTML = '';
      if (!outline || outline.length === 0) {
        outlineTree.innerHTML = '<div class="outline-empty">此 PDF 无内置目录大纲</div>';
        return;
      }

      function renderItems(items, depth = 0) {
        items.forEach(item => {
          const div = document.createElement('div');
          div.className = `outline-item depth-${Math.min(2, depth)}`;
          div.textContent = item.title;
          div.title = item.title;

          div.addEventListener('click', async () => {
            if (item.dest) {
              let pageIndex = 0;
              if (typeof item.dest === 'string') {
                const destArray = await pdfDoc.getDestination(item.dest);
                if (destArray) {
                  const ref = destArray[0];
                  pageIndex = await pdfDoc.getPageIndex(ref);
                }
              } else if (Array.isArray(item.dest)) {
                const ref = item.dest[0];
                pageIndex = await pdfDoc.getPageIndex(ref);
              }
              if (pageIndex >= 0 && pageIndex < pdfDoc.numPages) {
                pageNum = pageIndex + 1;
                await renderPage(pageNum);
              }
            }
          });

          outlineTree.appendChild(div);
          if (item.items && item.items.length > 0) {
            renderItems(item.items, depth + 1);
          }
        });
      }

      renderItems(outline);
    } catch (e) {
      console.warn('[PDF-Reader] 获取大纲异常:', e);
      outlineTree.innerHTML = '<div class="outline-empty">无法解析目录</div>';
    }
  }

  // 检查 URL 中是否带 auto_load=1
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('auto_load') === '1') {
    try {
      const req = indexedDB.open('PdfTransferDB', 1);
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (db.objectStoreNames.contains('pending_files')) {
          const tx = db.transaction('pending_files', 'readonly');
          const store = tx.objectStore('pending_files');
          const getReq = store.get('current_pdf');
          getReq.onsuccess = () => {
            if (getReq.result && getReq.result.data) {
              loadPdfBuffer(getReq.result.data, getReq.result.name);
            }
          };
        }
      };
    } catch (e) {
      console.warn('[PDF-Reader] 自动读取 IndexedDB 异常:', e);
    }
  }

  // 双页同步渲染
  async function renderPage(num) {
    pageNumInput.value = num;
    leftPageLabel.textContent = num;
    rightPageLabel.textContent = num;
    paraOverlay.innerHTML = '';
    hideVocabBubble();

    if (renderTaskLeft) {
      try { renderTaskLeft.cancel(); } catch (e) {}
      renderTaskLeft = null;
    }
    if (renderTaskRight) {
      try { renderTaskRight.cancel(); } catch (e) {}
      renderTaskRight = null;
    }

    try {
      const page = await pdfDoc.getPage(num);
      const viewport = page.getViewport({ scale });

      canvasLeft.height = viewport.height;
      canvasLeft.width = viewport.width;
      leftPaper.style.width = `${viewport.width}px`;
      leftPaper.style.height = `${viewport.height}px`;

      canvasRightBg.height = viewport.height;
      canvasRightBg.width = viewport.width;
      rightPaper.style.width = `${viewport.width}px`;
      rightPaper.style.height = `${viewport.height}px`;

      renderTaskLeft = page.render({ canvasContext: ctxLeft, viewport });
      await renderTaskLeft.promise;
      renderTaskLeft = null;

      renderTaskRight = page.render({ canvasContext: ctxRightBg, viewport });
      await renderTaskRight.promise;
      renderTaskRight = null;

      if (pageParaMap.has(num)) {
        renderParaOverlay(pageParaMap.get(num));
      }
    } catch (err) {
      if (err?.name === 'RenderingCancelledException') return;
      console.error('[PDF-Reader] 渲染页面异常:', err);
    }
  }

  // 翻页与缩放
  btnPrevPage.addEventListener('click', async () => {
    if (pageNum <= 1) return;
    pageNum--;
    await renderPage(pageNum);
  });

  btnNextPage.addEventListener('click', async () => {
    if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
    pageNum++;
    await renderPage(pageNum);
  });

  pageNumInput.addEventListener('change', async () => {
    const target = parseInt(pageNumInput.value, 10);
    if (target >= 1 && target <= (pdfDoc?.numPages || 1)) {
      pageNum = target;
      await renderPage(pageNum);
    }
  });

  btnZoomIn.addEventListener('click', async () => {
    scale += 0.15;
    zoomText.textContent = `${Math.round(scale * 100)}%`;
    await renderPage(pageNum);
  });

  btnZoomOut.addEventListener('click', async () => {
    if (scale <= 0.6) return;
    scale -= 0.15;
    zoomText.textContent = `${Math.round(scale * 100)}%`;
    await renderPage(pageNum);
  });

  // 提取段落与包围盒
  async function extractTrueParagraphBoxes(pageNumber) {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const textContent = await page.getTextContent();
    const items = textContent.items;

    if (!items || items.length === 0) return [];

    const allItems = [];

    items.forEach(item => {
      const str = item.str;
      if (!str || !str.trim()) return;

      const tx = item.transform;
      const [vx, vy] = viewport.convertToViewportPoint(tx[4], tx[5]);
      const itemWidth = (item.width || str.length * 7) * scale;
      const itemHeight = Math.max(10, (item.height || Math.abs(tx[0]) || 12) * scale);

      allItems.push({
        text: str,
        fontName: item.fontName || '',
        left: vx,
        top: Math.max(0, vy - itemHeight),
        right: vx + itemWidth,
        bottom: vy,
        width: itemWidth,
        height: itemHeight,
        fontSize: itemHeight * 0.95
      });
    });

    if (allItems.length === 0) return [];

    allItems.sort((a, b) => a.top - b.top || a.left - b.left);

    const physicalLines = [];
    let curLine = {
      text: allItems[0].text,
      left: allItems[0].left,
      top: allItems[0].top,
      right: allItems[0].right,
      bottom: allItems[0].bottom,
      fontName: allItems[0].fontName,
      fontSize: allItems[0].fontSize,
      items: [allItems[0]]
    };

    for (let i = 1; i < allItems.length; i++) {
      const item = allItems[i];
      const isSameLine = item.top < curLine.bottom + 2 && item.bottom > curLine.top - 6;

      if (isSameLine) {
        curLine.text += (curLine.text.endsWith('-') ? '' : ' ') + item.text;
        curLine.left = Math.min(curLine.left, item.left);
        curLine.top = Math.min(curLine.top, item.top);
        curLine.right = Math.max(curLine.right, item.right);
        curLine.bottom = Math.max(curLine.bottom, item.bottom);
        curLine.items.push(item);
      } else {
        curLine.width = curLine.right - curLine.left;
        curLine.height = curLine.bottom - curLine.top;
        physicalLines.push(curLine);
        curLine = {
          text: item.text,
          left: item.left,
          top: item.top,
          right: item.right,
          bottom: item.bottom,
          fontName: item.fontName,
          fontSize: item.fontSize,
          items: [item]
        };
      }
    }
    curLine.width = curLine.right - curLine.left;
    curLine.height = curLine.bottom - curLine.top;
    physicalLines.push(curLine);

    const paragraphBoxes = [];
    let curParagraph = null;

    physicalLines.forEach(line => {
      const lineText = line.text.replace(/\s+/g, ' ').trim();
      if (!lineText) return;

      if (/^Page\s+\d+\s+of\s+\d+$/i.test(lineText)) return;

      const isFinding = /^FINDING:\s*/i.test(lineText);
      const isListItem = /^(\d+\)|\([0-9A-Z]+\)|[A-Z]\.|\b[I|V|X]+\.)\s+/i.test(lineText);
      const isHeading = line.fontSize >= 15 || /^The\s+Origins\s+of/i.test(lineText);
      const isFootnoteSection = line.top > viewport.height * 0.76 && /^\d+\s+[A-Z]/i.test(lineText);
      
      const isIndentedFirstLine = curParagraph && (line.left - curParagraph.left > 14) && (line.top - curParagraph.bottom > 4);
      const isLargeGap = curParagraph && (line.top - curParagraph.bottom > 12);

      const startsNewParagraph = !curParagraph || isFinding || isListItem || isHeading || isFootnoteSection || isIndentedFirstLine || isLargeGap;

      if (startsNewParagraph) {
        if (curParagraph) {
          finalizeParagraphBox(curParagraph, paragraphBoxes);
        }
        curParagraph = {
          lines: [line],
          text: lineText,
          left: line.left,
          top: line.top,
          right: line.right,
          bottom: line.bottom,
          fontSize: line.fontSize,
          fontName: line.fontName,
          isFinding: isFinding,
          isHeading: isHeading,
          isFootnote: isFootnoteSection,
          translatedText: ''
        };
      } else {
        curParagraph.lines.push(line);
        curParagraph.text += (curParagraph.text.endsWith('-') ? '' : ' ') + lineText;
        curParagraph.left = Math.min(curParagraph.left, line.left);
        curParagraph.top = Math.min(curParagraph.top, line.top);
        curParagraph.right = Math.max(curParagraph.right, line.right);
        curParagraph.bottom = Math.max(curParagraph.bottom, line.bottom);
      }
    });

    if (curParagraph) {
      finalizeParagraphBox(curParagraph, paragraphBoxes);
    }

    return paragraphBoxes;
  }

  function finalizeParagraphBox(para, outputList) {
    const raw = para.text.replace(/-\s+/g, '').replace(/\s+/g, ' ').trim();
    if (!raw) return;

    const boxLeft = Math.max(0, para.left - 3);
    const boxTop = Math.max(0, para.top - 2);
    const boxWidth = Math.max(80, (para.right - para.left) + 8);
    const boxHeight = Math.max(18, (para.bottom - para.top) + 4);

    outputList.push({
      text: raw,
      left: boxLeft,
      top: boxTop,
      width: boxWidth,
      height: boxHeight,
      fontSize: Math.max(11, Math.min(22, para.fontSize)),
      isBold: /bold|black/i.test(para.fontName) || para.isHeading,
      isFinding: para.isFinding,
      textAlign: para.isHeading ? 'left' : 'justify',
      translatedText: ''
    });
  }

  // 渲染覆盖层
  function renderParaOverlay(boxes) {
    paraOverlay.innerHTML = '';

    boxes.forEach((b, index) => {
      const boxEl = document.createElement('div');
      boxEl.className = `pdf-para-box ${!b.translatedText ? 'pdf-para-loading' : ''} ${b.isFinding ? 'finding-box' : ''}`;
      boxEl.id = `para-box-${index}`;

      boxEl.style.left = `${b.left}px`;
      boxEl.style.top = `${b.top}px`;
      boxEl.style.width = `${b.width}px`;
      boxEl.style.minHeight = `${b.height}px`;
      boxEl.style.fontSize = `${b.fontSize}px`;
      boxEl.style.textAlign = b.textAlign;
      if (b.isBold) boxEl.style.fontWeight = '700';

      boxEl.textContent = b.translatedText || b.text;
      boxEl.title = `原文: ${b.text}\n(鼠标悬浮可查看原文)`;
      paraOverlay.appendChild(boxEl);

      if (b.translatedText) {
        fitFontSize(boxEl, b.height, b.fontSize);
      }
    });
  }

  function fitFontSize(el, targetHeight, defaultSize) {
    let size = defaultSize;
    el.style.fontSize = `${size}px`;
    while (el.scrollHeight > targetHeight + 6 && size > 9.5) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  }

  // 翻译当前页 (含 Vision 多模态降级)
  btnTranslatePage.addEventListener('click', async () => {
    if (!pdfDoc) {
      alert('请先选择 PDF 文件');
      return;
    }
    await translatePageConsolidated(pageNum);
  });

  async function translatePageConsolidated(targetPageNum) {
    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();

    const refreshed = await chrome.storage.sync.get('settings');
    if (refreshed.settings) {
      currentSettings = { ...DEFAULT_SETTINGS, ...refreshed.settings };
    }

    statusText.textContent = `正在提取第 ${targetPageNum} 页内容...`;
    const boxes = await extractTrueParagraphBoxes(targetPageNum);

    // ⭐️ 核心改进：若文字图层为空（纯图片封面/扫描件），自动触发多模态 Vision 翻译！
    if (boxes.length === 0) {
      await translateWithVisionFallback(targetPageNum);
      return;
    }

    pageParaMap.set(targetPageNum, boxes);
    renderParaOverlay(boxes);

    const targetLang = currentSettings.targetLang || 'zh-CN';
    const startTime = performance.now();
    statusText.textContent = `正在翻译第 ${targetPageNum} 页 (${boxes.length} 个段落)...`;

    let finishedCount = 0;
    const concurrency = 3;
    let cursor = 0;

    async function worker() {
      while (cursor < boxes.length) {
        if (!activeAbortController || activeAbortController.signal.aborted) break;
        const index = cursor++;
        const b = boxes[index];
        const boxEl = document.getElementById(`para-box-${index}`);

        try {
          await new Promise((resolve) => {
            LLMClient.translateStream({
              text: b.text,
              targetLang,
              mode: 'fluent',
              settings: currentSettings,
              signal: activeAbortController.signal,
              onChunk: (chunk, fullText) => {
                b.translatedText = fullText;
                if (boxEl) {
                  boxEl.classList.remove('pdf-para-loading');
                  boxEl.textContent = fullText;
                  fitFontSize(boxEl, b.height, b.fontSize);
                }
              },
              onDone: (finalText) => {
                b.translatedText = finalText;
                if (boxEl) {
                  boxEl.classList.remove('pdf-para-loading');
                  boxEl.textContent = finalText;
                  fitFontSize(boxEl, b.height, b.fontSize);
                }
                resolve();
              },
              onError: (err) => {
                console.warn(`[PDF-Reader] 段落 ${index + 1} 翻译失败:`, err);
                if (boxEl) boxEl.classList.remove('pdf-para-loading');
                resolve();
              }
            });
          });
        } catch (e) {}

        finishedCount++;
        statusText.textContent = `翻译进度: ${finishedCount}/${boxes.length}...`;
      }
    }

    const workers = [];
    for (let w = 0; w < Math.min(concurrency, boxes.length); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    const duration = Math.round(performance.now() - startTime);
    statusText.textContent = `第 ${targetPageNum} 页翻译完成，耗时: ${duration}ms`;
  }

  // 多模态 Vision 视觉降级翻译
  async function translateWithVisionFallback(targetPageNum) {
    statusText.textContent = `第 ${targetPageNum} 页为图片/扫描件，正在启动 Vision 视觉大模型识别翻译...`;

    // 导出左侧 Canvas 为图片 Base64
    const imageBase64 = canvasLeft.toDataURL('image/jpeg', 0.85);

    // 在右侧生成一个覆盖整页的自适应大容器
    paraOverlay.innerHTML = '';
    const visionBox = document.createElement('div');
    visionBox.className = 'pdf-para-box pdf-para-loading';
    visionBox.style.left = '30px';
    visionBox.style.top = '30px';
    visionBox.style.width = `${canvasRightBg.width - 60}px`;
    visionBox.style.minHeight = `${canvasRightBg.height - 60}px`;
    visionBox.style.padding = '24px';
    visionBox.style.fontSize = '14px';
    visionBox.style.lineHeight = '1.7';
    visionBox.style.whiteSpace = 'pre-wrap';
    paraOverlay.appendChild(visionBox);

    const startTime = performance.now();
    try {
      await LLMClient.translateVisionStream({
        imageBase64,
        targetLang: currentSettings.targetLang || 'zh-CN',
        settings: currentSettings,
        signal: activeAbortController.signal,
        onChunk: (chunk, fullText) => {
          visionBox.classList.remove('pdf-para-loading');
          visionBox.textContent = fullText;
        },
        onDone: (finalText) => {
          visionBox.classList.remove('pdf-para-loading');
          visionBox.textContent = finalText;
          const duration = Math.round(performance.now() - startTime);
          statusText.textContent = `第 ${targetPageNum} 页 Vision 视觉识别翻译完成！耗时: ${duration}ms`;
        },
        onError: (err) => {
          visionBox.classList.remove('pdf-para-loading');
          visionBox.innerHTML = `<span style="color: #ef4444;">Vision 视觉识别失败: ${err.message}</span>`;
          statusText.textContent = 'Vision 识别失败';
        }
      });
    } catch (e) {}
  }

  // 批量全文翻译
  btnTranslateAll.addEventListener('click', async () => {
    if (!pdfDoc) {
      alert('请先选择 PDF 文件');
      return;
    }

    if (isBatchTranslating) {
      isBatchTranslating = false;
      btnTranslateAll.textContent = '⚡ 翻译全文';
      statusText.textContent = '已暂停';
      return;
    }

    isBatchTranslating = true;
    btnTranslateAll.textContent = '⏹️ 停止翻译';

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      if (!isBatchTranslating) break;
      pageNum = i;
      await renderPage(i);
      await translatePageConsolidated(i);
    }

    isBatchTranslating = false;
    btnTranslateAll.textContent = '⚡ 翻译全文';
    statusText.textContent = '全文翻译完成';
  });

  // ==================== 划词生词气泡与收藏 ====================
  document.addEventListener('mouseup', async (e) => {
    // 如果点击在气泡内部，不处理
    if (vocabBubble.contains(e.target)) return;

    const selection = window.getSelection();
    const text = selection?.toString().trim();

    if (text && text.length >= 1 && text.length <= 100 && /^[a-zA-Z\s\-',]+$/.test(text)) {
      currentSelectedWord = text;
      showVocabBubble(e.pageX, e.pageY, text);
    } else {
      hideVocabBubble();
    }
  });

  function showVocabBubble(x, y, word) {
    vocabWordText.textContent = word;
    vocabTransText.textContent = '正在查询释义...';
    vocabBubble.style.left = `${Math.min(window.innerWidth - 300, x + 10)}px`;
    vocabBubble.style.top = `${y + 15}px`;
    vocabBubble.classList.add('show');

    // 简单查词
    LLMClient.translateStream({
      text: word,
      targetLang: 'zh-CN',
      mode: 'fluent',
      settings: currentSettings,
      onDone: (res) => {
        currentSelectedTrans = res;
        vocabTransText.textContent = res;
      }
    });
  }

  function hideVocabBubble() {
    vocabBubble.classList.remove('show');
  }

  btnSaveVocab.addEventListener('click', async () => {
    if (!currentSelectedWord) return;
    const ok = await dbInstance.addVocabulary({
      word: currentSelectedWord,
      translation: currentSelectedTrans,
      sourceLang: 'en',
      targetLang: currentSettings.targetLang || 'zh-CN'
    });
    if (ok) {
      btnSaveVocab.textContent = '✓ 已收藏';
      setTimeout(() => {
        btnSaveVocab.textContent = '⭐ 收藏到生词本';
        hideVocabBubble();
      }, 1000);
    }
  });

  btnCopyVocab.addEventListener('click', () => {
    if (currentSelectedWord) {
      navigator.clipboard.writeText(`${currentSelectedWord} : ${currentSelectedTrans}`);
      btnCopyVocab.textContent = '✓ 已复制';
      setTimeout(() => btnCopyVocab.textContent = '📋 复制', 1000);
    }
  });
});