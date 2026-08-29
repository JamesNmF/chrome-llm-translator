# 🌐 LLM 翻译官 (Chrome Extension v1.3.0)

基于 DeepSeek / OpenAI / Claude / Gemini / Ollama / Chrome Built-in AI 的 Chrome 网页沉浸式双语对照、YouTube 视频双语字幕、PDF 双语阅读（支持 Vision 多模态扫描件识别）、专业术语库与 EPUB 电子书双语制作扩展。

---

## 🌟 核心功能一览

### 1. 📑 网页沉浸式双语对照 (Bilingual Web Translation)
- **智能 DOM 遍历与块级识别**：自动识别段落并保持代码块、公式与排版完整。
- **视口优先加载**：优先翻译当前可视区域，节省 Token 并提升响应速度。
- **多主题视觉支持**：支持虚线下划线、荧光高亮、弱化原文、引用框等样式。
- **快捷键无缝切换**：快捷键 `Alt + A` 快速在「双语对照 ⇄ 仅显示译文 ⇄ 还原原文」之间切换。

### 2. 🎬 YouTube / 网页视频即时双语字幕 (Video Subtitles)
- **实时字幕拦截与流式翻译**：自动监听视频字幕轨，低延迟流式呈现中英双行沉浸式悬浮字幕。

### 3. 📄 PDF 双语阅读与排版还原
- **严格几何对齐**：沿用原版 PDF 几何位置与版面结构。
- **段落级自适应覆盖**：整段包围盒纯白底覆盖，消除漏字与中英文重叠。
- **字号自适应缩放**：根据原段落高度自动微调最佳字号。
- **多模态 Vision 扫描件识别**：纯图片封面或扫描件 PDF 自动启动 Vision 视觉大模型识别翻译。
- **大纲目录树**：自动解析 PDF 内置书签目录树，点击直达目标章节。
- **划词生词本**：在 PDF 内划选生词快速查看释义并一键收藏。

### 4. 📖 专业术语库 (Glossary) 与 Token 翻译缓存
- **术语库强制遵循**：支持自定义行业专有名词（如 `Token => 标记`），翻译时自动注入 Prompt 强制锁定译法。
- **本地 Token 缓存 (Translation Memory)**：基于 IndexedDB 自动缓存已翻译内容，二次访问零 Token 消耗、秒级呈现。
- **生词本导出**：支持一键导出生词本为 CSV (兼容 Anki) 或 JSON 格式。

### 5. 📚 EPUB 电子书双语制作
- **完整解包与生成**：内置 JSZip 支持解包、多章节并发翻译、双语样式内联注入。
- **一键打包下载**：直接导出全新的 `[双语对照] 原书名.epub` 文件。

### 6. ⚡ 输入框 3 连空格翻译 (Input Box Enhance)
- 在任意网页输入框中输入文本后，**连续按 3 次空格键**，自动调用大模型翻译为地道英文（或目标语言）并替换。

### 7. 🔮 划词翻译与 Shadow DOM 隔离
- 鼠标选中文本后悬浮微标，点击展开流式打字机卡片。
- **Shadow DOM 样式隔离**：完全隔离宿主网页样式，排版不串样。

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