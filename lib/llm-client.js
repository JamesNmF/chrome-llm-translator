/**
 * LLM 客户端：统一处理 OpenAI / DeepSeek / Claude / Gemini / Ollama / Chrome Built-in AI 流式与多模态 Vision 调用
 */

import { PROVIDERS, PROMPT_MODES, LANGUAGES } from './constants.js';
import { dbInstance } from './cache-db.js';

export class LLMClient {
  static getLanguageName(code) {
    const found = LANGUAGES.find(l => l.code === code);
    return found ? found.name : code;
  }

  /**
   * 构建 System Prompt 并动态注入术语表
   */
  static async buildSystemPrompt(modeId, targetLangCode, customPrompts = {}, userText = '', enableGlossary = true) {
    const langName = this.getLanguageName(targetLangCode);
    let rawPrompt = customPrompts[modeId] || PROMPT_MODES[modeId]?.systemPrompt || PROMPT_MODES.fluent.systemPrompt;
    let prompt = rawPrompt.replace(/\{targetLang\}/g, langName);

    // 动态匹配术语库
    if (enableGlossary && userText) {
      try {
        const glossaryList = await dbInstance.getGlossaryList();
        if (glossaryList && glossaryList.length > 0) {
          const matched = glossaryList.filter(item => 
            item.term && new RegExp(`\\b${escapeRegExp(item.term)}\\b`, 'i').test(userText)
          );
          if (matched.length > 0) {
            const glossaryRules = matched.map(m => `- "${m.term}" => "${m.translation}"`).join('\n');
            prompt += `\n\n【必须严格遵循的专业术语对照】：\n${glossaryRules}\n请确保译文中涉及上述术语时完全遵照该映射！`;
          }
        }
      } catch (e) {}
    }

    return prompt;
  }

