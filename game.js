'use strict';
// ============================================================
//  Tanks 3D — клиент (Three.js r128). Вся логика боя проверяется на сервере (api.php).
// ============================================================
const $ = s => document.querySelector(s);
let ME = null, CAT = null, S = null, tab = 'hangar', shopTab = 'prem';
const IS_TOUCH_DEV = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
let fpsValue=0, fpsFrames=0, fpsMark=performance.now(), pingValue=null, pingTimer=null, clockTimer=null, queueMode='pvp';

async function api(a, d) {
  try {
    const r = await fetch('api.php?a=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d || {}), credentials: 'same-origin' });
    return await r.json();
  } catch (e) { return { ok: false, err: 'Нет связи с сервером' }; }
}
function toast(t, ms) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d);
  setTimeout(() => d.remove(), ms || 2200);
}
const fmt = n => Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function angdiff(a, b) { let d = (a - b + Math.PI) % (2 * Math.PI); if (d < 0) d += 2 * Math.PI; return d - Math.PI; }
function turnTo(c, w, s) { return c + clamp(angdiff(w, c), -s, s); }

// ---------- Геометрия (идентична серверной) ----------
const R = 1.8, ARENA = 60;
function resolve(p) {
  for (const w of CAT.walls) {
    const hx = w[2] / 2, hz = w[3] / 2;
    const cx = clamp(p.x, w[0] - hx, w[0] + hx), cz = clamp(p.z, w[1] - hz, w[1] + hz);
    const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < R * R) {
      if (d2 > 1e-6) { const d = Math.sqrt(d2); p.x = cx + dx / d * R; p.z = cz + dz / d * R; }
      else {
        const px = hx - Math.abs(p.x - w[0]), pz = hz - Math.abs(p.z - w[1]);
        if (px < pz) p.x = w[0] + (p.x >= w[0] ? 1 : -1) * (hx + R); else p.z = w[1] + (p.z >= w[1] ? 1 : -1) * (hz + R);
      }
    }
  }
  const b = ARENA - R; p.x = clamp(p.x, -b, b); p.z = clamp(p.z, -b, b);
}
function rayBox(ox, oz, dx, dz, w) {
  const hx = w[2] / 2, hz = w[3] / 2; let tmin = 0, tmax = 1e9;
  for (const [o, d, lo, hi] of [[ox, dx, w[0] - hx, w[0] + hx], [oz, dz, w[1] - hz, w[1] + hz]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; }
    else { let t1 = (lo - o) / d, t2 = (hi - o) / d; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return null; }
  }
  return tmin;
}

