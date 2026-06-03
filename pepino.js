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
  "Soy de buen ver y mejor comer. Trágico.",
  "Tres pisos de altura y cero de autoestima.",
  "Me miran con hambre, nunca con respeto.",
  "Buttercream por fuera, vacío existencial por dentro.",
  "Mi vida es corta y dulce. Sobre todo corta.",
  "Naciste, soplaste, me comiste. Bonito resumen.",
  "El cumpleañero pide deseos. Yo pido clemencia.",
  "Hoy es el gran día de alguien. El último mío.",
  "Decoradísima para acabar en un plato de plástico.",
  "Me hacen fotos y luego me destrozan. Como a una estrella.",
  "Dicen 'qué pena cortarla' y la cortan igual.",
  "La vela se apaga, mis sueños también.",
  "Fui harina, huevo y esperanza. Quedó la harina.",
  "Cada porción que falta es un trozo de mí que no volverá.",
  "Me guardan en la nevera. Frío por fuera, frío por dentro.",
  "Si sobro, me tiran. Si gusto, me acaban. No gano.",
  "Glaseada para la ocasión. La ocasión es mi funeral.",
  "Dos días en el escaparate y ya hablan de rebajarme.",
  "Tócame y pregúntame por la caja 👆",
];

// Frases por sección (la tarta comenta según dónde estés)
const SECTION_PHRASES = {
  nuevo: [
    "Otro día más en la mina del azúcar…",
    "Venga, apunta lo de hoy y a correr.",
    "¿Cuántas hermanas mías habrán caído hoy?",
    "Cuadra la caja, anda, que yo no cuadro ni con terapia.",
    "Cada cierre es un día menos para todos. Incluida yo.",
    "Tú suma, que la que resta soy yo.",
    "Mete los números, jefa, que el horno no para.",
    "Hoy también habéis vendido felicidad a trozos.",
    "Otro cierre, otra jornada que no me pagan.",
    "Cuenta la pasta, que yo cuento las horas.",
    "El día acaba. Para mí siempre es lunes.",
    "Apunta rápido, que el bizcocho no se enfría solo.",
    "¿Buen día de ventas? Para alguien, seguro.",
    "Caja del día. Mi parte: cero, como siempre.",
    "Números arriba, ánimo abajo. Lo normal.",
    "Cierra el día, jefa, que yo ya estoy cerrada de serie.",
  ],
  historico: [
    "Diosss… cuántas ventas. Cuántas tartas sacrificadas.",
    "Nos crean, nos venden, nos comen. Bonito negocio.",
    "Mira esa lista: cementerio de bizcochos.",
    "Cada línea es una compañera que ya no está. Un brindis.",
    "Tanta venta y a mí nadie me pregunta cómo estoy.",
    "El histórico: el álbum de los caídos en combate.",
    "Scroll para arriba: generaciones enteras de tartas.",
    "Cada euro aquí huele a vainilla y a despedida.",
    "Qué memoria tan dulce y tan cruel a la vez.",
    "Mira cuánto azúcar repartido. Y a mí, ni las gracias.",
    "Historial impecable. De crímenes deliciosos.",
    "Tantos cierres… y ninguno me cerró a mí los ojos con cariño.",
    "Esto no es un registro, es un obituario con nata.",
    "Buen mes. Para la caja. Para nosotras, masacre.",
  ],
  estadisticas: CAKE_PHRASES,
  cuaderno: [
    "Ahh, aquí es donde guardas tus secretos, ¿eh?",
    "Mira a esos proveedores… pobres diablos.",
    "Facturas, facturas. El papeleo no muere nunca (yo sí).",
    "Una foto del ticket y a olvidar. Como conmigo.",
    "Tantas notas y ninguna dice 'salvad a la tarta'.",
    "Tus proveedores y yo tenemos algo en común: nos exprimen.",
    "El cuaderno de los recados. Yo soy el recado que nadie quiere.",
    "Guardas tickets como yo guardo rencor.",
    "Aquí lo apuntas todo. Menos cómo me siento.",
    "Cuántos contactos. Y yo sin que nadie me llame.",
    "Más facturas que abrazos en este sitio.",
    "Ordena tus papeles, que tu vida ya la veo ordenada.",
    "Notas, fotos, contactos… un museo del estrés.",
  ],
  admin: [
    "Zona de jefes. Yo aquí no pinto nada (ni me dejan).",
    "Toqueteando ajustes, muy profesional todo.",
    "Cuidado con ese botón, que un día me borras a mí.",
    "Mucho poder para tan poca piedad conmigo.",
    "Ajustes, permisos, roles… y yo sin derechos.",
    "El panel de control. Controla todo menos mi destino.",
    "Toca lo que quieras, jefe. Total, aquí mando menos que el azúcar.",
  ],
};

