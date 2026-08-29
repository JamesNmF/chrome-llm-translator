/**
 * LLM 客户端：统一处理 OpenAI / DeepSeek / Claude / Gemini / Ollama 流式与非流式调用
 */

import { PROVIDERS, PROMPT_MODES, LANGUAGES } from './constants.js';

export class LLMClient {
  /**
   * 解析目标语言名称
   */
  static getLanguageName(code) {
    const found = LANGUAGES.find(l => l.code === code);
    return found ? found.name : code;
  }

  /**
   * 构建 System Prompt
   */
  static buildSystemPrompt(modeId, targetLangCode, customPrompts = {}) {
    const langName = this.getLanguageName(targetLangCode);
    let rawPrompt = customPrompts[modeId] || PROMPT_MODES[modeId]?.systemPrompt || PROMPT_MODES.fluent.systemPrompt;
    return rawPrompt.replace(/\{targetLang\}/g, langName);
  }

  /**
   * 发起流式翻译请求
   * @param {Object} options
   * @param {string} options.text 待翻译文本
   * @param {string} options.targetLang 目标语言代码
   * @param {string} options.mode 模式 (fluent, academic, vocab_analysis, literal, polishing)
   * @param {Object} options.settings 用户配置
   * @param {Function} options.onChunk 收到文本块回调 (chunk, accumulatedText)
   * @param {Function} options.onDone 完成回调 (fullText)
   * @param {Function} options.onError 错误回调 (error)
   * @param {AbortSignal} options.signal 取消信号
   */
  static async translateStream({
    text,
    targetLang,
    mode = 'fluent',
    settings,
    onChunk = () => {},
    onDone = () => {},
    onError = () => {},
    signal
  }) {
    const providerId = settings.provider || 'deepseek';
    const providerMeta = PROVIDERS[providerId] || PROVIDERS.custom;
    const protocol = providerMeta.protocol || 'openai';

    const apiKey = settings.apiKey?.trim();
    const baseUrl = (settings.baseUrl || providerMeta.baseUrl || '').replace(/\/+$/, '');
    const model = settings.model || providerMeta.defaultModel;
    const temperature = Number(settings.temperature ?? 0.3);

    if (providerId !== 'ollama' && !apiKey) {
      const err = new Error(`请先在插件设置中配置 ${providerMeta.name} 的 API Key`);
      onError(err);
      return;
    }

    const systemPrompt = this.buildSystemPrompt(mode, targetLang, settings.customPrompts);

    try {
      if (protocol === 'openai') {
        await this._streamOpenAI({
          baseUrl,
          apiKey,
          model,
          temperature,
          systemPrompt,
          userText: text,
          onChunk,
          onDone,
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
          userText: text,
          onChunk,
          onDone,
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
          userText: text,
          onChunk,
          onDone,
          onError,
          signal
        });
      } else {
        throw new Error(`不支持的协议类型: ${protocol}`);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // 用户主动取消
        return;
      }
      onError(err);
    }
  }

  /**
   * OpenAI 兼容流式处理 (适用于 DeepSeek / OpenAI / Ollama / 通义 / Kimi / Groq)
   */
  static async _streamOpenAI({ baseUrl, apiKey, model, temperature, systemPrompt, userText, onChunk, onDone, onError, signal }) {
    const endpoint = `${baseUrl}/chat/completions`;
    const headers = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

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

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let accumulatedText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留未完整的行

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
        } catch (e) {
          // 忽略单行解析异常
        }
      }
    }

    onDone(accumulatedText);
  }

  /**
   * Anthropic Claude 流式处理
   */
  static async _streamClaude({ baseUrl, apiKey, model, temperature, systemPrompt, userText, onChunk, onDone, onError, signal }) {
    const endpoint = `${baseUrl}/messages`;
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'dangerously-allow-browser': 'true'
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
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

  /**
   * Google Gemini 流式处理
   */
  static async _streamGemini({ baseUrl, apiKey, model, temperature, systemPrompt, userText, onChunk, onDone, onError, signal }) {
    const endpoint = `${baseUrl}/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
    const headers = {
      'Content-Type': 'application/json'
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userText }]
          }
        ],
        generationConfig: {
          temperature
        }
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