// ---------- Three.js ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('#cv'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
function applyGraphicsQuality(){ const q=(S&&S.graphics)||'medium'; const ratio=q==='low'?0.75:q==='high'?Math.min(devicePixelRatio,2):Math.min(devicePixelRatio,1.35); renderer.setPixelRatio(ratio); renderer.setSize(innerWidth,innerHeight); renderer.shadowMap.enabled=false; }
function startPerfMonitors(){ clearInterval(pingTimer); clearInterval(clockTimer); pingTimer=setInterval(async()=>{if(!ME)return;const t=performance.now();const r=await api('ping');if(r&&r.ok)pingValue=Math.max(0,Math.round(performance.now()-t));},5000); clockTimer=setInterval(updatePerfHud,1000); updatePerfHud(); }
function updatePerfHud(){const el=$('#perfHud');if(!el||!ME)return;el.style.display=(S.showFps||S.showPing||S.showClock)?'flex':'none';$('#fpsHud').style.display=S.showFps?'':'none';$('#pingHud').style.display=S.showPing?'':'none';$('#clockHud').style.display=S.showClock?'':'none';$('#fpsHud').textContent='FPS: '+(fpsValue||'--');$('#pingHud').textContent='PING: '+(pingValue==null?'--':pingValue+' ms');$('#clockHud').textContent=new Date().toLocaleTimeString();}
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec3e6);
scene.fog = new THREE.Fog(0x9ec3e6, 80, 220);
const cam = new THREE.PerspectiveCamera(70, 1, 0.1, 400);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 0.75));
const sun = new THREE.DirectionalLight(0xfff2d6, 0.8); sun.position.set(40, 80, 30); scene.add(sun);
function resize() { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

function gridTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#5d7a45'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#4f6a3a'; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128);
  for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(${60 + Math.random() * 40},${90 + Math.random() * 40},50,.35)`; g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 30); return t;
}
// ---------- GLB-модели ----------
// Файлы лежат в папке models/: <id танка>.glb -> <нация>_<класс>.glb -> <класс>.glb.
// Узлы: turret (пивот башни) -> gun -> muzzle. Материал "paint" перекрашивается под цвет танка/команды.
const GLB = {}; let GLB_OK = false, GLB_ERR = '';
function loadModels() {
  return new Promise(res => {
    if (!THREE.GLTFLoader) { GLB_ERR = 'GLTFLoader не загрузился (CDN jsdelivr недоступен)'; return res(); }
    fetch('models/manifest.json?v=' + Date.now(), { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('manifest.json: HTTP ' + r.status); return r.json(); }).then(m => {
      const ld = new THREE.GLTFLoader(); let n = m.files.length; if (!n) return res();
      const done = () => { if (--n <= 0) { GLB_OK = Object.keys(GLB).length > 0; if (!GLB_OK) GLB_ERR = GLB_ERR || 'ни один .glb не загрузился'; res(); } };
      m.files.forEach(f => ld.load('models/' + f, g => { GLB[f.replace('.glb', '')] = g.scene; done(); }, undefined, e => { GLB_ERR = 'ошибка ' + f; done(); }));
    }).catch(e => { GLB_ERR = 'models/manifest.json не найден или не читается (' + (e && e.message || e) + ')'; res(); });
  });
}
function glbFor(T, id) {
  return GLB[id] || GLB[T.nation + '_' + T.cls] || GLB[T.cls] || GLB[T.nation + '_medium'] || null;
}
let TREAD_TEX = null;
function treadTex() {
  if (TREAD_TEX) return TREAD_TEX;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#1a1a1d'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#4a4a50'; g.fillRect(0, 0, 22, 64); g.fillStyle = '#0c0c0e'; g.fillRect(22, 0, 4, 64);
  g.fillStyle = '#6a6a70'; g.fillRect(0, 26, 22, 12); g.fillStyle = '#2a2a2e'; g.fillRect(30, 0, 30, 64);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return (TREAD_TEX = t);
}
function buildTankGLB(src, T, colorHex) {
  const root = src.clone(true); const col = new THREE.Color(colorHex || T.color);
  const mats = {}, anim = { P: [], N: [], tP: null, tN: null, kP: 0, kN: 0, hw: 1.4 };
  root.traverse(o => {
    const nm = o.name || '';
    if (/^w[PN]/.test(nm) && o.userData && o.userData.r) { anim[nm[1]].push({ n: o, r: o.userData.r }); anim.hw = Math.max(0.6, Math.abs(o.position.x)); }
    if (/^track[PN]/.test(nm)) { const sd = nm[5]; const tx = treadTex().clone(); tx.needsUpdate = true; anim['t' + sd] = tx; anim['k' + sd] = (o.userData && o.userData.k) || 2.5; o.traverse(q => { if (q.isMesh) q.material = new THREE.MeshLambertMaterial({ map: tx }); }); }
  });
  root.traverse(o => { if (o.isMesh && o.material && o.material.name !== 'track' && !(o.material.map)) { const m = o.material; if (!mats[m.name]) { mats[m.name] = m.clone(); if (m.name === 'paint') mats[m.name].color.copy(col); } o.material = mats[m.name]; } });
  const tur = root.getObjectByName('turret'), mz = root.getObjectByName('muzzle');
  if (!tur || !mz) return null;
  const g = new THREE.Group(); g.add(root);
  const k = T.cls === 'light' ? 0.9 : T.cls === 'heavy' ? 1.2 : 1;
  tur.userData.bz = tur.position.z; g.userData = { tur, mz, k, anim: (anim.P.length || anim.N.length) ? anim : null }; return g;
}
// Анимация ходовой: колёса крутятся, гусеничная лента «едет». Бортовые скорости из перемещения и поворота корпуса.
function animTank(m, dt) {
  const a = m.userData.anim; if (!a) return;
  const x = m.position.x, z = m.position.z, r = m.rotation.y, L = m.userData.last; m.userData.last = { x, z, r };
  if (!L || dt <= 0) return;
  const dx = x - L.x, dz = z - L.z; if (Math.hypot(dx, dz) > 4) return;
  const fwd = dx * Math.sin(r) + dz * Math.cos(r), dy = Math.atan2(Math.sin(r - L.r), Math.cos(r - L.r));
  const dN = fwd + dy * a.hw, dP = fwd - dy * a.hw;      // левый поворот (dy>0): правый борт (-X, «N») быстрее
  for (const w of a.P) w.n.rotation.x += dP / w.r;
  for (const w of a.N) w.n.rotation.x += dN / w.r;
  if (a.tP) a.tP.offset.x = (a.tP.offset.x + dP * a.kP) % 1000;
  if (a.tN) a.tN.offset.x = (a.tN.offset.x + dN * a.kN) % 1000;
}
function buildTank(id, colorHex) {
  const T = CAT.tanks[id];
  if (GLB_OK) { const src = glbFor(T, id); if (src) { const g = buildTankGLB(src, T, colorHex); if (g) return g; } }
  return buildTankProc(id, colorHex);
}
function buildTankProc(id, colorHex) {
  const T = CAT.tanks[id]; const k = T.cls === 'light' ? 0.9 : T.cls === 'heavy' ? 1.2 : 1;
  const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(colorHex || T.color) });
  const dark = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4 * k, 0.9 * k, 4.6 * k), mat); hull.position.y = 0.95 * k; g.add(hull);
  for (const s of [-1, 1]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.6 * k, 0.9 * k, 5 * k), dark); t.position.set(s * 1.35 * k, 0.5 * k, 0); g.add(t); }
  const sl = new THREE.Mesh(new THREE.BoxGeometry(2.4 * k, 0.35 * k, 1.4 * k), mat); sl.position.set(0, 1.2 * k, 2.3 * k); sl.rotation.x = 0.45; g.add(sl);
  const tur = new THREE.Group(); tur.position.y = 1.4 * k;
  const tb = new THREE.Mesh(new THREE.CylinderGeometry(1.0 * k, 1.2 * k, 0.8 * k, 10), mat); tb.position.y = 0.4 * k; tur.add(tb);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * k, 0.16 * k, 3.6 * k, 8), dark); gun.rotation.x = Math.PI / 2; gun.position.set(0, 0.45 * k, 2.4 * k); tur.add(gun);
  const mz = new THREE.Object3D(); mz.position.set(0, 0.45 * k, 4.2 * k); tur.add(mz);
  tur.userData.bz = 0; g.add(tur); g.userData = { tur, mz, k }; return g;
}

// ---------- Звук (WebAudio) ----------
let AC = null, eng = null;
function ac() { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; }
function noiseBuf(d) { const b = AC.createBuffer(1, AC.sampleRate * d, AC.sampleRate), a = b.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / a.length); return b; }
function sfx(type, vol) {
  if (!S || S.sfx <= 0) return; const c = ac(), t = c.currentTime, g = c.createGain(); g.gain.value = S.sfx * (vol == null ? 1 : vol); g.connect(c.destination);
  if (type === 'shot' || type === 'boom') {
    const s = c.createBufferSource(); s.buffer = noiseBuf(type === 'shot' ? 0.5 : 0.9);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = type === 'shot' ? 1800 : 700; s.connect(f); f.connect(g); s.start(t);
    const o = c.createOscillator(), og = c.createGain(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    og.gain.setValueAtTime(0.8, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.5); o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.6);
  } else if (type === 'hit') {
    const o = c.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.2);
    const og = c.createGain(); og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.3);
  } else if (type === 'click') {
    const o = c.createOscillator(); o.frequency.value = 700; const og = c.createGain(); og.gain.setValueAtTime(0.2, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.06); o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.07);
  }
}
function engineStart() {
  if (eng || !S) return; const c = ac(); const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
  o.type = 'sawtooth'; o.frequency.value = 40; f.type = 'lowpass'; f.frequency.value = 220; g.gain.value = 0; o.connect(f); f.connect(g); g.connect(c.destination); o.start(); eng = { o, g };
}
function engineSet(ratio) { if (!eng) return; eng.o.frequency.value = 35 + ratio * 40; eng.g.gain.value = S.engine * 0.18 * (0.3 + ratio * 0.7); }
function engineStop() { if (eng) { try { eng.o.stop(); } catch (e) { } eng = null; } }

// ---------- Ввод ----------
const keys = {}; const touch = { jx: 0, jy: 0, fire: false };
let rebind = null;
addEventListener('keydown', e => {
  if (rebind) { e.preventDefault(); S.keys[rebind] = e.code; rebind = null; saveSettings(); render(); return; }
  keys[e.code] = true;
  if (B && !B.over) {
    if (e.code === S.keys.scope) toggleScope();
    if (e.code === S.keys.fire) fire();
    // Быстрые расходники на ПК: 1 — ремонт, 2 — огнетушитель, 3 — лечение экипажа.
    // Повтор при удержании клавиши отключён, чтобы не отправлять несколько запросов.
    if (!e.repeat) {
      if (e.code === 'Digit1' || e.code === 'Numpad1') { e.preventDefault(); useConsumable('repair_kit'); }
      if (e.code === 'Digit2' || e.code === 'Numpad2') { e.preventDefault(); useConsumable('fire_extinguisher'); }
      if (e.code === 'Digit3' || e.code === 'Numpad3') { e.preventDefault(); useConsumable('medkit'); }
    }
    if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('contextmenu', e => { if (B) e.preventDefault(); });
const cv = $('#cv');
cv.addEventListener('mousedown', e => {
  if (!B || B.over) return; ac();
  if (document.pointerLockElement !== cv) { cv.requestPointerLock && cv.requestPointerLock(); return; }
  if (e.button === 0) fire(); if (e.button === 2) toggleScope();
});
addEventListener('mousemove', e => {
  if (!B || B.over || document.pointerLockElement !== cv) return; aimDelta(e.movementX, e.movementY, 0.0022);
});
addEventListener('wheel', e => { if (B && B.scope) { B.zoom = clamp(B.zoom + (e.deltaY < 0 ? 1 : -1), 0, 2); } });
function aimDelta(dx, dy, k) {
  const s = S.sens * (B.scope ? S.scopeSens : 1) * k;
  B.yaw -= dx * s; B.pit = clamp(B.pit + dy * s * (S.invert ? -1 : 1), B.scope ? -0.3 : -0.15, B.scope ? 0.35 : 0.75);
}
function useTouch() { return S.touch === 'on' || (S.touch === 'auto' && IS_TOUCH_DEV); }
(function touchInit() {
  const joy = $('#joy'), knob = $('#joyK'); let jid = null;
  const upd = t => { const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = t.clientX - cx, dy = t.clientY - cy; const m = Math.hypot(dx, dy), L = 50; if (m > L) { dx *= L / m; dy *= L / m; } knob.style.transform = `translate(${dx}px,${dy}px)`; touch.jx = dx / L; touch.jy = dy / L; };
  joy.addEventListener('touchstart', e => { e.preventDefault(); jid = e.changedTouches[0].identifier; upd(e.changedTouches[0]); }, { passive: false });
  joy.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === jid) upd(t); }, { passive: false });
  const end = e => { for (const t of e.changedTouches) if (t.identifier === jid) { jid = null; touch.jx = touch.jy = 0; knob.style.transform = ''; } };
  joy.addEventListener('touchend', end); joy.addEventListener('touchcancel', end);
  const az = $('#aimz'); let aid = null, lx = 0, ly = 0;
  az.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; aid = t.identifier; lx = t.clientX; ly = t.clientY; }, { passive: false });
  az.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === aid && B && !B.over) { aimDelta(t.clientX - lx, t.clientY - ly, 0.005); lx = t.clientX; ly = t.clientY; } }, { passive: false });
  az.addEventListener('touchend', () => { aid = null; });
  $('#fireB').addEventListener('touchstart', e => { e.preventDefault(); ac(); fire(); }, { passive: false });
  $('#scopeB').addEventListener('touchstart', e => { e.preventDefault(); toggleScope(); }, { passive: false });
})();

// ---------- Авторизация и UI ----------
const ui = $('#ui');
function handleNationTap(e) {
  const n = e.target.closest('[data-nation]');
  if (n) { e.preventDefault(); e.stopPropagation(); setUpgradeNation(n.dataset.nation); return true; }
  const b = e.target.closest('[data-branch-nation]');
  if (b) { e.preventDefault(); e.stopPropagation(); setBranchNation(b.dataset.branchNation); return true; }
  return false;
}
ui.addEventListener('click', e => { handleNationTap(e); });
ui.addEventListener('pointerup', e => { if (e.pointerType === 'touch' || e.pointerType === 'pen') handleNationTap(e); }, { passive: false });
ui.addEventListener('touchend', e => { if (handleNationTap(e)) e.preventDefault(); }, { passive: false });
async function boot() {
  const r = await api('boot'); if (!r.ok) { ui.innerHTML = '<div class="center"><div class="panel">Ошибка сервера. Проверьте api.php</div></div>'; return; }
  CAT = r.cat; ME = r.user; if (ME) { S = ME.settings; applyReticle(); applyGraphicsQuality(); startPerfMonitors(); }
  await loadModels();
  if (GLB_ERR) setTimeout(() => toast('3D-модели: ' + GLB_ERR, 6000), 800);
  buildLobbyScene(); requestAnimationFrame(loop);
  ME ? render() : authScreen();
}
function authScreen(msg) {
  ui.innerHTML = `<div class="center"><div class="panel" style="width:min(360px,92vw)">
  <h2 style="margin:0 0 8px">🛡 Tanks 3D</h2>
  <input id="n" type="text" placeholder="Ник (латиница, цифры, _)" autocomplete="username" maxlength="16">
  <input id="p" type="password" placeholder="Пароль (от 6 символов)" autocomplete="current-password">
  <div class="err" id="e">${msg || ''}</div>
  <div class="row"><button onclick="doAuth('login')">Войти</button><button class="sec" onclick="doAuth('register')">Регистрация</button></div></div></div>`;
}
async function doAuth(kind) {
  const r = await api(kind, { name: $('#n').value, pass: $('#p').value });
  if (!r.ok) { $('#e').textContent = r.err; return; }
  ME = r.user; S = ME.settings; S.fov = 50; applyReticle(); applyGraphicsQuality(); startPerfMonitors(); ac(); render();
}
async function logout() { await api('logout'); ME = null; authScreen(); lobbyTank && (lobbyTank.visible = false); }
async function refresh() { const r = await api('me'); if (r.ok) { ME = r.user; S = ME.settings; } }

function head() {
  return `<div class="top"><div class="l"><span class="cur">🛡 ${ME.name}</span><span class="cur">🥈 ${fmt(ME.silver)}</span><span class="cur">🪙 ${fmt(ME.gold)}</span><span class="cur">⭐ ${fmt(ME.xp)}</span></div>
  <button class="play" onclick="playMenu()">ИГРАТЬ</button>
  <div class="r">Бои: ${ME.stats.battles} · Победы: ${ME.stats.wins}${ME.boost ? ' · 🔥 бустер' : ''}</div></div>`;
}
function navHtml() {
  const n = [['hangar', '🏠', 'Ангар'], ['branches', '🌳', 'Ветки танков'], ['shop', '🛒', 'Магазин'], ['storage', '📦', 'Хранилище'], ['leaderboard', '🏆', 'Таблица лидеров'], ['chat', '💬', 'Общий чат'], ['settings', '⚙️', 'Настройки']]; const cur = tab === 'upgrade' ? 'hangar' : tab;
  return `<div class="nav">${n.map(t => `<button class="ib ${cur === t[0] ? 'on' : ''}" title="${t[2]}" aria-label="${t[2]}" onclick="setTab('${t[0]}')">${t[1]}</button>`).join('')}<button class="ib" title="Выход" aria-label="Выход" onclick="logout()">🚪</button></div>`;
}
const ROM = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'], CLS = { light: 'Лёгкий', medium: 'Средний', heavy: 'Тяжёлый' };
let thr = null; const thumbs = {};
function thumb(id) {
  if (thumbs[id]) return thumbs[id];
  if (!thr) {
    thr = { r: new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }), s: new THREE.Scene(), c: new THREE.PerspectiveCamera(32, 220 / 157, 0.1, 100) };
    thr.r.setSize(220, 157); thr.r.setClearColor(0x000000, 0); thr.s.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.0));
    const d = new THREE.DirectionalLight(0xffffff, 0.8); d.position.set(5, 10, 7); thr.s.add(d); thr.c.position.set(7.5, 4.6, 8.5); thr.c.lookAt(0, 1.0, 0);
  }
  const t = buildTank(id); thr.s.add(t); thr.r.render(thr.s, thr.c); thumbs[id] = thr.r.domElement.toDataURL(); thr.s.remove(t); return thumbs[id];
}
function tCard(id, extra) {
  const T = CAT.tanks[id];
  return `<div class="tcard ${T.premium ? 'prem' : ''} ${id === ME.sel ? 'sel' : ''}" onclick="${extra || `selTank('${id}')`}"><img src="${thumb(id)}"><span class="tier">${ROM[T.tier]}</span><div class="tn">${T.name}</div></div>`;
}
function tankInfo(id) {
  const T = CAT.tanks[id], E = ME.eff[id], L = ME.upg[id] || {};
  const row = (n, b, e, u) => `<tr><td>${n}</td><td>${e}${u}${e != b ? ` <span class="st">(база ${b})</span>` : ''}</td></tr>`;
  const m = document.createElement('div'); m.className = 'center'; m.style.cssText = 'background:#000b;z-index:30';
  m.innerHTML = `<div class="panel" style="width:min(420px,94vw);max-height:92vh;overflow:auto"><h3 style="margin:0">${T.name}</h3><div class="st">${CLS[T.cls]} · уровень ${ROM[T.tier]}${T.premium ? ' · премиум' : ''}</div>
  <img src="${thumb(id)}" style="width:100%;height:150px;object-fit:contain"><table class="tbl">
  ${row('Скорость', T.speed, E.speed, ' м/с')}${row('Прочность', T.hp, E.hp, '')}${row('Урон', T.dmg, E.dmg, '')}${row('Перезарядка', T.reload, E.reload, ' с')}${row('Поворот корпуса', T.turn, T.turn, ' рад/с')}${row('Поворот башни', T.tur, T.tur, ' рад/с')}</table>
  <div class="st" style="margin-top:8px">Модули: ${Object.entries(CAT.mods).map(([k, v]) => v.name + ' ' + (L[k] || 0) + '/' + CAT.modmax).join(' · ')}</div>
  <div class="row"><button onclick="this.closest('.center').remove()">Закрыть</button></div></div>`;
  document.body.appendChild(m);
}
function setTab(t) { tab = t; sfx('click'); render(); }
function setUpgradeNation(id) { if (!CAT || !CAT.nations || !Object.prototype.hasOwnProperty.call(CAT.nations,id)) return; window.upgradeNation=id; tab='upgrade'; render(); }
function setBranchNation(id) { if (!CAT || !CAT.nations || !Object.prototype.hasOwnProperty.call(CAT.nations,id)) return; window.branchNation=id; tab='branches'; render(); }
function statsOf(T) { return `Скорость ${T.speed} м/с · HP ${T.hp}<br>Урон ${T.dmg} · Перезарядка ${T.reload} с`; }
function render() {
  if (!ME) return; if (B) return;
  if (lobbyTank) { setLobbyTank(); lobbyTank.visible = true; }
  let h = head() + '<div class="body">' + navHtml();
  if (tab === 'hangar') {
    h += `<div class="main hg"><div class="acts"><button class="sec" onclick="tankInfo('${ME.sel}')">ℹ Информация о танке</button><button class="act" onclick="setTab('upgrade')">⬆ Улучшение</button>
    <button class="sec" onclick="daily()" ${ME.daily_in > 0 ? 'disabled' : ''}>🎁 Бонус${ME.daily_in > 0 ? ' (' + Math.ceil(ME.daily_in / 3600) + ' ч)' : ''}</button></div>
    ${ME.ban_in > 0 ? `<div class="err">Бои закрыты античитом: ${ME.ban_in} c</div>` : ''}
    <div class="strip">${ME.tanks.map(id => tCard(id)).join('')}<div class="tcard" onclick="setTab('upgrade')" style="justify-content:center;align-items:center;font-size:40px">➕</div></div></div>`;
  } else if (tab === 'upgrade') {
    const T = CAT.tanks[ME.sel], L = ME.upg[ME.sel] || {};
    const nations = Object.entries(CAT.nations).map(([id,name])=>[id,({ussr:'🇷🇺',usa:'🇺🇸',britain:'🇬🇧',china:'🇨🇳',europe:'🇪🇺'}[id]||'🌍'),name]);
    const nation = window.upgradeNation || T.nation || 'ussr';
    const nationTanks = Object.entries(CAT.tanks).filter(([id,t]) => !t.premium && t.nation===nation).sort((a,b)=>a[1].tier-b[1].tier);
    const modules = Object.entries(CAT.mods).map(([k,v])=>{
      const l=L[k]||0, max=l>=CAT.modmax, tf=1+0.18*Math.max(0,T.tier-1), cx=Math.round(100*(l+1)*tf), cs=Math.round(500*(l+1)*(1+0.20*Math.max(0,T.tier-1))); 
      const icon={engine:'⚙️',armor:'🛡️',gun:'🔩'}[k]||'🔧';
      return `<div class="module-slot"><div class="module-icon">${icon}</div><div><b>${v.name}</b><small>${v.desc}</small><div class="pips">${'●'.repeat(l)}${'○'.repeat(CAT.modmax-l)}</div><small>Уровень ${l}/${CAT.modmax}</small></div><button ${max?'disabled':''} onclick="upgrade('${k}')">${max?'Установлен максимум':`Улучшить · ${fmt(cx)} ⭐ + ${fmt(cs)} 🥈`}</button></div>`;
    }).join('');
    const tree = nationTanks.map(([id,t],i)=>{
      const own=ME.tanks.includes(id), res=ME.res.includes(id), parent=t.parent;
      const can=!parent || ME.res.includes(parent);
      const state=own?'owned':(res?'researched':(can?'available':'locked'));
      const click=own?`selTank('${id}')`:res?`buy('tank','${id}')`:can?`research('${id}')`:`toast('Сначала исследуйте предыдущий танк')`;
      const cost=own?'✓ В ангаре':res?`${fmt(t.price)} 🥈`:can?`${fmt(t.xp)} ⭐`:'🔒';
      return `${i?'<div class="tech-link"></div>':''}<div class="tech-node ${state} ${ME.sel===id?'sel':''}" onclick="${click}"><span class="tier-tag">${ROM[t.tier]}</span><img src="${thumb(id)}"><b>${t.name}</b><small>${cost}</small></div>`;
    }).join('');
    const E=ME.eff[ME.sel];
    h += `<div class="main upgrade-screen"><div class="upgrade-top"><button class="sec" onclick="setTab('hangar')">← Ангар</button><h2>${T.name} <span class="sub">/ Улучшения</span></h2><span class="cur">⭐ ${fmt(ME.xp)}</span><span class="cur">🥈 ${fmt(ME.silver)}</span></div>
      <div class="nation-select">${nations.map(([id,flag,name])=>`<button class="${nation===id?'act':'sec'}" type="button" data-nation="${id}">${flag} ${name}</button>`).join('')}</div>
      <div class="upgrade-layout"><section class="upg-modules"><h3>Модули и обвесы</h3>${modules}<div class="st" style="grid-column:1/-1">Чтобы открыть следующий танк, установите двигатель, броню и орудие на максимальный уровень (3/3).</div></section>
      <section class="tech-scroll"><h3 style="margin:4px 8px 0">Ветка исследования · уровни I–X</h3><div class="tech-tree">${tree || '<div class="st">В этой нации пока нет танков.</div>'}</div><div class="st">Нажмите на танк: исследуйте его за опыт, затем купите за серебро. Следующий уровень открывается после полной установки модулей предыдущего танка.</div></section>
      <aside class="upg-details"><h3>Характеристики · ${T.name}</h3><img class="detail-img" src="${thumb(ME.sel)}"><div><div class="detail-stat"><span>Уровень</span><b>${ROM[T.tier]}</b></div><div class="detail-stat"><span>Класс</span><b>${CLS[T.cls]}</b></div><div class="detail-stat"><span>Прочность</span><b>${fmt(E.hp)} ед.</b></div><div class="detail-stat"><span>Урон</span><b>${fmt(E.dmg)} ед.</b></div><div class="detail-stat"><span>Скорость</span><b>${E.speed} м/с</b></div><div class="detail-stat"><span>Перезарядка</span><b>${E.reload} с</b></div><div class="detail-stat"><span>Броня (оценка)</span><b>${E.armor}</b></div></div></aside></div></div>`;
  } else if (tab === 'branches') {
    const nations = Object.entries(CAT.nations || {ussr:'СССР',usa:'США',britain:'Британия',china:'Китай',europe:'Европа'}).map(([id,name])=>[id,({ussr:'🇷🇺',usa:'🇺🇸',britain:'🇬🇧',china:'🇨🇳',europe:'🇪🇺'}[id]||'🌍'),name]);
    const nation = window.branchNation || (CAT.tanks[ME.sel]?.nation || 'ussr');
    h += `<div class="main"><div class="branch-tabs">${nations.map(([id,flag,name]) => `<button class="${nation===id?'act':'sec'}" type="button" data-branch-nation="${id}">${flag} ${name}</button>`).join('')}</div>
    <h3>Ветка исследования — ${nations.find(x=>x[0]===nation)[2]}</h3>
    <div class="branch-tree">${Object.entries(CAT.tanks).filter(([id,t]) => !t.premium && (t.nation || 'ussr')===nation).sort((a,b)=>a[1].tier-b[1].tier).map(([id,t]) => {
      const own=ME.tanks.includes(id), res=ME.res.includes(id), can=!t.parent || ME.res.includes(t.parent);
      const action=own?'<button disabled>В ангаре</button>':res?`<button class="grn" onclick="buy('tank','${id}')">Купить · ${fmt(t.price)} 🥈</button>`:can?`<button class="act" onclick="research('${id}')" ${ME.xp<t.xp?'disabled':''}>Исследовать · ${fmt(t.xp)} ⭐</button>`:`<button disabled>🔒 ${CAT.tanks[t.parent].name}</button>`;
      return `<div class="card branch-card"><img src="${thumb(id)}"><div class="branch-info"><b>${t.name}</b><div class="st">Уровень ${ROM[t.tier]} · ${CLS[t.cls]}</div><div class="st">${statsOf(t)}</div>${action}</div></div>`;
    }).join('')}</div></div>`;
  } else if (tab === 'shop') {
    h += `<div class="main"><div class="row"><button class="${shopTab === 'prem' ? 'act' : 'sec'}" onclick="shopTab='prem';render()">Премиум-танки</button><button class="${shopTab === 'cont' ? 'act' : 'sec'}" onclick="shopTab='cont';render()">Контейнеры</button><button class="${shopTab === 'exchange' ? 'act' : 'sec'}" onclick="shopTab='exchange';render()">Обмен валюты</button></div><div class="grid">`;
    if (shopTab === 'cont') {
      h += `<div class="card" style="grid-column:1/-1"><h3>🎁 Подарочные контейнеры</h3><div class="st">Бесплатные подарки доступны независимо друг от друга. Таймер запускается заново после получения.</div></div>`;
      for (const id of ['bronze','rare','epic']) { const C=CAT.containers[id], left=ME.container_in?.[id]||0; h += `<div class="card"><h4>🎁 ${C.name}</h4><div class="st">В наличии: ${ME.inv.containers[id] || 0}<br>Следующий подарок: ${left>0?fmtTime(left):'ГОТОВ К ПОЛУЧЕНИЮ'}</div><div class="row"><button class="grn" ${left>0?'disabled':''} onclick="claimContainer('${id}')">${left>0?'Ожидание':'Забрать подарок'}</button></div></div>`; }
      h += `<div class="card" style="grid-column:1/-1"><h3>💳 Особые контейнеры</h3><div class="st">Покупаются за игровое золото. Реальных платежей нет.</div></div>`;
      for (const id of ['mystic','mevvix']) { const C=CAT.containers[id]; h += `<div class="card"><h4>${id==='mevvix'?'💠':'🔮'} ${C.name}</h4><div class="st">В наличии: ${ME.inv.containers[id]||0}<br>Содержимое: золото, серебро, предметы и шанс получить премиумный танк.</div><div class="row"><button ${ME.gold<C.price?'disabled':''} onclick="buy('container','${id}',1)">Купить · ${fmt(C.price)} 🪙</button></div></div>`; }
    } else if (shopTab === 'exchange') { h += `<div class="card"><h3>Обмен валюты</h3><div class="st">100 золота = 10 000 серебра · 1 000 серебра = 1 золото</div><div class="row"><input id="exAmount" type="number" min=1 max=100000 value=1 style="width:110px"><button onclick="exchange('gold_to_silver')">Золото → серебро (×100)</button><button class="sec" onclick="exchange('silver_to_gold')">Серебро → золото (×1000)</button></div></div>`; } else {
      for (const [id, T] of Object.entries(CAT.tanks)) {
        if ((shopTab === 'prem') !== T.premium) continue; const own = ME.tanks.includes(id);
        h += `<div class="card"><img src="${thumb(id)}" style="width:100%;height:90px;object-fit:contain"><h4>${T.name}</h4><div class="st">${T.collectible?'Коллекционный танк · ': 'Премиум · '}${ROM[T.tier]} уровень<br>${statsOf(T)}</div><div class="row"><button ${own ? 'disabled' : ''} onclick="buy('tank','${id}')">${own ? 'Куплен' : fmt(T.price) + (T.cur === 'gold' ? ' 🪙' : ' 🥈')}</button></div></div>`;
      }
    }
    h += '</div></div>';
  } else if (tab === 'storage') {
    h += `<div class="main"><h3>Хранилище контейнеров</h3><div class="grid">${Object.entries(CAT.containers).map(([id, C]) => { const n = ME.inv.containers[id] || 0; return `<div class="card"><h4>📦 ${C.name}</h4><div class="st">Количество: ${n}</div><div class="row"><button ${n < 1 ? 'disabled' : ''} onclick="openC('${id}',1)">Открыть</button><button class="sec" ${n < 2 ? 'disabled' : ''} onclick="openC('${id}',${Math.min(n, 10)})">Все (${Math.min(n, 10)})</button></div></div>`; }).join('')}</div>
    <h3>Предметы</h3><div class="grid">${Object.entries(ME.inv.items).filter(x => x[1] > 0).map(([id, n]) => `<div class="card"><h4>${CAT.items[id] || id}</h4><div class="st">Количество: ${n}</div>${id === 'boost_silver' ? `<div class="row"><button ${ME.boost ? 'disabled' : ''} onclick="useItem('${id}')">Активировать</button></div>` : ''}</div>`).join('') || '<div class="st">Пусто</div>'}</div>
    <h3>Танки в ангаре</h3><div class="st">${ME.tanks.map(id => CAT.tanks[id].name).join(', ')}</div></div>`;
  } else if (tab === 'leaderboard') {
    h += `<div class="main"><div class="panel"><h2 style="margin-top:0">🏆 Таблица лидеров</h2><div class="st">Топ-50 игроков: сначала по победам, затем по урону и количеству боёв.</div><div id="leaderboardBox" style="margin-top:12px">Загрузка рейтинга…</div></div></div>`;
  } else if (tab === 'chat') {
    h += `<div class="main chat-main"><div class="panel chat-panel"><h2 style="margin-top:0">💬 Общий чат</h2><div id="chatMessages" class="chat-messages" aria-live="polite">Загрузка сообщений…</div><form class="chat-compose" onsubmit="sendChat(event)"><input id="chatInput" type="text" maxlength="300" placeholder="Напишите сообщение…" autocomplete="off" enterkeyhint="send"><button class="act" type="submit">Отправить</button></form><div class="st">Общий чат виден всем игрокам. Не отправляйте личные данные.</div></div></div>`;
  } else if (tab === 'settings') {
    const row = (l, k, mn, mx, st) => `<div class="row"><label>${l}: <b>${(+S[k]).toFixed(2)}</b></label><input type="range" min="${mn}" max="${mx}" step="${st}" value="${S[k]}" oninput="S.${k}=+this.value;this.parentNode.querySelector('b').textContent=(+this.value).toFixed(2)" onchange="saveSettings()"></div>`;
    const names = { fwd: 'Вперёд', back: 'Назад', left: 'Влево', right: 'Вправо', fire: 'Выстрел', scope: 'Прицел' };
    h += `<div class="main"><div class="panel left"><h3 style="margin:0 0 6px">Управление</h3>
    ${row('Чувствительность', 'sens', 0.2, 3, 0.05)}${row('Чувств. в прицеле (×)', 'scopeSens', 0.1, 1.5, 0.05)}<div class="row"><label>Вид прицела</label><select onchange="S.reticle=this.value;applyReticle();saveSettings()"><option value="+" ${S.reticle==='+'?'selected':''}>+ (крест)</option><option value="×" ${S.reticle==='×'?'selected':''}>×</option><option value="^" ${S.reticle==='^'?'selected':''}>^</option></select></div><div class="st">Выбранный символ отображается при входе в прицел. Поле зрения зафиксировано на минимальном значении.</div>
    <div class="row"><label>Инвертировать Y</label><input type="checkbox" ${S.invert ? 'checked' : ''} onchange="S.invert=this.checked;saveSettings()"></div>
    <div class="row"><label>Сенсорное управление</label><select onchange="S.touch=this.value;saveSettings()">${['auto', 'on', 'off'].map(v => `<option value="${v}" ${S.touch === v ? 'selected' : ''}>${{ auto: 'Авто', on: 'Включено', off: 'Выключено' }[v]}</option>`).join('')}</select></div>
    <h3 style="margin:12px 0 6px">Графика</h3><div class="row"><label>Качество графики</label><select onchange="S.graphics=this.value;applyGraphicsQuality();saveSettings()"><option value="low" ${(S.graphics||'medium')==='low'?'selected':''}>Низкое — для слабых устройств</option><option value="medium" ${(S.graphics||'medium')==='medium'?'selected':''}>Среднее</option><option value="high" ${(S.graphics||'medium')==='high'?'selected':''}>Высокое</option></select></div>
    <div class="row"><label>Показывать FPS</label><input type="checkbox" ${S.showFps?'checked':''} onchange="S.showFps=this.checked;saveSettings();updatePerfHud()"></div>
    <div class="row"><label>Показывать ping</label><input type="checkbox" ${S.showPing?'checked':''} onchange="S.showPing=this.checked;saveSettings();updatePerfHud()"></div>
    <div class="row"><label>Время устройства</label><input type="checkbox" ${S.showClock?'checked':''} onchange="S.showClock=this.checked;saveSettings();updatePerfHud()"></div>
    <h3 style="margin:10px 0 6px">Кнопки (ПК)</h3>${Object.entries(names).map(([k, n]) => `<div class="row"><label>${n}</label><button class="sec" onclick="rebind='${k}';this.textContent='Нажмите клавишу…'">${S.keys[k]}</button></div>`).join('')}
    <div class="st">Мышь: ЛКМ — выстрел, ПКМ — прицел, колесо — зум в прицеле.</div>
    <h3 style="margin:10px 0 6px">Звук</h3>${row('Эффекты', 'sfx', 0, 1, 0.05)}${row('Двигатель', 'engine', 0, 1, 0.05)}
    <div class="row"><button onclick="sfx('shot')">Проверить звук</button></div></div></div>`;
  }
  ui.innerHTML = h + '</div>' + tutorialHtml(); startSocialPolling();
}
let leaderboardTimer=null, chatTimer=null, lastChatId=0;
async function loadLeaderboard(){ const box=$('#leaderboardBox'); if(!box)return; const r=await api('leaderboard'); if(!r.ok){box.textContent=r.err||'Не удалось загрузить рейтинг';return;} box.innerHTML=`<table class="tbl"><thead><tr><td>#</td><td>Игрок</td><td>Победы</td><td>Бои</td><td>Урон</td></tr></thead><tbody>${r.rows.map((x,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(x.name)}${x.name===ME.name?' (вы)':''}</td><td>${fmt(x.wins)}</td><td>${fmt(x.battles)}</td><td>${fmt(x.damage)}</td></tr>`).join('')||'<tr><td colspan="5">Пока нет результатов</td></tr>'}</tbody></table>`; }
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadChat(){
  const box = $('#chatMessages');
  if (!box) return;
  const r = await api('chat_get', { after: lastChatId });
  if (!r.ok) {
    box.innerHTML = `<div class="chat-empty">${escapeHtml(r.err || 'Чат временно недоступен')}</div>`;
    return;
  }
  if (r.messages && r.messages.length) {
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    // Remove empty placeholder if present
    const empty = box.querySelector('.chat-empty');
    if (empty) empty.remove();
    for (const m of r.messages) {
      const row = document.createElement('div');
      row.className = 'chat-line';
      row.innerHTML = `<time>${escapeHtml(m.time)}</time> <b>${escapeHtml(m.name)}</b>: ${escapeHtml(m.text)}`;
      box.appendChild(row);
      lastChatId = Math.max(lastChatId, Number(m.id) || 0);
    }
    while (box.children.length > 100) box.removeChild(box.firstChild);
    if (nearBottom) box.scrollTop = box.scrollHeight;
  } else if (!box.children.length || (box.children.length === 1 && box.querySelector('.chat-empty'))) {
    box.innerHTML = '<div class="chat-empty">Пока нет сообщений.<br>Напишите первое!</div>';
  }
}
async function sendChat(e) {
  e.preventDefault();
  const input = $('#chatInput');
  if (!input) return;
  const textValue = input.value.trim();
  if (!textValue) return;
  const r = await api('chat_send', { text: textValue });
  if (!r.ok) return toast(r.err || 'Не удалось отправить сообщение');
  input.value = '';
  await loadChat();
  // Keep focus on mobile so keyboard stays open for next message
  setTimeout(() => { try { input.focus(); } catch (_) {} }, 50);
}
function stopSocialPolling() {
  clearInterval(leaderboardTimer);
  clearInterval(chatTimer);
  leaderboardTimer = chatTimer = null;
}
function startSocialPolling() {
  stopSocialPolling();
  if (tab === 'leaderboard') {
    loadLeaderboard();
    leaderboardTimer = setInterval(() => { if (tab === 'leaderboard') loadLeaderboard(); }, 15000);
  }
  if (tab === 'chat') {
    lastChatId = 0;
    const box = $('#chatMessages');
    if (box) box.innerHTML = '<div class="chat-empty">Загрузка сообщений…</div>';
    loadChat();
    chatTimer = setInterval(() => { if (tab === 'chat') loadChat(); }, 2500);
  }
}

let saveT = null;
function applyReticle() { const el=$('#cross'); if (el) el.setAttribute('data-symbol', (S && S.reticle) || '+'); }
function saveSettings() { clearTimeout(saveT); saveT = setTimeout(async () => { const r = await api('settings_save', { settings: S }); if (r.ok) { ME = r.user; S = ME.settings; } }, 300); }
async function research(id) { const r = await api('research', { id }); if (!r.ok) return toast(r.err); ME = r.user; toast('Танк исследован'); sfx('click'); render(); }
async function upgrade(mod) { const r = await api('upgrade', { id: ME.sel, mod }); if (!r.ok) return toast(r.err); ME = r.user; toast('Модуль улучшен'); sfx('hit'); render(); }
async function selTank(id) { const r = await api('select', { id }); if (!r.ok) return toast(r.err); ME = r.user; render(); }
async function buy(type, id, n) { const r = await api('buy', { type, id, n }); if (!r.ok) return toast(r.err); ME = r.user; toast('Куплено!'); sfx('click'); render(); }
function fmtTime(sec) { sec=Math.max(0,Math.floor(sec)); const d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60),q=sec%60; return (d?d+'д ':'')+[h,m,q].map(x=>String(x).padStart(2,'0')).join(':'); }
async function claimContainer(id) { const r=await api('claim_container',{id}); if(!r.ok)return toast(r.err); ME=r.user; toast('Контейнер добавлен в хранилище'); render(); }
async function exchange(direction) { const amount=+(document.querySelector('#exAmount')?.value||1); const r=await api('exchange',{direction,amount}); if(!r.ok)return toast(r.err); ME=r.user; toast('Обмен выполнен'); render(); }
async function finishTutorial() { const r=await api('tutorial_done'); if(r.ok) ME=r.user; document.querySelector('#tutorialModal')?.remove(); }
function tutorialHtml() { if(ME.tutorial_done) return ''; return `<div id="tutorialModal" class="center" style="background:#000c;z-index:100"><div class="panel" style="width:min(440px,94vw)"><h2>Добро пожаловать в Tanks 3D!</h2><p>Вы начинаете с танка I уровня. Сражайтесь, получайте серебро и опыт.</p><ol><li>Играйте в боях, чтобы получать серебро и опыт.</li><li>В разделе «Улучшение» покупайте двигатель, броню и орудие.</li><li>После полного улучшения исследуйте следующий уровень.</li><li>Купите исследованный танк за серебро.</li><li>Забирайте контейнеры по таймеру в магазине.</li></ol><button class="act" onclick="finishTutorial()">Начать игру</button></div></div>`; }
async function daily() { const r = await api('daily'); if (!r.ok) return toast(r.err); ME = r.user; toast('+50 🪙 и +5000 🥈'); render(); }
async function useItem(id) { const r = await api('use_item', { id }); if (!r.ok) return toast(r.err); ME = r.user; toast('Бустер активирован'); render(); }
async function openC(id, n) {
  const r = await api('open', { id, n }); if (!r.ok) return toast(r.err); ME = r.user; sfx('hit');
  const names = d => d.kind === 'silver' ? `🥈 ${fmt(d.n)} серебра` : d.kind === 'gold' ? `🪙 ${d.n} золота${d.note ? ' (' + d.note + ')' : ''}` : d.kind === 'tank' ? `🎖 Танк: ${CAT.tanks[d.id].name}!` : d.kind === 'container' ? `📦 ${CAT.containers[d.id]?.name || d.id}` : `🎁 ${CAT.items[d.id]}`;
  render(); const m = document.createElement('div'); m.className = 'center'; m.style.background = '#000a'; m.style.zIndex = 40;
  m.innerHTML = `<div class="panel" style="width:min(380px,92vw)"><h3 style="margin-top:0">Награда</h3>${r.drops.map(d => `<div class="card" style="margin:6px 0">${names(d)}</div>`).join('')}<div class="row"><button onclick="this.closest('.center').remove()">Забрать</button></div></div>`;
  document.body.appendChild(m);
}

