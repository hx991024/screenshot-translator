# 🎨 漫画翻译器 - 多模态 AI

一款浏览器插件，通过框选网页区域，使用多模态 AI 进行图片文字识别和翻译。

## ✨ 核心功能

1. **鼠标框选** - 在网页上拖拽选择任意视觉区域
2. **智能截图** - 自动截取选区并转换为 Base64
3. **AI 翻译** - 调用多模态大模型识别并翻译文字
4. **蒙版覆盖** - 翻译结果显示在原区域的灰色蒙版上

## 🏗️ 项目结构

```
comic-translator/
├── manifest.json              # Manifest V3 配置
├── README.md                  # 项目说明
├── GUAID.md                   # 开发指南（原始需求）
└── src/
    ├── popup.html            # 插件主界面
    ├── popup.css             # Popup 样式
    ├── popup.js              # Popup 逻辑
    ├── options.html          # 设置页面
    ├── options.css           # 设置样式
    ├── options.js            # 设置逻辑
    ├── background.js         # Service Worker - API 调用
    └── content.js            # Content Script - 框选 & 截图
```

## 📦 安装使用

### 1. 准备工作

确保你有以下 API 之一的访问权限：
- OpenAI (GPT-4o, GPT-4V)
- 智谱 AI (GLM-4V)
- 阿里云通义千问 (Qwen-VL)
- Anthropic (Claude 3.5 Sonnet)
- 其他 OpenAI 兼容 API

### 2. 加载插件

```bash
# 1. 打开 Chrome/Edge 扩展程序页面
# Chrome: chrome://extensions/
# Edge: edge://extensions/

# 2. 开启"开发者模式"
# 3. 点击"加载已解压的扩展程序"
# 4. 选择 comic-translator 文件夹
```

### 3. 配置 API

1. 点击插件图标
2. 点击"设置 API"按钮
3. 填写以下信息：
   - **API Base URL**: `https://api.openai.com/v1` 或其他兼容 API 地址
   - **API Key**: 你的 API 密钥
   - **模型名称**: `gpt-4o`, `glm-4v`, `qwen-vl` 等
   - **目标语言**: 选择翻译目标语言
4. 点击"测试 API"验证配置
5. 点击"保存设置"

### 4. 使用翻译

1. 在任意网页点击插件图标
2. 点击"开始框选翻译"按钮
3. 在网页上拖拽选择要翻译的区域
4. 等待 AI 处理（约 2-10 秒）
5. 翻译结果将覆盖显示在原区域

## 🔧 技术实现细节

### 1. 区域框选 (content.js)

- **原理**: 创建全屏覆盖层，监听鼠标事件
- **交互**: 拖拽绘制矩形，实时显示选区边框
- **坐标**: 使用视口坐标系，确保跨 iframe 兼容

```javascript
// 框选流程
用户点击"开始框选" → 创建覆盖层 → 鼠标按下 → 拖拽 → 鼠标松开 → 截图处理
```

### 2. 截图裁剪 (content.js + background.js)

**方案**: `chrome.tabs.captureVisibleTab` + Canvas 裁剪

```javascript
// 1. 使用 Chrome API 截取整个可见页面
const dataUrl = await chrome.tabs.captureVisibleTab(null, {
  format: 'png',
  quality: 100
});

// 2. 在 Canvas 上裁剪选区
const img = new Image();
img.onload = () => {
  const scaleX = img.width / window.innerWidth;
  const scaleY = img.height / window.innerHeight;

  canvas.width = width * scaleX;
  canvas.height = height * scaleY;

  ctx.drawImage(
    img,
    left * scaleX, top * scaleY, width * scaleX, height * scaleY,
    0, 0, canvas.width, canvas.height
  );

  const croppedBase64 = canvas.toDataURL('image/png', 1.0);
};
```

**优势**:
- ✅ 支持跨 iframe、Canvas、图片
- ✅ 高分辨率，适合 OCR
- ✅ 无需复杂 DOM 计算

### 3. API 调用 (background.js)

**OpenAI 兼容协议**:

```javascript
const response = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  },
  body: JSON.stringify({
    model: model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageData } }
        ]
      }
    ],
    max_tokens: 2000
  })
});
```