  /**
   * 文本流式翻译 (集成本地缓存与术语库)
   */
  static async translateStream({ text, targetLang = 'zh-CN', mode = 'fluent', settings = {}, forceRefresh = false, onChunk = () => {}, onDone = () => {}, onError = () => {}, signal }) {
    if (!text || !text.trim()) {
      onDone('');
      return;
    }

    const { provider = 'deepseek', apiKey = '', baseUrl = '', model = '', temperature = 0.2 } = settings;
    const providerMeta = PROVIDERS[provider] || PROVIDERS.custom;
    const protocol = providerMeta.protocol;

    // 1. 尝试从本地 IndexedDB 缓存读取 (非 forceRefresh 且非词法精析模式)
    if (!forceRefresh && settings.enableBilingualCache !== false && mode !== 'vocab_analysis') {
      try {
        const cached = await dbInstance.getTranslation(text, targetLang, mode);
        if (cached && !CacheDB.isGarbageTranslation(cached)) {
          onChunk(cached, cached);
          onDone(cached);
          return;
        }
      } catch (e) {}
    }

    const providerId = settings.provider || 'deepseek';
    const providerMeta = PROVIDERS[providerId] || PROVIDERS.custom;
    const protocol = providerMeta.protocol || 'openai';

    const apiKey = settings.apiKey?.trim();
    const baseUrl = (settings.baseUrl || providerMeta.baseUrl || '').replace(/\/+$/, '');
    const model = settings.model || providerMeta.defaultModel;
    const temperature = Number(settings.temperature ?? 0.3);

    if (protocol !== 'chrome_builtin' && providerId !== 'ollama' && !apiKey) {
      const err = new Error(`请先在插件设置中配置 ${providerMeta.name} 的 API Key`);
      onError(err);
      return;
    }

    const systemPrompt = await this.buildSystemPrompt(mode, targetLang, settings.customPrompts, text, settings.enableGlossary !== false);
    const langName = this.getLanguageName(targetLang);

    // 标准化用户消息，杜绝任何大模型客套话或误当对话
    let formattedUserText = text;
    if (mode === 'vocab_analysis') {
      formattedUserText = `请深度解析以下词汇：\n\n${text}`;
    } else if (mode === 'polishing') {
      formattedUserText = `Please polish the following text:\n\n${text}`;
    } else {
      formattedUserText = `Translate the following text into ${langName}:\n\n${text}`;
    }

    // 包装 onDone 自动存入本地缓存
    const wrappedOnDone = async (finalText) => {
      if (finalText && settings.enableBilingualCache !== false && mode !== 'vocab_analysis') {
        try {
          await dbInstance.setTranslation(text, finalText, targetLang, mode);
        } catch (e) {}
      }
      onDone(finalText);
    };

    try {
      if (protocol === 'openai') {
        await this._streamOpenAI({
          baseUrl,
          apiKey,
          model,
          temperature,
          systemPrompt,
          userText: formattedUserText,
          onChunk,
          onDone: wrappedOnDone,
          onError,
          signal
        });
      } else if (protocol === 'claude') {
        await this._streamClaude({
          baseUrl,
          apiKey,
          model,
          temperature,
          systemPrompt,
          userText: formattedUserText,
          onChunk,
          onDone: wrappedOnDone,
          onError,
          signal
        });
      } else if (protocol === 'gemini') {
        await this._streamGemini({
          baseUrl,
          apiKey,
          model,
          temperature,
          systemPrompt,
          userText: formattedUserText,
          onChunk,
          onDone: wrappedOnDone,
          onError,
          signal
        });
      } else if (protocol === 'chrome_builtin') {
        await this._streamChromeBuiltinAI({
          systemPrompt,
          userText: formattedUserText,
          onChunk,
          onDone: wrappedOnDone,
          onError,
          signal
        });
      } else {
        throw new Error(`不支持的协议类型: ${protocol}`);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      onError(err);
    }
  }

  /**
   * 多模态 Vision 视觉识别流式翻译 (用于纯图片/扫描件 PDF)
   */
  static async translateVisionStream({
    imageBase64,
    targetLang = 'zh-CN',
    settings,
    onChunk = () => {},
    onDone = () => {},
    onError = () => {},
    signal
  }) {
    const langName = this.getLanguageName(targetLang);
    const systemPrompt = `你是一位高阶版面还原与翻译专家。图像是学术报告或书籍的一页。
请按以下规范操作：
1. 识别图像中的全部标题、重点框、自然段落与列表文字；
2. 将其翻译为通顺、优美、地道的 ${langName}；
3. 保留原版段落分界与编号；只输出翻译后的文本正文，严禁输出任何问候或额外标记。`;

    const providerId = settings.provider || 'deepseek';
    const providerMeta = PROVIDERS[providerId] || PROVIDERS.custom;
    const protocol = providerMeta.protocol || 'openai';

    // 处理 base64 前缀
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    const dataUri = `data:image/jpeg;base64,${cleanBase64}`;

    try {
      if (protocol === 'openai') {
        const endpoint = `${(settings.baseUrl || providerMeta.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`;
        const visionModel = providerId === 'openai' ? 'gpt-4o-mini' : (settings.model || providerMeta.defaultModel);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.apiKey}`
          },
          signal,
          body: JSON.stringify({
            model: visionModel,
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: [
                  { type: 'text', text: '请翻译此页面图片中的所有内容：' },
                  { type: 'image_url', image_url: { url: dataUri } }
                ]
              }
            ],
            temperature: 0.2,
            stream: true
          })
        });

        if (!response.ok) throw new Error(`Vision 请求失败 HTTP ${response.status}`);
        await this._consumeOpenAIStream(response, onChunk, onDone);
      } else if (protocol === 'gemini') {
        const model = settings.model?.includes('gemini') ? settings.model : 'gemini-1.5-flash';
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${settings.apiKey}&alt=sse`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [
              {
                role: 'user',
                parts: [
                  { text: '请识别并翻译此页面的所有文字：' },
                  { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } }
                ]
              }
            ]
          })
        });

        if (!response.ok) throw new Error(`Gemini Vision 请求失败 HTTP ${response.status}`);
        await this._consumeGeminiStream(response, onChunk, onDone);
      } else {
        throw new Error('当前提供商暂不支持 Vision 多模态接口，请在设置中选用 OpenAI (gpt-4o-mini) 或 Google Gemini');
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      onError(err);
    }
  }

  // ==================== 底层流式协议实现 ====================

  static async _streamOpenAI({ baseUrl, apiKey, model, temperature, systemPrompt, userText, onChunk, onDone, onError, signal }) {
    const endpoint = `${baseUrl}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText }
        ],
        temperature,
        stream: true
      })
    });

    if (!response.ok) {
      let errMsg = `请求失败 HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        errMsg = errJson.error?.message || errJson.message || errMsg;
      } catch (e) {
        const errText = await response.text();
        if (errText) errMsg = errText.slice(0, 300);
      }
      throw new Error(errMsg);
    }

    await this._consumeOpenAIStream(response, onChunk, onDone);
  }

  static async _consumeOpenAIStream(response, onChunk, onDone) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let accumulatedText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        if (trimmed === 'data: [DONE]') continue;

        try {
          const jsonStr = trimmed.replace(/^data:\s*/, '');
          const data = JSON.parse(jsonStr);
          const delta = data.choices?.[0]?.delta?.content || '';
          if (delta) {
            accumulatedText += delta;
            onChunk(delta, accumulatedText);
          }
        } catch (e) {}
      }
    }

    onDone(accumulatedText);
  }

  static async _streamClaude({ baseUrl, apiKey, model, temperature, systemPrompt, userText, onChunk, onDone, onError, signal }) {
    const endpoint = `${baseUrl}/messages`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'dangerously-allow-browser': 'true'
      },
      signal,
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }],
        max_tokens: 4096,
        temperature,
        stream: true
      })
    });

    if (!response.ok) {
      let errMsg = `Claude 请求失败 HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        errMsg = errJson.error?.message || errMsg;
      } catch (e) {}
      throw new Error(errMsg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let accumulatedText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        try {
          const jsonStr = trimmed.replace(/^data:\s*/, '');
          const data = JSON.parse(jsonStr);
          if (data.type === 'content_block_delta') {
            const delta = data.delta?.text || '';
            if (delta) {
              accumulatedText += delta;
              onChunk(delta, accumulatedText);
            }
          }
        } catch (e) {}
      }
    }

    onDone(accumulatedText);
  }

  static async _streamGemini({ baseUrl, apiKey, model, temperature, systemPrompt, userText, onChunk, onDone, onError, signal }) {
    const endpoint = `${baseUrl}/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { temperature }
      })
    });

    if (!response.ok) {
      let errMsg = `Gemini 请求失败 HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        errMsg = errJson.error?.message || errMsg;
      } catch (e) {}
      throw new Error(errMsg);
    }

    await this._consumeGeminiStream(response, onChunk, onDone);
  }

  static async _consumeGeminiStream(response, onChunk, onDone) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let accumulatedText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        try {
          const jsonStr = trimmed.replace(/^data:\s*/, '');
          const data = JSON.parse(jsonStr);
          const candidates = data.candidates || [];
          if (candidates.length > 0) {
            const parts = candidates[0].content?.parts || [];
            for (const part of parts) {
              if (part.text) {
                accumulatedText += part.text;
                onChunk(part.text, accumulatedText);
              }
            }
          }
        } catch (e) {}
      }
    }

    onDone(accumulatedText);
  }

  /**
   * Chrome 128+ 内置原生 AI (window.ai) 离线流式调用
   */
  static async _streamChromeBuiltinAI({ systemPrompt, userText, onChunk, onDone, onError, signal }) {
    if (typeof window === 'undefined' || (!window.ai && !window.translation)) {
      throw new Error('当前浏览器环境尚未开启 Chrome 内置 AI (请使用 Chrome 128+ 并在 chrome://flags 中启用 Prompt API)');
    }

    try {
      // 优先使用 window.ai.languageModel
      if (window.ai?.languageModel) {
        const session = await window.ai.languageModel.create({
          systemPrompt: systemPrompt
        });
        const stream = session.promptStreaming(userText, { signal });
        let accumulated = '';
        for await (const chunk of stream) {
          accumulated = chunk;
          onChunk(chunk, accumulated);
        }
        onDone(accumulated);
        session.destroy();
        return;
      }
      throw new Error('未检测到可用的 Chrome 内置 LanguageModel 实例');
    } catch (e) {
      throw new Error(`Chrome 内置 AI 调用失败: ${e.message}`);
    }
  }

  /**
   * 一键测试连通性
   */
  static async testConnection(settings) {
    const startTime = performance.now();
    return new Promise((resolve) => {
      let resultText = '';
      this.translateStream({
        text: 'Hello, World!',
        targetLang: 'zh-CN',
        mode: 'fluent',
        settings,
        onChunk: (chunk) => {
          resultText += chunk;
        },
        onDone: (fullText) => {
          const duration = Math.round(performance.now() - startTime);
          resolve({
            success: true,
            duration,
            text: fullText || resultText,
            message: `连接成功！响应耗时: ${duration}ms`
          });
        },
        onError: (err) => {
          const duration = Math.round(performance.now() - startTime);
          resolve({
            success: false,
            duration,
            message: `连接失败: ${err.message}`
          });
        }
      });
    });
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}