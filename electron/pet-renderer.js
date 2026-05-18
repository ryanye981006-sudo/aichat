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
  const ctx = canvas.getContext('2d', { alpha: true });

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
    applyPosition();
  }

  // === 精灵图渲染 ===
  function drawFrame() {
    if (!petManifest || !spritesheet || !currentAnimation) return;
    var sprite = getSprite();
    var col = currentFrame % sprite.columns;
    var row = currentAnimation.row;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (idlePhase === 'sleep') {
      ctx.globalAlpha = 0.6;
    }

    ctx.drawImage(
      spritesheet,
      col * sprite.width, row * sprite.height, sprite.width, sprite.height,
      0, 0, sprite.width, sprite.height
    );

    ctx.globalAlpha = 1.0;
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
      tick._lastTime = performance.now();
      animFrameId = requestAnimationFrame(tick);
    }
  }

  // === 状态机 ===
  function transitionState(newState) {
    if (newState === currentState) return;
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
    currentState = newState;
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
      if (idlePhase !== 'sleep') { idlePhase = 'sleep'; if (currentState === 'idle') { currentState = 'sleep'; fps = 2; } }
    } else if (elapsed >= 120000) { idlePhase = 'drowsy'; }
    else if (elapsed >= 30000) { idlePhase = 'fidget'; }
  }
  setInterval(updateIdlePhase, 1000);

  // === 加载宠物 ===
  function loadPet(petData) {
    petLog('INFO', 'loadPet: id="' + petData.id + '", name="' + petData.name + '"');
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

    var ssUrl = petData.spritesheetDataUrl || petData.spritesheetUrl;
    petLog('INFO', '加载 spritesheet: ' + (petData.spritesheetDataUrl ? '(base64)' : ssUrl));

    var img = new Image();
    img.onload = function () {
      petLog('INFO', 'spritesheet 加载成功! ' + img.width + 'x' + img.height);
      spritesheet = img;
      setState('idle');
    };
    img.onerror = function () {
      petLog('ERROR', 'spritesheet 加载失败');
    };
    img.src = ssUrl;
  }

  // === 鼠标交互 ===
  let isDragging = false;
  let dragStartScreenX = 0, dragStartScreenY = 0;
  let dragStartPetX = 0, dragStartPetY = 0;
  let dragCumDX = 0, dragCumDY = 0;
  let hoverTimer = null;

  function isOpaquePixel(x, y) {
    if (!spritesheet || !petManifest) return true;
    var sprite = getSprite();
    var sx = Math.floor(x / scale);
    var sy = Math.floor(y / scale);
    if (sx < 0 || sy < 0 || sx >= sprite.width || sy >= sprite.height) return false;
    // 快速检测：用 canvas 当前位置判断
    return true;
  }

  function updateMousePassthrough(e) {
    if (isDragging) return;
    // 检测鼠标是否在宠物范围内
    var rect = canvas.getBoundingClientRect();
    var inBounds = e.clientX >= rect.left && e.clientX <= rect.right &&
                   e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inBounds) {
      api.sendPetAction({ type: 'mouse-leave' });
    }
  }

  canvas.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    isDragging = true;
    dragCumDX = 0;
    dragCumDY = 0;
    dragStartScreenX = e.screenX;
    dragStartScreenY = e.screenY;
    dragStartPetX = petX;
    dragStartPetY = petY;
    clearHoverTimer();

    petLog('DEBUG', '拖拽开始: petX=' + Math.round(petX) + ', petY=' + Math.round(petY));
    api.sendDragStart();
  });

  canvas.addEventListener('mousemove', function (e) {
    if (isDragging) {
      var dx = e.screenX - dragStartScreenX;
      var dy = e.screenY - dragStartScreenY;
      dragCumDX += Math.abs(dx);
      dragCumDY += Math.abs(dy);

      // 拖拽方向动画
      var absDX = Math.abs(e.screenX - dragStartScreenX);
      var absDY = Math.abs(e.screenY - dragStartScreenY);
      if (absDX > 8 || absDY > 8) {
        if (absDX > absDY) {
          playAnimation(e.screenX > dragStartScreenX ? 'runningRight' : 'runningLeft', {});
        } else {
          playAnimation(e.screenY > dragStartScreenY ? 'jumping' : 'waving', {});
        }
      }

      petX = dragStartPetX + dx;
      petY = dragStartPetY + dy;
      applyPosition();
    } else {
      // 悬停检测
      var rect = canvas.getBoundingClientRect();
      var over = e.clientX >= rect.left && e.clientX <= rect.right &&
                 e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (over && currentState === 'idle') {
        if (!hoverTimer) {
          hoverTimer = setTimeout(function () {
            if (!isDragging && currentState === 'idle') playAnimation('waving', {});
          }, 600);
        }
      } else if (!over) {
        clearHoverTimer();
      }
    }
  });

  window.addEventListener('mouseup', function (e) {
    if (!isDragging) return;
    petLog('DEBUG', '拖拽结束: dx=' + dragCumDX + ', dy=' + dragCumDY);

    // 保存位置
    api.sendPetAction({ type: 'drag-end', x: petX, y: petY });
    api.sendDragEnd();

    isDragging = false;
    dragCumDX = 0;
    dragCumDY = 0;

    // 恢复 idle
    setTimeout(function () { if (!isDragging) setState('idle'); }, 200);
  });

  function clearHoverTimer() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  }

  // 双击呼出主窗口
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
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.willChange = 'transform';
  setInitialPosition(null);  // 默认右下角

  ctx.fillStyle = 'rgba(136, 153, 184, 0.4)';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🐾', canvas.width / 2, canvas.height / 2);
  ctx.textAlign = 'start';

  petLog('INFO', 'pet-renderer 就绪');
})();
