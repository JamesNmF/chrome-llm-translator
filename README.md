# 🌐 LLM 翻译官 (Chrome Extension v1.4.0)

基于 DeepSeek / OpenAI / Claude / Gemini / Ollama / Chrome Built-in AI 的 Chrome 网页沉浸式双语对照、YouTube 视频双语字幕、Word (.docx) 双语文档制作、PDF 双语阅读（支持 Vision 多模态扫描件识别）、专业术语库与 EPUB 电子书制作扩展。

---

## 🌟 核心功能一览

### 1. 📝 Word (.docx) 双语文档制作器 (全新功能)
- **纯本地解包与排版保留**：直接拖入英文或外文 `.docx` 文档，浏览器本地解析段落与格式。
- **双语对照与全译文模式**：支持在原段落下方紧跟中文译文（双语对照），或原样保留排版替换为纯中文。
- **一键打包导出**：自动生成 `[双语对照] 原书名.docx`，格式、表格、粗体无损还原。

### 2. 📑 网页沉浸式双语对照 (Bilingual Web Translation)
- **智能 DOM 遍历与块级识别**：自动识别正文段落，保持代码块、公式与排版完整。
- **多模式一键切换**：Popup 弹窗与悬浮球支持「显示原文 ⇄ 双语对照 ⇄ 仅看译文」极速切换（快捷键 `Alt + A`）。
- **多主题视觉支持**：支持点线虚线、荧光高亮、弱化原文、引用框等样式。

### 3. 🎬 YouTube / 网页视频即时双语字幕 (Video Subtitles)
- **实时字幕拦截与大字号接管**：深度接管原生字幕节点，30px / 42px 超大金黄高亮双语字幕，告别字幕重叠。

### 4. 📄 PDF 双语阅读与排版还原
- **严格几何对齐**：沿用原版 PDF 几何位置与版面结构。
- **多模态 Vision 扫描件识别**：纯图片封面或扫描件 PDF 自动启动 Vision 视觉大模型识别翻译。
- **大纲目录树与生词本**：自动解析 PDF 内置书签目录树，划选生词一键收藏。

### 5. 📖 专业术语库 (Glossary) 与 Token 翻译缓存
- **术语库强制遵循**：支持自定义行业专有名词（如 `Token => 标记`），翻译时自动注入 Prompt 强制锁定译法。
- **本地 Token 缓存 (Translation Memory)**：基于 IndexedDB 自动缓存已翻译内容，二次访问零 Token 消耗、秒级呈现。
- **生词本导出**：支持一键导出生词本为 CSV (兼容 Anki) 或 JSON 格式。

### 6. 📚 EPUB 电子书双语制作
- **完整解包与生成**：内置 JSZip 支持解包、多章节并发翻译、双语样式内联注入。
- **一键打包下载**：直接导出全新的 `[双语对照] 原书名.epub` 文件。

### 7. 🔮 划词翻译与 Shadow DOM 隔离
- 鼠标选中文本后悬浮微标，点击展开流式打字机卡片。
- **智能双向语种互译**：划选中文字符自动切换为 English（中译英），划选外文自动翻译为简体中文。

### 8. 🤖 全大模型生态兼容
- **DeepSeek** (deepseek-chat / deepseek-reasoner)
- **OpenAI** (gpt-4o-mini / gpt-4o 等，支持 Vision 多模态)
- **Anthropic Claude** (claude-3-5-haiku / claude-3-5-sonnet)
- **Google Gemini** (gemini-1.5-flash / gemini-2.0-flash 等，原生视觉与多语言)
- **Chrome 内置 AI** (Gemini Nano / window.ai，100% 离线、免 API Key、零网络请求)
- **本地 Ollama** (qwen2.5 / llama3 / deepseek-r1 等本地离线大模型)
- **自定义 OpenAI 兼容接口** (通义千问、Kimi、GLM、Groq、OneAPI、NewAPI 等)

---

## 🚀 安装指南

1. 下载项目源码或 Release 压缩包并解压；
2. 打开 Google Chrome，访问 `chrome://extensions/`；
3. 开启右上角 **「开发者模式」**；
4. 点击左上角 **「加载已解压的扩展程序」**，选择本项目文件夹；
5. 点击插件图标进入设置页，填入 API Key（或选择本地 Ollama / Chrome Built-in AI），点击测试连通性并保存即可。

---

## ⌨️ 快捷键

| 快捷键 | 功能描述 |
| :--- | :--- |
| `Alt + A` | **切换网页双语对照 / 仅译文 / 还原原文** |
| `Alt + T` | **对当前划选的文本呼出翻译悬浮窗** |
| `输入框连按 3 次空格` | **快速将输入框中文翻译为目标语言** |

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源。