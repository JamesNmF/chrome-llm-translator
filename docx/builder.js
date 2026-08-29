/**
 * Word (.docx) 双语制作器引擎 (基于 JSZip 与 XML 注入)
 */

import { DEFAULT_SETTINGS, PROVIDERS } from '../lib/constants.js';
import { LLMClient } from '../lib/llm-client.js';

document.addEventListener('DOMContentLoaded', async () => {
  // DOM 元素
  const fileInput = document.getElementById('file-input');
  const btnSelectFile = document.getElementById('btn-select-file');
  const btnOpenDialog = document.getElementById('btn-open-dialog');
  const dropOverlay = document.getElementById('drop-overlay');

  const docxModeSelect = document.getElementById('docx-mode');
  const currentModelTag = document.getElementById('current-model-tag');
  const btnStartTranslate = document.getElementById('btn-start-translate');
  const btnDownload = document.getElementById('btn-download');

  const progressWrap = document.getElementById('progress-wrap');
  const progressText = document.getElementById('progress-text');
  const progressPercent = document.getElementById('progress-percent');
  const progressFill = document.getElementById('progress-fill');
  const previewContainer = document.getElementById('preview-container');
  const statusText = document.getElementById('status-text');

  // 状态变量
  let currentSettings = { ...DEFAULT_SETTINGS };
  let originalZip = null;
  let originalFileName = 'document.docx';
  let extractedParagraphs = []; // [{ id, text, element, translatedText }]
  let docXmlDoc = null;
  let isTranslating = false;
  let abortController = null;
  let generatedBlob = null;

  // 读取配置
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    currentSettings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }
  const providerMeta = PROVIDERS[currentSettings.provider] || PROVIDERS.custom;
  currentModelTag.textContent = `${providerMeta.name.split(' ')[0]}: ${currentSettings.model || providerMeta.defaultModel}`;

  // 打开与拖拽文件
  btnSelectFile.addEventListener('click', () => fileInput.click());
  btnOpenDialog.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleDocxFile(file);
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.docx') || file.type.includes('wordprocessingml'))) {
      handleDocxFile(file);
    }
  });

  async function handleDocxFile(file) {
    originalFileName = file.name;
    statusText.textContent = `正在解包 Word 文档: ${file.name}...`;
    dropOverlay.classList.add('hidden');
    btnStartTranslate.disabled = true;
    btnDownload.disabled = true;
    previewContainer.innerHTML = '<div class="empty-hint">正在解析文档 XML 结构...</div>';

    try {
      const buffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      originalZip = zip;

      const docXmlFile = zip.file('word/document.xml');
      if (!docXmlFile) {
        throw new Error('未找到 word/document.xml，可能不是合法的 .docx 文件');
      }

      const xmlText = await docXmlFile.async('text');
      const parser = new DOMParser();
      docXmlDoc = parser.parseFromString(xmlText, 'application/xml');

      // 提取正文段落
      const pElements = docXmlDoc.getElementsByTagName('w:p');
      extractedParagraphs = [];

      let validCount = 0;
      for (let i = 0; i < pElements.length; i++) {
        const pEl = pElements[i];
        const tElements = pEl.getElementsByTagName('w:t');
        let fullText = '';
        for (let j = 0; j < tElements.length; j++) {
          fullText += tElements[j].textContent;
        }

        const trimmed = fullText.trim();
        // 过滤空行与纯数字符号
        if (trimmed && trimmed.length >= 2 && /[a-zA-Z\u4e00-\u9fa5]/.test(trimmed)) {
          extractedParagraphs.push({
            id: validCount++,
            element: pEl,
            text: trimmed,
            translatedText: ''
          });
        }
      }

      if (extractedParagraphs.length === 0) {
        previewContainer.innerHTML = '<div class="empty-hint">文档中未发现可翻译的有效文字段落</div>';
        statusText.textContent = '无可翻译内容';
        return;
      }

      renderPreviewList(extractedParagraphs);
      btnStartTranslate.disabled = false;
      statusText.textContent = `已成功载入: ${file.name} (共 ${extractedParagraphs.length} 个段落)`;
    } catch (err) {
      console.error('[DocxBuilder] 解析失败:', err);
      alert(`无法解析 Word 文档: ${err.message}`);
      statusText.textContent = '解析失败';
    }
  }

  function renderPreviewList(paragraphs) {
    previewContainer.innerHTML = '';
    paragraphs.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'docx-para-card';
      card.id = `para-card-${idx}`;
      card.innerHTML = `
        <div class="docx-origin-text">${escapeHtml(p.text)}</div>
        <div class="docx-trans-text pending" id="trans-text-${idx}">等待翻译...</div>
      `;
      previewContainer.appendChild(card);
    });
  }

  // 开始翻译
  btnStartTranslate.addEventListener('click', async () => {
    if (!originalZip || extractedParagraphs.length === 0) return;

    if (isTranslating) {
      if (abortController) abortController.abort();
      isTranslating = false;
      btnStartTranslate.textContent = '⚡ 开始翻译';
      statusText.textContent = '已暂停翻译';
      return;
    }

    isTranslating = true;
    abortController = new AbortController();
    btnStartTranslate.textContent = '⏹️ 暂停翻译';
    btnDownload.disabled = true;
    progressWrap.style.display = 'block';

    const targetLang = currentSettings.targetLang || 'zh-CN';
    const total = extractedParagraphs.length;
    let completed = 0;
    const concurrency = 3;
    let cursor = 0;

    async function worker() {
      while (cursor < total) {
        if (!isTranslating || abortController.signal.aborted) break;
        const index = cursor++;
        const p = extractedParagraphs[index];
        const card = document.getElementById(`para-card-${index}`);
        const transEl = document.getElementById(`trans-text-${index}`);

        if (card) card.classList.add('translating');

        try {
          await new Promise((resolve) => {
            LLMClient.translateStream({
              text: p.text,
              targetLang,
              mode: 'fluent',
              settings: currentSettings,
              signal: abortController.signal,
              onChunk: (chunk, acc) => {
                p.translatedText = acc;
                if (transEl) {
                  transEl.classList.remove('pending');
                  transEl.textContent = acc;
                }
              },
              onDone: (finalText) => {
                p.translatedText = finalText;
                if (transEl) {
                  transEl.classList.remove('pending');
                  transEl.textContent = finalText;
                }
                if (card) {
                  card.classList.remove('translating');
                  card.classList.add('finished');
                }
                resolve();
              },
              onError: (err) => {
                if (transEl) transEl.textContent = `[翻译失败: ${err.message}]`;
                if (card) card.classList.remove('translating');
                resolve();
              }
            });
          });
        } catch (e) {}

        completed++;
        const percent = Math.round((completed / total) * 100);
        progressPercent.textContent = `${percent}%`;
        progressFill.style.width = `${percent}%`;
        progressText.textContent = `正在翻译: ${completed}/${total} 段...`;
      }
    }

    const workers = [];
    for (let w = 0; w < Math.min(concurrency, total); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    isTranslating = false;
    btnStartTranslate.textContent = '⚡ 重新翻译';
    progressText.textContent = '全部段落翻译完成！准备打包...';

    // 重新构建 Word XML
    await rebuildDocxFile();
  });

  // 重新构建 Word XML 并打包
  async function rebuildDocxFile() {
    statusText.textContent = '正在重新封装 Word 格式...';
    const mode = docxModeSelect.value; // 'dual' | 'replace'

    try {
      extractedParagraphs.forEach(p => {
        if (!p.translatedText) return;

        if (mode === 'replace') {
          // 仅译文替换：将第一个 <w:t> 改为译文，其余置空
          const tElements = p.element.getElementsByTagName('w:t');
          if (tElements.length > 0) {
            tElements[0].textContent = p.translatedText;
            for (let i = 1; i < tElements.length; i++) {
              tElements[i].textContent = '';
            }
          }
        } else {
          // 📑 双语对照：克隆原段落结构并在原段落下方插入
          const cloneP = p.element.cloneNode(true);
          const tElements = cloneP.getElementsByTagName('w:t');
          if (tElements.length > 0) {
            tElements[0].textContent = p.translatedText;
            for (let i = 1; i < tElements.length; i++) {
              tElements[i].textContent = '';
            }
          }

          // 尝试给译文段落增加浅紫/深蓝色区分
          const rElements = cloneP.getElementsByTagName('w:r');
          for (let r of rElements) {
            let rPr = r.getElementsByTagName('w:rPr')[0];
            if (!rPr) {
              rPr = docXmlDoc.createElement('w:rPr');
              r.insertBefore(rPr, r.firstChild);
            }
            const colorEl = docXmlDoc.createElement('w:color');
            colorEl.setAttribute('w:val', '4F46E5'); // 沉浸紫色
            rPr.appendChild(colorEl);
          }

          // 插入到原段落后方
          if (p.element.nextSibling) {
            p.element.parentNode.insertBefore(cloneP, p.element.nextSibling);
          } else {
            p.element.parentNode.appendChild(cloneP);
          }
        }
      });

      // 序列化 XML
      const serializer = new XMLSerializer();
      const newXmlText = serializer.serializeToString(docXmlDoc);

      // 写回 Zip
      originalZip.file('word/document.xml', newXmlText);

      // 生成 Blob
      generatedBlob = await originalZip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });

      btnDownload.disabled = false;
      statusText.textContent = '🎉 Word 文档生成完成，点击右上角导出！';
    } catch (err) {
      console.error('[DocxBuilder] 打包异常:', err);
      alert(`打包失败: ${err.message}`);
    }
  }

  // 导出下载
  btnDownload.addEventListener('click', () => {
    if (!generatedBlob) return;
    const cleanName = originalFileName.replace(/\.docx$/i, '');
    const modeStr = docxModeSelect.value === 'dual' ? '[双语对照]' : '[中文译本]';
    const downloadName = `${modeStr} ${cleanName}.docx`;

    const url = URL.createObjectURL(generatedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    a.click();
    URL.revokeObjectURL(url);
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
});