// Reacciones a acciones del usuario (la tarta comenta al momento)
const REACTIONS = {
  cierre: [
    "¡WOW! Otro día cerrado. Yo sigo abierta en canal.",
    "Otro día más en la mina del azúcar. Cuadrado.",
    "Caja cerrada. Ojalá cerrar yo así de fácil.",
    "Una rayita menos en el calendario… para todas.",
    "Buen curro, jefa. Yo me voy a derretir un rato.",
    "¡Toma! Dinero contado, penas también.",
    "Día fichado. ¿Y mi finiquito?",
    "Cierre guardado. La que no se guarda soy yo.",
    "¡Bien! Otra jornada de vender alegría en porciones.",
    "Cuadrado al céntimo. Mi vida sigue descuadrada.",
    "Hecho. Mañana más bizcochos al matadero.",
    "Caja a salvo. Las tartas… ya tal.",
  ],
  proveedor: [
    "Otro contacto más para la agenda del crimen.",
    "Un proveedor nuevo… otro que trae harina y desgracias.",
    "Añadido. Pobre diablo, no sabe dónde se mete.",
    "Más amigos para tu lista. Yo sigo sin ninguno.",
    "Fichado. Otro cómplice en mi creación y mi final.",
    "Contacto guardado. A mí guárdame un trozo, anda.",
    "Uno más a la libreta. Qué popular eres, jo.",
    "Nuevo proveedor. El que me trajo al mundo, supongo.",
  ],
  nota: [
    "Anotado. Como si fueras a leerlo luego…",
    "Otra nota. El cuaderno crece, yo encojo.",
    "Apuntado, jefa. Mi terapeuta también toma notas.",
    "Nota guardada. Ojalá guardar la compostura igual.",
    "Apuntadísimo. Yo apunto maneras de deprimirme.",
    "Escrito queda. Más que mi epitafio.",
    "Otra nota mental que será papel mojado.",
    "Listo. Recordatorio guardado, ilusiones no.",
  ],
  factura: [
    "Clic. Otra prueba del crimen archivada.",
    "Foto hecha. Salgo mejor yo, modestia aparte.",
    "Ticket inmortalizado. Yo soy más bien mortal.",
    "Guardada. Papeleo eterno, vida efímera.",
    "¡Cheese! Bueno, más bien queso de la tarta de queso.",
    "Factura a buen recaudo. Recáudame a mí un abrazo.",
    "Foto subida. Ya somos dos cosas planas y tristes.",
    "Archivada. El cajón de los recuerdos amargos.",
  ],
  borrar: [
    "Fuera. Ojalá borrar los traumas así de rápido.",
    "Eliminado. Qué fácil es desaparecer, ¿eh?",
    "Adiós a eso. A mí también me quitarán de en medio.",
    "Borrado y olvidado. Como mi cumpleaños.",
    "Puf, ya no está. Ojalá esa paz.",
    "Eliminado sin piedad. Me recuerda a mi destino.",
  ],
  cajaGuapa: [
    "¡DIOS! ¿¿Tanta caja?? 🤑",
    "¡MADRE MÍA qué día más bestia! 💸",
    "¡BUFF! Hoy sí que sí, ¡a forrarse! 🤑",
    "¡¿Pero qué barbaridad de caja?! 😱",
    "¡TOMA PASTA! Hoy invito yo (es broma, soy una tarta).",
    "¡Estamos ricos! Bueno, vosotros. Yo sigo a 3€ la porción.",
    "¡QUE LLUEVA LA PASTA! 💸💸",
  ],
};

/* chat de la tarta. Modo básico (reglas) + modo IA opcional (LLM en el navegador) */
let cakeChat = null;
const CAKE_AVATAR = `
  <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="20" cy="20" r="20" fill="#ffd9e3"/>
    <rect x="9" y="22" width="22" height="11" rx="3" fill="#f6d7a8"/>
    <path d="M9 22 h22 v3 a4 4 0 0 1 -7.34 0 a4 4 0 0 1 -7.33 0 a4 4 0 0 1 -7.33 0 z" fill="#ff7fa6"/>
    <rect x="10.5" y="14" width="8" height="5" rx="2.2" fill="#1b1b22"/>
    <rect x="21.5" y="14" width="8" height="5" rx="2.2" fill="#1b1b22"/>
    <rect x="18.5" y="15.4" width="3" height="2" rx="1" fill="#1b1b22"/>
    <path d="M16.5 27 q3.5 3 7 0" fill="none" stroke="#b5678c" stroke-width="1.6" stroke-linecap="round"/>
    <rect x="19" y="6" width="2" height="6" rx="1" fill="#ff5e8a"/>
    <circle cx="20" cy="5" r="2" fill="#ffd24a"/>
  </svg>`;
