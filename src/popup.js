// Popup 页面逻辑
document.addEventListener('DOMContentLoaded', async () => {
  const startBtn = document.getElementById('startSelection');
  const settingsBtn = document.getElementById('openSettings');
  const statusEl = document.getElementById('status');

  // 配置状态显示元素
  const apiBaseUrlStatus = document.getElementById('apiBaseUrlStatus');
  const apiKeyStatus = document.getElementById('apiKeyStatus');
  const modelStatus = document.getElementById('modelStatus');
  const targetLangStatus = document.getElementById('targetLangStatus');

  // 加载配置并显示状态
  async function loadConfigStatus() {
    const config = await chrome.storage.sync.get([
      'apiBaseUrl',
      'apiKey',
      'model',
      'targetLang'
    ]);

    // API Base URL
    if (config.apiBaseUrl) {
      apiBaseUrlStatus.textContent = '已配置';
      apiBaseUrlStatus.className = 'ok';
    } else {
      apiBaseUrlStatus.textContent = '未配置';
      apiBaseUrlStatus.className = 'error';
    }

    // API Key
    if (config.apiKey) {
      apiKeyStatus.textContent = '已配置';
      apiKeyStatus.className = 'ok';
    } else {
      apiKeyStatus.textContent = '未配置';
      apiKeyStatus.className = 'error';
    }

    // Model
    if (config.model) {
      modelStatus.textContent = config.model;
      modelStatus.className = 'ok';
    } else {
      modelStatus.textContent = '未配置';
      modelStatus.className = 'error';
    }

    // Target Language
    if (config.targetLang) {
      targetLangStatus.textContent = config.targetLang;
      targetLangStatus.className = 'ok';
    } else {
      targetLangStatus.textContent = '未配置';
      targetLangStatus.className = 'error';
    }

    // 检查是否所有配置都完成
    const isConfigured = config.apiBaseUrl && config.apiKey && config.model && config.targetLang;

    if (!isConfigured) {
      startBtn.disabled = true;
      statusEl.textContent = '请先配置 API';
      statusEl.className = 'status-badge error';
    } else {
      startBtn.disabled = false;
      statusEl.textContent = '配置完整，可以开始';
      statusEl.className = 'status-badge';
    }
  }

  // 开始框选
  startBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      updateStatus('无法获取当前标签页', 'error');
      return;
    }

    // 检查是否是 chrome:// 或 edge:// 页面
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
      updateStatus('无法在浏览器内部页面使用', 'error');
      return;
    }

    updateStatus('进入框选模式...', 'loading');

    // 向 content script 发送消息，开始框选模式
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content.js']
      });

      // 发送开始框选消息
      const result = await chrome.tabs.sendMessage(tab.id, {
        action: 'startSelection'
      });

      if (result && result.success) {
        updateStatus('框选完成，正在处理...', 'loading');
      } else {
        updateStatus('已取消框选', 'error');
        setTimeout(() => updateStatus('准备就绪', ''), 2000);
      }
    } catch (error) {
      console.error('启动框选失败:', error);
      updateStatus('启动失败，请刷新页面重试', 'error');
    }
  });

  // 打开设置页面
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 更新状态显示
  function updateStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = 'status-badge';
    if (type) {
      statusEl.classList.add(type);
    }
  }

  // 监听来自 background 的消息（翻译进度）
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'translationProgress') {
      updateStatus(message.status, message.type || 'loading');
    } else if (message.action === 'translationComplete') {
      updateStatus('翻译完成！', '');
      setTimeout(() => updateStatus('准备就绪', ''), 3000);
    } else if (message.action === 'translationError') {
      updateStatus(message.error, 'error');
    }
  });

  // 初始化
  await loadConfigStatus();
});
