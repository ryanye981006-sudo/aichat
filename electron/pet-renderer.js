// pet-renderer.js — 全屏透明覆盖层内宠物渲染（Vanilla JS）
// 宠物通过 CSS transform 在覆盖层内定位，拖拽直接操作 DOM，无需 IPC 传位置

(function () {
  'use strict';

  function petLog(tag, msg) {
    console.log('[Pet][' + tag + '] ' + msg);
  }

  const api = window.electronAPI;
  if (!api) { console.error('[Pet] electronAPI 不可用'); return; }
  petLog('INFO', 'pet-renderer 启动');

  // === 默认配置 ===
  const DEFAULT_SPRITE = {
    url: 'spritesheet.webp', width: 192, height: 208, columns: 8, rows: 9
  };
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

  function getSprite() { return (petManifest && petManifest.sprite) || DEFAULT_SPRITE; }
  function getAnimations() {
    return (petManifest && petManifest.animations && Object.keys(petManifest.animations).length > 0)
      ? petManifest.animations : DEFAULT_ANIMATIONS;
  }

  // === DOM ===
  const canvas = document.getElementById('pet-canvas');
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });

  // 离屏 Canvas 双缓冲：先在离屏绘制整帧，再一次 blit 到可见画布，消除闪烁
  const offscreen = document.createElement('canvas');
  offscreen.width = 192;
  offscreen.height = 208;
  const offCtx = offscreen.getContext('2d', { alpha: true });

  // === 运行时状态 ===
  let spritesheet = null;
  let petManifest = null;
  let currentState = 'idle';
  let currentAnimation = null;
  let currentFrame = 0;
  let frameTimer = 0;
  let scale = 1.0;
  let fps = 6;
  let loop = true;
  let isRunning = false;
  let animFrameId = 0;

  // 位置（相对于覆盖层窗口）
  let petX = 0, petY = 0;

  // 渐进式 idle
  let idlePhase = 'active';
  let idleTimeStart = 0;
  let isPaused = false;
  let sleepTimerId = 0;  // sleep 阶段 setTimeout 替代 rAF

  // spritesheet 缓存与内存管理
  var spritesheetCache = new Map();  // key: petId, value: { img, blobUrl }
  var MAX_CACHE_SIZE = 3;
  var currentBlobUrl = null;  // 当前活跃 Blob URL，用于 revoke

  // === 定位相关 ===
  function applyPosition() {
    canvas.style.transform = 'translate(' + Math.round(petX) + 'px, ' + Math.round(petY) + 'px) scale(' + scale + ')';
    canvas.style.transformOrigin = 'top left';
  }

  function setInitialPosition(config) {
    var winW = window.innerWidth;
    var winH = window.innerHeight;
    var petW = Math.round(192 * scale);
    var petH = Math.round(208 * scale);
    var margin = 20;

    if (config && config.position === 'custom' && config.customPosition) {
      petX = config.customPosition.x;
      petY = config.customPosition.y;
    } else if (config && config.position === 'bottom-left') {
      petX = margin;
      petY = winH - petH - margin;
    } else {
      // 默认右下角
      petX = winW - petW - margin;
      petY = winH - petH - margin;
    }
    applyPosition();
    petLog('INFO', '初始位置: x=' + Math.round(petX) + ', y=' + Math.round(petY) + ', zoom=' + scale);
  }

  // === 缩放 ===
  function resizeCanvas() {
    if (!petManifest) return;
    var sprite = getSprite();
    canvas.width = sprite.width;
    canvas.height = sprite.height;
    offscreen.width = sprite.width;
    offscreen.height = sprite.height;
    applyPosition();
  }

  // === 精灵图渲染（离屏双缓冲：一次 blit，消除 clearRect→drawImage 间隙闪烁） ===
  function drawFrame() {
    if (!petManifest || !spritesheet || !currentAnimation) return;
    var sprite = getSprite();
    var col = currentFrame % sprite.columns;
    var row = currentAnimation.row;

    // 离屏绘制
    offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
    if (idlePhase === 'sleep') offCtx.globalAlpha = 0.6;
    offCtx.drawImage(
      spritesheet,
      col * sprite.width, row * sprite.height, sprite.width, sprite.height,
      0, 0, sprite.width, sprite.height
    );
    offCtx.globalAlpha = 1.0;

    // 一次 blit 到可见画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(offscreen, 0, 0);
  }

  function tick(now) {
    if (!isRunning || isPaused || !currentAnimation) {
      animFrameId = requestAnimationFrame(tick);
      return;
    }

    var frameInterval = 1000 / fps;
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

  function playAnimation(state, opts) {
    opts = opts || {};
    if (!petManifest) return;

    var anims = getAnimations();
    var anim = anims[state];
    if (!anim) {
      if (state !== 'idle') playAnimation('idle', opts);
      return;
    }

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
      cancelAnimationFrame(animFrameId);
      tick._lastTime = performance.now();
      animFrameId = requestAnimationFrame(tick);
    }
  }

  // === 状态机 ===
  function transitionState(newState) {
    if (newState === currentState) return;
    // 从 sleep 恢复时切回 rAF 模式
    if (currentState === 'sleep' && newState !== 'sleep') {
      stopSleepRender();
    }
    var animMap = {
      idle: 'idle', attention: 'waving', thinking: 'review',
      working: 'runningRight', success: 'jumping', error: 'failed', sleep: 'idle',
    };
    currentState = newState;
    playAnimation(animMap[newState] || 'idle', {});
    if (newState === 'success' || newState === 'error') {
      setTimeout(function () {
        if (currentState === newState) setState('idle');
      }, 3500);
    }
  }

  function setState(newState) {
    if (newState === 'idle') {
      idleTimeStart = performance.now();
      idlePhase = 'active';
    }
    transitionState(newState);
  }

  function updateIdlePhase() {
    if (currentState !== 'idle' && currentState !== 'sleep') return;
    var elapsed = performance.now() - idleTimeStart;
    if (elapsed >= 300000) {
      if (idlePhase !== 'sleep') {
        idlePhase = 'sleep';
        if (currentState === 'idle') {
          currentState = 'sleep';
          fps = 2;
          // sleep 时切换到 setTimeout 模式，释放 rAF
          if (isRunning) {
            isRunning = false;
            cancelAnimationFrame(animFrameId);
            startSleepRender();
          }
        }
      }
    } else if (elapsed >= 120000) { idlePhase = 'drowsy'; }
    else if (elapsed >= 30000) { idlePhase = 'fidget'; }
  }
  setInterval(updateIdlePhase, 1000);

  // sleep 阶段的低功耗 setTimeout 渲染（替代 rAF）
  function startSleepRender() {
    stopSleepRender();
    function sleepTick() {
      if (currentState !== 'sleep' || isRunning || isPaused) { sleepTimerId = 0; return; }
      currentFrame++;
      if (currentAnimation && currentFrame >= currentAnimation.frames) currentFrame = 0;
      drawFrame();
      sleepTimerId = setTimeout(sleepTick, 500);  // 2fps
    }
    sleepTimerId = setTimeout(sleepTick, 500);
  }
  function stopSleepRender() {
    if (sleepTimerId) { clearTimeout(sleepTimerId); sleepTimerId = 0; }
  }

  // 释放旧 spritesheet 资源（ImageBitmap.close / Blob URL）
  function releaseSpritesheet() {
    if (spritesheet && spritesheet.close) spritesheet.close();
    spritesheet = null;
    if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
  }

  // === 加载宠物 ===
  var loadId = 0;   // 递增，防止切换宠物后旧异步回调覆盖新数据

  function loadPet(petData) {
    var myLoadId = ++loadId;
    petLog('INFO', 'loadPet #' + myLoadId + ': id="' + petData.id + '", name="' + petData.name + '"');

    // 停止当前动画
    isRunning = false;
    cancelAnimationFrame(animFrameId);
    stopSleepRender();
    currentAnimation = null;

    // 释放旧 spritesheet 资源
    releaseSpritesheet();

    // 清空画布显示加载中
    offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
    offCtx.fillStyle = 'rgba(136, 153, 184, 0.4)';
    offCtx.font = '20px sans-serif';
    offCtx.textAlign = 'center';
    offCtx.fillText('🐾', offscreen.width / 2, offscreen.height / 2);
    offCtx.textAlign = 'start';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(offscreen, 0, 0);

    petManifest = petData.manifest;
    scale = petData.zoom || 1.0;

    if (!petManifest.sprite) {
      petManifest.sprite = { url: 'spritesheet.webp', width: 192, height: 208, columns: 8, rows: 9 };
      if (petManifest.spritesheetPath) petManifest.sprite.url = petManifest.spritesheetPath;
    }
    if (!petManifest.animations || Object.keys(petManifest.animations).length === 0) {
      petManifest.animations = {};
      var d = DEFAULT_ANIMATIONS;
      for (var k in d) { if (d.hasOwnProperty(k)) petManifest.animations[k] = { row: d[k].row, frames: d[k].frames, fps: d[k].fps }; }
    }

    petLog('INFO', 'sprite=' + JSON.stringify(getSprite()) + ', anims=' + Object.keys(getAnimations()).join(','));

    setInitialPosition(petData.config);
    resizeCanvas();

    // === spritesheet 缓存 ===
    var cached = spritesheetCache.get(petData.id);
    if (cached && cached.img) {
      petLog('INFO', '缓存命中: ' + petData.id + ' → 免 IPC + 免解码');
      spritesheet = cached.img;
      startIdleAnimation();
      return;
    }

    // 通过 IPC invoke 读取 spritesheet 文件（Buffer → Blob URL → 解码）
    var ssPath = petData.path + '/' + (petManifest.sprite.url || petManifest.spritesheetPath || 'spritesheet.webp');
    petLog('INFO', '加载 spritesheet: ' + ssPath);

    api.petReadFile(ssPath).then(function (result) {
      if (myLoadId !== loadId) { petLog('INFO', '忽略过期加载结果 #' + myLoadId); return; }
      if (!result || !result.ok) {
        petLog('ERROR', '读取失败: ' + (result ? result.error : 'unknown'));
        var fallback = petData.spritesheetUrl;
        if (fallback) loadWithFallback(fallback, myLoadId);
        return;
      }
      var buf = new Uint8Array(result.data);
      var mime = ssPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/webp';
      var blob = new Blob([buf], { type: mime });
      var blobUrl = URL.createObjectURL(blob);
      currentBlobUrl = blobUrl;
      petLog('INFO', 'Blob URL 已创建: ' + blobUrl.substring(0, 40) + '...');
      decodeSpritesheet(blob, blobUrl, myLoadId);
    }).catch(function (err) {
      if (myLoadId !== loadId) return;
      petLog('ERROR', 'IPC 读取异常: ' + err.message);
      var fallback = petData.spritesheetUrl;
      if (fallback) loadWithFallback(fallback, myLoadId);
    });

    // createImageBitmap 优先（直接传 Blob，免 fetch），失败回退 Image
    function decodeSpritesheet(blob, fallbackUrl, expectedLoadId) {
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'premultiply' })
          .then(function (bitmap) {
            if (expectedLoadId !== loadId) { bitmap.close(); return; }
            petLog('INFO', 'createImageBitmap GPU 解码成功: ' + bitmap.width + 'x' + bitmap.height);
            onDecodeDone(bitmap, fallbackUrl, expectedLoadId);
          })
          .catch(function () {
            if (expectedLoadId !== loadId) return;
            petLog('WARN', 'createImageBitmap 失败，回退 Image');
            loadWithFallback(fallbackUrl, expectedLoadId);
          });
        return;
      }
      loadWithFallback(fallbackUrl, expectedLoadId);
    }

    function loadWithFallback(url, expectedLoadId) {
      var img = new Image();
      img.onload = function () {
        if (expectedLoadId !== loadId) return;
        petLog('INFO', 'Image 解码成功: ' + img.width + 'x' + img.height);
        onDecodeDone(img, url, expectedLoadId);
      };
      img.onerror = function () {
        if (expectedLoadId !== loadId) return;
        petLog('ERROR', 'spritesheet 加载失败');
      };
      img.src = url;
    }

    function onDecodeDone(img, url, expectedLoadId) {
      if (expectedLoadId !== loadId) return;
      spritesheet = img;

      // 存入 LRU 缓存，淘汰最旧条目
      if (spritesheetCache.size >= MAX_CACHE_SIZE) {
        var firstKey = spritesheetCache.keys().next().value;
        var old = spritesheetCache.get(firstKey);
        if (old) {
          if (old.img && old.img.close) old.img.close();
          if (old.blobUrl) URL.revokeObjectURL(old.blobUrl);
        }
        spritesheetCache.delete(firstKey);
      }
      spritesheetCache.set(petData.id, { img: img, blobUrl: url });

      startIdleAnimation();
    }
  }

  // 绕过 transitionState 的状态检查，直接启动 idle 动画
  function startIdleAnimation() {
    currentState = 'idle';
    idleTimeStart = performance.now();
    idlePhase = 'active';
    playAnimation('idle', {});
  }

  // === 鼠标交互 ===
  // forward:true 时 mousemove 仍会到达页面，但 mousedown/mouseup 不会。
  // 策略：通过 window mousemove 检测鼠标接近宠物 → 关闭穿透 → 接收 mousedown 开始拖拽 → mouseup 结束拖拽 → 恢复穿透
  let isDragging = false;
  let isMouseNear = false;
  let dragStartScreenX = 0, dragStartScreenY = 0;
  let dragStartPetX = 0, dragStartPetY = 0;
  let dragCumDX = 0, dragCumDY = 0;
  let hoverTimer = null;
  let exitDebounceTimer = null;

  function petRect() {
    return {
      left: petX, top: petY,
      right: petX + Math.round(192 * scale),
      bottom: petY + Math.round(208 * scale),
    };
  }

  function isNearPet(clientX, clientY, exiting) {
    var r = petRect();
    // hysteresis：离开时用更宽的容差，防止边缘快速切换导致闪烁
    var margin = exiting ? 24 : 8;
    return clientX >= r.left - margin && clientX <= r.right + margin &&
           clientY >= r.top - margin && clientY <= r.bottom + margin;
  }

  // window mousemove 在 forward:true 时仍能触发，用于检测接近
  window.addEventListener('mousemove', function (e) {
    var near = isNearPet(e.clientX, e.clientY, isMouseNear);

    if (near && !isMouseNear) {
      isMouseNear = true;
      clearExitDebounce();
      api.sendDragStart(); // → setIgnoreMouseEvents(false)，现在可以接收 mousedown
    } else if (!near && isMouseNear && !isDragging) {
      // 延迟退出：鼠标短暂离开后立即回来不会反复切换穿透状态
      if (!exitDebounceTimer) {
        exitDebounceTimer = setTimeout(function () {
          isMouseNear = false;
          clearHoverTimer();
          api.sendDragEnd();   // → setIgnoreMouseEvents(true)，恢复穿透
          exitDebounceTimer = null;
        }, 300);
      }
    }

    if (isDragging) {
      var sdx = e.screenX - dragStartScreenX;
      var sdy = e.screenY - dragStartScreenY;
      dragCumDX = Math.abs(sdx);
      dragCumDY = Math.abs(sdy);

      // 拖拽方向动画
      if (dragCumDX > 8 || dragCumDY > 8) {
        if (dragCumDX > dragCumDY) {
          playAnimation(sdx > 0 ? 'runningRight' : 'runningLeft', {});
        } else {
          playAnimation(sdy > 0 ? 'jumping' : 'waving', {});
        }
      }

      petX = dragStartPetX + sdx;
      petY = dragStartPetY + sdy;
      applyPosition();
    }

    // 悬停检测
    if (!isDragging && near && currentState === 'idle') {
      if (!hoverTimer) {
        hoverTimer = setTimeout(function () {
          if (!isDragging && currentState === 'idle') playAnimation('waving', {});
        }, 600);
      }
    }
  });

  // mousedown 在穿透关闭后到达
  canvas.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    isDragging = true;
    clearExitDebounce();
    dragCumDX = 0; dragCumDY = 0;
    dragStartScreenX = e.screenX;
    dragStartScreenY = e.screenY;
    dragStartPetX = petX;
    dragStartPetY = petY;
    clearHoverTimer();
    petLog('DEBUG', '拖拽开始');
    // 穿透已在 mousemove 接近时关闭
  });

  // mouseup 也在穿透关闭后到达
  window.addEventListener('mouseup', function (e) {
    if (!isDragging) return;
    petLog('DEBUG', '拖拽结束: dx=' + dragCumDX + ', dy=' + dragCumDY);
    api.sendPetAction({ type: 'drag-end', x: petX, y: petY });
    api.sendDragEnd();  // 恢复穿透
    isDragging = false;
    isMouseNear = false;
    dragCumDX = 0; dragCumDY = 0;
    setTimeout(function () { if (!isDragging) setState('idle'); }, 200);
  });

  function clearHoverTimer() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  }

  function clearExitDebounce() {
    if (exitDebounceTimer) { clearTimeout(exitDebounceTimer); exitDebounceTimer = null; }
  }

  canvas.addEventListener('dblclick', function () {
    api.sendPetAction({ type: 'double-click' });
  });

  canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  // === IPC 事件 ===
  api.onPetLoad(function (petData) {
    petLog('INFO', '收到 pet:load: id="' + petData.id + '"');
    loadPet(petData);
  });

  api.onPetEvent(function (event) {
    if (!petManifest) return;
    switch (event.type) {
      case 'session:user-input-start':
        idleTimeStart = performance.now(); idlePhase = 'active'; transitionState('attention'); break;
      case 'session:ai-thinking-start': transitionState('thinking'); break;
      case 'session:tool-call-start': transitionState('working'); break;
      case 'session:tool-call-end': transitionState('thinking'); break;
      case 'session:response-start':
        idleTimeStart = performance.now(); idlePhase = 'active'; break;
      case 'session:response-complete': transitionState('success'); break;
      case 'session:error': transitionState('error'); break;
    }
  });

  api.onPetConfigUpdate(function (config) {
    if (config.zoom && config.zoom !== scale) {
      scale = Math.max(0.5, Math.min(2.0, config.zoom));
      applyPosition();
    }
    if (config.position && config.position !== 'custom') {
      setInitialPosition(config);
    }
  });

  api.onPetPauseRender(function () { isPaused = true; });
  api.onPetResumeRender(function () { isPaused = false; });

  // === 启动 ===
  canvas.width = 192;
  canvas.height = 208;
  offscreen.width = 192;
  offscreen.height = 208;
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.willChange = 'transform';
  setInitialPosition(null);  // 默认右下角

  offCtx.fillStyle = 'rgba(136, 153, 184, 0.4)';
  offCtx.font = '20px sans-serif';
  offCtx.textAlign = 'center';
  offCtx.fillText('🐾', offscreen.width / 2, offscreen.height / 2);
  offCtx.textAlign = 'start';
  ctx.drawImage(offscreen, 0, 0);

  petLog('INFO', 'pet-renderer 就绪');
})();