// ---------- Ангар (3D превью) ----------
let lobbyG = null, lobbyTank = null, lobbyId = null;
function buildLobbyScene() {
  lobbyG = new THREE.Group(); scene.add(lobbyG);
  const gr = new THREE.Mesh(new THREE.CircleGeometry(30, 40), new THREE.MeshLambertMaterial({ color: 0x4d6b3a })); gr.rotation.x = -Math.PI / 2; lobbyG.add(gr);
  const pl = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.4, 0.4, 32), new THREE.MeshLambertMaterial({ color: 0x3a424d })); pl.position.y = 0.2; lobbyG.add(pl);
  lobbyTank = new THREE.Group(); lobbyTank.position.y = 0.4; lobbyG.add(lobbyTank); lobbyTank.visible = false;
}
function setLobbyTank() {
  if (lobbyId === ME.sel) return; lobbyId = ME.sel;
  while (lobbyTank.children.length) lobbyTank.remove(lobbyTank.children[0]);
  const t = buildTank(ME.sel); t.scale.setScalar(1.15); lobbyTank.add(t);
}

// ---------- Бой ----------
let B = null, queueTimer = null;
function playMenu() {
  if (!ME || B) return; sfx('click'); if ($('#pm')) return;
  const m = document.createElement('div'); m.id = 'pm'; m.className = 'center'; m.style.cssText = 'background:#000a;z-index:30';
  m.innerHTML = `<div class="panel" style="text-align:center;max-width:94vw"><h3 style="margin:0 0 4px">Выберите режим</h3><div class="st" style="margin-bottom:10px">${CAT.tanks[ME.sel].name}</div>
  <div class="modes"><button class="act mode" onclick="closePM();queue('pvp')">⚔ Бой 1 на 1<div class="st" style="color:#fff9;font-weight:400">против игрока</div></button>
  <button class="grn mode" onclick="closePM();botBattle('bot')">🤖 Бой с ботом<div class="st" style="color:#fff9;font-weight:400">тренировка</div></button>
  <button class="act mode" onclick="closePM();queue('capture')">🚩 Захват точки<div class="st" style="color:#fff9;font-weight:400">соревнование с игроком</div></button></div>
  <div class="row" style="justify-content:center"><button class="sec" onclick="closePM()">Отмена</button></div></div>`;
  ui.appendChild(m);
}
function closePM() { const m = $('#pm'); if (m) m.remove(); }
async function queue(mode='pvp') {
  queueMode=mode; const r = await api('queue_join',{mode}); if (!r.ok) return toast(r.err);
  if (r.matched) return enterMatch();
  ui.insertAdjacentHTML('beforeend', `<div class="center" id="qm" style="background:#000a;z-index:30"><div class="panel" style="text-align:center"><h3 style="margin-top:0">Поиск соперника…</h3><div class="st" id="qt">0 c</div><div class="row" style="justify-content:center"><button class="grn" onclick="queueCancel(true)">Сыграть с ботом</button><button class="sec" onclick="queueCancel(false)">Отмена</button></div></div></div>`);
  let t = 0; clearInterval(queueTimer);
  queueTimer = setInterval(async () => {
    t++; const el = $('#qt'); if (el) el.textContent = t + ' c';
    const p = await api('queue_poll'); if (p.ok && p.matched) { clearInterval(queueTimer); enterMatch(); }
  }, 1000);
}
async function queueCancel(bot) { clearInterval(queueTimer); await api('queue_leave'); if (bot) botBattle('bot'); else render(); }
async function botBattle(mode='bot') { clearInterval(queueTimer); await api('queue_leave'); const r = await api('bot_start',{mode}); if (!r.ok) { render(); return toast(r.err); } enterMatch(); }
async function enterMatch() {
  clearInterval(queueTimer); const r = await api('match_info'); if (!r.ok) { render(); return toast('Не удалось войти в бой'); }
  startBattle(r);
}
function startBattle(info) {
  ac(); ui.innerHTML = ''; if (lobbyG) lobbyG.visible = false;
  const g = new THREE.Group(); scene.add(g);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2), new THREE.MeshLambertMaterial({ map: gridTex() })); ground.rotation.x = -Math.PI / 2; g.add(ground);
  const wm = new THREE.MeshLambertMaterial({ color: 0x8a7a64 });
  for (const w of CAT.walls) { const m = new THREE.Mesh(new THREE.BoxGeometry(w[2], 5, w[3]), wm); m.position.set(w[0], 2.5, w[1]); g.add(m); }
  const bm = new THREE.MeshLambertMaterial({ color: 0x555b66 });
  if (info.mode==='capture') { const ring=new THREE.Mesh(new THREE.RingGeometry(7.5,8.2,48),new THREE.MeshBasicMaterial({color:0xe7c33d,side:THREE.DoubleSide,transparent:true,opacity:.85})); ring.rotation.x=-Math.PI/2; ring.position.y=.06; g.add(ring); const disk=new THREE.Mesh(new THREE.CircleGeometry(7.5,48),new THREE.MeshBasicMaterial({color:0xd9b43b,transparent:true,opacity:.12}));disk.rotation.x=-Math.PI/2;disk.position.y=.04;g.add(disk); }
  for (const [x, z, w, d] of [[0, -ARENA - 1, ARENA * 2 + 4, 2], [0, ARENA + 1, ARENA * 2 + 4, 2], [-ARENA - 1, 0, 2, ARENA * 2], [ARENA + 1, 0, 2, ARENA * 2]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 6, d), bm); m.position.set(x, 3, z); g.add(m); }
  B = { g, me: info.me, mode: info.mode, startAt: performance.now() + info.start_in * 1000, ents: {}, proj: [], fx: [], ev: 0, over: null, reload: 0, scope: false, zoom: 0, spread: 0,
    yaw: 0, pit: 0.25, v: 0, x: 0, z: 0, rot: 0, tur: 0, shake: 0, flash: 0, busy: false, sentLast: 0 };
  for (const e of info.ents) {
    const mesh = buildTank(e.tank, e.id === B.me ? null : '#a6402f'); g.add(mesh); mesh.position.set(e.x, 0, e.z);
    B.ents[e.id] = { ...e, mesh, tx: e.x, tz: e.z, trot: e.rot, ttur: e.tur };
    if (e.id === B.me) { B.x = e.x; B.z = e.z; B.rot = e.rot; B.tur = e.tur; B.yaw = e.rot; }
  }
  const mine = B.ents[B.me]; $('#hpMeN').textContent = mine.name; const en = info.ents.find(x => x.id !== B.me); $('#hpEnN').textContent = en ? en.name : '';
  $('#hud').style.display = 'block'; $('#perfHud').style.display='flex'; $('#captureHud').style.display=info.mode==='capture'?'block':'none';
  let ci = $('#combatItems');
  if (!ci) { ci = document.createElement('div'); ci.id='combatItems'; ci.className='combat-items'; document.body.appendChild(ci); } else if (ci.parentElement !== document.body) { document.body.appendChild(ci); }
  ci.innerHTML = `<button type="button" data-consumable="repair_kit"><kbd>1</kbd><span>🔧 Ремонт</span></button><button type="button" data-consumable="fire_extinguisher"><kbd>2</kbd><span>🧯 Потушить</span></button><button type="button" data-consumable="medkit"><kbd>3</kbd><span>➕ Экипаж</span></button>`;
  ci.style.display = 'flex'; // Показываем расходники только после входа в бой.
  // Надёжная обработка кнопок расходников: слушатели назначаются прямо
  // на кнопки после создания. Это исключает перехват касаний зоной прицеливания.
  ci.querySelectorAll('button[data-consumable]').forEach(btn => {
    let lastPointerAction = 0;
    const activate = e => {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (!btn.disabled && B && !B.over) {
        lastPointerAction = Date.now();
        useConsumable(btn.dataset.consumable);
      }
    };
    if ('PointerEvent' in window) {
      btn.addEventListener('pointerdown', activate, { passive: false });
    } else {
      btn.addEventListener('touchstart', activate, { passive: false });
      btn.addEventListener('mousedown', activate);
    }
    // Клавиатура, accessibility и браузеры без Pointer Events.
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (Date.now() - lastPointerAction < 700) return;
      if (!btn.disabled && B && !B.over) useConsumable(btn.dataset.consumable);
    });
  });
  $('#scope').style.display = 'none'; $('#cross').style.display = 'block';
  const tc = useTouch(); $('#joy').style.display = tc ? 'block' : 'none'; $('#aimz').style.display = tc ? 'block' : 'none'; $('#fireB').style.display = tc ? 'flex' : 'none'; $('#scopeB').style.display = tc ? 'flex' : 'none';
  $('#hint').textContent = tc ? '' : 'WASD — движение · мышь — прицел · ЛКМ — выстрел · ПКМ/Shift — прицел · 1 — ремонт · 2 — потушить пожар · 3 — лечение экипажа';
  $('#exitB').onclick = () => { if (confirm('Выйти из боя? Будет засчитано поражение.')) leaveBattle(); };
  engineStart(); B.timer = setInterval(syncTick, 100);
}
let consumableBusy = false;
async function useConsumable(id) {
  if (!B || B.over || consumableBusy) return;
  consumableBusy = true;
  const buttons = document.querySelectorAll('#combatItems button');
  buttons.forEach(btn => btn.disabled = true);
  try {
    const r = await api('consumable', {id});
    if (!r.ok) { toast(r.err || 'Не удалось использовать снаряжение', 3000); return; }
    toast(id === 'repair_kit' ? 'Модули отремонтированы, прочность восстановлена частично' : id === 'fire_extinguisher' ? 'Пожар потушен' : 'Экипаж восстановлен');
    syncTick();
  } catch (err) {
    toast('Ошибка соединения при использовании снаряжения');
  } finally {
    consumableBusy = false;
    buttons.forEach(btn => btn.disabled = false);
  }
}
function toggleScope() { if (!B || B.over) return; B.scope = !B.scope; B.pit = clamp(B.pit, B.scope ? -0.3 : -0.15, B.scope ? 0.35 : 0.75); sfx('click'); }
async function fire() {
  if (!B || B.over || performance.now() < B.startAt || B.reload > 0) return; const me = B.ents[B.me]; if (me.hp <= 0) return;
  const T = me; B.reload = T.reload; B.recoil = 1; sfx('shot'); muzzleFlash(me);
  api('shoot', { dx: Math.sin(B.tur), dz: Math.cos(B.tur) });
}
function muzzleFlash(e) {
  const v = new THREE.Vector3(); e.mesh.userData.mz.getWorldPosition(v);
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd36a })); s.position.copy(v); B.g.add(s); B.fx.push({ m: s, t: 0.12, grow: 0 });
}
function explosion(x, y, z, size) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 10), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.9 })); s.position.set(x, y, z); B.g.add(s); B.fx.push({ m: s, t: 0.5, grow: 2.2 });
}
let lastSync = 0;
async function syncTick() {
  if (!B || B.busy || B.over) return; B.busy = true;
  const r = await api('sync', { x: B.x, z: B.z, rot: B.rot, tur: B.tur, ev: B.ev });
  B.busy = false; if (!B || !r) return;
  if (!r.ok) { if (r.err === 'no_match') { finishBattle({ reason: 'lost' }); } return; }
  for (const e of r.ents) {
    const o = B.ents[e.id]; if (!o) continue; o.hp = e.hp; o.maxhp = e.maxhp; o.speed = e.speed; o.reload = e.reload; o.damage = e.damage || {}; o.burning = !!e.burning; o.consumables = e.consumables || {};
    if (e.id !== B.me) { o.tx = e.x; o.tz = e.z; o.trot = e.rot; o.ttur = e.tur; }
  }
  if (r.corr) { B.x = r.corr.x; B.z = r.corr.z; B.v = 0; toast('Позиция скорректирована сервером', 900); }
  for (const e of r.ev) {
    if (e.i <= B.ev) continue; B.ev = e.i;
    if (e.t === 'shot') {
      const o = B.ents[e.from];
      if (e.from !== B.me && o) { muzzleFlash(o); sfx('shot', 0.7); }
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 6), new THREE.MeshBasicMaterial({ color: 0xfff1a8 }));
      p.position.set(e.ox, 2.3, e.oz); B.g.add(p); B.proj.push({ m: p, dx: e.dx, dz: e.dz, left: e.len, hit: e.hit });
    } else if (e.t === 'hit') {
      if (e.to === B.me) { B.shake = 1; B.flash = 1; sfx('hit'); }
      const t = B.ents[e.to]; if (t) { floatDmg(e.dmg, t.mesh.position); if (e.to === B.me && e.part) {
    const partText = e.part === 'track' ? (e.partLevel >= 2 ? 'Гусеница сбита' : 'Критическое повреждение гусеницы') :
      ({engine:'Двигатель повреждён',fuel:'Топливный бак повреждён',ammo:'Боеукладка повреждена',crew:'Экипаж ранен'})[e.part];
    toast(partText + (e.burn ? ' · ПОЖАР!' : ''), 1800);
  } }
    } else if (e.t === 'death') { const t = B.ents[e.id]; if (t) { explosion(t.mesh.position.x, 1.5, t.mesh.position.z, 2.5); t.mesh.visible = false; sfx('boom'); } }
  }
  B.tleft = r.tleft; if (r.capture) { B.capture = Number(r.capture[B.me] || 0); const cp=$('#capturePct'), cf=$('#captureFill'); if(cp)cp.textContent=Math.round(B.capture)+'%'; if(cf)cf.style.width=Math.max(0,Math.min(100,B.capture))+'%'; }
  if (r.over) finishBattle(r.over);
}
function floatDmg(n, p) {
  const v = new THREE.Vector3(p.x, 4, p.z).project(cam); if (v.z > 1) return;
  const d = document.createElement('div'); d.className = 'dmg'; d.textContent = '-' + n; d.style.left = ((v.x + 1) / 2 * innerWidth) + 'px'; d.style.top = ((1 - v.y) / 2 * innerHeight) + 'px';
  $('#hud').appendChild(d); requestAnimationFrame(() => { d.style.top = (parseFloat(d.style.top) - 60) + 'px'; d.style.opacity = 0; }); setTimeout(() => d.remove(), 1100);
}
function finishBattle(o) {
  if (!B || B.over) return; B.over = o; clearInterval(B.timer); engineStop();
  const combatItems = $('#combatItems'); if (combatItems) combatItems.style.display = 'none'; if (document.exitPointerLock) document.exitPointerLock();
  const rw = o.rew || {}; const win = rw.win; const rs = { kill: 'Танк противника уничтожен', time: 'Время вышло', disconnect: 'Соперник отключился', leave: 'Выход из боя', ace: 'Нарушение правил (античит)', lost: 'Бой завершён' }[o.reason] || '';
  const m = document.createElement('div'); m.className = 'center'; m.style.cssText = 'background:#000b;z-index:40;position:fixed;inset:0';
  m.innerHTML = `<div class="panel" style="width:min(380px,92vw);text-align:center"><h2 style="margin:0">${o.winner == null ? 'Ничья' : win ? '🏆 ПОБЕДА' : '💀 ПОРАЖЕНИЕ'}</h2><div class="st">${rs}</div>
  <div class="st" style="font-size:15px;margin:10px 0">Нанесено урона: ${rw.dealt || 0}<br>🥈 +${fmt(rw.silver || 0)}${rw.gold ? ' · 🪙 +' + rw.gold : ''}${rw.xp ? ' · ⭐ +' + rw.xp : ''}${rw.battle_cont ? ' · 📦 +1 боевой контейнер' : ''}${rw.cont ? ' · 🎁 бонусный обычный контейнер (25%)' : ''}</div>
  <button onclick="leaveBattle(true)">В ангар</button></div>`;
  document.body.appendChild(m); B.resultEl = m;
}
async function leaveBattle(done) {
  if (!B) return; if (B.resultEl) B.resultEl.remove(); clearInterval(B.timer); engineStop();
  if (!done || !B.over) await api('leave_match'); else await api('leave_match');
  if (document.exitPointerLock) document.exitPointerLock();
  scene.remove(B.g); B = null; $('#captureHud').style.display='none'; const combatItems = $('#combatItems'); if (combatItems) combatItems.style.display = 'none'; $('#hud').style.display = 'none'; for (const id of ['#joy', '#aimz', '#fireB', '#scopeB']) $(id).style.display = 'none';
  if (lobbyG) lobbyG.visible = true; await refresh(); lobbyId = null; render();
}

