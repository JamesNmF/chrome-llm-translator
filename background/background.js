/**
 * Background Service Worker
 * 管理右键菜单、快捷键监听、初始化配置与跨上下文消息分发
 */

import { DEFAULT_SETTINGS } from '../lib/constants.js';
import './hot-reload.js';

// 初始化安装
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[LLM-Translator] 插件安装/更新:', details.reason);

  const stored = await chrome.storage.sync.get('settings');
  if (!stored.settings) {
    await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
    console.log('[LLM-Translator] 已写入初始默认配置');
  }

  // 1. 划词翻译菜单
  chrome.contextMenus.create({
    id: 'llm-translate-selection',
    title: '🌐 使用 AI 翻译选中文本',
    contexts: ['selection']
  });

  // 2. 双语对照菜单
  chrome.contextMenus.create({
    id: 'llm-toggle-bilingual-page',
    title: '📑 切换全网页双语对照 (Alt+A)',
    contexts: ['page']
  });

  // 3. PDF 阅读器右键打开菜单 (针对链接)
  chrome.contextMenus.create({
    id: 'llm-open-pdf-link',
    title: '📑 在 PDF 双语阅读器中打开此链接',
    contexts: ['link']
  });
});

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'llm-translate-selection' && info.selectionText) {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'TRIGGER_TRANSLATE_SELECTION',
        text: info.selectionText
      }).catch(() => {});
    }
  } else if (info.menuItemId === 'llm-toggle-bilingual-page') {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_BILINGUAL_PAGE'
      }).catch(() => {});
    }
  } else if (info.menuItemId === 'llm-open-pdf-link' && info.linkUrl) {
    const readerUrl = chrome.runtime.getURL(`pdf/reader.html?url=${encodeURIComponent(info.linkUrl)}`);
    chrome.tabs.create({ url: readerUrl });
  }
});

// 监听快捷键触发
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (command === 'translate-selection') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'TRIGGER_HOTKEY_TRANSLATE'
    }).catch(() => {});
  } else if (command === 'toggle-bilingual-page') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'TOGGLE_BILINGUAL_PAGE'
    }).catch(() => {});
  }
});

// 监听通用消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_OPTIONS_PAGE') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
  } else if (message.type === 'OPEN_PDF_READER') {
    const readerUrl = chrome.runtime.getURL(message.url ? `pdf/reader.html?url=${encodeURIComponent(message.url)}` : 'pdf/reader.html');
    chrome.tabs.create({ url: readerUrl });
    sendResponse({ success: true });
  }
  return true;
});