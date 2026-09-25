/* GB Studio Reviews: local media, time-linked feedback and frame annotations. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const DB_NAME = 'gb-studio-reviews-v1';
  const ACTIVE_KEY = 'gb-studio-reviews-active-v1';
  const state = { records: [], active: null, mediaUrl: null, drawing: false, draft: [], activeCommentId: null, pointerId: null, saving: false };
  const video = $('#reviewsVideo');
  const image = $('#reviewsImage');
  const canvas = $('#reviewsCanvas');
  const ctx = canvas.getContext('2d');
  let databasePromise;

  function openDatabase() {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return databasePromise;
  }
  async function databaseRequest(storeName, mode, action) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      let result;
      try { result = action(transaction.objectStore(storeName)); } catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('No se pudo guardar el archivo'));
    });
  }
  async function saveRecord(record) { await databaseRequest('items', 'readwrite', store => store.put(record)); }
  async function getMedia(id) { return databaseRequest('media', 'readonly', store => store.get(id)); }
  function formatTime(seconds) {
    const whole = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(whole / 3600);
    const minutes = String(Math.floor(whole / 60) % 60).padStart(2, '0');
    const rest = String(whole % 60).padStart(2, '0');
    return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
  }
  function readableSize(bytes) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
  function isVideo() { return state.active?.kind === 'video'; }
  function currentTime() { return isVideo() ? Math.max(0, video.currentTime || 0) : 0; }
  function showStatus(message) { $('#reviewsCommentContext').textContent = message; }
  function stopMedia() { video.pause(); video.removeAttribute('src'); video.load(); image.removeAttribute('src'); if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl); state.mediaUrl = null; }
  function clearAnnotation() { state.draft = []; state.activeCommentId = null; redraw(); renderCommentList(); }
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }
  function visibleStrokes() {
    if (state.draft.length) return state.draft;
    return state.active?.comments.find(comment => comment.id === state.activeCommentId)?.strokes || [];
  }
  function redraw() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const stroke of visibleStrokes()) {
      if (!stroke.points?.length) continue;
      ctx.beginPath();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = stroke.color || '#ff3b30';
      ctx.lineWidth = Math.max(2, rect.width * .004);
      stroke.points.forEach(([x, y], index) => index ? ctx.lineTo(x * rect.width, y * rect.height) : ctx.moveTo(x * rect.width, y * rect.height));
      if (stroke.points.length === 1) { const [x, y] = stroke.points[0]; ctx.lineTo(x * rect.width + .1, y * rect.height + .1); }
      ctx.stroke();
    }
  }
  function pointerPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  }
  function renderList() {
    const list = $('#reviewsList');
    list.replaceChildren();
    $('#reviewsCount').textContent = state.records.length;
    if (!state.records.length) {
      const empty = document.createElement('p'); empty.className = 'reviews-list-empty'; empty.textContent = 'Todavía no cargaste archivos.'; list.append(empty); return;
    }
    for (const record of [...state.records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `reviews-file${record.id === state.active?.id ? ' is-active' : ''}`;
      const icon = document.createElement('span'); icon.className = 'reviews-file-icon'; icon.textContent = record.kind === 'video' ? '▶' : '▧';
      const copy = document.createElement('span'); copy.className = 'reviews-file-copy';
      const name = document.createElement('strong'); name.textContent = record.name;
      const details = document.createElement('small'); details.textContent = `${record.kind === 'video' ? 'VIDEO' : 'FOTO'} · ${record.comments.length} comentario${record.comments.length === 1 ? '' : 's'}`;
      copy.append(name, details); button.append(icon, copy); button.addEventListener('click', () => selectRecord(record.id)); list.append(button);
    }
  }
  function renderMarkers() {
    const wrapper = $('#reviewsMarkers'); wrapper.replaceChildren();
    if (!isVideo() || !Number.isFinite(video.duration) || !video.duration) return;
    for (const comment of state.active.comments) {
      const marker = document.createElement('button'); marker.type = 'button'; marker.className = `reviews-marker${comment.resolved ? ' is-resolved' : ''}`;
      marker.style.left = `${Math.max(0, Math.min(100, comment.time / video.duration * 100))}%`;
      marker.title = `${formatTime(comment.time)} · ${comment.text || 'Anotación'}`;
      marker.setAttribute('aria-label', marker.title);
      marker.addEventListener('click', () => selectComment(comment.id)); wrapper.append(marker);
    }
  }
  function renderCommentList() {
    const list = $('#reviewsCommentList'); list.replaceChildren();
    const comments = state.active?.comments || [];
    $('#reviewsCommentCount').textContent = comments.length;
    if (!state.active) return;
    if (!comments.length) {
      const empty = document.createElement('p'); empty.className = 'reviews-comment-empty'; empty.textContent = 'Aún no hay comentarios. Pausá el video o elegí un punto de la foto para dejar la primera corrección.'; list.append(empty); return;
    }
    for (const comment of [...comments].sort((a, b) => a.time - b.time || a.createdAt.localeCompare(b.createdAt))) {
      const card = document.createElement('article'); card.className = `reviews-comment${comment.id === state.activeCommentId ? ' is-selected' : ''}${comment.resolved ? ' is-resolved' : ''}`;
      const open = document.createElement('button'); open.type = 'button'; open.className = 'reviews-comment-open';
      const meta = document.createElement('span'); meta.className = 'reviews-comment-meta'; meta.textContent = `${isVideo() ? formatTime(comment.time) : 'FOTO'}${comment.strokes?.length ? ' · ✎ Anotación' : ''}`;
      const text = document.createElement('span'); text.className = 'reviews-comment-text'; text.textContent = comment.text || 'Anotación visual';
      open.append(meta, text); open.addEventListener('click', () => selectComment(comment.id));
      const actions = document.createElement('div'); actions.className = 'reviews-comment-actions';
      const resolve = document.createElement('button'); resolve.type = 'button'; resolve.textContent = comment.resolved ? 'Reabrir' : 'Resolver'; resolve.addEventListener('click', () => updateComment(comment.id, entry => { entry.resolved = !entry.resolved; }));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Eliminar'; remove.addEventListener('click', () => updateComment(comment.id, null));
      actions.append(resolve, remove); card.append(open, actions); list.append(card);
    }
  }
  function updateClock() {
    $('#reviewsCurrentTime').textContent = formatTime(currentTime());
    $('#reviewsDuration').textContent = formatTime(video.duration);
    $('#reviewsCommentTime').textContent = isVideo() ? formatTime(currentTime()) : 'Foto';
    $('#reviewsSeek').value = video.duration ? String(Math.round(currentTime() / video.duration * 1000)) : '0';
    $('#reviewsPlayBtn').textContent = video.paused ? '▶' : '❚❚';
    $('#reviewsPlayBtn').setAttribute('aria-label', video.paused ? 'Reproducir' : 'Pausar');
    $('#reviewsMuteBtn').textContent = video.muted ? '×' : '♪';
    $('#reviewsMuteBtn').setAttribute('aria-label', video.muted ? 'Activar sonido' : 'Silenciar');
  }
  async function selectRecord(id) {
    const record = state.records.find(entry => entry.id === id); if (!record) return;
    stopMedia(); state.active = record; state.draft = []; state.activeCommentId = null; state.drawing = false;
    localStorage.setItem(ACTIVE_KEY, id);
    renderList(); renderCommentList();
    $('#reviewsMediaTitle').textContent = record.name;
    $('#reviewsMediaDetails').textContent = `${record.kind === 'video' ? 'Video' : 'Foto'} · ${readableSize(record.size)}`;
    $('#reviewsEmpty').hidden = true; $('#reviewsMediaSurface').hidden = false;
    $('#reviewsAnnotationBar').hidden = false; $('#reviewsCommentForm').hidden = false; $('#reviewsRemoveMedia').hidden = false;
    $('#reviewsTimeline').hidden = record.kind !== 'video';
    $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false');
    canvas.classList.remove('is-drawing');
    showStatus(record.kind === 'video' ? 'Los comentarios se guardan en el segundo actual.' : 'Los comentarios se guardan sobre esta foto.');
    try {
      const blob = await getMedia(id);
      if (state.active?.id !== id) return;
      if (!blob) throw new Error('El archivo ya no está disponible en este navegador');
      state.mediaUrl = URL.createObjectURL(blob);
      image.hidden = record.kind !== 'image'; video.hidden = record.kind !== 'video';
      if (record.kind === 'video') video.src = state.mediaUrl; else image.src = state.mediaUrl;
      updateClock(); renderMarkers(); requestAnimationFrame(resizeCanvas);
    } catch (error) { showStatus(error.message || 'No se pudo abrir el archivo'); }
  }
  function selectComment(id) {
    const comment = state.active?.comments.find(entry => entry.id === id); if (!comment) return;
    video.pause();
    if (isVideo()) video.currentTime = Math.min(comment.time, Number.isFinite(video.duration) ? video.duration : comment.time);
    state.activeCommentId = id; state.draft = []; state.drawing = false;
    canvas.classList.remove('is-drawing'); $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false');
    renderCommentList(); redraw(); updateClock();
  }
  async function updateComment(id, mutate) {
    if (!state.active) return;
    if (mutate) { const entry = state.active.comments.find(comment => comment.id === id); if (!entry) return; mutate(entry); }
    else state.active.comments = state.active.comments.filter(comment => comment.id !== id);
    if (state.activeCommentId === id && !mutate) state.activeCommentId = null;
    state.active.updatedAt = new Date().toISOString();
    try { await saveRecord(state.active); } catch { showStatus('No se pudo guardar el cambio. Revisá el espacio disponible.'); }
    renderCommentList(); renderList(); renderMarkers(); redraw();
  }
  async function addFiles(files) {
    for (const file of files) {
      const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null;
      if (!kind) { showStatus(`Formato no compatible: ${file.name}`); continue; }
      const now = new Date().toISOString();
      const record = { id: crypto.randomUUID(), name: file.name, kind, size: file.size, createdAt: now, updatedAt: now, comments: [] };
      try {
        const db = await openDatabase();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['items', 'media'], 'readwrite');
          tx.objectStore('items').put(record); tx.objectStore('media').put(file, record.id);
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        });
        state.records.unshift(record); await selectRecord(record.id);
      } catch (error) { showStatus(`No se pudo guardar ${file.name}. Puede faltar espacio en este navegador.`); console.error(error); }
    }
  }
  async function removeActive() {
    const record = state.active; if (!record || !confirm(`¿Eliminar “${record.name}” y todos sus comentarios de este navegador?`)) return;
    try {
      const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['items', 'media'], 'readwrite');
        tx.objectStore('items').delete(record.id); tx.objectStore('media').delete(record.id);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
      stopMedia(); state.records = state.records.filter(entry => entry.id !== record.id); state.active = null; localStorage.removeItem(ACTIVE_KEY);
      if (state.records.length) await selectRecord(state.records[0].id);
      else {
        $('#reviewsMediaTitle').textContent = 'Elegí un archivo'; $('#reviewsMediaDetails').textContent = 'Subí una foto o un video para empezar.';
        $('#reviewsEmpty').hidden = false; $('#reviewsMediaSurface').hidden = true; $('#reviewsTimeline').hidden = true;
        $('#reviewsAnnotationBar').hidden = true; $('#reviewsCommentForm').hidden = true; $('#reviewsRemoveMedia').hidden = true;
        showStatus('Elegí un archivo para ver sus comentarios.'); renderList(); renderCommentList();
      }
    } catch (error) { showStatus('No se pudo eliminar el archivo.'); console.error(error); }
  }
  function showReviews() {
    if (document.body.classList.contains('auth-locked')) return;
    showDashboard();
    $('#dashboardView').hidden = true; $('#reviewsView').hidden = false; document.body.classList.add('reviews-open');
    $('#storyboardsNav').classList.remove('is-active'); $('#reviewsNav').classList.add('is-active');
    $('#breadcrumbTitle').textContent = 'Reviews';
    requestAnimationFrame(resizeCanvas);
  }
  async function initialize() {
    try {
      state.records = await databaseRequest('items', 'readonly', store => store.getAll()) || [];
      renderList();
      const id = localStorage.getItem(ACTIVE_KEY);
      if (id && state.records.some(record => record.id === id)) await selectRecord(id);
      else if (state.records.length) await selectRecord(state.records[0].id);
    } catch (error) { showStatus('Reviews necesita almacenamiento local del navegador para guardar archivos y comentarios.'); console.error(error); }
  }

  $('#reviewsNav').addEventListener('click', showReviews);
  $('#dashboardReviewsBtn').addEventListener('click', showReviews);
  $('#storyboardsNav').addEventListener('click', () => video.pause());
  document.querySelector('.brand').addEventListener('click', () => video.pause());
  $('#reviewsUploadBtn').addEventListener('click', () => $('#reviewsFileInput').click());
  $('#reviewsEmptyUpload').addEventListener('click', () => $('#reviewsFileInput').click());
  $('#reviewsFileInput').addEventListener('change', event => { addFiles([...event.target.files]); event.target.value = ''; });
  $('#reviewsRemoveMedia').addEventListener('click', removeActive);
  $('#reviewsStage').addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); $('#reviewsStage').classList.add('is-drop-target'); } });
  $('#reviewsStage').addEventListener('dragleave', () => $('#reviewsStage').classList.remove('is-drop-target'));
  $('#reviewsStage').addEventListener('drop', event => { event.preventDefault(); $('#reviewsStage').classList.remove('is-drop-target'); addFiles([...event.dataTransfer.files]); });
  $('#reviewsPlayBtn').addEventListener('click', () => video.paused ? video.play().catch(() => showStatus('Este navegador no puede reproducir el formato del video.')) : video.pause());
  $('#reviewsMuteBtn').addEventListener('click', () => { video.muted = !video.muted; updateClock(); });
  video.addEventListener('click', () => { if (state.drawing) return; video.paused ? video.play().catch(() => showStatus('Este navegador no puede reproducir el formato del video.')) : video.pause(); });
  $('#reviewsSeek').addEventListener('input', event => { if (!Number.isFinite(video.duration)) return; video.currentTime = video.duration * Number(event.target.value) / 1000; state.activeCommentId = null; redraw(); updateClock(); renderCommentList(); });
  video.addEventListener('loadedmetadata', () => { $('#reviewsMediaSurface').style.setProperty('--review-aspect', String((video.videoWidth || 16) / (video.videoHeight || 9))); updateClock(); renderMarkers(); resizeCanvas(); });
  image.addEventListener('load', () => { $('#reviewsMediaSurface').style.setProperty('--review-aspect', String((image.naturalWidth || 16) / (image.naturalHeight || 9))); resizeCanvas(); });
  video.addEventListener('timeupdate', updateClock);
  video.addEventListener('play', () => { state.activeCommentId = null; state.drawing = false; canvas.classList.remove('is-drawing'); $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false'); redraw(); renderCommentList(); updateClock(); });
  video.addEventListener('pause', updateClock);
  video.addEventListener('error', () => showStatus('El formato del video no se puede reproducir en este navegador. Probá con MP4 (H.264) o WebM.'));
  $('#reviewsDrawBtn').addEventListener('click', () => { if (!state.active) return; video.pause(); state.activeCommentId = null; state.drawing = !state.drawing; canvas.classList.toggle('is-drawing', state.drawing); $('#reviewsDrawBtn').classList.toggle('is-active', state.drawing); $('#reviewsDrawBtn').setAttribute('aria-pressed', String(state.drawing)); redraw(); });
  $('#reviewsUndoBtn').addEventListener('click', () => { state.draft.pop(); redraw(); });
  $('#reviewsClearBtn').addEventListener('click', clearAnnotation);
  canvas.addEventListener('pointerdown', event => { if (!state.drawing || !state.active) return; event.preventDefault(); state.activeCommentId = null; state.pointerId = event.pointerId; canvas.setPointerCapture(event.pointerId); state.draft.push({ color: $('#reviewsColor').value, points: [pointerPoint(event)] }); redraw(); });
  canvas.addEventListener('pointermove', event => { if (state.pointerId !== event.pointerId || !state.draft.length) return; const stroke = state.draft.at(-1); const point = pointerPoint(event); const last = stroke.points.at(-1); if (Math.hypot((point[0] - last[0]) * canvas.clientWidth, (point[1] - last[1]) * canvas.clientHeight) > 2) { stroke.points.push(point); redraw(); } });
  const endStroke = event => { if (state.pointerId !== event.pointerId) return; state.pointerId = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); };
  canvas.addEventListener('pointerup', endStroke); canvas.addEventListener('pointercancel', endStroke);
  $('#reviewsCommentForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.active || state.saving) return;
    const text = $('#reviewsCommentText').value.trim(); if (!text && !state.draft.length) { $('#reviewsCommentText').focus(); return; }
    const comment = { id: crypto.randomUUID(), text, time: currentTime(), strokes: structuredClone(state.draft), resolved: false, createdAt: new Date().toISOString() };
    state.saving = true; $('#reviewsCommentForm button[type=submit]').disabled = true;
    state.active.comments.push(comment); state.active.updatedAt = comment.createdAt;
    try {
      await saveRecord(state.active); $('#reviewsCommentText').value = ''; state.draft = []; state.activeCommentId = comment.id; state.drawing = false;
      canvas.classList.remove('is-drawing'); $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false');
      renderCommentList(); renderMarkers(); renderList(); redraw();
    } catch (error) { state.active.comments.pop(); showStatus('No se pudo guardar el comentario. Revisá el espacio disponible.'); console.error(error); }
    finally { state.saving = false; $('#reviewsCommentForm button[type=submit]').disabled = false; }
  });
  new ResizeObserver(resizeCanvas).observe($('#reviewsMediaSurface'));
  initialize();
})();