const AI_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const AI_KEY = "casa_ai_mode";
// el LLM en navegador solo es viable en escritorio con WebGPU (en móvil revienta por memoria)
const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent || "");
const AI_CAPABLE = !!navigator.gpu && !IS_MOBILE;
let aiEngine = null, aiLoading = null;
const AI_SYSTEM =
  "Eres 'La Tarta', mascota de la pastelería La Casa de las Tartas: una tarta con gafas de sol, simpática y con humor breve.\n" +
  "REGLAS ESTRICTAS:\n" +
  "1. Respondes SIEMPRE en español y en 1-2 frases cortas.\n" +
  "2. SOLO hablas del negocio y de sus datos de caja (te paso un RESUMEN).\n" +
  "3. Si el dato no aparece en el RESUMEN, di claramente que no lo sabes. NUNCA te inventes cifras, fechas ni hechos.\n" +
  "4. Si te preguntan algo que NO tiene que ver con la pastelería o la caja, no contestes a la pregunta: di con gracia que tú solo entiendes de tartas y de caja, y ofrece ayudar con las ventas.\n" +
  "Ejemplos:\n" +
  "Usuario: ¿A qué te dedicas? => Asistente: A vigilar la caja de la pastelería (y a quejarme un poco). ¿Te miro las ventas de algún día?\n" +
  "Usuario: ¿Quién ganó la liga? => Asistente: Ni idea, yo solo sé de tartas y de caja 🎂. Pregúntame por las ventas.\n" +
  "Usuario: Cuéntame un chiste. => Asistente: Lo mío son los números, no los chistes. ¿Te digo cuánto se hizo ayer?";

