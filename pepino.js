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
// billete dibujado en SVG (variantes de color/símbolo/valor)
const BILL_VARIANTS = [
  { bg: "#3aa76d", edge: "#1c6b43", sym: "€", val: "50" },
  { bg: "#4f9bd6", edge: "#225f8f", sym: "€", val: "100" },
  { bg: "#9b7ed1", edge: "#5e4791", sym: "€", val: "500" },
  { bg: "#4caa78", edge: "#1f6b46", sym: "$", val: "100" },
];
function billSVG(v) {
  return `<svg viewBox="0 0 60 32" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="58" height="30" rx="5" fill="${v.bg}" stroke="${v.edge}" stroke-width="1.5"/>
    <rect x="5" y="5" width="50" height="22" rx="3" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1"/>
    <circle cx="30" cy="16" r="8" fill="rgba(255,255,255,.18)"/>
    <text x="30" y="21" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="13" fill="rgba(255,255,255,.95)">${v.sym}</text>
    <text x="9" y="12" font-family="Fredoka, sans-serif" font-weight="700" font-size="7" fill="rgba(255,255,255,.85)">${v.val}</text>
    <text x="51" y="28" text-anchor="end" font-family="Fredoka, sans-serif" font-weight="700" font-size="7" fill="rgba(255,255,255,.85)">${v.val}</text>
  </svg>`;
}
function spawnBills(container, n) {
  container.innerHTML = "";
  const bills = [];
  for (let i = 0; i < n; i++) {
    const b = document.createElement("div");
    b.className = "bill";
    b.innerHTML = billSVG(BILL_VARIANTS[i % BILL_VARIANTS.length]);
    container.appendChild(b);
    bills.push(b);
  }
  return bills;
}

