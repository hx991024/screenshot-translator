// Options 页面逻辑
document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('settingsForm');
  const testBtn = document.getElementById('testBtn');
  const resetBtn = document.getElementById('resetBtn');
  const testResult = document.getElementById('testResult');

  // 加载已保存的配置
  async function loadSettings() {
    const config = await chrome.storage.sync.get([
      'apiBaseUrl',
      'apiKey',
      'model',
      'targetLang',
      'customPrompt'
    ]);

    document.getElementById('apiBaseUrl').value = config.apiBaseUrl || '';
    document.getElementById('apiKey').value = config.apiKey || '';
    document.getElementById('model').value = config.model || '';
    document.getElementById('targetLang').value = config.targetLang || '';
    document.getElementById('customPrompt').value = config.customPrompt || '';
  }

  // 保存配置
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const config = {
      apiBaseUrl: document.getElementById('apiBaseUrl').value.trim(),
      apiKey: document.getElementById('apiKey').value.trim(),
      model: document.getElementById('model').value.trim(),
      targetLang: document.getElementById('targetLang').value,
      customPrompt: document.getElementById('customPrompt').value.trim()
    };

    await chrome.storage.sync.set(config);
    showResult('✅ 配置已保存！', 'success');
  });

  // 测试 API
  testBtn.addEventListener('click', async () => {
    const apiBaseUrl = document.getElementById('apiBaseUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const model = document.getElementById('model').value.trim();

    if (!apiBaseUrl || !apiKey || !model) {
      showResult('❌ 请先填写 API Base URL、API Key 和模型名称', 'error');
      return;
    }

    showResult('🧪 正在测试 API 连接...', 'loading');

    try {
      // 创建一个符合模型要求的测试图片（100x100 像素，包含测试文字的 PNG）
      // 这是一个简单的灰色背景图片，所有模型都应该支持
      const testImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

      // 使用 Canvas 创建一个 100x100 的测试图片（确保满足最小尺寸要求）
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');

      // 绘制灰色背景
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, 100, 100);

      // 绘制测试文字（确保图片包含可识别内容）
      ctx.fillStyle = '#333333';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('测试', 50, 55);

      // 转换为 Base64
      const validTestImage = canvas.toDataURL('image/png');

      const prompt = `你将看到一张测试图片。

任务要求：
1. 识别图片中所有可见文字
2. 自动判断文字语言
3. 如果有文字，翻译为【目标语言】
4. 如果没有文字，返回：【未识别到可翻译文本】
5. 保持原文的段落结构和换行

只输出翻译结果，不要解释。`;

      const response = await fetch(`${apiBaseUrl}/chat/completions`, {
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
                {
                  type: 'text',
                  text: prompt
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: validTestImage
                  }
                }
              ]
            }
          ],
          max_tokens: 100,
          temperature: 0.1
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.choices && data.choices[0]) {
          const result = data.choices[0].message.content;
          showResult(`✅ API 测试成功！\n响应: ${result.substring(0, 100)}${result.length > 100 ? '...' : ''}`, 'success');
        } else {
          showResult('⚠️ API 响应格式异常，但连接成功。', 'success');
        }
      } else {
        const errorText = await response.text();
        let errorMsg = `❌ API 错误 (${response.status}): `;

        // 尝试解析 JSON 错误信息
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error && errorJson.error.message) {
            errorMsg += errorJson.error.message;
          } else {
            errorMsg += errorText.substring(0, 200);
          }
        } catch (e) {
          errorMsg += errorText.substring(0, 200);
        }

        // 提供更友好的错误提示
        if (response.status === 400) {
          errorMsg += '\n\n💡 提示: 请检查模型名称是否支持多模态（图像）功能';
        } else if (response.status === 401) {
          errorMsg += '\n\n💡 提示: API Key 可能无效或过期';
        } else if (response.status === 404) {
          errorMsg += '\n\n💡 提示: 模型名称或 API 地址可能错误';
        } else if (response.status === 429) {
          errorMsg += '\n\n💡 提示: API 频率限制，请稍后重试';
        }

        showResult(errorMsg, 'error');
      }
    } catch (error) {
      showResult(`❌ 连接失败: ${error.message}\n\n💡 提示: 检查网络连接或 API 地址`, 'error');
    }
  });

  // 重置配置
  resetBtn.addEventListener('click', async () => {
    if (confirm('确定要重置所有配置吗？此操作不可恢复。')) {
      await chrome.storage.sync.clear();
      await loadSettings();
      showResult('🔄 配置已重置', 'success');
    }
  });

  // 显示结果
  function showResult(message, type) {
    testResult.textContent = message;
    testResult.className = `test-result ${type}`;
    testResult.style.display = 'block';
  }

  // 初始化
  await loadSettings();
});
