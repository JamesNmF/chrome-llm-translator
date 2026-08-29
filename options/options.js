import { DEFAULT_SETTINGS, LANGUAGES, PROMPT_MODES, PROVIDERS, BILINGUAL_THEMES } from '../lib/constants.js';
import { LLMClient } from '../lib/llm-client.js';

document.addEventListener('DOMContentLoaded', async () => {
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const toastBanner = document.getElementById('toast-banner');

  // API
  const providerSelect = document.getElementById('provider-select');
  const providerTip = document.getElementById('provider-tip');
  const apiKeyInput = document.getElementById('api-key-input');
  const apiKeyLink = document.getElementById('api-key-link');
  const btnToggleKey = document.getElementById('btn-toggle-key');
  const baseUrlInput = document.getElementById('base-url-input');
  const modelInput = document.getElementById('model-input');
  const modelOptions = document.getElementById('model-options');
  const temperatureRange = document.getElementById('temperature-range');
  const tempVal = document.getElementById('temp-val');
  const btnTestApi = document.getElementById('btn-test-api');
  const testResultTag = document.getElementById('test-result-tag');

  // 双语
  const prefBilingualTheme = document.getElementById('pref-bilingual-theme');
  const prefShowFloatBall = document.getElementById('pref-show-float-ball');
  const prefEnableInputEnhance = document.getElementById('pref-enable-input-enhance');
  const prefInputTargetLang = document.getElementById('pref-input-target-lang');

  // 划词与偏好
  const prefEnableSelection = document.getElementById('pref-enable-selection');
  const prefSelectionTrigger = document.getElementById('pref-selection-trigger');
  const prefTargetLang = document.getElementById('pref-target-lang');
  const prefDefaultMode = document.getElementById('pref-default-mode');
  const prefAutoPronounce = document.getElementById('pref-auto-pronounce');

  // Prompt
  const promptModeSelect = document.getElementById('prompt-mode-select');
  const promptContentTextarea = document.getElementById('prompt-content-textarea');
  const btnResetPrompt = document.getElementById('btn-reset-prompt');

  // 数据
  const btnExportConfig = document.getElementById('btn-export-config');
  const btnImportConfig = document.getElementById('btn-import-config');
  const fileImportInput = document.getElementById('file-import-input');
  const btnClearAllHistory = document.getElementById('btn-clear-all-history');
  const btnResetAll = document.getElementById('btn-reset-all');

  const btnSaveAll = document.getElementById('btn-save-all');
  const saveStatusText = document.getElementById('save-status-text');

  let settings = { ...DEFAULT_SETTINGS };
  let currentProvider = 'deepseek';

  // 读取配置
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    settings = {
      ...DEFAULT_SETTINGS,
      ...stored.settings,
      providersConfig: {
        ...DEFAULT_SETTINGS.providersConfig,
        ...(stored.settings.providersConfig || {})
      },
      customPrompts: {
        ...(stored.settings.customPrompts || {})
      }
    };
  }
  currentProvider = settings.provider || 'deepseek';

  function initOptions() {
    // 渲染 Provider
    providerSelect.innerHTML = '';
    Object.values(PROVIDERS).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === currentProvider) opt.selected = true;
      providerSelect.appendChild(opt);
    });

    // 渲染双语主题
    prefBilingualTheme.innerHTML = '';
    BILINGUAL_THEMES.forEach(th => {
      const opt = document.createElement('option');
      opt.value = th.id;
      opt.textContent = `${th.name} - ${th.desc}`;
      if (th.id === (settings.bilingualTheme || 'dashed')) opt.selected = true;
      prefBilingualTheme.appendChild(opt);
    });

    // 渲染语言
    prefTargetLang.innerHTML = '';
    prefInputTargetLang.innerHTML = '';
    LANGUAGES.forEach(l => {
      const opt1 = document.createElement('option');
      opt1.value = l.code;
      opt1.textContent = l.name;
      if (l.code === settings.targetLang) opt1.selected = true;
      prefTargetLang.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = l.code;
      opt2.textContent = l.name;
      if (l.code === (settings.inputTargetLang || 'en')) opt2.selected = true;
      prefInputTargetLang.appendChild(opt2);
    });

    // 渲染模式
    prefDefaultMode.innerHTML = '';
    promptModeSelect.innerHTML = '';
    Object.values(PROMPT_MODES).forEach(m => {
      const opt1 = document.createElement('option');
      opt1.value = m.id;
      opt1.textContent = `${m.icon} ${m.name} (${m.desc})`;
      if (m.id === settings.defaultMode) opt1.selected = true;
      prefDefaultMode.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = m.id;
      opt2.textContent = `${m.icon} ${m.name}`;
      promptModeSelect.appendChild(opt2);
    });

    prefShowFloatBall.checked = settings.showFloatBall !== false;
    prefEnableInputEnhance.checked = settings.enableInputEnhance !== false;
    prefEnableSelection.checked = settings.enableSelection !== false;
    prefSelectionTrigger.value = settings.selectionTrigger || 'icon';
    prefAutoPronounce.checked = !!settings.autoPronounce;

    loadProviderFields(currentProvider);
    loadPromptField(promptModeSelect.value);
  }

  function loadProviderFields(providerId) {
    const meta = PROVIDERS[providerId] || PROVIDERS.custom;
    const provConfig = settings.providersConfig[providerId] || {
      apiKey: '',
      baseUrl: meta.baseUrl || '',
      model: meta.defaultModel || ''
    };

    providerTip.textContent = meta.tip || '';
    apiKeyInput.value = provConfig.apiKey || (providerId === settings.provider ? settings.apiKey : '');
    baseUrlInput.value = provConfig.baseUrl || meta.baseUrl || '';
    modelInput.value = provConfig.model || meta.defaultModel || '';
    temperatureRange.value = settings.temperature ?? 0.3;
    tempVal.textContent = temperatureRange.value;

    if (meta.docsUrl) {
      apiKeyLink.href = meta.docsUrl;
      apiKeyLink.style.display = 'inline';
    } else {
      apiKeyLink.style.display = 'none';
    }

    modelOptions.innerHTML = '';
    (meta.models || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      modelOptions.appendChild(opt);
    });

    testResultTag.textContent = '';
  }

  function saveCurrentProviderFields() {
    if (!settings.providersConfig) settings.providersConfig = {};
    settings.providersConfig[currentProvider] = {
      apiKey: apiKeyInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
      model: modelInput.value.trim()
    };
  }

  function loadPromptField(modeId) {
    const custom = settings.customPrompts?.[modeId];
    promptContentTextarea.value = custom || PROMPT_MODES[modeId]?.systemPrompt || '';
  }

  initOptions();

  // Tab 切换
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.dataset.tab;
      navItems.forEach(n => n.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(tabId).classList.add('active');
    });
  });

  providerSelect.addEventListener('change', () => {
    saveCurrentProviderFields();
    currentProvider = providerSelect.value;
    loadProviderFields(currentProvider);
  });

  btnToggleKey.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      btnToggleKey.textContent = '🔒';
    } else {
      apiKeyInput.type = 'password';
      btnToggleKey.textContent = '👁️';
    }
  });

  temperatureRange.addEventListener('input', () => {
    tempVal.textContent = temperatureRange.value;
  });

  promptModeSelect.addEventListener('change', () => {
    loadPromptField(promptModeSelect.value);
  });

  btnResetPrompt.addEventListener('click', () => {
    const modeId = promptModeSelect.value;
    if (settings.customPrompts) {
      delete settings.customPrompts[modeId];
    }
    loadPromptField(modeId);
    showToast('已重置该场景为官方默认 Prompt', 'success');
  });

  // 测试连接
  btnTestApi.addEventListener('click', async () => {
    testResultTag.textContent = '⏳ 正在发起测试请求...';
    testResultTag.className = 'test-tag';
    btnTestApi.disabled = true;

    saveCurrentProviderFields();

    const tempSettings = {
      ...settings,
      provider: currentProvider,
      apiKey: apiKeyInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
      model: modelInput.value.trim(),
      temperature: Number(temperatureRange.value)
    };

    const res = await LLMClient.testConnection(tempSettings);
    btnTestApi.disabled = false;

    if (res.success) {
      testResultTag.textContent = `✅ ${res.message} (译文: "${res.text.slice(0, 20)}")`;
      testResultTag.className = 'test-tag success';
    } else {
      testResultTag.textContent = `❌ ${res.message}`;
      testResultTag.className = 'test-tag error';
    }
  });

  // 保存所有设置
  btnSaveAll.addEventListener('click', async () => {
    saveCurrentProviderFields();

    const currentModeId = promptModeSelect.value;
    const currentPromptVal = promptContentTextarea.value.trim();
    if (!settings.customPrompts) settings.customPrompts = {};
    if (currentPromptVal && currentPromptVal !== PROMPT_MODES[currentModeId]?.systemPrompt) {
      settings.customPrompts[currentModeId] = currentPromptVal;
    } else {
      delete settings.customPrompts[currentModeId];
    }

    settings.provider = currentProvider;
    settings.apiKey = apiKeyInput.value.trim();
    settings.baseUrl = baseUrlInput.value.trim();
    settings.model = modelInput.value.trim();
    settings.temperature = Number(temperatureRange.value);

    // 双语与输入框
    settings.bilingualTheme = prefBilingualTheme.value;
    settings.showFloatBall = prefShowFloatBall.checked;
    settings.enableInputEnhance = prefEnableInputEnhance.checked;
    settings.inputTargetLang = prefInputTargetLang.value;

    settings.enableSelection = prefEnableSelection.checked;
    settings.selectionTrigger = prefSelectionTrigger.value;
    settings.targetLang = prefTargetLang.value;
    settings.defaultMode = prefDefaultMode.value;
    settings.autoPronounce = prefAutoPronounce.checked;

    await chrome.storage.sync.set({ settings });

    showToast('🎉 设置已成功保存并实时生效！', 'success');
    saveStatusText.textContent = `上次保存时间: ${new Date().toLocaleTimeString()}`;
  });

  btnExportConfig.addEventListener('click', () => {
    saveCurrentProviderFields();
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(settings, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `llm-translator-config-${new Date().toISOString().slice(0, 10)}.json`);
    dlAnchor.click();
    dlAnchor.remove();
  });

  btnImportConfig.addEventListener('click', () => {
    fileImportInput.click();
  });

  fileImportInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        settings = { ...DEFAULT_SETTINGS, ...imported };
        await chrome.storage.sync.set({ settings });
        currentProvider = settings.provider || 'deepseek';
        initOptions();
        showToast('✅ 配置文件导入成功！', 'success');
      } catch (err) {
        showToast('导入失败：无效的 JSON 配置文件', 'error');
      }
    };
    reader.readAsText(file);
  });

  btnClearAllHistory.addEventListener('click', async () => {
    if (confirm('确定要清空全部翻译历史记录吗？此操作不可逆。')) {
      await chrome.storage.local.set({ translation_history: [] });
      showToast('已清空全部翻译历史记录', 'success');
    }
  });

  btnResetAll.addEventListener('click', async () => {
    if (confirm('确定要恢复出厂设置吗？所有配置与自定义 API 将被重置。')) {
      settings = { ...DEFAULT_SETTINGS };
      await chrome.storage.sync.set({ settings });
      currentProvider = 'deepseek';
      initOptions();
      showToast('已恢复为初始默认出厂设置', 'success');
    }
  });

  function showToast(msg, type = 'success') {
    toastBanner.textContent = msg;
    toastBanner.className = `toast-banner ${type}`;
    setTimeout(() => {
      toastBanner.className = 'toast-banner hidden';
    }, 3000);
  }
});