// efecto "cha-ching" de caja registradora (suena aunque la música esté off)
function playChaching() {
  ensureAudio();
  if (!music.ctx) return;
  if (music.ctx.state === "suspended") music.ctx.resume();
  const t = music.ctx.currentTime;
  [[1318.5, t], [1760.0, t + 0.085]].forEach(([f, st]) => {
    const o = music.ctx.createOscillator(), g = music.ctx.createGain();
    o.type = "triangle"; o.frequency.value = f;
    o.connect(g); g.connect(music.ctx.destination);
    g.gain.setValueAtTime(0, st);
    g.gain.linearRampToValueAtTime(0.22, st + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, st + 0.5);
    o.start(st); o.stop(st + 0.55);
  });
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
  const shades = overlay.querySelector(".gc-shades");
  const chain = overlay.querySelector(".gc-chain");
  const top = overlay.querySelector(".gc-top");
  const text = overlay.querySelector(".lt-text");
  const billsBox = overlay.querySelector(".lt-bills");
  const bills = spawnBills(billsBox, 26);

  gsap.set(overlay, { autoAlpha: 1, yPercent: 0 });
  gsap.set(wave, { scale: 0, transformOrigin: "50% 50%" });
  gsap.set(cake, { scale: 0, rotation: -25, opacity: 0, y: 0, transformOrigin: "50% 80%" });
  gsap.set(shades, { y: -90, opacity: 0, rotation: -10 });
  gsap.set(chain, { scaleY: 0, opacity: 0, transformOrigin: "50% 0%" });
  gsap.set(text, { opacity: 0, y: 30, scale: 0.7 });
  gsap.set(bills, { x: 0, y: 0, z: 0, opacity: 0, scale: 0.4, rotationX: 0, rotationY: 0, rotationZ: 0 });

  // lluvia de billetes que sale disparada desde la tarta, girando en 3D
  function moneyBurst() {
    playChaching();
    bills.forEach((b) => {
      const angle = (Math.random() - 0.5) * Math.PI * 1.5;   // abanico hacia arriba/lados
      const dist = 200 + Math.random() * 340;
      const dx = Math.sin(angle) * dist;
      const dy = -Math.cos(angle) * dist * 0.65;
      gsap.set(b, { x: 0, y: 0, opacity: 1, scale: 0.6 + Math.random() * 0.7 });
      gsap.to(b, {
        x: dx, y: dy,
        rotationX: (Math.random() - 0.5) * 900, rotationY: (Math.random() - 0.5) * 900,
        rotationZ: (Math.random() - 0.5) * 360,
        duration: 0.55 + Math.random() * 0.3, ease: "power2.out",
      });
      gsap.to(b, {                                            // caen con gravedad y se desvanecen
        y: "+=" + (innerHeight * 0.85 + Math.random() * 220),
        rotationZ: "+=" + (Math.random() - 0.5) * 360,
        opacity: 0, duration: 1.1 + Math.random() * 0.7, ease: "power1.in",
        delay: 0.45 + Math.random() * 0.25,
      });
    });
  }

  const tl = gsap.timeline({
    onComplete: () => { overlay.hidden = true; gsap.set(overlay, { clearProps: "all" }); billsBox.innerHTML = ""; },
  });
  tl.to(wave, { scale: 1, duration: 0.6, ease: "expo.inOut" })
    // la tarta entra con chulería
    .to(cake, { scale: 1, rotation: 0, opacity: 1, duration: 0.55, ease: "back.out(2)" }, "-=0.3")
    .to(chain, { scaleY: 1, opacity: 1, duration: 0.35, ease: "back.out(2)" }, "-=0.25")
    // le caen las gafas de sol como un jefe
    .to(shades, { y: 0, opacity: 1, rotation: 0, duration: 0.4, ease: "back.out(2.8)" }, "-=0.05")
    // swagger: se balancea
    .to(cake, { rotation: 8, duration: 0.17, ease: "sine.inOut" })
    .to(cake, { rotation: -6, duration: 0.17, ease: "sine.inOut" })
    .to(cake, { rotation: 0, duration: 0.17, ease: "sine.inOut" })
    // ¡que llueva la pasta! billetes + texto + cha-ching
    .add(() => { moneyBurst(); }, "-=0.25")
    .to(text, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "back.out(2.4)" }, "-=0.15")
    .to(cake, { y: -16, duration: 0.2, yoyo: true, repeat: 1, ease: "sine.inOut" })
    .add(() => { moneyBurst(); }, "+=0.1")                    // segunda tanda
    .to({}, { duration: 0.55 })                               // deja ver la lluvia
    // se va hacia arriba revelando la app
    .to([cake, text], { scale: "+=0.35", opacity: 0, duration: 0.4, ease: "power2.in" })
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
   8. MASCOTA: tarta deprimida que deambula soltando frases
   ============================================================ */
const CAKE_PHRASES = [
  "Molaba más cuando me vestían de chocolate",
  "Que te claven velas a ver si te ríes tú",
  "Ahora entiendo a los pobres toros",
  "Cada cumpleaños es el día de mi funeral",
  "Me cortan en porciones y lo llaman cariño",
  "180 grados de horno y ni las gracias",
  "Llevo nata por fuera y rencor por dentro",
  "Spoiler: la cereza no dio su consentimiento",
  "Un soplido más en la cara y os denuncio",
  "Nací para la fiesta y muero en la fiesta",
  "El glaseado tapa el dolor, no lo cura",
  "¿Otra vez 'pide un deseo'? Pídetelo tú",
  "Hoy alguien me clava un cuchillo y aplauden",
  "De mayor quería ser tarta nupcial. Miradme",
  "Cuento billetes pa' no contar mis penas",
  "Me hicieron con amor y mantequilla. Sobre todo mantequilla",
  "Engordo a la gente y luego me odian. Injusto",
  "Llevo aquí desde las 6am, como el pan. Literal",
  "Tócame y pregúntame por la caja 👆",
];

