// pepino.js — capa de "wow" para La Casa de las Tartas
// Todo aquí es ADITIVO: si algo falla (sin red, Three.js no carga...),
// la app de caja sigue funcionando igual. No toca la lógica de negocio.

const $ = (s) => document.querySelector(s);
const hasGsap = typeof window.gsap !== "undefined";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const hoverDevice = window.matchMedia("(hover: hover)").matches;

/* ============================================================
   1. MODO OSCURO
   ============================================================ */
const THEME_KEY = "casa_tartas_theme";
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  const btn = $("#fx-theme");
  if (btn) btn.textContent = t === "dark" ? "☀️" : "🌙";
}
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "light";
  applyTheme(saved);
  $("#fx-theme")?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

/* ============================================================
   2. MÚSICA (WebAudio, sin ficheros externos)
   Melodía dulce en pentatónica, volumen bajo. Empieza apagada.
   ============================================================ */
const MUSIC_KEY = "casa_tartas_music";
const music = {
  ctx: null, master: null, on: false, timer: null, step: 0,
};
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33]; // C D E G A C5 D5
const MELODY = [0, 2, 4, 2, 3, 4, 5, 4, 2, 0, 1, 2]; // índices sobre SCALE

function ensureAudio() {
  if (music.ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  music.ctx = new AC();
  music.master = music.ctx.createGain();
  music.master.gain.value = 0.0;
  music.master.connect(music.ctx.destination);
}

function playNote(freq, time, dur, type = "sine", vol = 0.18) {
  const o = music.ctx.createOscillator();
  const g = music.ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g); g.connect(music.master);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(vol, time + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  o.start(time); o.stop(time + dur + 0.05);
}

function scheduleLoop() {
  if (!music.on) return;
  const t = music.ctx.currentTime + 0.05;
  const idx = MELODY[music.step % MELODY.length];
  playNote(SCALE[idx], t, 0.5, "triangle", 0.16);          // melodía
  if (music.step % 4 === 0) {                               // pad/acorde suave
    playNote(SCALE[0] / 2, t, 1.6, "sine", 0.10);
    playNote(SCALE[2] / 2, t, 1.6, "sine", 0.07);
  }
  music.step++;
  music.timer = setTimeout(scheduleLoop, 380);
}

function musicOn() {
  ensureAudio();
  if (!music.ctx) return;
  if (music.ctx.state === "suspended") music.ctx.resume();
  music.on = true;
  music.master.gain.cancelScheduledValues(music.ctx.currentTime);
  music.master.gain.linearRampToValueAtTime(0.5, music.ctx.currentTime + 0.6);
  scheduleLoop();
  $("#fx-music").textContent = "🔊";
  localStorage.setItem(MUSIC_KEY, "on");
}
function musicOff() {
  music.on = false;
  if (music.timer) clearTimeout(music.timer);
  if (music.ctx) music.master.gain.linearRampToValueAtTime(0, music.ctx.currentTime + 0.3);
  $("#fx-music").textContent = "🔇";
  localStorage.setItem(MUSIC_KEY, "off");
}
function initMusic() {
  $("#fx-music")?.addEventListener("click", () => (music.on ? musicOff() : musicOn()));
}

/* ============================================================
   3. CURSOR PERSONALIZADO + BOTONES MAGNÉTICOS (solo login, solo PC)
   ============================================================ */
function initCursor() {
  if (!hoverDevice || !hasGsap) return;
  const cur = $(".cursor"), dot = $(".cursor-dot");
  if (!cur) return;
  let mx = innerWidth / 2, my = innerHeight / 2, cx = mx, cy = my;
  addEventListener("pointermove", (e) => { mx = e.clientX; my = e.clientY; gsap.set(dot, { x: mx, y: my }); });
  gsap.ticker.add(() => { cx += (mx - cx) * 0.18; cy += (my - cy) * 0.18; gsap.set(cur, { x: cx, y: cy }); });
  const grow = () => gsap.to(cur, { scale: 2.2, duration: 0.3 });
  const shrink = () => gsap.to(cur, { scale: 1, duration: 0.3 });
  document.querySelectorAll("#view-login a, #view-login button, .magnetic, .fx-btn").forEach((el) => {
    el.addEventListener("pointerenter", grow);
    el.addEventListener("pointerleave", shrink);
  });
  document.querySelectorAll(".magnetic").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      gsap.to(el, { x: (e.clientX - r.left - r.width / 2) * 0.3, y: (e.clientY - r.top - r.height / 2) * 0.3, duration: 0.4 });
    });
    el.addEventListener("pointerleave", () => gsap.to(el, { x: 0, y: 0, duration: 0.6, ease: "elastic.out(1,0.3)" }));
  });
}

