/**
 * EPUB 电子书双语批量制作与打包引擎
 */

import { DEFAULT_SETTINGS, PROVIDERS } from '../lib/constants.js';
import { LLMClient } from '../lib/llm-client.js';

document.addEventListener('DOMContentLoaded', async () => {
  // DOM 元素
  const fileInput = document.getElementById('file-input');
  const btnSelectFile = document.getElementById('btn-select-file');
  const dropZone = document.getElementById('drop-zone');

  const uploadSection = document.getElementById('upload-section');
  const bookSection = document.getElementById('book-section');
  const progressSection = document.getElementById('progress-section');

  const bookTitleEl = document.getElementById('book-title');
  const bookCreatorEl = document.getElementById('book-creator');
  const bookChapterCountEl = document.getElementById('book-chapter-count');
  const coverWrap = document.getElementById('cover-wrap');
  const selectTargetLang = document.getElementById('select-target-lang');
  const selectTheme = document.getElementById('select-theme');

  const chapterList = document.getElementById('chapter-list');
  const selectedCountEl = document.getElementById('selected-count');
  const totalCountEl = document.getElementById('total-count');
  const btnSelectAll = document.getElementById('btn-select-all');
  const btnSelectNone = document.getElementById('btn-select-none');

  const btnStartTranslate = document.getElementById('btn-start-translate');
  const btnReselect = document.getElementById('btn-reselect');
  const btnStopTranslate = document.getElementById('btn-stop-translate');
  const btnDownloadEpub = document.getElementById('btn-download-epub');

  const progressStatusTitle = document.getElementById('progress-status-title');
  const progressPercentText = document.getElementById('progress-percent-text');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const logBox = document.getElementById('log-box');
  const currentModelTag = document.getElementById('current-model-tag');

  // 状态变量
  let currentSettings = { ...DEFAULT_SETTINGS };
  let zip = null;
  let epubMeta = {
    title: 'Unknown Title',
    creator: 'Unknown Author',
    opfPath: '',
    baseDir: '',
    chapters: [] // { id, href, fullPath, title, size }
  };
  let isTranslating = false;
  let generatedBlob = null;

  // 读取插件配置
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    currentSettings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }
  const providerMeta = PROVIDERS[currentSettings.provider] || PROVIDERS.custom;
  currentModelTag.textContent = `${providerMeta.name.split(' ')[0]}: ${currentSettings.model || providerMeta.defaultModel}`;

  // 文件上传
  btnSelectFile.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleEpubFile(file);
  });

  dropZone.addEventListener('dragover', (e) => e.preventDefault());
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.epub')) {
      handleEpubFile(file);
    }
  });

  btnReselect.addEventListener('click', () => {
    uploadSection.classList.remove('hidden');
    bookSection.classList.add('hidden');
    progressSection.classList.add('hidden');
    fileInput.value = '';
    zip = null;
  });

  // 日志输出辅助
  function appendLog(msg, type = 'info') {
    const item = document.createElement('div');
    item.className = `log-item ${type}`;
    item.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logBox.appendChild(item);
    logBox.scrollTop = logBox.scrollHeight;
  }

  // 解析 EPUB 文件
  async function handleEpubFile(file) {
    appendLog(`正在读取 EPUB 文件: ${file.name} (${Math.round(file.size / 1024)} KB)...`);
    uploadSection.classList.add('hidden');

    try {
      const buffer = await file.arrayBuffer();
      zip = await JSZip.loadAsync(buffer);

      // 1. 读取 container.xml 查找 OPF 文件路径
      const containerXml = await zip.file('META-INF/container.xml')?.async('text');
      if (!containerXml) throw new Error('无效的 EPUB 文件：找不到 META-INF/container.xml');

      const parser = new DOMParser();
      const containerDoc = parser.parseFromString(containerXml, 'application/xml');
      const rootfileEl = containerDoc.querySelector('rootfile');
      const opfPath = rootfileEl?.getAttribute('full-path');
      if (!opfPath) throw new Error('无法解析 OPF 文件路径');

      epubMeta.opfPath = opfPath;
      epubMeta.baseDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

      // 2. 读取并解析 OPF
      const opfXml = await zip.file(opfPath)?.async('text');
      if (!opfXml) throw new Error(`找不到 OPF 文件: ${opfPath}`);

      const opfDoc = parser.parseFromString(opfXml, 'application/xml');

      // 提取标题与作者
      epubMeta.title = opfDoc.querySelector('metadata > title, metadata > dc\\:title')?.textContent || file.name.replace('.epub', '');
      epubMeta.creator = opfDoc.querySelector('metadata > creator, metadata > dc\\:creator')?.textContent || '未知作者';

      // 提取所有 manifest 项
      const manifestItems = {};
      opfDoc.querySelectorAll('manifest > item').forEach(item => {
        manifestItems[item.getAttribute('id')] = {
          href: item.getAttribute('href'),
          mediaType: item.getAttribute('media-type')
        };
      });

      // 提取封面
      let coverHref = null;
      const coverItem = opfDoc.querySelector('manifest > item[properties~="cover-image"]') ||
                        opfDoc.querySelector('manifest > item[id*="cover"]');
      if (coverItem) {
        coverHref = coverItem.getAttribute('href');
      }

      if (coverHref) {
        const coverFullPath = epubMeta.baseDir + coverHref;
        const coverData = await zip.file(coverFullPath)?.async('base64');
        if (coverData) {
          coverWrap.innerHTML = `<img src="data:image/jpeg;base64,${coverData}" alt="封面">`;
        }
      }

      // 提取有序章节 (Spine)
      epubMeta.chapters = [];
      const itemrefs = opfDoc.querySelectorAll('spine > itemref');
      itemrefs.forEach((ref, idx) => {
        const idref = ref.getAttribute('idref');
        const item = manifestItems[idref];
        if (item && (item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html')) {
          const fullPath = epubMeta.baseDir + item.href;
          epubMeta.chapters.push({
            id: idref,
            href: item.href,
            fullPath: fullPath,
            title: `第 ${idx + 1} 章: ${item.href}`
          });
        }
      });

      // 渲染书籍信息到 UI
      bookTitleEl.textContent = epubMeta.title;
      bookCreatorEl.textContent = `作者: ${epubMeta.creator}`;
      bookChapterCountEl.textContent = `共 ${epubMeta.chapters.length} 个章节文件`;
      totalCountEl.textContent = epubMeta.chapters.length;

      // 渲染章节列表
      renderChapterList();
      bookSection.classList.remove('hidden');
      appendLog(`EPUB 解析成功: 《${epubMeta.title}》，共发现 ${epubMeta.chapters.length} 个章节`, 'success');

    } catch (err) {
      alert(`解析 EPUB 失败: ${err.message}`);
      uploadSection.classList.remove('hidden');
    }
  }

  // 渲染章节列表
  function renderChapterList() {
    chapterList.innerHTML = '';
    epubMeta.chapters.forEach((ch, i) => {
      const item = document.createElement('label');
      item.className = 'chapter-item';
      item.innerHTML = `
        <input type="checkbox" checked value="${i}">
        <span>${ch.title}</span>
      `;
      item.querySelector('input').addEventListener('change', updateSelectedCount);
      chapterList.appendChild(item);
    });
    updateSelectedCount();
  }

  function updateSelectedCount() {
    const checked = chapterList.querySelectorAll('input[type="checkbox"]:checked');
    selectedCountEl.textContent = checked.length;
  }

  btnSelectAll.addEventListener('click', () => {
    chapterList.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = true);
    updateSelectedCount();
  });

  btnSelectNone.addEventListener('click', () => {
    chapterList.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = false);
    updateSelectedCount();
  });

  // 开始批量翻译制作
  btnStartTranslate.addEventListener('click', async () => {
    const selectedIndices = Array.from(chapterList.querySelectorAll('input[type="checkbox"]:checked')).map(c => parseInt(c.value, 10));
    if (selectedIndices.length === 0) {
      alert('请至少勾选一个要翻译的章节！');
      return;
    }

    isTranslating = true;
    bookSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    btnDownloadEpub.classList.add('hidden');
    btnStopTranslate.classList.remove('hidden');
    logBox.innerHTML = '';

    const targetLang = selectTargetLang.value;
    const theme = selectTheme.value;

    appendLog(`开始制作双语 EPUB，共 ${selectedIndices.length} 个章节需要处理...`);
    appendLog(`目标语言: ${targetLang} | 双语主题: ${theme}`);

    // 内联双语 CSS 样式
    const bilingualCss = `
      .llm-bilingual-wrapper {
        display: block !important;
        margin-top: 0.35em !important;
        margin-bottom: 0.65em !important;
        font-family: inherit !important;
        font-size: inherit !important;
        font-weight: inherit !important;
        line-height: inherit !important;
        color: inherit !important;
      }
      .llm-bilingual-inner {
        display: inline;
        border-bottom: 1.5px dashed rgba(99, 102, 241, 0.6);
        padding-bottom: 1px;
      }
    `;

    let completed = 0;

    for (const idx of selectedIndices) {
      if (!isTranslating) break;

      const ch = epubMeta.chapters[idx];
      appendLog(`正在处理 [${completed + 1}/${selectedIndices.length}]: ${ch.href}...`);

      const fileObj = zip.file(ch.fullPath);
      if (!fileObj) {
        appendLog(`找不到章节文件: ${ch.fullPath}，已跳过`, 'warn');
        continue;
      }

      const htmlContent = await fileObj.async('text');
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, 'application/xhtml+xml');

      // 提取段落
      const paragraphs = Array.from(doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote'));
      const translatable = paragraphs.filter(p => {
        const t = p.textContent.trim();
        return t && t.length >= 2 && !/^[\d\s\p{P}]+$/u.test(t);
      });

      if (translatable.length > 0) {
        appendLog(`- 章节提取出 ${translatable.length} 个待翻译段落，调用大模型流式处理中...`);

        // 批量分块（每 3 个段落一组）
        for (let i = 0; i < translatable.length; i += 3) {
          if (!isTranslating) break;
          const chunk = translatable.slice(i, i + 3);
          const combined = chunk.map((p, pIdx) => `[P${pIdx + 1}] ${p.textContent.trim()}`).join('\n\n');

          try {
            await new Promise((resolve) => {
              LLMClient.translateStream({
                text: combined,
                targetLang,
                mode: 'fluent',
                settings: currentSettings,
                onDone: (finalText) => {
                  // 解析并注入
                  const parts = {};
                  const regex = /\[P(\d+)\]\s*([\s\S]*?)(?=(?:\[P\d+\]|$))/g;
                  let match;
                  while ((match = regex.exec(finalText)) !== null) {
                    parts[parseInt(match[1], 10) - 1] = match[2].trim();
                  }

                  const fallbackLines = finalText.split('\n\n').map(s => s.trim()).filter(Boolean);

                  chunk.forEach((pEl, pI) => {
                    let trans = parts[pI] || fallbackLines[pI] || finalText;
                    trans = trans.replace(/^\[P\d+\]\s*/, '');

                    const wrapper = doc.createElement('div');
                    wrapper.className = 'llm-bilingual-wrapper';
                    wrapper.innerHTML = `<span class="llm-bilingual-inner">${escapeHtml(trans)}</span>`;
                    pEl.insertAdjacentElement('afterend', wrapper);
                  });

                  resolve();
                },
                onError: (err) => {
                  appendLog(`段落翻译警告: ${err.message}`, 'warn');
                  resolve(); // 忽略单组错误继续
                }
              });
            });
          } catch (e) {}
        }

        // 注入 style
        const styleTag = doc.createElement('style');
        styleTag.textContent = bilingualCss;
        doc.head.appendChild(styleTag);

        // 写回 zip
        const serializer = new XMLSerializer();
        const updatedHtml = serializer.serializeToString(doc);
        zip.file(ch.fullPath, updatedHtml);
      }

      completed++;
      const percent = Math.round((completed / selectedIndices.length) * 100);
      progressPercentText.textContent = `${percent}%`;
      progressBarFill.style.width = `${percent}%`;
    }

    if (isTranslating) {
      appendLog('🎉 全书所选章节双语制作完成！正在重新打包生成 .epub 文件...', 'success');
      progressStatusTitle.textContent = '✅ 制作完成！';

      generatedBlob = await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/epub+zip'
      });

      btnStopTranslate.classList.add('hidden');
      btnDownloadEpub.classList.remove('hidden');
      appendLog(`打包成功，文件大小: ${Math.round(generatedBlob.size / 1024)} KB，点击下方按钮即可下载！`, 'success');
    }
  });

  // 停止翻译
  btnStopTranslate.addEventListener('click', () => {
    isTranslating = false;
    appendLog('用户已停止翻译操作。', 'warn');
    progressStatusTitle.textContent = '已暂停';
    btnStopTranslate.textContent = '已停止';
  });

  // 下载 EPUB
  btnDownloadEpub.addEventListener('click', () => {
    if (!generatedBlob) return;
    const url = URL.createObjectURL(generatedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `[双语对照] ${epubMeta.title}.epub`;
    a.click();
    URL.revokeObjectURL(url);
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
});