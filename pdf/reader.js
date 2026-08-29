/**
 * PDF 页面排版与自适应字号双语阅读引擎 (增强 Canvas 渲染取消保护与 IndexedDB 自动加载)
 */

import { DEFAULT_SETTINGS, PROVIDERS } from '../lib/constants.js';
import { LLMClient } from '../lib/llm-client.js';

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

  // 读取配置
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    currentSettings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }
  const providerMeta = PROVIDERS[currentSettings.provider] || PROVIDERS.custom;
  currentModelTag.textContent = `${providerMeta.name.split(' ')[0]}: ${currentSettings.model || providerMeta.defaultModel}`;

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

  // 检查 URL 中是否带 auto_load=1，自动从 IndexedDB 取出
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

  // 双页同步渲染 (带取消冲突保护)
  async function renderPage(num) {
    pageNumInput.value = num;
    leftPageLabel.textContent = num;
    rightPageLabel.textContent = num;
    paraOverlay.innerHTML = '';

    // 取消尚未结束的前序渲染任务
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

      // 设置左侧 Canvas
      canvasLeft.height = viewport.height;
      canvasLeft.width = viewport.width;
      leftPaper.style.width = `${viewport.width}px`;
      leftPaper.style.height = `${viewport.height}px`;

      // 设置右侧 Canvas
      canvasRightBg.height = viewport.height;
      canvasRightBg.width = viewport.width;
      rightPaper.style.width = `${viewport.width}px`;
      rightPaper.style.height = `${viewport.height}px`;

      // 渲染左侧原始英文 Canvas
      renderTaskLeft = page.render({
        canvasContext: ctxLeft,
        viewport: viewport
      });
      await renderTaskLeft.promise;
      renderTaskLeft = null;

      // 渲染右侧背景 Canvas
      renderTaskRight = page.render({
        canvasContext: ctxRightBg,
        viewport: viewport
      });
      await renderTaskRight.promise;
      renderTaskRight = null;

      if (pageParaMap.has(num)) {
        renderParaOverlay(pageParaMap.get(num));
      }
    } catch (err) {
      if (err?.name === 'RenderingCancelledException') {
        // 快速翻页导致的正常取消，忽略
        return;
      }
      console.error('[PDF-Reader] 渲染页面异常:', err);
    }
  }

  // 翻页
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

  // 缩放
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
          finalizeParagraphBox(curParagraph, paragraphBoxes, viewport.width);
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
      finalizeParagraphBox(curParagraph, paragraphBoxes, viewport.width);
    }

    return paragraphBoxes;
  }

  function finalizeParagraphBox(para, outputList, pageWidth) {
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

  // 翻译当前页
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

    if (currentSettings.provider !== 'ollama' && !currentSettings.apiKey) {
      alert(`请先在设置中填写 ${providerMeta.name} 的 API Key。`);
      chrome.runtime.openOptionsPage();
      return;
    }

    statusText.textContent = `正在提取第 ${targetPageNum} 页段落...`;
    const boxes = await extractTrueParagraphBoxes(targetPageNum);

    if (boxes.length === 0) {
      alert(`第 ${targetPageNum} 页未提取到文本（可能是图片封面）。请翻到正文页重试。`);
      statusText.textContent = '未提取到文本';
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
                if (boxEl) {
                  boxEl.classList.remove('pdf-para-loading');
                }
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
});