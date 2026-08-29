/**
 * 🪟 网页双生分屏驱动引擎 (Twin Mirror Reader)
 */

document.addEventListener('DOMContentLoaded', async () => {
  const urlInput = document.getElementById('target-url-input');
  const btnLoadUrl = document.getElementById('btn-load-url');
  const btnReloadBoth = document.getElementById('btn-reload-both');
  const btnSwapViews = document.getElementById('btn-swap-views');
  const resizer = document.getElementById('twin-resizer');
  const leftPane = document.getElementById('left-pane');
  const rightPane = document.getElementById('right-pane');
  const leftFrame = document.getElementById('left-frame');
  const rightFrame = document.getElementById('right-frame');
  const statusText = document.getElementById('page-status-text');

  // 解析 URL 参数
  const params = new URLSearchParams(window.location.search);
  const initialUrl = params.get('url') || 'https://en.wikipedia.org/wiki/Main_Page';

  urlInput.value = initialUrl;
  loadUrl(initialUrl);

  btnLoadUrl.addEventListener('click', () => {
    let url = urlInput.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    urlInput.value = url;
    loadUrl(url);
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnLoadUrl.click();
  });

  btnReloadBoth.addEventListener('click', () => {
    statusText.textContent = '正在刷新双侧网页...';
    leftFrame.src = leftFrame.src;
    rightFrame.src = rightFrame.src;
  });

  let isSwapped = false;
  btnSwapViews.addEventListener('click', () => {
    isSwapped = !isSwapped;
    if (isSwapped) {
      leftPane.style.order = '3';
      rightPane.style.order = '1';
    } else {
      leftPane.style.order = '1';
      rightPane.style.order = '3';
    }
  });

  // 加载双侧页面
  function loadUrl(targetUrl) {
    statusText.textContent = `正在加载: ${targetUrl}...`;
    leftFrame.src = targetUrl;
    rightFrame.src = targetUrl;
  }

  // 左右拖拽调节比例
  let isDragging = false;
  resizer.addEventListener('mousedown', () => {
    isDragging = true;
    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    // 遮挡 iframe 避免拖拽被 iframe 内部吞掉事件
    leftFrame.style.pointerEvents = 'none';
    rightFrame.style.pointerEvents = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const ratio = (e.clientX / window.innerWidth) * 100;
    const clamped = Math.max(20, Math.min(80, ratio));
    leftPane.style.flex = `0 0 ${clamped}%`;
    rightPane.style.flex = `0 0 ${100 - clamped}%`;
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      resizer.classList.remove('dragging');
      document.body.style.userSelect = '';
      leftFrame.style.pointerEvents = 'auto';
      rightFrame.style.pointerEvents = 'auto';
    }
  });

  // 同轴双向同步滚动驱动器
  let isSyncing = false;

  window.addEventListener('message', (e) => {
    if (!e.data || typeof e.data !== 'object') return;

    if (e.data.type === 'TWIN_SCROLL_UPDATE') {
      if (isSyncing) return;
      isSyncing = true;
      const { sourcePane, scrollY, scrollHeight } = e.data;

      const targetFrame = sourcePane === 'left' ? rightFrame : leftFrame;
      if (targetFrame && targetFrame.contentWindow) {
        targetFrame.contentWindow.postMessage({
          type: 'TWIN_SCROLL_SET',
          scrollY,
          scrollHeight
        }, '*');
      }

      setTimeout(() => { isSyncing = false; }, 30);
    }
  });

  leftFrame.addEventListener('load', () => {
    statusText.textContent = '左侧原始网页就绪';
  });

  rightFrame.addEventListener('load', () => {
    statusText.textContent = '右侧镜像就绪，正在准备全网页翻译...';
    // 通知右侧 iframe 开启仅看译文模式
    try {
      rightFrame.contentWindow.postMessage({ type: 'AUTO_TRANSLATE_TRANSLATION_MODE' }, '*');
    } catch (e) {}
  });
});