/* ===== cutiebooth app logic ===== */

(() => {
  'use strict';

  // ----- DOM -----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const screens = {
    welcome: $('#screen-welcome'),
    camera:  $('#screen-camera'),
    editor:  $('#screen-editor'),
    wall:    $('#screen-wall'),
  };

  const video       = $('#video');
  const snapCanvas  = $('#snap-canvas');
  const stripCanvas = $('#strip-canvas');
  const stripCtx    = stripCanvas.getContext('2d');
  const snapCtx     = snapCanvas.getContext('2d');
  const countdownEl = $('#countdown');
  const flashEl     = $('#flash');
  const boothLight  = $('#booth-light');
  const boothLight2 = $('#booth-light-2');
  const stripPreview= $('#strip-preview');
  const stickerLayer= $('#sticker-layer');
  const cameraHint  = $('#camera-hint');
  const toastEl     = $('#toast');

  // ----- State -----
  const state = {
    stream: null,
    shots: 3,
    capturedFrames: [], // array of dataURLs
    placedStickers: [], // {id, type, content, x, y, size, rot}
    caption: '',
    posting: false,
  };

  // ----- Screens -----
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'wall') renderWall();
    if (name === 'camera' && !state.stream) startCamera();
  }

  $$('.nav-btn').forEach(b => {
    b.addEventListener('click', () => showScreen(b.dataset.screen));
  });
  $('#btn-start').addEventListener('click', () => showScreen('camera'));
  $('#btn-go-wall').addEventListener('click', () => showScreen('wall'));
  $('#btn-make-one').addEventListener('click', () => showScreen('camera'));
  $('#btn-retake').addEventListener('click', () => {
    state.capturedFrames = [];
    state.placedStickers = [];
    state.caption = '';
    stickerLayer.innerHTML = '';
    $('#caption-input').value = '';
    showScreen('camera');
  });

  // ----- Camera -----
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      state.stream = stream;
      video.srcObject = stream;
      await video.play().catch(()=>{});
      cameraHint.textContent = 'click when ready. smile. repeat.';
    } catch (err) {
      console.error('camera error', err);
      cameraHint.innerHTML = `<span style="color:var(--error)">camera not available. allow camera access & reload.</span>`;
    }
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach(t => t.stop());
      state.stream = null;
    }
  }

  // ----- Shot selection -----
  $$('input[name="shots"]').forEach(r => {
    r.addEventListener('change', e => {
      state.shots = parseInt(e.target.value, 10);
      renderStripPreview();
    });
  });

  function renderStripPreview() {
    stripPreview.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const slot = document.createElement('div');
      slot.className = 'strip-slot';
      if (i < state.capturedFrames.length) {
        const img = document.createElement('img');
        img.src = state.capturedFrames[i];
        slot.appendChild(img);
        slot.classList.add('filled');
      }
      stripPreview.appendChild(slot);
    }
  }

  // ----- Shutter -----
  $('#btn-shutter').addEventListener('click', async () => {
    if (state.posting) return;
    state.posting = true;
    state.capturedFrames = [];
    renderStripPreview();

    for (let i = 0; i < state.shots; i++) {
      cameraHint.textContent = `snap ${i + 1} of ${state.shots}`;
      await runCountdown();
      flash();
      const dataUrl = captureFrame();
      state.capturedFrames.push(dataUrl);
      renderStripPreview();
      if (i < state.shots - 1) await sleep(800);
    }

    state.posting = false;
    cameraHint.textContent = 'nice! opening editor…';
    await sleep(600);
    openEditor();
  });

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function runCountdown() {
    boothLight.classList.add('active');
    boothLight2.classList.add('active');
    for (const n of [3, 2, 1]) {
      countdownEl.textContent = n;
      countdownEl.classList.add('show');
      await sleep(800);
    }
    countdownEl.classList.remove('show');
    boothLight.classList.remove('active');
    boothLight2.classList.remove('active');
    await sleep(120);
  }

  function flash() {
    flashEl.classList.add('flash-on');
    setTimeout(() => flashEl.classList.remove('flash-on'), 320);
  }

  function captureFrame() {
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    snapCanvas.width = w;
    snapCanvas.height = h;
    // mirror flip
    snapCtx.save();
    snapCtx.translate(w, 0);
    snapCtx.scale(-1, 1);
    snapCtx.drawImage(video, 0, 0, w, h);
    snapCtx.restore();
    return snapCanvas.toDataURL('image/jpeg', 0.85);
  }

  // ----- Editor -----
  function openEditor() {
    stopCamera();
    showScreen('editor');
    buildStripCanvas();
  }

  function buildStripCanvas() {
    const PHOTO_W = 480;
    const PHOTO_H = 360;
    const GAP = 16;
    const PAD = 28;
    const n = state.capturedFrames.length;

    const canvasW = PAD * 2 + PHOTO_W;
    const canvasH = PAD * 2 + (PHOTO_H + GAP) * n - GAP;

    stripCanvas.width = canvasW;
    stripCanvas.height = canvasH;

    // paper bg
    stripCtx.fillStyle = '#fafaf7';
    stripCtx.fillRect(0, 0, canvasW, canvasH);

    // little squiggle decorations on the paper
    stripCtx.fillStyle = '#1a1a1a';
    stripCtx.font = '20px "Caveat", cursive';
    stripCtx.textAlign = 'left';
    stripCtx.fillText('~ cutiebooth ~', 18, canvasH - 10);
    stripCtx.textAlign = 'right';
    stripCtx.fillText(`✶ ${new Date().toLocaleDateString()}`, canvasW - 18, canvasH - 10);

    // place each photo with rotation for that hand-pasted feel
    const rotations = [-1.2, 1.5, -0.8, 1.8];
    state.capturedFrames.forEach((dataUrl, idx) => {
      const img = new Image();
      img.onload = () => {
        const x = PAD;
        const y = PAD + idx * (PHOTO_H + GAP);
        const cx = x + PHOTO_W / 2;
        const cy = y + PHOTO_H / 2;
        stripCtx.save();
        stripCtx.translate(cx, cy);
        stripCtx.rotate((rotations[idx % rotations.length]) * Math.PI / 180);
        // shadow
        stripCtx.fillStyle = 'rgba(0,0,0,0.10)';
        stripCtx.fillRect(-PHOTO_W / 2 + 6, -PHOTO_H / 2 + 6, PHOTO_W, PHOTO_H);
        // white photo backing
        stripCtx.fillStyle = '#fff';
        stripCtx.fillRect(-PHOTO_W / 2, -PHOTO_H / 2, PHOTO_W, PHOTO_H);
        // actual photo
        stripCtx.drawImage(img, -PHOTO_W / 2, -PHOTO_H / 2, PHOTO_W, PHOTO_H);
        // black border
        stripCtx.strokeStyle = '#1a1a1a';
        stripCtx.lineWidth = 2;
        stripCtx.strokeRect(-PHOTO_W / 2, -PHOTO_H / 2, PHOTO_W, PHOTO_H);
        stripCtx.restore();
      };
      img.src = dataUrl;
    });

    // re-place stickers after a tick (positions are % based on layer)
    setTimeout(() => repositionStickersFromData(), 50);
  }

  // ----- Stickers -----
  const EMOJI_STICKERS = ['♡', '✶', '✿', '✦', '☼', '☾', '✺', '◡', '✧', '❀', '♬', '☁'];
  const PROP_STICKERS = ['🎩', '👑', '🕶️', '🤠', '👒', '🎀', '🐱', '🐶', '🌵', '⭐', '🍒', '🌸'];

  function renderStickerPresets() {
    const presetsEl = $('#sticker-presets');
    presetsEl.innerHTML = '';
    EMOJI_STICKERS.forEach(ch => {
      const tile = document.createElement('div');
      tile.className = 'preset-tile';
      tile.textContent = ch;
      tile.addEventListener('click', () => addSticker({ type: 'emoji', content: ch }));
      presetsEl.appendChild(tile);
    });
    const propsEl = $('#prop-presets');
    propsEl.innerHTML = '';
    PROP_STICKERS.forEach(ch => {
      const tile = document.createElement('div');
      tile.className = 'preset-tile';
      tile.textContent = ch;
      tile.addEventListener('click', () => addSticker({ type: 'emoji', content: ch, size: 80 }));
      propsEl.appendChild(tile);
    });
  }
  renderStickerPresets();

  function addSticker({ type, content, size = 60 }) {
    const id = 's_' + Math.random().toString(36).slice(2, 10);
    const stickerData = {
      id, type, content,
      x: 40 + Math.random() * 20, // % from left
      y: 30 + Math.random() * 30, // % from top
      size, rot: (Math.random() * 30 - 15)
    };
    state.placedStickers.push(stickerData);
    renderSticker(stickerData);
  }

  function renderSticker(data) {
    const el = document.createElement('div');
    el.className = 'sticker' + (data.type === 'image' ? ' generated' : '');
    el.dataset.id = data.id;
    el.style.left = data.x + '%';
    el.style.top  = data.y + '%';
    el.style.fontSize = data.size + 'px';
    el.style.transform = `rotate(${data.rot}deg)`;
    if (data.type === 'image') {
      const img = document.createElement('img');
      img.src = data.content;
      el.appendChild(img);
    } else {
      el.textContent = data.content;
    }
    const del = document.createElement('button');
    del.className = 'sticker-del';
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeSticker(data.id);
    });
    el.appendChild(del);
    makeDraggable(el, data);
    stickerLayer.appendChild(el);
  }

  function removeSticker(id) {
    state.placedStickers = state.placedStickers.filter(s => s.id !== id);
    const el = stickerLayer.querySelector(`[data-id="${id}"]`);
    if (el) el.remove();
  }

  function repositionStickersFromData() {
    stickerLayer.innerHTML = '';
    state.placedStickers.forEach(renderSticker);
  }

  function makeDraggable(el, data) {
    let startX, startY, origX, origY, dragging = false;

    function getPos(e) {
      const pt = e.touches ? e.touches[0] : e;
      return { x: pt.clientX, y: pt.clientY };
    }

    function onStart(e) {
      e.preventDefault();
      dragging = true;
      const p = getPos(e);
      startX = p.x; startY = p.y;
      const rect = stickerLayer.getBoundingClientRect();
      origX = (data.x / 100) * rect.width;
      origY = (data.y / 100) * rect.height;
      el.style.zIndex = '100';
    }
    function onMove(e) {
      if (!dragging) return;
      const p = getPos(e);
      const rect = stickerLayer.getBoundingClientRect();
      const dx = p.x - startX;
      const dy = p.y - startY;
      let nx = origX + dx;
      let ny = origY + dy;
      nx = Math.max(0, Math.min(rect.width, nx));
      ny = Math.max(0, Math.min(rect.height, ny));
      data.x = (nx / rect.width) * 100;
      data.y = (ny / rect.height) * 100;
      el.style.left = data.x + '%';
      el.style.top  = data.y + '%';
    }
    function onEnd() {
      dragging = false;
      el.style.zIndex = '';
    }

    el.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    el.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
  }

  // ----- AI Sticker Generation (Pollinations.ai — free, no API key) -----
  $('#btn-gen-sticker').addEventListener('click', async () => {
    const prompt = $('#sticker-prompt').value.trim();
    if (!prompt) {
      showToast('type what you want to see!');
      return;
    }
    const status = $('#ai-status');
    const result = $('#ai-result');
    status.textContent = 'drawing…';
    result.innerHTML = '';

    // generate 4 sticker variations using a few seeds
    const seeds = [Math.floor(Math.random() * 999999), Math.floor(Math.random() * 999999), Math.floor(Math.random() * 999999), Math.floor(Math.random() * 999999)];
    const fullPrompt = `cute simple black and white line drawing sticker of ${prompt}, hand-drawn doodle, white background, no shading, minimal, sketch style, png`;

    seeds.forEach((seed, idx) => {
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=200&height=200&seed=${seed}&nologo=true`;
      const tile = document.createElement('div');
      tile.className = 'ai-tile';
      const img = document.createElement('img');
      img.src = url;
      img.alt = prompt;
      img.loading = 'lazy';
      img.onload = () => {
        if (idx === 0) status.textContent = 'tap one to add!';
      };
      img.onerror = () => {
        if (idx === 0) status.textContent = 'hmm, generation failed. try again.';
        tile.remove();
      };
      tile.appendChild(img);
      tile.addEventListener('click', () => {
        addSticker({ type: 'image', content: url, size: 90 });
      });
      result.appendChild(tile);
    });
  });

  // ----- Caption -----
  $('#btn-add-caption').addEventListener('click', () => {
    const v = $('#caption-input').value.trim();
    if (!v) { showToast('write a little something first'); return; }
    state.caption = v;
    addSticker({ type: 'emoji', content: '✎', size: 50 });
    showToast('caption saved (draws onto strip on save)');
  });

  // ----- Download & Wall -----
  $('#btn-download').addEventListener('click', () => {
    const finalCanvas = renderFinalComposite();
    const link = document.createElement('a');
    link.download = `cutiebooth-${Date.now()}.png`;
    link.href = finalCanvas.toDataURL('image/png');
    link.click();
    showToast('saved! check your downloads');
  });

  $('#btn-post-wall').addEventListener('click', () => {
    const finalCanvas = renderFinalComposite();
    const dataUrl = finalCanvas.toDataURL('image/png');
    const name = $('#wall-name').value.trim() || 'anon';
    const caption = $('#caption-input').value.trim();
    const strip = {
      id: 'strip_' + Date.now(),
      img: dataUrl,
      name,
      caption,
      ts: Date.now(),
    };
    saveStrip(strip);
    showToast('posted to the wall! ♡');
    setTimeout(() => showScreen('wall'), 500);
  });

  // render final composite: strip canvas + stickers + caption overlay
  function renderFinalComposite() {
    const composite = document.createElement('canvas');
    composite.width = stripCanvas.width;
    composite.height = stripCanvas.height;
    const ctx = composite.getContext('2d');
    ctx.drawImage(stripCanvas, 0, 0);

    // draw each placed sticker onto composite
    state.placedStickers.forEach(s => {
      const px = (s.x / 100) * composite.width;
      const py = (s.y / 100) * composite.height;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate((s.rot || 0) * Math.PI / 180);
      if (s.type === 'image') {
        // draw image - we'd need to load it but it's cached
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = s.content;
        if (img.complete) {
          ctx.drawImage(img, -s.size / 2, -s.size / 2, s.size, s.size);
        }
      } else {
        ctx.font = `${s.size}px "Caveat", cursive`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.content, 0, 0);
      }
      ctx.restore();
    });

    // caption overlay (bottom)
    if (state.caption) {
      ctx.save();
      ctx.font = `bold 36px "Caveat", cursive`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#1a1a1a';
      ctx.fillText(state.caption, composite.width / 2, composite.height - 8);
      ctx.restore();
    }

    return composite;
  }

  // ----- Wall (localStorage) -----
  function getStrips() {
    try {
      return JSON.parse(localStorage.getItem('cutiebooth_strips') || '[]');
    } catch { return []; }
  }
  function saveStrip(strip) {
    const all = getStrips();
    all.unshift(strip);
    // cap at 30 to keep storage sane
    if (all.length > 30) all.length = 30;
    localStorage.setItem('cutiebooth_strips', JSON.stringify(all));
  }

  function renderWall() {
    const grid = $('#wall-grid');
    const empty = $('#empty-wall');
    grid.innerHTML = '';
    const strips = getStrips();
    if (strips.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    strips.forEach(s => {
      const card = document.createElement('div');
      card.className = 'wall-card';
      const img = document.createElement('img');
      img.src = s.img;
      img.alt = 'photo strip';
      card.appendChild(img);
      if (s.caption) {
        const cap = document.createElement('div');
        cap.className = 'wall-caption';
        cap.textContent = s.caption;
        card.appendChild(cap);
      }
      const meta = document.createElement('div');
      meta.className = 'wall-meta';
      const date = new Date(s.ts);
      meta.textContent = `~ ${s.name} · ${date.toLocaleDateString()} ~`;
      card.appendChild(meta);
      grid.appendChild(card);
    });
  }

  // ----- Toast -----
  let toastTimer;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  // ----- Boot -----
  // kick off camera eagerly if user grants; otherwise wait for start button
  startCamera();
})();