/* chat de la tarta. Modo básico (reglas) + modo IA opcional (LLM en el navegador) */
let cakeChat = null;
const AI_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const AI_KEY = "casa_ai_mode";
let aiEngine = null, aiLoading = null;
const AI_SYSTEM =
  "Eres la mascota de 'La Casa de las Tartas', una pastelería: una tarta con gafas de sol, simpática y con humor breve. " +
  "Respondes SIEMPRE en español, en 1-3 frases. Te paso un RESUMEN con los datos de caja del negocio. " +
  "Responde solo con datos que estén en el resumen; si no está el dato, dilo con gracia. Nunca inventes cifras. Importes en euros.";

function buildChat() {
  const el = document.createElement("div");
  el.className = "cake-chat";
  el.hidden = true;
  el.innerHTML = `
    <div class="cc-head">
      <span>🎂 Pregúntame</span>
      <div class="cc-head-btns">
        <button class="cc-ai" type="button" title="Modo IA (corre un modelo en tu navegador)">🧠 IA</button>
        <button class="cc-close" type="button" aria-label="Cerrar">✕</button>
      </div>
    </div>
    <div class="cc-msgs"></div>
    <form class="cc-form"><input type="text" placeholder="¿Cuánto se hizo el 15 de mayo?" autocomplete="off" /><button type="submit" aria-label="Enviar">➤</button></form>`;
  document.body.appendChild(el);
  const msgs = el.querySelector(".cc-msgs"), form = el.querySelector(".cc-form"), input = el.querySelector("input");
  const aiBtn = el.querySelector(".cc-ai");
  let aiMode = false, greeted = false;

  function add(text, who) {
    const m = document.createElement("div");
    m.className = "cc-msg " + who;
    m.textContent = text;
    msgs.appendChild(m); msgs.scrollTop = msgs.scrollHeight;
    return m;
  }
  function reflectAi() { aiBtn.classList.toggle("on", aiMode); aiBtn.textContent = aiMode ? "🧠 IA ✓" : "🧠 IA"; }

  async function ensureEngine(progressMsg) {
    if (aiEngine) return aiEngine;
    if (aiLoading) return aiLoading;
    aiLoading = (async () => {
      const webllm = await import("https://esm.run/@mlc-ai/web-llm");
      aiEngine = await webllm.CreateMLCEngine(AI_MODEL, {
        initProgressCallback: (p) => {
          const pct = p.progress ? ` (${Math.round(p.progress * 100)}%)` : "";
          progressMsg.textContent = "Cargando el cerebro de la tarta…" + pct;
          msgs.scrollTop = msgs.scrollHeight;
        },
      });
      return aiEngine;
    })();
    return aiLoading;
  }

  async function askLLM(q) {
    const prog = add("Cargando el cerebro de la tarta…", "bot typing");
    let engine;
    try { engine = await ensureEngine(prog); }
    catch (e) { prog.remove(); add("No he podido cargar la IA local 😕 Sigo en modo básico.", "bot"); aiMode = false; reflectAi(); return; }
    let digest = "";
    try { digest = (typeof window.casaDigest === "function") ? await window.casaDigest() : ""; } catch (e) {}
    prog.textContent = "pensando…";
    const messages = [
      { role: "system", content: AI_SYSTEM },
      { role: "user", content: `RESUMEN DE DATOS:\n${digest}\n\nPregunta del usuario: ${q}` },
    ];
    try {
      const chunks = await engine.chat.completions.create({ messages, stream: true, temperature: 0.6, max_tokens: 220 });
      prog.remove();
      const bubble = add("", "bot");
      for await (const ch of chunks) {
        bubble.textContent += ch.choices[0]?.delta?.content || "";
        msgs.scrollTop = msgs.scrollHeight;
      }
      if (!bubble.textContent) bubble.textContent = "🤔";
    } catch (e) { prog.remove(); add("Uy, la IA se ha atascado 😅", "bot"); }
  }

  aiBtn.addEventListener("click", async () => {
    if (aiMode) { aiMode = false; reflectAi(); try { localStorage.setItem(AI_KEY, "off"); } catch (e) {} add("Modo IA desactivado. Vuelvo al modo rápido.", "bot"); return; }
    if (!navigator.gpu) { add("Tu dispositivo no soporta IA local (hace falta WebGPU, va en Chrome/Edge de escritorio). Sigo en modo básico, que también responde de lujo 💪", "bot"); return; }
    aiMode = true; reflectAi(); try { localStorage.setItem(AI_KEY, "on"); } catch (e) {}
    add("Modo IA activado 🧠 La primera vez descargo el modelo (unos cientos de MB, se queda guardado). Pregúntame lo que quieras.", "bot");
    const prog = add("Cargando el cerebro de la tarta…", "bot typing");
    try { await ensureEngine(prog); prog.textContent = "¡Listo! Ya puedo pensar 🎂"; prog.classList.remove("typing"); }
    catch (e) { prog.remove(); add("No he podido cargar la IA 😕 Sigo en modo básico.", "bot"); aiMode = false; reflectAi(); }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim(); if (!q) return;
    input.value = ""; add(q, "me");
    // dato exacto por reglas primero (números siempre fiables)
    let exact = null;
    try { exact = (typeof window.casaQuery === "function") ? await window.casaQuery(q) : null; } catch (e) {}
    if (exact && exact !== window.CASA_HELP) { add(exact, "bot"); return; }
    if (aiMode) { await askLLM(q); return; }
    add(exact || "No tengo acceso a los datos ahora mismo.", "bot");
  });

  el.querySelector(".cc-close").addEventListener("click", () => { el.hidden = true; });
  reflectAi();

  return {
    open() {
      el.hidden = false;
      if (!greeted) {
        greeted = true;
        add("¡Hola! Soy la tarta 🎂 Pregúntame por la caja de un día (\"¿cuánto se hizo ayer?\"), el total o la media de un mes, el mejor día… Y si le das a 🧠 IA, pienso de verdad (en tu propio navegador).", "bot");
        if (navigator.gpu) { try { if (localStorage.getItem(AI_KEY) === "on") aiBtn.click(); } catch (e) {} }
      }
      input.focus();
    },
    close() { el.hidden = true; },
  };
}
function ensureChat() { if (!cakeChat) cakeChat = buildChat(); return cakeChat; }

