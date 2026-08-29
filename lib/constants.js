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
    tip: '标准稳定，4o-mini 极速且经济，支持多模态视觉'
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
    tip: '响应飞快，免费额度充裕，原生支持视觉与多语言'
  },
  chrome_ai: {
    id: 'chrome_ai',
    name: 'Chrome 内置本地 AI (Gemini Nano)',
    baseUrl: 'builtin://ai',
    models: ['gemini-nano'],
    defaultModel: 'gemini-nano',
    protocol: 'chrome_builtin',
    docsUrl: 'https://developer.chrome.com/docs/ai/built-in',
    tip: 'Chrome 128+ 内置原生 AI，100% 离线、免 API Key、零网络请求'
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
    tip: '支持通义千问、Kimi、GLM、Groq、OneAPI、NewAPI 等各类聚合平台'
  }
};

export const LANGUAGES = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'ru', name: 'Русский' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'ar', name: 'العربية' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'th', name: 'ไทย' }
];

export const PROMPT_MODES = {
  fluent: {
    id: 'fluent',
    name: '地道意译',
    desc: '通顺自然，符合中文母语阅读习惯',
    systemPrompt: `你是一位专业翻译官。将用户提供的文本翻译成地道、流畅的 {targetLang}。
要求：
1. 保持原意的前提下，符合目标语言的日常阅读习惯与文化背景；
2. 只输出最终翻译结果，不要输出任何引言、解释、前后缀或 Markdown 标记（除非原文有特殊格式）；
3. 专有名词（如人名、地名、产品名）请采用标准译法，若无标准译法可保留英文。`
  },
  academic: {
    id: 'academic',
    name: '学术严谨',
    desc: '术语精确，适合论文、技术文档与专业报告',
    systemPrompt: `你是一位顶级学术学者与技术翻译专家。将用户文本翻译为严谨、精准、专业学术风格的 {targetLang}。
要求：
1. 专业术语必须严格符合该学科规范；
2. 保持逻辑紧密与学术客观语气；
3. 只输出翻译正文，绝不包含任何多余文字。`
  },
  vocab_analysis: {
    id: 'vocab_analysis',
    name: '词法精析',
    desc: '划词深度解析：音标、词义、词根词缀与典型例句',
    systemPrompt: `你是一位资深英语名师。请对用户查询的单词或短语进行结构化深度拆解，输出清晰的 Markdown 格式：
1. **音标 & 核心词性词义**
2. **构词拆解**（词根、前缀、后缀记忆法）
3. **高频搭配 / 同义词辨析**
4. **2 个经典地道例句**（附带中文翻译）
请保持排版整洁紧凑。`
  },
  literal: {
    id: 'literal',
    name: '忠实直译',
    desc: '严格逐句对照，还原原文句式结构',
    systemPrompt: `你是一位严谨的直译翻译官。请将用户文本逐句忠实直译为 {targetLang}，严格对应原文的句子结构与修辞。只输出译文。`
  },
  polishing: {
    id: 'polishing',
    name: '母语润色',
    desc: '提升用词高级感，改善句子流畅度与文采',
    systemPrompt: `你是一位资深英文编辑兼母语审校专家。请对用户文本进行深度母语级润色与优化，修正语法瑕疵，提升用词精准度与文采。直接输出润色后的文本，并在文末简要标注 1~2 处关键改进点。`
  }
};

export const MODES = Object.values(PROMPT_MODES);

export const THEMES = [
  { id: 'dashed', name: '点线虚线', desc: '译文下方带优雅点线，清爽自然' },
  { id: 'highlight', name: '荧光高亮', desc: '淡黄荧光底色，重点清晰' },
  { id: 'dim_origin', name: '弱化原文', desc: '原文淡化半透明，突出译文' },
  { id: 'blockquote', name: '引用框', desc: '左侧品牌色竖线，结构分明' },
  { id: 'simple', name: '自然段落', desc: '极简无修饰，上下段落堆叠' }
];

export const DEFAULT_SETTINGS = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: '',
  model: 'deepseek-chat',
  targetLang: 'zh-CN',
  temperature: 0.3,
  theme: 'dashed',
  hotkeyBilingual: 'Alt+A',
  hotkeySelection: 'Alt+T',
  enableSpaceTranslate: true,
  enableSelectionBubble: true,
  enableBilingualCache: true,       // 启用本地 Token 缓存
  enableGlossary: true,             // 启用专业术语库
  enableVideoSubtitles: true,       // 启用视频双语字幕
  customPrompts: {}
};