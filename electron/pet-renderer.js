// pet-renderer.js — 宠物悬浮窗渲染逻辑（Vanilla JS，无框架依赖）
// 通过 electronAPI（preload 暴露）与主进程通信

(function () {
  'use strict';

  // 后台日志（仅输出到 console，运行时可查看 DevTools 或主进程日志文件）
  function petLog(tag, msg) {
    console.log('[Pet][' + tag + '] ' + msg);
  }

  const api = window.electronAPI;
  if (!api) {
    console.error('[Pet] electronAPI 不可用');
    return;
  }
  petLog('INFO', 'pet-renderer 启动');

  // Codex 社区标准默认精灵配置（1536×1872 spritesheet, 8×9 grid, 192×208 帧）
  const DEFAULT_SPRITE = {
    url: 'spritesheet.webp',
    width: 192,
    height: 208,
    columns: 8,
    rows: 9
  };

  // Codex 社区标准默认动画行映射（帧数按社区素材实际帧数）
  const DEFAULT_ANIMATIONS = {
    idle:         { row: 0, frames: 6, fps: 6 },
    waving:       { row: 1, frames: 4, fps: 6 },
    review:       { row: 2, frames: 6, fps: 6 },
    runningRight: { row: 3, frames: 8, fps: 8 },
    jumping:      { row: 4, frames: 5, fps: 7 },
    grab:         { row: 5, frames: 8, fps: 7 },
    failed:       { row: 6, frames: 8, fps: 7 },
    grabbing:     { row: 7, frames: 6, fps: 6 },
    runningLeft:  { row: 8, frames: 8, fps: 8 }
  };

  // 获取 sprite 配置（缺失时回退到默认值）
  function getSprite() {
    return (petManifest && petManifest.sprite) ? petManifest.sprite : DEFAULT_SPRITE;
  }

  // 获取 animations 配置（缺失时回退到默认值）
  function getAnimations() {
    return (petManifest && petManifest.animations && Object.keys(petManifest.animations).length > 0)
      ? petManifest.animations : DEFAULT_ANIMATIONS;
  }

  // ============ DOM 引用 ============
  const canvas = document.getElementById('pet-canvas');
  const ctx = canvas.getContext('2d', { alpha: true });

  // ============ 运行时状态 ============
  let spritesheet = null;             // HTMLImageElement
  let petManifest = null;            // pet.json 数据
  let petPath = null;                // 宠物目录路径
  let currentState = 'idle';
  let currentAnimation = null;
  let currentFrame = 0;
  let frameTimer = 0;
  let scale = 1.0;
  let fps = 6;
  let loop = true;
  let isRunning = false;
  let animFrameId = 0;

  // 渐进式 idle 阶段
  let idlePhase = 'active';          // 'active' | 'fidget' | 'drowsy' | 'sleep'
  let idleTimeStart = 0;
  let zzzBubbleTime = 0;

  // 全屏暂停
  let isPaused = false;

  // ============ 精灵图渲染 ============
  function resizeCanvas() {
    if (!petManifest) return;
    const sprite = getSprite();
    canvas.width = Math.round(sprite.width * scale);
    canvas.height = Math.round(sprite.height * scale);
  }

  function drawFrame() {
    if (!petManifest || !spritesheet || !currentAnimation) return;

    const sprite = getSprite();
    const col = currentFrame % sprite.columns;
    const row = currentAnimation.row;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 休眠状态降低不透明度
    if (idlePhase === 'sleep') {
      ctx.globalAlpha = 0.6;
    }

    ctx.drawImage(
      spritesheet,
      col * sprite.width, row * sprite.height, sprite.width, sprite.height,
      0, 0, Math.round(sprite.width * scale), Math.round(sprite.height * scale)
    );

    ctx.globalAlpha = 1.0;

    // ZZZ 气泡（休眠时绘制）
    if (idlePhase === 'sleep' && Date.now() - zzzBubbleTime > 0) {
      drawZzzBubble();
    }
  }

  // ZZZ 气泡
  let zzzOffset = 0;
  function drawZzzBubble() {
    const x = canvas.width * 0.6 + zzzOffset;
    const y = canvas.height * 0.15;
    ctx.font = `${Math.round(14 * scale)}px sans-serif`;
    ctx.fillStyle = '#8899b8';
    ctx.fillText('💤', x, y);
    // 气泡浮动
    zzzOffset = Math.sin(Date.now() / 800) * 3;
  }

  function tick(now) {
    if (!isRunning || isPaused || !currentAnimation) {
      animFrameId = requestAnimationFrame(tick);
      return;
    }

    const frameInterval = 1000 / fps;
    frameTimer += (now - (tick._lastTime || now));
    tick._lastTime = now;

    if (frameTimer >= frameInterval) {
      frameTimer -= frameInterval;
      currentFrame++;
      if (currentFrame >= currentAnimation.frames) {
        if (loop) {
          currentFrame = 0;
        } else {
          currentFrame = currentAnimation.frames - 1;
        }
      }
    }

    drawFrame();
    animFrameId = requestAnimationFrame(tick);
  }

  // 播放指定状态动画
  function playAnimation(state, opts) {
    opts = opts || {};
    if (!petManifest) return;

    const anims = getAnimations();
    const anim = anims[state];
    if (!anim) {
      // 回退到 idle
      if (state !== 'idle') {
        playAnimation('idle', opts);
      }
      return;
    }

    // 相同动画不重启
    if (currentAnimation && currentAnimation.row === anim.row && isRunning) {
      loop = opts.loop !== false;
      return;
    }

    currentAnimation = anim;
    currentFrame = 0;
    frameTimer = 0;
    fps = (idlePhase === 'sleep' && state === 'idle') ? 2 : (anim.fps || 6);
    loop = opts.loop !== false;

    if (!isRunning) {
      isRunning = true;
      tick._lastTime = performance.now();
      animFrameId = requestAnimationFrame(tick);
    }
  }

  // ============ 状态机 ============
  function transitionState(newState) {
    if (newState === currentState) return;

    // 映射到动画 key
    const animMap = {
      idle: 'idle',
      attention: 'waving',
      thinking: 'review',
      working: 'runningRight',
      success: 'jumping',
      error: 'failed',
      sleep: 'idle',
    };

    currentState = newState;
    playAnimation(animMap[newState] || 'idle', {});

    // success/error 3.5s 后自动回到 idle
    if (newState === 'success' || newState === 'error') {
      setTimeout(() => {
        if (currentState === newState) {
          setState('idle');
        }
      }, 3500);
    }
  }

  function setState(newState) {
    currentState = newState;
    if (newState === 'idle') {
      idleTimeStart = performance.now();
      idlePhase = 'active';
    }
    transitionState(newState);
  }

  // 渐进式 idle 更新
  function updateIdlePhase() {
    if (currentState !== 'idle' && currentState !== 'sleep') return;

    const elapsed = performance.now() - idleTimeStart;
    if (elapsed >= 300000) {          // 5 min
      if (idlePhase !== 'sleep') {
        idlePhase = 'sleep';
        zzzBubbleTime = Date.now();
        if (currentState === 'idle') {
          currentState = 'sleep';
          fps = 2;
        }
      }
    } else if (elapsed >= 120000) {   // 2 min
      idlePhase = 'drowsy';
    } else if (elapsed >= 30000) {    // 30 sec
      idlePhase = 'fidget';
    }
  }

  // 定期检查 idle 阶段
  setInterval(updateIdlePhase, 1000);

  // ============ 加载宠物 ============
  function loadPet(petData) {
    // petData: { id, name, path, manifest }
    petLog('INFO', 'loadPet 被调用: id="' + petData.id + '", name="' + petData.name + '", path="' + petData.path + '"');
    petPath = petData.path;
    petManifest = petData.manifest;
    scale = petData.zoom || 1.0;

    // 填充社区格式缺失的默认值
    if (!petManifest.sprite) {
      petLog('INFO', 'sprite 缺失，填充 Codex 默认值');
      petManifest.sprite = { ...DEFAULT_SPRITE };
    }
    // 社区格式用 spritesheetPath 字段指定文件名
    if (petManifest.spritesheetPath && !petManifest.sprite.url) {
      petLog('INFO', '使用 spritesheetPath: "' + petManifest.spritesheetPath + '"');
      petManifest.sprite.url = petManifest.spritesheetPath;
    }
    if (!petManifest.animations || Object.keys(petManifest.animations).length === 0) {
      petLog('INFO', 'animations 缺失，填充 Codex 默认值');
      petManifest.animations = { ...DEFAULT_ANIMATIONS };
    }

    petLog('INFO', 'sprite 配置: ' + JSON.stringify(getSprite()));
    petLog('INFO', 'animations keys: ' + Object.keys(getAnimations()).join(', '));

    resizeCanvas();

    // 加载 spritesheet — 优先用主进程传来的 HTTP URL，回退到 file://
    const ssUrl = petData.spritesheetUrl || ('file:///' + (petPath + '/' + (petManifest.sprite.url || petManifest.spritesheetPath || 'spritesheet.webp')).replace(/\\/g, '/').replace(/^\//, ''));
    petLog('INFO', '加载 spritesheet: ' + ssUrl);

    const img = new Image();
    img.onload = function () {
      petLog('INFO', 'spritesheet 加载成功! ' + img.width + 'x' + img.height);
      spritesheet = img;
      setState('idle');
    };
    img.onerror = function () {
      petLog('ERROR', 'spritesheet 加载失败! URL: ' + ssUrl);
      // 在 canvas 上显示错误信息
      ctx.fillStyle = 'rgba(255,80,80,0.9)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('spritesheet 加载失败', canvas.width / 2, canvas.height / 2 - 10);
      ctx.fillText(ssUrl.split('/').pop(), canvas.width / 2, canvas.height / 2 + 10);
      ctx.textAlign = 'start';
    };

    img.src = ssUrl;
  }

  // ============ 鼠标交互 ============
  let mouseX = 0, mouseY = 0;
  let clickStartTime = 0;
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let dragCumDX = 0, dragCumDY = 0;    // 累计拖拽位移，用于判断方向
  let hoverTimer = null;                 // 悬停计时器

  // 像素碰撞检测：检测鼠标位置是否为非透明像素
  function isOpaquePixel(x, y) {
    if (!spritesheet || !petManifest) return true;
    const sprite = getSprite();
    const sx = Math.floor(x / scale);
    const sy = Math.floor(y / scale);
    if (sx < 0 || sy < 0 || sx >= sprite.width || sy >= sprite.height) return false;

    // 从 Canvas 读取当前帧的 alpha 值
    const pixel = ctx.getImageData(x, y, 1, 1);
    return pixel.data[3] > 30;
  }

  // 根据拖拽方向切换动画（借鉴 Open Design: drag-right→runningRight, drag-left→runningLeft 等）
  function applyDragAnimation() {
    const absDX = Math.abs(dragCumDX);
    const absDY = Math.abs(dragCumDY);
    // 只有位移足够才触发方向动画
    if (absDX < 10 && absDY < 10) return;
    if (absDX > absDY) {
      // 水平方向为主
      playAnimation(dragCumDX > 0 ? 'runningRight' : 'runningLeft', {});
    } else {
      // 垂直方向为主
      playAnimation(dragCumDY > 0 ? 'jumping' : 'waving', {});
    }
  }

  canvas.addEventListener('mousemove', function (e) {
    mouseX = e.offsetX;
    mouseY = e.offsetY;

    if (isDragging) {
      const dx = e.screenX - dragStartX;
      const dy = e.screenY - dragStartY;
      dragCumDX += dx;
      dragCumDY += dy;
      // 按方向切换动画
      applyDragAnimation();
      // 发送增量位移给主进程移动窗口
      api.sendPetAction({
        type: 'drag-move',
        dx: dx,
        dy: dy,
      });
      dragStartX = e.screenX;
      dragStartY = e.screenY;
    } else {
      // 非拖拽：检测悬停
      const opaque = isOpaquePixel(e.offsetX, e.offsetY);
      if (opaque && currentState === 'idle') {
        // 透明区域让鼠标穿透
        canvas.style.pointerEvents = 'auto';
        // 启动悬停计时
        if (!hoverTimer) {
          hoverTimer = setTimeout(() => {
            if (!isDragging && currentState === 'idle') {
              playAnimation('waving', {});
            }
          }, 600);
        }
      } else if (!opaque) {
        canvas.style.pointerEvents = 'none';
        clearHoverTimer();
      }
    }
  });

  function clearHoverTimer() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  }

  canvas.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return; // 仅左键

    const opaque = isOpaquePixel(e.offsetX, e.offsetY);
    if (!opaque) return;

    isDragging = true;
    dragCumDX = 0;
    dragCumDY = 0;
    clickStartTime = Date.now();
    dragStartX = e.screenX;
    dragStartY = e.screenY;
    clearHoverTimer();

    petLog('DEBUG', '拖拽开始: screenX=' + e.screenX + ', screenY=' + e.screenY);
    api.sendDragStart();
  });

  canvas.addEventListener('mouseup', function (e) {
    const elapsed = Date.now() - clickStartTime;

    if (elapsed < 200 && isDragging && Math.abs(dragCumDX) < 5 && Math.abs(dragCumDY) < 5) {
      // 短按且未明显移动 → 单击
      handleClick();
    }

    if (isDragging) {
      petLog('DEBUG', '拖拽结束, 累计位移: dx=' + dragCumDX + ', dy=' + dragCumDY);
      api.sendDragEnd();
      // 拖拽结束后恢复 idle
      setTimeout(() => { if (!isDragging) setState('idle'); }, 200);
    }

    isDragging = false;
    dragCumDX = 0;
    dragCumDY = 0;
    clickStartTime = 0;
  });

  // 鼠标离开时结束拖拽 + 恢复 idle
  canvas.addEventListener('mouseleave', function () {
    clearHoverTimer();
    if (isDragging) {
      petLog('DEBUG', '鼠标离开，强制结束拖拽');
      api.sendDragEnd();
      isDragging = false;
      dragCumDX = 0;
      dragCumDY = 0;
      setTimeout(() => setState('idle'), 200);
    }
    // 鼠标离开后恢复 idle（如果之前是 waving）
    if (currentState !== 'idle' && !isDragging) {
      setState('idle');
    }
  });

  function handleClick() {
    // 简单单击不做操作（避免误触）
  }

  // 双击
  canvas.addEventListener('dblclick', function (e) {
    const opaque = isOpaquePixel(e.offsetX, e.offsetY);
    if (!opaque) return;
    // 双击呼出主窗口
    api.sendPetAction({ type: 'double-click' });
  });

  // 右键菜单
  canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    const opaque = isOpaquePixel(e.offsetX, e.offsetY);
    if (!opaque) return;
    api.sendPetAction({ type: 'right-click' });
  });

  // 处理拖拽移动（主进程转发的位置更新）
  canvas.addEventListener('pet:move-to', function (e) {
    // 来自主进程的位置更新
  });

  // ============ IPC 事件监听 ============
  api.onPetLoad(function (petData) {
    petLog('INFO', '收到 pet:load 事件: id="' + petData.id + '"');
    loadPet(petData);
  });

  api.onPetEvent(function (event) {
    petLog('DEBUG', '收到 pet:event: ' + event.type);
    if (!petManifest) {
      petLog('WARN', 'pet:event 被忽略: manifest 未加载');
      return;
    }

    switch (event.type) {
      case 'session:user-input-start':
        idleTimeStart = performance.now();
        idlePhase = 'active';
        transitionState('attention');
        break;

      case 'session:ai-thinking-start':
        transitionState('thinking');
        break;

      case 'session:tool-call-start':
        transitionState('working');
        break;

      case 'session:tool-call-end':
        transitionState('thinking');
        break;

      case 'session:response-start':
        // 流式输出开始，宠物保持活跃（不做状态切换）
        idleTimeStart = performance.now();
        idlePhase = 'active';
        break;

      case 'session:response-complete':
        transitionState('success');
        break;

      case 'session:error':
        transitionState('error');
        break;
    }
  });

  api.onPetConfigUpdate(function (config) {
    if (config.zoom && config.zoom !== scale) {
      scale = Math.max(0.5, Math.min(2.0, config.zoom));
      resizeCanvas();
    }
  });

  api.onPetPauseRender(function () {
    isPaused = true;
  });

  api.onPetResumeRender(function () {
    isPaused = false;
    tick._lastTime = performance.now();
  });

  api.onPetEnableTransparent(function () {
    canvas.style.pointerEvents = 'auto';
  });

  // ============ 启动 ============
  // 初始显示等待状态（主进程会在加载后发送 pet:load），置于画布上方避免被调试面板遮挡
  ctx.fillStyle = 'rgba(136, 153, 184, 0.5)';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🐾', canvas.width / 2, 40);
  ctx.font = '9px monospace';
  ctx.fillStyle = 'rgba(136, 153, 184, 0.35)';
  ctx.fillText('等待加载...', canvas.width / 2, 62);
  ctx.textAlign = 'start';

  console.log('[Pet] Renderer 就绪');
})();