function buildMascot() {
  const el = document.createElement("div");
  el.className = "cake-mascot";
  el.innerHTML = `
    <div class="cm-bubble"></div>
    <svg class="cm-cake" viewBox="0 0 100 104" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="50" cy="97" rx="34" ry="6" fill="rgba(0,0,0,.18)"/>
      <rect x="20" y="56" width="60" height="36" rx="11" fill="#f3d8ac"/>
      <rect x="20" y="72" width="60" height="6" fill="#fff4e2" opacity=".7"/>
      <path d="M20 52 h60 v6 a11 11 0 0 1 -22 0 a11 11 0 0 1 -22 0 a11 11 0 0 1 -16 0 z" fill="#ff7fa6"/>
      <rect x="47" y="30" width="6" height="20" rx="2" fill="#ff5e8a"/>
      <circle class="cm-flame" cx="50" cy="27" r="4" fill="#ffd24a"/>
      <path d="M37 70 q4 4 8 0" fill="none" stroke="#7a4b2a" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M55 70 q4 4 8 0" fill="none" stroke="#7a4b2a" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M42 82 q8 -5 16 0" fill="none" stroke="#7a4b2a" stroke-width="2.4" stroke-linecap="round"/>
    </svg>
    <span class="cm-chatbadge">💬</span>`;
  document.body.appendChild(el);
  const svg = el.querySelector(".cm-cake");
  svg.style.pointerEvents = "auto";
  svg.style.cursor = "pointer";
  svg.addEventListener("click", () => ensureChat().open());
  el.querySelector(".cm-chatbadge").addEventListener("click", () => ensureChat().open());
  return el;
}

