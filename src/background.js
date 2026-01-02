/**
 * Background Service Worker
 * 负责：
 * 1. 截图权限调用 (chrome.tabs.captureVisibleTab)
 * 2. OpenAI 兼容 API 调用
 * 3. 与 content script 和 popup 通信
 */

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'captureTab') {
    // 处理截图请求
    handleCaptureTab().then(sendResponse);
    return true; // 保持消息通道开放以进行异步响应
  } else if (message.action === 'translateImage') {
    // 处理翻译请求
    handleTranslateImage(message.imageData, message.selection).then(sendResponse);
    return true;
  }
});

// 处理截图
async function handleCaptureTab() {
  try {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('无法获取当前标签页');
    }

    // 检查是否是 chrome:// 或 edge:// 页面（这些页面不允许截图）
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
      throw new Error('无法在浏览器内部页面截图');
    }

    // 使用 chrome.tabs.captureVisibleTab 截图
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 100
    });

    return { dataUrl };

  } catch (error) {
    console.error('截图失败:', error);
    // 通知 content script 截图失败
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'translationError',
        error: '截图失败: ' + error.message + ' (请确保有截图权限，并且不在浏览器内部页面使用)'
      });
    }
    return { error: error.message };
  }
}

// 处理图片翻译
async function handleTranslateImage(imageData, selection) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    // 发送进度通知
    if (tab) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'translationProgress',
        status: '正在调用 AI API...',
        type: 'loading'
      });
    }

    // 获取配置
    const config = await chrome.storage.sync.get([
      'apiBaseUrl',
      'apiKey',
      'model',
      'targetLang',
      'customPrompt'
    ]);

    // 验证配置
    if (!config.apiBaseUrl || !config.apiKey || !config.model || !config.targetLang) {
      throw new Error('请先在设置页面配置 API 参数');
    }

    // 构建 Prompt
    const prompt = config.customPrompt || getDefaultPrompt(config.targetLang);

    // 调用 OpenAI 兼容 API
    const result = await callOpenAICompatibleAPI(
      config.apiBaseUrl,
      config.apiKey,
      config.model,
      prompt,
      imageData
    );

    // 发送结果给 content script
    if (tab) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'translationResult',
        result: result
      });
    }

    return { success: true, result };

  } catch (error) {
    console.error('翻译失败:', error);
    if (tab) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'translationError',
        error: '翻译失败: ' + error.message
      });
    }
    return { error: error.message };
  }
}

// 默认 Prompt 模板
function getDefaultPrompt(targetLang) {
  return `你将看到一张网页截图图片（可能是漫画、文章或对话框）。

任务要求：
1. 识别图片中所有可见文字
2. 自动判断源语言
3. 将其完整翻译为【${targetLang}】
4. **保持原文的段落结构和换行** - 这是最重要的！
5. **保持文字的相对位置关系** - 如果原文是多行的，翻译后也要多行
6. 不要添加图片中不存在的内容
7. 不要解释翻译过程，只输出翻译结果
8. 如果是漫画对话框，保持对话的顺序

示例：
原文：
Hello
World

翻译：
你好
世界

如果图片中没有文字，返回：
【未识别到可翻译文本】`;
}

// 调用 OpenAI 兼容 API
async function callOpenAICompatibleAPI(baseUrl, apiKey, model, prompt, imageData) {
  // 确保 base URL 不以 / 结尾
  baseUrl = baseUrl.replace(/\/$/, '');

  // 构建 API URL
  const apiUrl = `${baseUrl}/chat/completions`;

  // 构建请求体
  const requestBody = {
    model: model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt
          },
          {
            type: 'image_url',
            image_url: {
              url: imageData
            }
          }
        ]
      }
    ],
    max_tokens: 2000,
    temperature: 0.1
  };

  // 发送请求
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  // 检查响应
  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errorData = await response.json();
      errorMsg += `: ${errorData.error?.message || JSON.stringify(errorData)}`;
    } catch (e) {
      const text = await response.text();
      errorMsg += `: ${text.substring(0, 200)}`;
    }
    throw new Error(errorMsg);
  }

  // 解析响应
  const data = await response.json();

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('API 响应格式异常');
  }

  // 提取翻译结果
  const result = data.choices[0].message.content;

  if (!result || result.trim() === '') {
    throw new Error('API 返回空结果');
  }

  return result.trim();
}

// 安装时的初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('[漫画翻译器] 插件已安装/更新');
});

// 错误处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'translationError') {
    console.error('翻译错误:', message.error);
  }
});