### 4. 翻译结果显示 (content.js)

- **蒙版**: 半透明灰色背景 (`rgba(80, 80, 80, 0.92)`)
- **位置**: 绝对定位，覆盖原选区
- **交互**: 支持关闭、重新翻译、滚动查看长文本
- **不影响**: 原内容仍在蒙版下方，不被破坏

## 🧠 多模态 Prompt 模板

### 默认 Prompt

```text
你将看到一张网页截图图片。

任务要求：
1. 识别图片中所有可见文字
2. 自动判断文字语言
3. 将其完整翻译为【目标语言】
4. 保持原有段落结构和顺序
5. 不要添加图片中不存在的内容
6. 不要解释翻译过程，只输出翻译结果

如果图片中没有文字，返回：
【未识别到可翻译文本】
```

### 自定义 Prompt

在设置页面可以自定义 Prompt，例如：

**漫画专用 Prompt**:
```text
你将看到一张漫画截图。

任务要求：
1. 识别所有对话框和文字
2. 保留漫画的段落结构
3. 翻译为【简体中文】
4. 保持语气和情感
5. 不要添加解释

只输出翻译后的文字。
```

## 🔐 权限说明

```json
{
  "permissions": [
    "activeTab",      // 访问当前标签页
    "storage",        // 存储配置
    "scripting"       // 注入脚本
  ],
  "host_permissions": [
    "<all_urls>"      // 所有网站
  ]
}
```

**隐私说明**:
- ✅ API Key 仅存储在本地浏览器
- ✅ 截图数据仅用于 API 调用
- ✅ 不收集任何用户数据
- ✅ 不上传到任何第三方服务器（除用户配置的 API）

## 🐛 常见问题

### ❌ "image length and width do not meet the model restrictions"

**已修复！** ✅

**原因**: 旧版本测试图片为 1x1 像素，不符合模型要求

**解决方案**:
- 测试图片现在使用 100x100 像素
- 截图裁剪自动检查最小尺寸（50x50）
- 用户框选要求至少 30x30 像素

如果仍然出现此错误，请查看 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

### Q: 截图失败
**A**:
1. 检查是否在 `chrome://` 或 `edge://` 页面（这些页面不允许截图）
2. 确保插件有截图权限
3. 尝试刷新页面后重试

### Q: API 调用失败
**A**:
1. 检查 API Base URL 是否正确
2. 验证 API Key 是否有效
3. 确认模型名称是否支持多模态
4. 查看 [TROUBLESHOOTING.md](TROUBLESHOOTING.md) 获取详细错误排查

### Q: 翻译结果不准确
**A**:
1. 尝试调整 Prompt
2. 选择更高分辨率的模型
3. 确保选区包含清晰的文字
4. 可以重新翻译

### Q: 蒙版显示异常
**A**:
1. 检查页面是否有特殊的 CSS 定位
2. 尝试重新框选
3. 关闭蒙版后重新翻译

### Q: 如何选择合适的 API？
**A**:
- **中文漫画**: 智谱 AI (glm-4v) - 快速且便宜
- **英文翻译**: OpenAI (gpt-4o) - 最准确
- **国内服务**: 阿里云 (qwen-vl) - 稳定可靠
- **高质量**: Anthropic (claude-3.5) - 理解力强

详细配置参考: [API_REFERENCE.md](API_REFERENCE.md)

## 🚀 扩展功能建议

1. **历史记录** - 保存翻译历史
2. **批量翻译** - 同时框选多个区域
3. **语言检测** - 自动显示源语言
4. **快捷键** - 支持键盘快捷操作
5. **导出功能** - 导出翻译结果
6. **主题切换** - 浅色/深色模式

## 📝 开发调试

### 加载插件
1. `chrome://extensions/` → 开发者模式 → 加载已解压
2. 修改代码后，点击扩展页面的"刷新"按钮
3. 重新加载目标网页

### 查看日志
- **Popup**: 右键插件图标 → 检查
- **Content Script**: 在目标网页按 F12 → Console
- **Background**: 扩展页面 → "检查视图" → Service Worker

## 📄 License

MIT License

---

**开发完成** ✅
基于 GUAID.md 需求，完整实现了所有核心功能。