// ---------- Основной цикл ----------
let lastT = performance.now();
function loop(t) {
  requestAnimationFrame(loop); const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t; fpsFrames++; if(t-fpsMark>=500){fpsValue=Math.round(fpsFrames*1000/(t-fpsMark));fpsFrames=0;fpsMark=t;updatePerfHud();}
  if (B) updateBattle(dt, t); else {
    if (lobbyTank && lobbyTank.visible) lobbyTank.rotation.y += dt * 0.5; cam.fov = 50; cam.updateProjectionMatrix();
    cam.position.set(8, 4.2, 10); cam.lookAt(0, 0.4, 0);
  }
  renderer.render(scene, cam);
}
function updateBattle(dt, now) {
  const me = B.ents[B.me]; const T = { speed: me.speed, turn: me.turn, tur: me.tur_s, reload: me.reload }; const live = now >= B.startAt && !B.over && me.hp > 0;
  let thr = 0, st = 0;
  if (live) {
    if (keys[S.keys.fwd]) thr += 1; if (keys[S.keys.back]) thr -= 1; if (keys[S.keys.right]) st += 1; if (keys[S.keys.left]) st -= 1;
    thr = clamp(thr - touch.jy, -1, 1); st = clamp(st + touch.jx, -1, 1);
  }
  // скорость и поворот — строго из параметров танка (то же значение проверяет сервер)
  B.rot -= st * T.turn * dt;
  const target = thr >= 0 ? thr * T.speed : thr * T.speed * 0.55; B.v += (target - B.v) * Math.min(1, 3.5 * dt);
  const p = { x: B.x + Math.sin(B.rot) * B.v * dt, z: B.z + Math.cos(B.rot) * B.v * dt }; const want = Math.hypot(p.x - B.x, p.z - B.z);
  resolve(p); const got = Math.hypot(p.x - B.x, p.z - B.z);
  if (want > 1e-4 && got < want * 0.6) B.v *= 0.6;           // упёрлись в стену — замедляемся
  B.x = p.x; B.z = p.z;
  if (me.hp > 0) B.tur = turnTo(B.tur, B.yaw, T.tur * dt);
  B.reload = Math.max(0, B.reload - dt);
  if (keys[S.keys.fire] && live) fire();
  // меши
  for (const id in B.ents) {
    const e = B.ents[id], m = e.mesh;
    if (id === B.me) { e.x = B.x; e.z = B.z; e.rot = B.rot; e.tur = B.tur; }
    else { const k = Math.min(1, 12 * dt); e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; e.rot += angdiff(e.trot, e.rot) * k; e.tur += angdiff(e.ttur, e.tur) * k; }
    m.position.set(e.x, 0, e.z); m.rotation.y = e.rot; m.userData.tur.rotation.y = angdiff(e.tur, e.rot);
    animTank(m, dt);
    if (e.hp <= 0) m.visible = false;
  }
  me.mesh.userData.tur.position.z = (me.mesh.userData.tur.userData.bz || 0) - 0.25 * (B.recoil || 0); B.recoil = Math.max(0, (B.recoil || 0) - dt * 4);
  // снаряды и эффекты
  for (let i = B.proj.length - 1; i >= 0; i--) {
    const q = B.proj[i], s = Math.min(q.left, 260 * dt); q.m.position.x += q.dx * s; q.m.position.z += q.dz * s; q.left -= s;
    if (q.left <= 0.01) { explosion(q.m.position.x, q.hit ? 2 : 1.5, q.m.position.z, q.hit ? 1.4 : 0.8); if (q.hit && q.hit !== B.me) sfx('boom', 0.6); B.g.remove(q.m); B.proj.splice(i, 1); }
  }
  for (let i = B.fx.length - 1; i >= 0; i--) { const f = B.fx[i]; f.t -= dt; if (f.grow) f.m.scale.addScalar(f.grow * dt); if (f.m.material.opacity !== undefined && f.m.material.transparent) f.m.material.opacity = Math.max(0, f.t * 1.8); if (f.t <= 0) { B.g.remove(f.m); B.fx.splice(i, 1); } }
  // камера
  const scope = B.scope && me.hp > 0; me.mesh.visible = !scope && me.hp > 0;
  if (scope) {
    cam.fov = 25 / [1, 1.5, 2][B.zoom]; const cp = B.pit;
    cam.position.set(B.x + Math.sin(B.yaw) * 0.6, 2.9, B.z + Math.cos(B.yaw) * 0.6);
    cam.lookAt(cam.position.x + Math.sin(B.yaw) * Math.cos(cp), cam.position.y - Math.sin(cp), cam.position.z + Math.cos(B.yaw) * Math.cos(cp));
  } else {
    cam.fov = 50; let D = 13; const hx = -Math.sin(B.yaw), hz = -Math.cos(B.yaw);
    for (const w of CAT.walls) { const t = rayBox(B.x, B.z, hx, hz, w); if (t !== null && t < D) D = Math.max(3, t - 0.6); }
    const el = B.pit * 0.9;
    cam.position.set(B.x + hx * D * Math.cos(el), 2.6 + D * Math.sin(el) + 0.8, B.z + hz * D * Math.cos(el));
    cam.lookAt(B.x - hx * 12, 1.8, B.z - hz * 12);
  }
  if (B.shake > 0) { cam.position.x += (Math.random() - 0.5) * B.shake * 0.5; cam.position.y += (Math.random() - 0.5) * B.shake * 0.5; B.shake = Math.max(0, B.shake - dt * 3); }
  cam.updateProjectionMatrix();
  // HUD
  $('#scope').style.display = 'none'; $('#cross').style.display = 'flex'; $('#cross').style.fontSize = scope ? '34px' : '28px'; applyReticle();
  $('#rel').textContent = B.reload > 0 ? B.reload.toFixed(1) : '0.0';
  const aimTarget = Object.values(B.ents).find(e => e.id !== B.me && e.hp > 0);
  if (aimTarget && $('#penHint')) { const dx=aimTarget.x-B.x,dz=aimTarget.z-B.z,angle=Math.atan2(dx,dz),aligned=Math.abs(angdiff(angle,B.tur))<0.13; const enemyT=CAT.tanks[aimTarget.tank]||{}, myT=CAT.tanks[me.tank]||{}; const armor=(enemyT.tier||1)*7+((enemyT.cls==='heavy')?45:(enemyT.cls==='medium'?25:10)); const pen=(myT.dmg||me.damageValue||90)*0.72; $('#penHint').textContent=aligned?(pen>=armor?'ПРОБИТИЕ':'РИКОШЕТ'):(B.scope?'Наводитесь на цель':''); $('#penHint').style.color=pen>=armor?'#43f58b':'#ff6666'; }
  const movingSpread = Math.min(1, Math.abs(B.v) / Math.max(1, T.speed));
  const spreadValue = Math.min(1, 0.12 + movingSpread * 0.55 + (B.recoil || 0) * 0.28 + (B.scope ? 0 : 0.05));
  drawSpread(spreadValue, scope);
  if (B.mode==='capture') { const cap=B.capture||0; $('#capturePct').textContent=Math.round(cap)+'%'; $('#captureFill').style.width=Math.max(0,Math.min(100,cap))+'%'; }
  const en = Object.values(B.ents).find(e => e.id !== B.me);
  $('#hpMe').style.width = (100 * me.hp / me.maxhp) + '%';
  const dm = me.damage || {};
  $('#hpMeV').textContent = me.hp + ' / ' + me.maxhp + (me.burning ? ' 🔥' : '');
  const status = Object.entries({track:(dm.track>=2?'Гусеница сбита':'Гусеница крит'),engine:(dm.engine>=2?'Двигатель крит':'Двигатель повреждён'),fuel:'Топливный бак',ammo:'Боеукладка',crew:'Экипаж'}).filter(([k]) => dm[k]>0).map(([,v])=>v).join(', ');
  $('#hpMeN').textContent = me.name + (status ? ' · ⚠ ' + status : '');
  if (en) { $('#hpEn').style.width = (100 * en.hp / en.maxhp) + '%'; $('#hpEnV').textContent = en.hp + ' / ' + en.maxhp; }
  B.flash = Math.max(0, B.flash - dt * 2); $('#hitfx').style.opacity = B.flash * 0.8;
  const left = (B.startAt - now) / 1000; $('#cd').textContent = left > 0 ? Math.ceil(left) : (left > -0.8 ? 'В БОЙ!' : '');
  engineSet(Math.abs(B.v) / T.speed);
  drawMini();
}
function drawSpread(value, scoped) {
  const root = $('#spread'); if (!root) return;
  const radius = 8 + value * (scoped ? 24 : 34);
  root.innerHTML = '';
  // Тот же угол разброса в обоих режимах; меняется только оформление прицела.
  for (let i = 0; i < 8; i++) {
    const a = Math.PI * 2 * i / 8, d = document.createElement('i');
    d.className = 'spot'; d.style.left = (50 + Math.cos(a) * radius) + 'px';
    d.style.top = (50 + Math.sin(a) * radius) + 'px';
    if (!scoped) { d.style.width = '4px'; d.style.height = '4px'; }
    root.appendChild(d);
  }
  root.style.width = '100px'; root.style.height = '100px';
  root.style.transform = 'translate(-50%,-50%)';
}

function drawMini() {
  const c = $('#mini').getContext('2d'), s = 140 / (ARENA * 2); c.clearRect(0, 0, 140, 140); c.fillStyle = '#8a7a64';
  for (const w of CAT.walls) c.fillRect((w[0] - w[2] / 2 + ARENA) * s, (w[1] - w[3] / 2 + ARENA) * s, w[2] * s, w[3] * s);
  for (const id in B.ents) { const e = B.ents[id]; if (e.hp <= 0) continue; c.fillStyle = id === B.me ? '#35e07a' : '#ff5040'; c.beginPath(); c.arc((e.x + ARENA) * s, (e.z + ARENA) * s, 4, 0, 7); c.fill();
    c.strokeStyle = c.fillStyle; c.beginPath(); c.moveTo((e.x + ARENA) * s, (e.z + ARENA) * s); c.lineTo((e.x + ARENA + Math.sin(e.tur) * 8) * s, (e.z + ARENA + Math.cos(e.tur) * 8) * s); c.stroke(); }
}
boot();