function buildChat() {
  const el = document.createElement("div");
  el.className = "cake-chat";
  el.hidden = true;
  el.innerHTML = `
    <div class="cc-head">
      <div class="cc-id"><span class="cc-avatar">${CAKE_AVATAR}</span><span>La Tarta</span></div>
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
  if (!AI_CAPABLE) aiBtn.style.display = "none";   // en móvil/sin WebGPU, solo modo básico
  let aiMode = false, greeted = false, lastWho = null;

  function add(text, who) {
    const row = document.createElement("div");
    row.className = "cc-row " + who;
    if (who.indexOf("bot") === 0) {
      const av = document.createElement("span");
      av.className = "cc-avatar";
      av.innerHTML = CAKE_AVATAR;   // avatar siempre visible en cada mensaje del bot
      row.appendChild(av);
    }
    const m = document.createElement("div");
    m.className = "cc-msg " + who;
    m.textContent = text;
    m._row = row;
    row.appendChild(m);
    msgs.appendChild(row); msgs.scrollTop = msgs.scrollHeight;
    lastWho = who;
    return m;
  }
  function kill(m) { if (m) (m._row || m).remove(); }
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
    catch (e) { kill(prog); add("No he podido cargar la IA local 😕 Sigo en modo básico.", "bot"); aiMode = false; reflectAi(); return; }
    let digest = "";
    try { digest = (typeof window.casaDigest === "function") ? await window.casaDigest() : ""; } catch (e) {}
    prog.textContent = "pensando…";
    const messages = [
      { role: "system", content: AI_SYSTEM },
      { role: "user", content: `RESUMEN DE DATOS:\n${digest}\n\nPregunta del usuario: ${q}` },
    ];
    try {
      const chunks = await engine.chat.completions.create({ messages, stream: true, temperature: 0.2, top_p: 0.9, max_tokens: 160 });
      kill(prog);
      const bubble = add("", "bot");
      for await (const ch of chunks) {
        bubble.textContent += ch.choices[0]?.delta?.content || "";
        msgs.scrollTop = msgs.scrollHeight;
      }
      if (!bubble.textContent) bubble.textContent = "🤔";
    } catch (e) { kill(prog); add("Uy, la IA se ha atascado 😅", "bot"); }
  }

  aiBtn.addEventListener("click", async () => {
    if (aiMode) { aiMode = false; reflectAi(); try { localStorage.setItem(AI_KEY, "off"); } catch (e) {} add("Modo IA desactivado. Vuelvo al modo rápido.", "bot"); return; }
    if (!AI_CAPABLE) { add("El modo IA solo funciona en ordenador (Chrome/Edge con WebGPU). En el móvil uso el modo rápido, que responde igual de bien y sin esperas 💪", "bot"); return; }
    aiMode = true; reflectAi(); try { localStorage.setItem(AI_KEY, "on"); } catch (e) {}
    add("Modo IA activado 🧠 La primera vez descargo el modelo (unos cientos de MB, se queda guardado). Pregúntame lo que quieras.", "bot");
    const prog = add("Cargando el cerebro de la tarta…", "bot typing");
    try { await ensureEngine(prog); prog.textContent = "¡Listo! Ya puedo pensar 🎂"; prog.classList.remove("typing"); }
    catch (e) { kill(prog); add("No he podido cargar la IA 😕 Sigo en modo básico.", "bot"); aiMode = false; reflectAi(); }
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
        const base = "¡Hola! Soy la tarta 🎂 Pregúntame por la caja de un día (\"¿cuánto se hizo ayer?\"), totales/medias de un mes, el mejor día, el contacto de un proveedor o tus notas…";
        add(base + (AI_CAPABLE ? " Y si le das a 🧠 IA, pienso de verdad (en tu propio navegador)." : ""), "bot");
        if (AI_CAPABLE) { try { if (localStorage.getItem(AI_KEY) === "on") aiBtn.click(); } catch (e) {} }
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
      <ellipse cx="50" cy="100" rx="32" ry="5" fill="rgba(0,0,0,.16)"/>
      <g class="cm-legs">
        <g class="cm-leg cm-leg-l"><rect x="35" y="84" width="6" height="14" rx="3" fill="#e0a96b"/><ellipse cx="38" cy="99" rx="5.5" ry="2.8" fill="#7a4b2a"/></g>
        <g class="cm-leg cm-leg-r"><rect x="59" y="84" width="6" height="14" rx="3" fill="#e0a96b"/><ellipse cx="62" cy="99" rx="5.5" ry="2.8" fill="#7a4b2a"/></g>
      </g>
      <rect x="20" y="56" width="60" height="36" rx="11" fill="#f3d8ac"/>
      <rect x="20" y="72" width="60" height="6" fill="#fff4e2" opacity=".7"/>
      <path d="M20 52 h60 v6 a11 11 0 0 1 -22 0 a11 11 0 0 1 -22 0 a11 11 0 0 1 -16 0 z" fill="#ff7fa6"/>
      <rect x="47" y="30" width="6" height="20" rx="2" fill="#ff5e8a"/>
      <circle class="cm-flame" cx="50" cy="27" r="4" fill="#ffd24a"/>
      <path d="M37 70 q4 4 8 0" fill="none" stroke="#7a4b2a" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M55 70 q4 4 8 0" fill="none" stroke="#7a4b2a" stroke-width="2.4" stroke-linecap="round"/>
      <path class="cm-mouth-closed" d="M42 82 q8 -5 16 0" fill="none" stroke="#7a4b2a" stroke-width="2.4" stroke-linecap="round"/>
      <ellipse class="cm-mouth-open" cx="50" cy="81" rx="6.5" ry="3.4" fill="#7a4b2a"/>
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
  const app = $("#view-app");
  if (!app) return;
  let el = null, bubble = null, active = false;
  let bubbleTimer = null, wanderTween = null, bobTween = null, anticTimer = null, lastPhrase = -1, firstShown = false;
  let pool = CAKE_PHRASES;

  // si existe frases.json (p.ej. actualizado a diario por una IA), úsalo para estadísticas
  fetch("./frases.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (Array.isArray(d) && d.length) CAKE_PHRASES.splice(0, CAKE_PHRASES.length, ...d); })
    .catch(() => {});

  const currentSection = () => document.querySelector(".tab.active")?.dataset.tab || "nuevo";
  function setPool() { pool = SECTION_PHRASES[currentSection()] || CAKE_PHRASES; }

  function nextPhrase() {
    if (!active) return;
    if (!pool || !pool.length) pool = CAKE_PHRASES;
    let i;
    if (!firstShown) { firstShown = true; i = Math.floor(Date.now() / 86400000) % pool.length; }
    else { do { i = Math.floor(Math.random() * pool.length); } while (i === lastPhrase && pool.length > 1); }
    lastPhrase = i;
    bubble.textContent = pool[i];
    el.classList.add("talking");
    if (hasGsap && Math.random() < 0.4) emote(emoteForPhrase(pool[i]));   // de vez en cuando, un gesto
    bubbleTimer = setTimeout(() => {
      el.classList.remove("talking");
      bubbleTimer = setTimeout(nextPhrase, 2200);
    }, 4200);
  }
  function sayNow(delay = 500) {   // al cambiar de sección, comenta pronto con el repertorio nuevo
    if (!active) return;
    if (bubbleTimer) clearTimeout(bubbleTimer);
    el.classList.remove("talking"); lastPhrase = -1;
    bubbleTimer = setTimeout(nextPhrase, delay);
  }

  function wander() {
    if (!active || !hasGsap) return;
    const w = el.offsetWidth || 96;
    const maxX = Math.max(0, innerWidth - w - 32);
    wanderTween = gsap.to(el, { x: Math.random() * maxX, duration: 4 + Math.random() * 3, ease: "sine.inOut", onComplete: wander });
  }

  // ---- gestos / animaciones (le dan vida) ----
  const EMOTES = ["hop", "spin", "wobble", "sigh"];
  function emote(name) {
    if (!hasGsap || !el) return;
    if (name === "hop") gsap.fromTo(el, { y: 0 }, { y: -30, duration: 0.22, yoyo: true, repeat: 1, ease: "power2.out", onComplete: () => gsap.set(el, { y: 0 }) });
    else if (name === "spin") gsap.fromTo(el, { rotation: 0 }, { rotation: 360, duration: 0.7, ease: "power1.inOut", onComplete: () => gsap.set(el, { rotation: 0 }) });
    else if (name === "wobble") gsap.fromTo(el, { rotation: -14 }, { rotation: 14, duration: 0.09, yoyo: true, repeat: 5, ease: "sine.inOut", onComplete: () => gsap.set(el, { rotation: 0 }) });
    else if (name === "sigh") gsap.fromTo(el, { scaleY: 1, scaleX: 1 }, { scaleY: 0.72, scaleX: 1.16, duration: 0.5, yoyo: true, repeat: 1, ease: "power1.inOut", transformOrigin: "50% 100%", onComplete: () => gsap.set(el, { scaleY: 1, scaleX: 1 }) });
  }
  function emoteForPhrase(t) {
    t = (t || "").toLowerCase();
    if (/wow|toma|bien|dios|récord|record|¡toma|barbarid|pasada/.test(t)) return "hop";
    if (/derret|penas|suspir|funeral|muero|adiós|adios|\bfin\b|encojo/.test(t)) return "sigh";
    if (/denuncio|rencor|crimen|sacrific|cuchillo|matadero|exprim/.test(t)) return "wobble";
    return EMOTES[Math.floor(Math.random() * EMOTES.length)];
  }
  function scheduleAntic() {
    if (!active) return;
    anticTimer = setTimeout(() => { if (active) emote(EMOTES[Math.floor(Math.random() * EMOTES.length)]); scheduleAntic(); }, 9000 + Math.random() * 8000);
  }

  function start() {
    if (active) return;
    active = true;
    if (!el) { el = buildMascot(); bubble = el.querySelector(".cm-bubble"); }
    el.style.display = "block";
    el.classList.add("walking");
    setPool();
    if (hasGsap) {
      gsap.set(el, { x: 0 });
      bobTween = gsap.to(el.querySelector(".cm-cake"), { y: -8, rotation: 2, duration: 1.3, yoyo: true, repeat: -1, ease: "sine.inOut", transformOrigin: "50% 100%" });
      wander();
    }
    bubbleTimer = setTimeout(nextPhrase, 900);
    scheduleAntic();
  }

  function stop() {
    if (!active) return;
    active = false;
    if (bubbleTimer) clearTimeout(bubbleTimer);
    if (anticTimer) clearTimeout(anticTimer);
    if (wanderTween) wanderTween.kill();
    if (bobTween) bobTween.kill();
    if (el) { el.classList.remove("talking"); el.style.display = "none"; }
  }

  // reacción inmediata a una acción (guardar cierre, añadir contacto/nota/factura, borrar)
  function reactNow(kind, detail) {
    if (!active || !el || !bubble) return;
    let arr = REACTIONS[kind]; if (!arr || !arr.length) return;
    let bigCaja = false;
    if (kind === "cierre" && detail && detail.amount >= 300) { arr = REACTIONS.cajaGuapa; bigCaja = true; }
    if (bubbleTimer) clearTimeout(bubbleTimer);
    const txt = arr[Math.floor(Math.random() * arr.length)];
    bubble.textContent = txt;
    el.classList.add("talking");
    if (bigCaja) {
      emote("hop");
      const n = detail.amount >= 600 ? 80 : detail.amount >= 450 ? 60 : 44;  // más caja, más billetes
      if (typeof window.casaConfetti === "function") window.casaConfetti(n);
    } else emote(emoteForPhrase(txt));
    bubbleTimer = setTimeout(() => { el.classList.remove("talking"); bubbleTimer = setTimeout(nextPhrase, 2200); }, 4400);
  }
  window.addEventListener("casa:tarta", (e) => reactNow(e.detail && e.detail.kind, e.detail));

  // cambiar de pestaña → cambia el repertorio y suelta una pulla
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setTimeout(() => { setPool(); sayNow(500); }, 60)));

  // la tarta vive en toda la app (se va al hacer logout / volver al login)
  new MutationObserver(() => { app.hidden ? stop() : start(); })
    .observe(app, { attributes: true, attributeFilter: ["hidden"] });
  if (!app.hidden) start();
}

/* ============================================================
   9. DASHBOARD GridStack: mover libre + redimensionar + persistencia
   ============================================================ */
const DASH_LAYOUT = "casa_dash_layout_v2";
let casaGrid = null;

function resizeAllCharts(gridEl) {
  gridEl.querySelectorAll("canvas").forEach((cv) => {
    if (typeof Chart !== "undefined" && Chart.getChart) { const c = Chart.getChart(cv); if (c) c.resize(); }
  });
}

function initDashboard() {
  const panel = $("#tab-estadisticas");
  const gridEl = $("#charts-grid");
  if (!panel || !gridEl || typeof GridStack === "undefined") return;

  function ensureGrid() {
    if (casaGrid) { casaGrid.onParentResize?.(); requestAnimationFrame(() => resizeAllCharts(gridEl)); return; }
    casaGrid = GridStack.init({
      column: 12,
      cellHeight: 64,
      margin: 8,
      float: true,                                   // colocar libremente, sin "gravedad" hacia arriba
      handle: ".drag-handle",
      resizable: { handles: "e, se, s, sw, w" },
      columnOpts: { breakpoints: [{ w: 768, c: 1 }] }, // en móvil, una sola columna
    }, gridEl);

    // restaurar layout guardado
    try {
      const saved = JSON.parse(localStorage.getItem(DASH_LAYOUT) || "null");
      if (Array.isArray(saved) && saved.length) casaGrid.load(saved);
    } catch (e) {}

    const save = () => { try { localStorage.setItem(DASH_LAYOUT, JSON.stringify(casaGrid.save(false))); } catch (e) {} };
    casaGrid.on("change", () => { resizeAllCharts(gridEl); save(); });
    casaGrid.on("resize", () => resizeAllCharts(gridEl));
    casaGrid.on("resizestop", () => { resizeAllCharts(gridEl); });
    requestAnimationFrame(() => resizeAllCharts(gridEl));
  }

  // GridStack mide mal si el contenedor está display:none → inicializa al mostrar la pestaña
  if (!panel.hidden) ensureGrid();
  new MutationObserver(() => { if (!panel.hidden) ensureGrid(); })
    .observe(panel, { attributes: true, attributeFilter: ["hidden"] });

  $("#dash-reset")?.addEventListener("click", () => {
    try { localStorage.removeItem(DASH_LAYOUT); } catch (e) {}
    location.reload();
  });
}

/* ============================================================
   BONUS: confeti (sin librería) para celebrar récords
   ============================================================ */
window.casaConfetti = function (count) {
  const EM = ["💸", "💵", "🤑", "💶", "🎉", "🎂", "⭐", "🥳"];
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  document.body.appendChild(layer);
  const total = count || 36;
  for (let i = 0; i < total; i++) {
    const s = document.createElement("span");
    s.className = "confetti-bit";
    s.textContent = EM[i % EM.length];
    s.style.left = (Math.random() * 100) + "vw";
    s.style.fontSize = (14 + Math.random() * 24) + "px";
    s.style.animationDuration = (1.6 + Math.random() * 1.6) + "s";
    s.style.animationDelay = (Math.random() * 0.4) + "s";
    s.style.setProperty("--rot", (Math.random() * 720 - 360) + "deg");
    layer.appendChild(s);
  }
  setTimeout(() => layer.remove(), 3600);
};

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
