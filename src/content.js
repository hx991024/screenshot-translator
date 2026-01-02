/**
 * Content Script - 区域框选、截图、显示翻译结果
 * 负责：
 * 1. 鼠标框选交互
 * 2. 区域截图（使用 chrome.tabs.captureVisibleTab + 裁剪）
 * 3. 与 background 通信进行 API 调用
 * 4. 显示灰色蒙版覆盖翻译结果
 */

// 防止重复注入的标记
if (!window.__comicTranslatorInitialized) {
  window.__comicTranslatorInitialized = true;

  // 全局状态
  let selectionMode = false;
  let isDrawing = false;
  let startX = 0, startY = 0;
  let currentX = 0, currentY = 0;

  // UI 元素
  let overlay = null;              // 框选覆盖层
  let selectionBox = null;         // 框选框
  let maskLayer = null;            // 翻译结果蒙版
  let maskOverlay = null;          // 半透明遮挡层

  // 初始化
  function init() {
    // 监听来自 popup 的消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'startSelection') {
        startSelectionMode();
        sendResponse({ success: true });
        return true;
      }
    });

    // 监听来自 background 的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'translationResult') {
        // 获取保存的选区信息
        chrome.storage.local.get('lastSelection', (data) => {
          if (data.lastSelection) {
            showTranslationMask(message.result, data.lastSelection);
            // 通知 popup
            chrome.runtime.sendMessage({
              action: 'translationComplete'
            });
          }
        });
      } else if (message.action === 'translationError') {
        // 移除 loading 蒙版
        removeLoadingMask();
        chrome.runtime.sendMessage({
          action: 'translationError',
          error: message.error
        });
      }
    });

    console.log('[漫画翻译器] Content script 已加载');
  }

  // 开始框选模式
  function startSelectionMode() {
    if (selectionMode) {
      cancelSelectionMode();
      return;
    }

    selectionMode = true;
    createOverlay();
    bindMouseEvents();

    // 通知 popup 状态更新
    chrome.runtime.sendMessage({
      action: 'translationProgress',
      status: '已进入框选模式，请拖拽选择区域',
      type: ''
    });
  }

  // 取消框选模式
  function cancelSelectionMode() {
    selectionMode = false;
    isDrawing = false;
    unbindMouseEvents();
    removeOverlay();
  }

  // 创建覆盖层
  function createOverlay() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'comic-translator-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 999999;
      cursor: crosshair;
      pointer-events: auto;
    `;

    // 暗色背景层（非选中区域）
    const bgLayer = document.createElement('div');
    bgLayer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.3);
      pointer-events: none;
    `;
    overlay.appendChild(bgLayer);

    // 选区框
    selectionBox = document.createElement('div');
    selectionBox.style.cssText = `
      position: absolute;
      border: 2px solid #1976d2;
      background: rgba(25, 118, 210, 0.1);
      pointer-events: none;
      display: none;
    `;
    overlay.appendChild(selectionBox);

    // 提示文字
    const hint = document.createElement('div');
    hint.textContent = '拖拽选择要翻译的区域，按 ESC 取消';
    hint.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 14px;
      pointer-events: none;
      z-index: 1000000;
    `;
    overlay.appendChild(hint);

    document.body.appendChild(overlay);
  }

  // 移除覆盖层
  function removeOverlay() {
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    overlay = null;
    selectionBox = null;
  }

  // 绑定鼠标事件
  function bindMouseEvents() {
    if (!overlay) return;

    overlay.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
  }

  // 解绑鼠标事件
  function unbindMouseEvents() {
    if (overlay) {
      overlay.removeEventListener('mousedown', handleMouseDown);
    }
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('keydown', handleKeyDown);
  }

  // 鼠标按下
  function handleMouseDown(e) {
    if (!selectionMode) return;
    e.preventDefault();
    e.stopPropagation();

    isDrawing = true;
    startX = e.clientX;
    startY = e.clientY;

    selectionBox.style.display = 'block';
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
  }

  // 鼠标移动
  function handleMouseMove(e) {
    if (!selectionMode || !isDrawing) return;
    e.preventDefault();

    currentX = e.clientX;
    currentY = e.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
  }

  // 鼠标松开
  function handleMouseUp(e) {
    if (!selectionMode || !isDrawing) return;
    e.preventDefault();
    e.stopPropagation();

    isDrawing = false;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    // 最小尺寸检查
    if (width < 30 || height < 30) {
      chrome.runtime.sendMessage({
        action: 'translationProgress',
        status: '选区太小，请选择至少 30x30 像素的区域',
        type: 'error'
      });
      return;
    }

    // 取消框选模式，开始处理
    cancelSelectionMode();

    // 处理选区
    processSelection(left, top, width, height);
  }

  // 键盘事件（ESC 取消）
  function handleKeyDown(e) {
    if (e.key === 'Escape' && selectionMode) {
      cancelSelectionMode();
      chrome.runtime.sendMessage({
        action: 'translationProgress',
        status: '已取消框选',
        type: 'error'
      });
    }
  }

  // 处理选区 - 截图并调用 API
  async function processSelection(left, top, width, height) {
    // 保存选区信息供后续使用
    const selectionInfo = {
      left: left,
      top: top,
      width: width,
      height: height,
      pageUrl: window.location.href,
      viewportOffset: {
        x: window.pageXOffset,
        y: window.pageYOffset
      }
    };

    await chrome.storage.local.set({ lastSelection: selectionInfo });

    // 立即显示蒙版（带loading状态）
    showLoadingMask(selectionInfo);

    // 通知开始处理
    chrome.runtime.sendMessage({
      action: 'translationProgress',
      status: '正在截图...',
      type: 'loading'
    });

    try {
      // 方法1: 使用 chrome.tabs.captureVisibleTab + Canvas 裁剪
      const screenshotDataUrl = await captureVisibleTab();

      if (!screenshotDataUrl) {
        throw new Error('截图失败');
      }

      // 更新蒙版状态
      updateMaskStatus('正在调用 AI API...');

      // 裁剪图片到选区
      const croppedBase64 = await cropImage(screenshotDataUrl, left, top, width, height);

      if (!croppedBase64) {
        throw new Error('图片裁剪失败');
      }

      // 发送给 background 进行 API 调用
      chrome.runtime.sendMessage({
        action: 'translateImage',
        imageData: croppedBase64,
        selection: selectionInfo
      });

    } catch (error) {
      console.error('处理选区失败:', error);
      // 移除loading蒙版，显示错误
      removeLoadingMask();
      chrome.runtime.sendMessage({
        action: 'translationError',
        error: '处理失败: ' + error.message
      });
    }
  }

  // 使用 chrome.tabs.captureVisibleTab 截图
  async function captureVisibleTab() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'captureTab' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (response && response.dataUrl) {
          resolve(response.dataUrl);
        } else {
          reject(new Error('截图返回为空'));
        }
      });
    });
  }

  // 裁剪图片到指定区域
  async function cropImage(dataUrl, left, top, width, height) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          // 计算实际的屏幕缩放比例
          const scaleX = img.width / window.innerWidth;
          const scaleY = img.height / window.innerHeight;

          // 计算裁剪后的实际像素尺寸
          let cropWidth = width * scaleX;
          let cropHeight = height * scaleY;

          // 最小尺寸检查（确保符合模型要求）
          const MIN_SIZE = 50; // 至少 50x50 像素
          if (cropWidth < MIN_SIZE || cropHeight < MIN_SIZE) {
            // 如果太小，按比例放大到最小尺寸
            const scale = Math.max(MIN_SIZE / cropWidth, MIN_SIZE / cropHeight);
            cropWidth *= scale;
            cropHeight *= scale;
          }

          // 创建 Canvas（使用更高的分辨率以提高 OCR 准确性）
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(cropWidth);
          canvas.height = Math.ceil(cropHeight);

          const ctx = canvas.getContext('2d');

          // 设置高质量渲染
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // 绘制裁剪区域
          ctx.drawImage(
            img,
            left * scaleX, top * scaleY, width * scaleX, height * scaleY, // 源区域
            0, 0, canvas.width, canvas.height // 目标区域
          );

          // 转换为 Base64，使用较高品质
          const croppedDataUrl = canvas.toDataURL('image/png', 1.0);

          // 验证生成的图片大小
          if (croppedDataUrl.length < 100) {
            throw new Error('生成的图片数据过小');
          }

          resolve(croppedDataUrl);
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = dataUrl;
    });
  }

  // 显示 loading 蒙版
  function showLoadingMask(selection) {
    // 移除已存在的蒙版和遮挡层
    if (maskLayer) {
      maskLayer.remove();
      maskLayer = null;
    }
    if (maskOverlay) {
      maskOverlay.remove();
      maskOverlay = null;
    }

    // 创建半透明遮挡层（用于遮挡原内容）
    maskOverlay = document.createElement('div');
    maskOverlay.style.cssText = `
      position: absolute;
      left: ${selection.left}px;
      top: ${selection.top + window.pageYOffset}px;
      width: ${selection.width}px;
      height: ${selection.height}px;
      background: rgba(0, 0, 0, 0.75);
      border: 2px solid #1976d2;
      border-radius: 4px;
      z-index: 999998;
      pointer-events: none;
      box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.5);
    `;

    // 创建 loading 蒙版容器
    maskLayer = document.createElement('div');
    maskLayer.className = 'comic-translator-mask-loading';
    maskLayer.style.cssText = `
      position: absolute;
      left: ${selection.left}px;
      top: ${selection.top + window.pageYOffset}px;
      width: ${selection.width}px;
      height: ${selection.height}px;
      background: rgba(0, 0, 0, 0.85);
      border: 2px solid #1976d2;
      border-radius: 4px;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 14px;
      font-weight: 500;
      box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.5);
    `;

    // Loading 文字
    const text = document.createElement('div');
    text.textContent = '正在处理...';
    text.style.cssText = `
      text-align: center;
      line-height: 1.5;
      padding: 8px 12px;
      background: rgba(25, 118, 210, 0.3);
      border-radius: 6px;
      min-width: 120px;
    `;

    maskLayer.appendChild(text);

    // 取消按钮（放在蒙版外部右上角）
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕';
    cancelBtn.title = '取消处理';
    cancelBtn.style.cssText = `
      position: fixed;
      left: ${selection.left + selection.width + 8}px;
      top: ${selection.top + window.pageYOffset}px;
      background: rgba(220, 0, 0, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.5);
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      font-weight: bold;
      transition: all 0.2s;
      z-index: 1000000;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    `;
    cancelBtn.onmouseover = () => {
      cancelBtn.style.background = 'rgba(255, 50, 50, 0.9)';
      cancelBtn.style.transform = 'scale(1.1)';
    };
    cancelBtn.onmouseout = () => {
      cancelBtn.style.background = 'rgba(220, 0, 0, 0.8)';
      cancelBtn.style.transform = 'scale(1)';
    };
    cancelBtn.onclick = () => {
      removeLoadingMask();
      chrome.runtime.sendMessage({
        action: 'translationProgress',
        status: '已取消',
        type: 'error'
      });
    };

    // 添加到页面
    document.body.appendChild(maskOverlay);
    document.body.appendChild(maskLayer);
    document.body.appendChild(cancelBtn);

    // 保存取消按钮引用，便于清理
    maskLayer.cancelButton = cancelBtn;

    // 自动滚动到蒙版位置
    setTimeout(() => {
      maskLayer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  // 更新蒙版状态
  function updateMaskStatus(status) {
    if (!maskLayer) return;

    // 更新文字内容
    const textElement = maskLayer.querySelector('div');
    if (textElement) {
      textElement.textContent = status;
    }
  }

  // 移除 loading 蒙版
  function removeLoadingMask() {
    if (maskLayer) {
      // 移除取消按钮
      if (maskLayer.cancelButton) {
        maskLayer.cancelButton.remove();
      }
      maskLayer.remove();
      maskLayer = null;
    }
    if (maskOverlay) {
      maskOverlay.remove();
      maskOverlay = null;
    }
  }

  // 显示翻译结果蒙版
  function showTranslationMask(result, selection) {
    // 先移除 loading 蒙版
    removeLoadingMask();
    // 移除已存在的蒙版和遮挡层
    if (maskLayer) {
      // 移除已存在的控制按钮
      if (maskLayer.controlsElement) {
        maskLayer.controlsElement.remove();
      }
      maskLayer.remove();
      maskLayer = null;
    }
    if (maskOverlay) {
      maskOverlay.remove();
      maskOverlay = null;
    }

    // 创建半透明遮挡层（用于遮挡原内容）
    maskOverlay = document.createElement('div');
    maskOverlay.style.cssText = `
      position: absolute;
      left: ${selection.left}px;
      top: ${selection.top + window.pageYOffset}px;
      width: ${selection.width}px;
      height: ${selection.height}px;
      background: rgba(0, 0, 0, 0.75);
      border: 2px solid #1976d2;
      border-radius: 4px;
      z-index: 999998;
      pointer-events: none;
      box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.5);
    `;

    // 创建蒙版容器（用于显示文字，完全透明背景）
    maskLayer = document.createElement('div');
    maskLayer.className = 'comic-translator-mask';
    maskLayer.style.cssText = `
      position: absolute;
      left: ${selection.left}px;
      top: ${selection.top + window.pageYOffset}px;
      width: ${selection.width}px;
      height: ${selection.height}px;
      background: transparent;
      color: #ffffff;
      padding: 8px;
      z-index: 999999;
      overflow: auto;
      font-size: 14px;
      line-height: 1.7;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      text-shadow: 1.5px 1.5px 3px rgba(0, 0, 0, 1);
      box-sizing: border-box;
    `;

    // 翻译内容 - 保持原始段落结构
    const content = document.createElement('div');
    content.textContent = result;
    content.style.cssText = `
      white-space: pre-wrap;
      word-wrap: break-word;
      line-height: 1.7;
      padding: 2px 4px;
      font-size: 14px;
    `;
    maskLayer.appendChild(content);

    // 控制按钮容器（固定在蒙版外部右上角）
    const controls = document.createElement('div');
    controls.style.cssText = `
      position: fixed;
      left: ${selection.left + selection.width + 8}px;
      top: ${selection.top + window.pageYOffset}px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      z-index: 1000000;
    `;

    // 重新翻译按钮
    const retryBtn = document.createElement('button');
    retryBtn.textContent = '↻';
    retryBtn.title = '重新翻译';
    retryBtn.style.cssText = `
      background: rgba(0, 0, 0, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.4);
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      font-weight: bold;
      transition: all 0.2s;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    `;
    retryBtn.onmouseover = () => {
      retryBtn.style.background = 'rgba(0, 100, 200, 0.9)';
      retryBtn.style.transform = 'scale(1.1)';
    };
    retryBtn.onmouseout = () => {
      retryBtn.style.background = 'rgba(0, 0, 0, 0.7)';
      retryBtn.style.transform = 'scale(1)';
    };
    retryBtn.onclick = async () => {
      controls.remove();
      maskLayer.remove();
      maskOverlay.remove();
      maskLayer = null;
      maskOverlay = null;
      await processSelection(selection.left, selection.top, selection.width, selection.height);
    };

    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = '关闭蒙版';
    closeBtn.style.cssText = `
      background: rgba(220, 0, 0, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.4);
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      font-weight: bold;
      transition: all 0.2s;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    `;
    closeBtn.onmouseover = () => {
      closeBtn.style.background = 'rgba(255, 50, 50, 0.9)';
      closeBtn.style.transform = 'scale(1.1)';
    };
    closeBtn.onmouseout = () => {
      closeBtn.style.background = 'rgba(220, 0, 0, 0.7)';
      closeBtn.style.transform = 'scale(1)';
    };
    closeBtn.onclick = () => {
      controls.remove();
      maskLayer.remove();
      maskOverlay.remove();
      maskLayer = null;
      maskOverlay = null;
    };

    controls.appendChild(retryBtn);
    controls.appendChild(closeBtn);
    document.body.appendChild(controls);

    // 添加到页面（先添加遮挡层，再添加文字层）
    document.body.appendChild(maskOverlay);
    document.body.appendChild(maskLayer);

    // 保存控制按钮引用，便于清理
    maskLayer.controlsElement = controls;

    // 自动滚动到蒙版位置，确保用户能看到
    setTimeout(() => {
      maskLayer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  // 启动
  init();
}
