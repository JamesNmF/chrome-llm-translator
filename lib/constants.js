/**
 * LLM 翻译插件常量与默认配置定义
 */

export const PROVIDERS = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek (深度求索)',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    protocol: 'openai',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    tip: '性价比极高，中文理解与翻译能力卓越'
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o-mini',
    protocol: 'openai',
    docsUrl: 'https://platform.openai.com/api-keys',
    tip: '标准稳定，4o-mini 极速且经济'
  },
  claude: {
    id: 'claude',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022'],
    defaultModel: 'claude-3-5-haiku-20241022',
    protocol: 'claude',
    docsUrl: 'https://console.anthropic.com/',
    tip: '文学修辞与语境表达极其自然'
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'],
    defaultModel: 'gemini-1.5-flash',
    protocol: 'gemini',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    tip: '响应飞快，免费额度充裕'
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (本地/离线)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen2.5:7b', 'llama3.1:8b', 'deepseek-r1:7b', 'gemma2:9b'],
    defaultModel: 'qwen2.5:7b',
    protocol: 'openai',
    docsUrl: 'https://ollama.com/',
    tip: '完全本地运行，100% 保护隐私与离线翻译'
  },
  custom: {
    id: 'custom',
    name: '自定义 OpenAI 兼容接口',
    baseUrl: '',
    models: ['custom-model'],
    defaultModel: 'custom-model',
    protocol: 'openai',
    docsUrl: '',
    tip: '支持通义千问、Kimi、GLM、Groq、OneAPI、NewAPI 等各类中转/聚合平台'
  }
};

export const LANGUAGES = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: 'English (英语)' },
  { code: 'ja', name: '日本語 (日语)' },
  { code: 'ko', name: '한국어 (韩语)' },
  { code: 'fr', name: 'Français (法语)' },
  { code: 'de', name: 'Deutsch (德语)' },
  { code: 'es', name: 'Español (西班牙语)' },
  { code: 'ru', name: 'Русский (俄语)' },
  { code: 'it', name: 'Italiano (意大利语)' },
  { code: 'pt', name: 'Português (葡萄牙语)' },
  { code: 'ar', name: 'العربية (阿拉伯语)' }
];

export const BILINGUAL_THEMES = [
  { id: 'dashed', name: '✨ 点线虚线 (Dashed Underline)', desc: '译文带淡色虚线底边，清爽自然' },
  { id: 'highlight', name: '🖍️ 荧光便签 (Highlight)', desc: '译文淡黄荧光背景微圆角' },
  { id: 'dim_origin', name: '🌫️ 弱化原文 (Dim Original)', desc: '原文半透明弱化，突出译文' },
  { id: 'blockquote', name: '📑 优雅引用框 (Blockquote)', desc: '左侧带品牌色装饰线' },
  { id: 'simple', name: '🍃 极简无干扰 (Simple)', desc: '原文与译文自然段落堆叠' }
];

export const PROMPT_MODES = {
  fluent: {
    id: 'fluent',
    name: '地道意译',
    icon: '✨',
    desc: '流畅自然，符合目标语言地道习惯',
    systemPrompt: `You are a professional and natural translator. Your goal is to translate the provided text into the target language {targetLang}.
Guidelines:
1. Translate fluently and idiomatically, avoiding mechanical word-for-word translation.
2. Preserve the original tone, nuance, and intent.
3. Keep specialized terms accurate and keep code, formulas, and markup intact.
4. Output ONLY the final translation without any explanations, pleasantries, or introductory prefixes unless specified.`
  },
  academic: {
    id: 'academic',
    name: '学术严谨',
    icon: '🎓',
    desc: '术语精准规范，专业客观严谨',
    systemPrompt: `You are an expert academic translator and peer reviewer. Translate the given text into {targetLang} for an academic paper or technical publication.
Guidelines:
1. Use standardized scholarly terminology and formal scientific register.
2. Maintain precise conceptual clarity and logical coherence.
3. Preserve mathematical notations, citations, variable names, and code blocks exactly.
4. Output ONLY the academic translation directly.`
  },
  vocab_analysis: {
    id: 'vocab_analysis',
    name: '词法精析',
    icon: '📖',
    desc: '生词拆解、短语搭配、语法解析与例句',
    systemPrompt: `You are an elite linguistic instructor and language coach. Analyze and translate the given text into {targetLang}.
Please structure your response in clear markdown sections:
### 1. 🎯 核心译文 (Translation)
(Provide the most accurate and natural translation)

### 2. 📚 重点生词与短语 (Key Vocabulary & Idioms)
(List key words with phonetic/pronunciation, part of speech, definition, and typical collocations)

### 3. 🔍 语法与句式拆解 (Grammar & Sentence Structure)
(Explain difficult syntactic structures, clauses, or stylistic nuances)

### 4. 💡 拓展例句 (Example Usage)
(Provide 1-2 high-frequency authentic example sentences with translations)`
  },
  literal: {
    id: 'literal',
    name: '忠实直译',
    icon: '📐',
    desc: '紧贴原文句法与词义结构',
    systemPrompt: `You are a precision translator. Translate the text into {targetLang} faithfully and accurately, staying as close as possible to the literal meaning, clause structure, and word choices of the source text while ensuring grammatical correctness.
Output ONLY the translation.`
  },
  polishing: {
    id: 'polishing',
    name: '母语润色',
    icon: '💎',
    desc: '语法纠错、词汇升级与表达优化',
    systemPrompt: `You are an expert language editor and copywriter. Polish and elevate the given text in {targetLang} (or its original language if no translation is needed).
Please provide:
### ✨ 润色推荐版本 (Polished Version)
(A refined, eloquent, and professional version)

### 📝 优化与修改要点 (Key Improvements)
(Briefly list the grammar fixes, vocabulary upgrades, or flow enhancements made)`
  }
};

export const DEFAULT_SETTINGS = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  temperature: 0.3,
  
  providersConfig: {
    deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    claude: { apiKey: '', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-20241022' },
    gemini: { apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' },
    ollama: { apiKey: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
    custom: { apiKey: '', baseUrl: '', model: '' }
  },

  // 偏好设置
  targetLang: 'zh-CN',
  defaultMode: 'fluent',
  enableSelection: true,         // 是否开启划词
  selectionTrigger: 'icon',      // 'icon' (点悬浮图标弹出) | 'auto' (划选后立即弹出)
  streamOutput: true,           // 是否启用打字机流式输出
  autoPronounce: false,         // 翻译完成后是否自动发音
  
  // 沉浸式双语与增强功能
  enableBilingualPage: true,    // 是否启用全网页双语对照
  bilingualTheme: 'dashed',      // 双语对照视觉主题 ('dashed', 'highlight', 'dim_origin', 'blockquote', 'simple')
  showFloatBall: true,          // 是否显示页面右下角悬浮球
  enableInputEnhance: true,     // 是否启用输入框连按3次空格自动翻译
  inputTargetLang: 'en',        // 输入框翻译目标语言 (如中文->英文)

  customPrompts: {}
};