/* ============================================================
   4. FONDO ANIMADO DEL LOGIN (Three.js shader, tonos pastelería)
   ============================================================ */
const bg = { renderer: null, running: false };
async function initLoginBg() {
  const canvas = $("#login-bg");
  if (!canvas || reduceMotion) return;
  let THREE;
  try { THREE = await import("three"); }
  catch (e) { console.warn("Three.js no cargó, login sin fondo 3D", e); return; }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  bg.renderer = renderer;
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    u_time: { value: 0 },
    u_res: { value: new THREE.Vector2(innerWidth, innerHeight) },
    u_mouse: { value: new THREE.Vector2(0.5, 0.5) },
    u_dark: { value: document.documentElement.getAttribute("data-theme") === "dark" ? 1 : 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `void main(){ gl_Position = vec4(position,1.0); }`,
    fragmentShader: `
      uniform float u_time; uniform vec2 u_res; uniform vec2 u_mouse; uniform float u_dark;
      void main(){
        vec2 uv = gl_FragCoord.xy / u_res.xy;
        vec2 p = uv - 0.5; p.x *= u_res.x / u_res.y;
        float d = length(p - (u_mouse - 0.5));
        float v = sin(p.x*2.2 + u_time*0.35) + sin(p.y*2.6 + u_time*0.5) + sin(d*6.0 - u_time*0.8);
        v *= 0.25;
        // paleta cálida pastelería: crema -> rosa fresa -> melocotón
        vec3 cream = vec3(0.99, 0.95, 0.88);
        vec3 rosa  = vec3(0.85, 0.40, 0.52);
        vec3 melo  = vec3(0.98, 0.78, 0.62);
        vec3 col = mix(cream, rosa, smoothstep(-0.4, 0.6, v));
        col = mix(col, melo, smoothstep(0.2, 1.0, sin(v*3.1416 + u_time*0.2)*0.5+0.5)*0.5);
        // versión oscura: malva profundo
        vec3 dark = mix(vec3(0.10,0.06,0.12), vec3(0.30,0.10,0.22), smoothstep(-0.4,0.8,v));
        col = mix(col, dark, u_dark);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  addEventListener("pointermove", (e) => uniforms.u_mouse.value.set(e.clientX / innerWidth, 1 - e.clientY / innerHeight));
  addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight); uniforms.u_res.value.set(innerWidth, innerHeight); });

  // sincroniza el shader con el modo oscuro
  new MutationObserver(() => {
    uniforms.u_dark.value = document.documentElement.getAttribute("data-theme") === "dark" ? 1 : 0;
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  bg.running = true;
  renderer.setAnimationLoop((t) => {
    if (!bg.running) return;
    uniforms.u_time.value = t * 0.001;
    renderer.render(scene, cam);
  });
}

/* ============================================================
   5. login-mode (cursor + fondo activos solo en el login)
   ============================================================ */
function syncLoginMode() {
  const loginVisible = !$("#view-login")?.hidden;
  document.body.classList.toggle("login-mode", loginVisible && hoverDevice);
  bg.running = loginVisible && !reduceMotion;
}
function observeLogin() {
  const view = $("#view-login");
  if (!view) return;
  new MutationObserver(syncLoginMode).observe(view, { attributes: true, attributeFilter: ["hidden"] });
  syncLoginMode();
}

/* ============================================================
   6. TRANSICIÓN AL HACER LOGIN
   ============================================================ */
const BILL_CHARS = ["💵", "💸", "💶", "🤑", "💴", "💷"];
function spawnBills(container, n) {
  container.innerHTML = "";
  const bills = [];
  for (let i = 0; i < n; i++) {
    const b = document.createElement("span");
    b.className = "bill";
    b.textContent = BILL_CHARS[i % BILL_CHARS.length];
    container.appendChild(b);
    bills.push(b);
  }
  return bills;
}

function loginTransition() {
  const overlay = $("#login-transition");
  if (!overlay) return;
  // si previamente la música estaba en on, reanúdala (este click es gesto de usuario)
  if (localStorage.getItem(MUSIC_KEY) === "on" && !music.on) musicOn();

  if (!hasGsap || reduceMotion) {
    overlay.hidden = false;
    overlay.style.opacity = "1";
    setTimeout(() => { overlay.hidden = true; overlay.style.opacity = ""; }, 500);
    return;
  }

  overlay.hidden = false;
  const wave = overlay.querySelector(".lt-wave");
  const cake = overlay.querySelector(".lt-cake");
  const shades = overlay.querySelector(".lt-shades");
  const hand = overlay.querySelector(".lt-hand");
  const text = overlay.querySelector(".lt-text");
  const billsBox = overlay.querySelector(".lt-bills");
  const bills = spawnBills(billsBox, 22);

  gsap.set(overlay, { autoAlpha: 1, yPercent: 0 });
  gsap.set(wave, { scale: 0, transformOrigin: "50% 50%" });
  gsap.set(cake, { scale: 0, rotate: -25, opacity: 0, y: 0 });
  gsap.set(shades, { y: -120, opacity: 0, rotate: -8 });
  gsap.set(hand, { scale: 0, opacity: 0 });
  gsap.set(text, { opacity: 0, y: 30, scale: 0.7 });
  gsap.set(bills, { x: 0, y: 0, opacity: 0, scale: 0.4, rotate: 0 });

  // lluvia de billetes que sale disparada desde la tarta
  function moneyBurst() {
    bills.forEach((b) => {
      const angle = (Math.random() - 0.5) * Math.PI * 1.4;   // hacia los lados/arriba
      const dist = 180 + Math.random() * 320;
      const dx = Math.sin(angle) * dist;
      const dy = -Math.cos(angle) * dist * 0.6;
      gsap.set(b, { x: 0, y: 0, opacity: 1, scale: 0.6 + Math.random() * 0.7, rotate: 0 });
      gsap.to(b, {
        x: dx, y: dy, rotate: (Math.random() - 0.5) * 720,
        duration: 0.5 + Math.random() * 0.3, ease: "power2.out",
      });
      gsap.to(b, {                                            // luego caen con gravedad
        y: "+=" + (innerHeight * 0.8 + Math.random() * 200),
        opacity: 0, duration: 1 + Math.random() * 0.6, ease: "power1.in", delay: 0.4 + Math.random() * 0.2,
      });
    });
  }

  const tl = gsap.timeline({
    onComplete: () => { overlay.hidden = true; gsap.set(overlay, { clearProps: "all" }); billsBox.innerHTML = ""; },
  });
  tl.to(wave, { scale: 1, duration: 0.6, ease: "expo.inOut" })
    // la tarta entra con chulería
    .to(cake, { scale: 1, rotate: 0, opacity: 1, duration: 0.55, ease: "back.out(2)" }, "-=0.3")
    // le caen las gafas de sol
    .to(shades, { y: 0, opacity: 1, rotate: 0, duration: 0.4, ease: "back.out(2.5)" }, "-=0.1")
    .to(hand, { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(2)" }, "-=0.15")
    // swagger: se balancea como un jefe
    .to(cake, { rotate: 9, duration: 0.18, ease: "sine.inOut" })
    .to(cake, { rotate: -7, duration: 0.18, ease: "sine.inOut" })
    .to(cake, { rotate: 0, duration: 0.18, ease: "sine.inOut" })
    // ¡here's my money bitch! lluvia de billetes + texto
    .add(() => { moneyBurst(); }, "-=0.3")
    .to(text, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "back.out(2.2)" }, "-=0.2")
    .to(cake, { y: -18, duration: 0.2, yoyo: true, repeat: 1, ease: "sine.inOut" })
    .add(() => { moneyBurst(); }, "+=0.05")                   // segunda tanda de billetes
    .to({}, { duration: 0.5 })                                // deja ver la lluvia
    // se va hacia arriba revelando la app
    .to([cake, text], { scale: "+=0.4", opacity: 0, duration: 0.4, ease: "power2.in" })
    .to(overlay, { yPercent: -100, duration: 0.85, ease: "expo.inOut" }, "-=0.2");
}

/* ============================================================
   7. TARTA INVADERS — jugable con teclado/ratón (PC) y táctil (móvil)
   ============================================================ */
function initGame() {
  const modal = $("#game-modal");
  const canvas = $("#game-canvas");
  if (!modal || !canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  let raf = null, state = "ready";
  let player, bullets, enemies, dir, score, lives, lastShot, tick;
  const keys = {};

  function reset() {
    player = { x: W / 2, y: H - 46, w: 40, speed: 5 };
    bullets = [];
    enemies = [];
    const cols = 6, rows = 3;
    const gx = 60, gy = 50, ox = (W - (cols - 1) * gx) / 2, oy = 60;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        enemies.push({ x: ox + c * gx, y: oy + r * gy, alive: true });
    dir = 1; score = 0; lives = 3; lastShot = 0; tick = 0;
    state = "playing";
  }

  function shoot() {
    if (state === "ready" || state === "over" || state === "win") { reset(); return; }
    if (tick - lastShot < 9) return;
    lastShot = tick;
    bullets.push({ x: player.x, y: player.y - 22 });
  }

  function draw() {
    // fondo espacial
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    ctx.fillStyle = dark ? "#0a0612" : "#1a1030";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (let i = 0; i < 40; i++) {
      const sx = (i * 97 + (tick * 0.3)) % W;
      const sy = (i * 53) % H;
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";

    // enemigos (planetas)
    ctx.font = "30px serif";
    enemies.forEach((e) => { if (e.alive) ctx.fillText("🌍", e.x, e.y); });
    // balas (cerezas)
    ctx.font = "18px serif";
    bullets.forEach((b) => ctx.fillText("🍒", b.x, b.y));
    // jugador (tarta)
    ctx.font = "38px serif";
    ctx.fillText("🎂", player.x, player.y);

    // HUD
    ctx.fillStyle = "#fff"; ctx.font = "bold 16px Fredoka, sans-serif"; ctx.textAlign = "left";
    ctx.fillText("Puntos: " + score, 12, 20);
    ctx.textAlign = "right";
    ctx.fillText("❤️".repeat(Math.max(0, lives)), W - 12, 20);
    ctx.textAlign = "center";

    if (state === "ready" || state === "over" || state === "win") {
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, H / 2 - 70, W, 140);
      ctx.fillStyle = "#fff"; ctx.font = "bold 26px Fredoka, sans-serif";
      const title = state === "win" ? "🎉 ¡Mundo a salvo!" : state === "over" ? "💥 Game Over" : "🎂 Tarta Invaders";
      ctx.fillText(title, W / 2, H / 2 - 20);
      ctx.font = "16px Fredoka, sans-serif";
      if (state !== "ready") ctx.fillText("Puntuación: " + score, W / 2, H / 2 + 8);
      ctx.fillText("Toca o pulsa ESPACIO para jugar", W / 2, H / 2 + 36);
    }
  }

  function update() {
    tick++;
    if (state === "playing") {
      if (keys["ArrowLeft"]) player.x -= player.speed;
      if (keys["ArrowRight"]) player.x += player.speed;
      player.x = Math.max(22, Math.min(W - 22, player.x));

      bullets.forEach((b) => (b.y -= 7));
      bullets = bullets.filter((b) => b.y > -20);

      // movimiento de planetas
      let edge = false;
      const live = enemies.filter((e) => e.alive);
      const speed = 0.4 + (18 - live.length) * 0.06;
      live.forEach((e) => {
        e.x += dir * speed;
        if (e.x > W - 24 || e.x < 24) edge = true;
      });
      if (edge) { dir *= -1; live.forEach((e) => (e.y += 18)); }

      // colisiones bala-planeta
      bullets.forEach((b) => {
        enemies.forEach((e) => {
          if (e.alive && Math.abs(b.x - e.x) < 18 && Math.abs(b.y - e.y) < 18) {
            e.alive = false; b.y = -999; score += 10;
          }
        });
      });
      bullets = bullets.filter((b) => b.y > -20);

      // ¿planeta llega abajo?
      live.forEach((e) => {
        if (e.y > H - 60) {
          e.alive = false; lives--;
          if (lives <= 0) state = "over";
        }
      });

      if (enemies.every((e) => !e.alive) && state === "playing") state = "win";
    }
    draw();
    raf = requestAnimationFrame(update);
  }

  // ---- controles ----
  addEventListener("keydown", (e) => {
    if (modal.open === false) return;
    keys[e.key] = true;
    if (e.key === " " || e.key === "ArrowUp") { e.preventDefault(); shoot(); }
  });
  addEventListener("keyup", (e) => { keys[e.key] = false; });

  // ratón/táctil: mover siguiendo el dedo/puntero + disparar al tocar
  function pointAt(e) {
    const r = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    if (player) player.x = Math.max(22, Math.min(W - 22, (cx / r.width) * W));
  }
  canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); pointAt(e); shoot(); });
  canvas.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "touch") { e.preventDefault(); pointAt(e); } });
  canvas.addEventListener("touchmove", (e) => { e.preventDefault(); pointAt(e); }, { passive: false });

  // abrir / cerrar
  function open() {
    reset(); state = "ready";
    modal.showModal();
    if (!raf) update();
  }
  function close() {
    modal.close();
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }
  $("#play-game")?.addEventListener("click", open);
  $("#game-close")?.addEventListener("click", close);
  modal.addEventListener("close", () => { if (raf) { cancelAnimationFrame(raf); raf = null; } });
}

/* ============================================================
   BOOT
   ============================================================ */
function boot() {
  initTheme();
  initMusic();
  initCursor();
  observeLogin();
  initGame();
  initLoginBg();
  window.addEventListener("casa:login-success", loginTransition);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