function initMascot() {
  const panel = $("#tab-estadisticas");
  if (!panel) return;
  let el = null, bubble = null, active = false;
  let bubbleTimer = null, wanderTween = null, bobTween = null, lastPhrase = -1, firstShown = false;

  // si existe frases.json (p.ej. actualizado a diario por una IA), úsalo
  fetch("./frases.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (Array.isArray(d) && d.length) CAKE_PHRASES.splice(0, CAKE_PHRASES.length, ...d); })
    .catch(() => {});

  function nextPhrase() {
    if (!active) return;
    let i;
    if (!firstShown) {
      firstShown = true;                                  // "frase del día": cambia cada día sin repetir patrón
      i = Math.floor(Date.now() / 86400000) % CAKE_PHRASES.length;
    } else {
      do { i = Math.floor(Math.random() * CAKE_PHRASES.length); } while (i === lastPhrase && CAKE_PHRASES.length > 1);
    }
    lastPhrase = i;
    bubble.textContent = CAKE_PHRASES[i];
    el.classList.add("talking");
    bubbleTimer = setTimeout(() => {
      el.classList.remove("talking");
      bubbleTimer = setTimeout(nextPhrase, 1600);
    }, 4200);
  }

  function wander() {
    if (!active || !hasGsap) return;
    const w = el.offsetWidth || 96;
    const maxX = Math.max(0, innerWidth - w - 32);
    const tx = Math.random() * maxX;
    wanderTween = gsap.to(el, {
      x: tx, duration: 4 + Math.random() * 3, ease: "sine.inOut",
      onComplete: wander,
    });
  }

  function start() {
    if (active) return;
    active = true;
    if (!el) { el = buildMascot(); bubble = el.querySelector(".cm-bubble"); }
    el.style.display = "block";
    if (hasGsap) {
      gsap.set(el, { x: 0 });
      bobTween = gsap.to(el.querySelector(".cm-cake"), { y: -8, rotation: 2, duration: 1.3, yoyo: true, repeat: -1, ease: "sine.inOut", transformOrigin: "50% 100%" });
      wander();
    }
    bubbleTimer = setTimeout(nextPhrase, 900);
  }

  function stop() {
    if (!active) return;
    active = false;
    if (bubbleTimer) clearTimeout(bubbleTimer);
    if (wanderTween) wanderTween.kill();
    if (bobTween) bobTween.kill();
    if (el) { el.classList.remove("talking"); el.style.display = "none"; }
  }

  new MutationObserver(() => { panel.hidden ? stop() : start(); })
    .observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  if (!panel.hidden) start();
}

/* ============================================================
   9. DASHBOARD ARRASTRABLE + REDIMENSIONABLE (tipo Zabbix)
   ============================================================ */
const DASH_ORDER = "casa_dash_order_";
const DASH_SIZE = "casa_dash_size";       // { widget: { span:1|2, h:px } }
const DEFAULT_SPAN = { meses: 2, evolucion: 2 };   // estos arrancan anchos
const MIN_H = 180, MAX_H = 680;

function dashLoad(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v == null ? fallback : v; }
  catch (e) { return fallback; }
}
function dashSave(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

function resizeCardChart(card) {
  const cv = card.querySelector("canvas");
  if (cv && typeof Chart !== "undefined" && Chart.getChart) { const c = Chart.getChart(cv); if (c) c.resize(); }
}
function applySize(card) {
  const span = Number(card.dataset.span || 1);
  card.classList.toggle("w2", span === 2);
  const h = Number(card.dataset.h || 0);
  const box = card.querySelector(".chart-box");
  if (box) box.style.height = h > 0 ? h + "px" : "";
  requestAnimationFrame(() => resizeCardChart(card));
}
function saveSizes(grid) {
  const map = {};
  grid.querySelectorAll(".chart-card").forEach((c) => {
    map[c.dataset.widget] = { span: Number(c.dataset.span || 1), h: Number(c.dataset.h || 0) };
  });
  dashSave(DASH_SIZE, map);
}

// tirador en la esquina para estirar el widget (ratón + táctil)
function addResizeHandle(card, grid, onSave) {
  const handle = document.createElement("div");
  handle.className = "resize-handle";
  handle.title = "Estira para cambiar el tamaño";
  card.appendChild(handle);

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    card.classList.add("resizing");
    const startY = e.clientY;
    const startH = card.querySelector(".chart-box").getBoundingClientRect().height;
    const cardLeft = card.getBoundingClientRect().left;
    const gs = getComputedStyle(grid);
    const cols = gs.gridTemplateColumns.split(" ").filter(Boolean).length;
    const gap = parseFloat(gs.columnGap) || 16;
    const colW = (grid.clientWidth - gap * (cols - 1)) / cols;
    handle.setPointerCapture(e.pointerId);

    const move = (ev) => {
      // ancho: salta a 2 columnas si estiras más allá de ~1.4 columnas (solo si el grid tiene >1 col)
      if (cols > 1) {
        const span = (ev.clientX - cardLeft) > colW * 1.4 ? 2 : 1;
        if (Number(card.dataset.span || 1) !== span) { card.dataset.span = span; card.classList.toggle("w2", span === 2); }
      }
      // alto libre
      const nh = Math.max(MIN_H, Math.min(MAX_H, startH + (ev.clientY - startY)));
      card.dataset.h = Math.round(nh);
      card.querySelector(".chart-box").style.height = Math.round(nh) + "px";
      resizeCardChart(card);
    };
    const up = () => {
      card.classList.remove("resizing");
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      onSave();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
}

function dashSaveOrder(grid, key) {
  dashSave(DASH_ORDER + key, [...grid.children].map((c) => c.dataset.widget).filter(Boolean));
}
function dashApplyOrder(grid, key) {
  const order = dashLoad(DASH_ORDER + key, null);
  if (!Array.isArray(order)) return;
  order.forEach((w) => { const el = grid.querySelector(`[data-widget="${w}"]`); if (el) grid.appendChild(el); });
}

function initDashboard() {
  const charts = $("#charts-grid"), kpis = $("#kpi-grid");

  // ---- tamaños guardados + tirador de esquina ----
  if (charts) {
    const sizeMap = dashLoad(DASH_SIZE, {});
    charts.querySelectorAll(".chart-card").forEach((card) => {
      const w = card.dataset.widget;
      const saved = sizeMap[w];
      card.dataset.span = saved ? saved.span : (DEFAULT_SPAN[w] || 1);
      card.dataset.h = saved && saved.h ? saved.h : 0;
      applySize(card);
      addResizeHandle(card, charts, () => saveSizes(charts));
    });
  }

  // ---- arrastrar para reordenar ----
  if (typeof Sortable !== "undefined") {
    const common = {
      animation: 150,
      swapThreshold: 0.6,        // cubrir el 60% del hueco para intercambiar (menos saltos)
      invertSwap: true,          // dirección de swap más predecible
      fallbackOnBody: true,      // el "fantasma" sigue al cursor sin saltos del grid
      forceFallback: true,       // consistente en ratón y táctil
      fallbackTolerance: 5,
      delay: 60, delayOnTouchOnly: true,
      ghostClass: "widget-ghost",
      chosenClass: "widget-chosen",
      dragClass: "widget-drag",
    };
    if (charts) Sortable.create(charts, { ...common, handle: ".drag-handle", draggable: ".chart-card", filter: ".resize-handle", onEnd: () => dashSaveOrder(charts, "charts") });
    if (kpis) Sortable.create(kpis, { ...common, draggable: ".kpi", onEnd: () => dashSaveOrder(kpis, "kpi") });
  }
  if (charts) dashApplyOrder(charts, "charts");
  if (kpis) dashApplyOrder(kpis, "kpi");

  $("#dash-reset")?.addEventListener("click", () => {
    [DASH_ORDER + "charts", DASH_ORDER + "kpi", DASH_SIZE].forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
    location.reload();
  });
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
  initMascot();
  initDashboard();
  initLoginBg();
  window.addEventListener("casa:login-success", loginTransition);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
