/* Eye tracker — from Bencho (bencho.dev), MIT licence: bencho.dev/licence.
   Ported from the React original (EyeTracker.tsx / Watcher) to plain
   JavaScript, because this site has no React. The maths, the numbers and
   the comments are the original's; what changed is only the plumbing:
   refs became variables, effects became one mount() call, and a shape
   change is a method (setShape) instead of a new prop.
   Сделано по компоненту Eye tracker из Bencho (лицензия MIT), переписано
   без React: на сайте его нет. */

/* ══ Eye tracker ═══════════════════════════════════════════
   A ball with two eyes that watches your cursor, wherever it is
   on the page.

   ── THE EYES ARE ON THE BALL, NOT IN FRONT OF IT ───────────
   The easy version slides two shapes toward the pointer, and it
   reads as stickers on a disc. Here each eye is a point on the
   sphere's surface: looking left turns the ball, so an eye
   travels along the curve, and the one heading for the rim
   moves less and narrows as it turns away from you while the
   other swings wide. That foreshortening is the whole trick —
   it is what makes a flat circle read as something round.

   One turn (yaw and pitch) is the state, sprung toward where
   the pointer is; both eyes are read off it, so they can never
   disagree. It relaxes back to facing you when the pointer
   leaves the window, and it blinks on its own now and then.

   Written straight to the DOM every frame, never through state:
   a pointer move is not a render. */
(function () {
  /* ── one spring, for everything that settles ───────────────
     Frames, not milliseconds. `dt` is expressed in sixtieths of
     a second and the damping is RAISED to it rather than
     multiplied by it, so a dropped frame decays the same amount
     of energy as the two frames it replaced. Multiplying is the
     version that makes a spring behave differently on a busy
     page, which is the hardest kind of bug to see.

     The loop parks itself the moment the value has settled
     (here: whenever the toy cannot be seen), so there is no
     permanent requestAnimationFrame running for nothing. */

  /* Read once. A preference, not a live input. */
  const stillness = () =>
    typeof window !== 'undefined' &&
    !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const R = 50; /* the ball's radius, in the 100-unit viewBox */

  /* ── the eyes: a style, and where they rest ─────────────────
     Every style is two rounded rectangles, the same size as each
     other — the difference between styles is only their width,
     height and corner — so they all ride the same sphere and
     blink the same way. Any difference in SIZE between the two is
     depth, worked out from the turn, never drawn in.

     The face goes where you are: straight on, centred and level
     when you are on top of it, and it comes back to centre when
     the pointer leaves the window. */
  const STYLES = {
    Slant: { w: 9, h: 15, r: 4.5 },
    Dots: { w: 11, h: 11, r: 5.5 },
    Squares: { w: 12, h: 12, r: 3.5 },
  };
  /* half the gap between the eyes, as a fraction of the radius */
  const GAP = 0.19;
  /* how far a look to a corner tilts the pair, in degrees at the
     rim — a glance up and right leans them back, like the logo */
  const TILT = 64;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ── it talks back when you poke it ─────────────────────────
     A press on the toy (never on the mark) opens a little chat
     bubble off it — the pet's bubble, same shape and tints — types
     one short line into it a letter at a time, holds it to be
     read, and folds it away. Never the same line twice running.
     The lines are in Russian, like the rest of this site. */
  const LINES = [
    'Эй, я тебя вижу.',
    'Буп.',
    'Щекотно!',
    'Привет!',
    'Хватит тыкать.',
    'Я за тобой слежу.',
    'Опять? Ладно.',
    'Ты меня нашёл.',
  ];
  const TINTS = ['#3b5bff', '#179c52', '#e0307f'];
  const KEY_MS = 38;
  const HOLD_MS = 1500;

  /* ── the body, in three shapes ──────────────────────────────
     The eyes are worked out on a sphere whatever the body is, so
     the turn reads the same on all three; the body is only the
     outline they are clipped to. The cube is a soft square, the
     pill lies on its side — both keep the eyes' resting spot
     inside them. */
  const SHAPES = {
    Ball: 'M50 0 A50 50 0 1 1 49.99 0 Z',
    /* a smaller circle, the same area as the hexagon, for the mark
       that changes between the two */
    Circle: 'M50 7 A43 43 0 1 1 49.99 7 Z',
    Cube: 'M30 6 H70 A24 24 0 0 1 94 30 V70 A24 24 0 0 1 70 94 H30 A24 24 0 0 1 6 70 V30 A24 24 0 0 1 30 6 Z',
    Pill: 'M34 17 H66 A33 33 0 0 1 66 83 H34 A33 33 0 0 1 34 17 Z',
    /* six sides with softened corners: stood on a point, and lying
       on a flat side */
    Hexagon: 'M59.53 8.50 L81.18 21.00 Q90.70 26.50 90.70 37.50 L90.70 62.50 Q90.70 73.50 81.18 79.00 L59.53 91.50 Q50.00 97.00 40.47 91.50 L18.82 79.00 Q9.30 73.50 9.30 62.50 L9.30 37.50 Q9.30 26.50 18.82 21.00 L40.47 8.50 Q50.00 3.00 59.53 8.50 Z',
    'Hex flat': 'M91.50 59.53 L79.00 81.18 Q73.50 90.70 62.50 90.70 L37.50 90.70 Q26.50 90.70 21.00 81.18 L8.50 59.53 Q3.00 50.00 8.50 40.47 L21.00 18.82 Q26.50 9.30 37.50 9.30 L62.50 9.30 Q73.50 9.30 79.00 18.82 L91.50 40.47 Q97.00 50.00 91.50 59.53 Z',
  };

  /* ── morphing between shapes ────────────────────────────────
     The shapes are written as different kinds of path — arcs for
     the ball and the pill, lines and curves for the hexagon — so
     they cannot be tweened as they are. Each is read instead as
     its distance from the centre at a set of evenly spaced angles
     (they are all star-shaped about the centre, so a ray from the
     middle crosses each edge once), and a morph is those distances
     eased from one set to the other and drawn back out as a path.
     Measured once per shape, off the browser's own hit-testing,
     and kept. */
  const RAYS = 120;
  const radii = new Map();
  const NS = 'http://www.w3.org/2000/svg';

  function measure(shape) {
    const hit = radii.get(shape);
    if (hit) return hit;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', SHAPES[shape] || SHAPES.Ball);
    svg.appendChild(path);
    document.body.appendChild(svg);
    const pt = svg.createSVGPoint();
    const out = [];
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2 - Math.PI / 2;
      let lo = 0, hi = 60;
      for (let k = 0; k < 16; k++) {
        const mid = (lo + hi) / 2;
        pt.x = 50 + Math.cos(a) * mid;
        pt.y = 50 + Math.sin(a) * mid;
        if (path.isPointInFill(pt)) lo = mid; else hi = mid;
      }
      out.push(lo);
    }
    svg.remove();
    radii.set(shape, out);
    return out;
  }

  function outline(r) {
    let d = '';
    r.forEach((v, i) => {
      const a = (i / r.length) * Math.PI * 2 - Math.PI / 2;
      d += `${i ? 'L' : 'M'}${(50 + Math.cos(a) * v).toFixed(2)} ${(50 + Math.sin(a) * v).toFixed(2)}`;
    });
    return d + 'Z';
  }

  let uid = 0;

  function mount(root, opts) {
    const o = Object.assign({
      /* how far the ball turns toward the pointer, 0..100 */
      follow: 60,
      /* how much the turn overshoots and settles, 0..100 */
      bounce: 30,
      size: 100,
      shape: 'Cube',
      eyes: 'Slant',
      /* the eyes' size against the body; a small mark wants them
         bigger than a big one does to read at all */
      eyeScale: 1,
      /* the eyes' width on its own, for a thinner or fuller stroke */
      eyeWidth: 1,
      /* how round the eyes' corners are, 1 fully round; below 1 they
         start to square off */
      eyeRound: 1,
      /* the eyes' height on its own */
      eyeHeight: 1,
      /* a mark rather than a toy: it ignores the pointer, looks
         straight ahead, glances somewhere every five seconds and
         blinks every two */
      idle: false,
      /* whether a press on the toy opens the chat bubble; off, the
         toy only watches and blinks, and a press does nothing */
      talk: true,
      /* the box it watches inside, as a selector; 'viewport' is the
         whole window. Left unset it is the toy's own box */
      within: undefined,
    }, opts || {});

    const still = stillness();
    const talks = !o.idle && o.talk;
    const base = STYLES[o.eyes] || STYLES.Slant;
    const eye = {
      w: base.w * o.eyeScale * o.eyeWidth,
      h: base.h * o.eyeScale * o.eyeHeight,
      r: base.r * o.eyeScale * o.eyeWidth * o.eyeRound,
    };
    const s = clamp(o.size, 16, 180);
    const clipId = 'eyt-clip-' + (++uid);

    /* ── the markup: the ball, its clip, two eyes, the bubble ── */
    root.classList.add('eyt');
    root.style.setProperty('--eyt-size', s + 'px');
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', 'Шарик с глазами, который следит за курсором');
    root.innerHTML =
      `<svg class="eyt-ball" viewBox="0 0 100 100"${talks ? ' data-poke' : ''}>` +
        `<defs><clipPath id="${clipId}"><path d="${SHAPES[o.shape] || SHAPES.Ball}"/></clipPath></defs>` +
        `<path class="eyt-body" d="${SHAPES[o.shape] || SHAPES.Ball}"/>` +
        `<g clip-path="url(#${clipId})">` +
          [0, 1].map(() => `<g><rect class="eyt-eye" x="${-eye.w / 2}" y="${-eye.h / 2}" width="${eye.w}" height="${eye.h}" rx="${eye.r}"/></g>`).join('') +
        `</g>` +
      `</svg>` +
      (!talks ? '' : `<span class="eyt-say" aria-live="polite"><span></span><span class="eyt-caret"></span></span>`);

    const ball = root.querySelector('.eyt-ball');
    const bodyEl = root.querySelector('.eyt-body');
    const clipEl = root.querySelector('clipPath path');
    const eyes = Array.from(root.querySelectorAll('.eyt-ball > g > g'));
    const say = root.querySelector('.eyt-say');
    const sayText = say && say.firstElementChild;

    /* ── poke: one line, typed out, held, folded away ──────── */
    let turn = 0;
    let lastLine = -1;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const poke = async () => {
      if (!talks || !say) return;
      const mine = ++turn;
      const pool = LINES.map((_, i) => i).filter((i) => i !== lastLine);
      const i = pool[Math.floor(Math.random() * pool.length)];
      lastLine = i;
      const line = Array.from(LINES[i]);
      say.style.setProperty('--tint', TINTS[Math.floor(Math.random() * TINTS.length)]);
      sayText.textContent = '';
      say.setAttribute('data-on', '');
      for (let k = 1; k <= line.length; k++) {
        await wait(KEY_MS + Math.random() * 30);
        if (mine !== turn) return;
        sayText.textContent = line.slice(0, k).join('');
      }
      await wait(HOLD_MS);
      if (mine !== turn) return;
      say.removeAttribute('data-on');
    };
    ball.addEventListener('click', poke);

    /* where the face is on the ball (fractions of the radius),
       its speed, and where it is heading — one spring on a point,
       read as a turn when the eyes are drawn */
    const t = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
    let raf = 0;
    let prev = 0;
    let blink = 0;
    let nextBlink = performance.now() + 2200;

    const draw = (now) => {
      /* a blink is 160ms down and up, as a squash on each eye */
      let lid = 1;
      if (now > nextBlink) {
        blink = now;
        nextBlink = now + (o.idle ? 2000 : 2600 + Math.random() * 3200);
      }
      const since = now - blink;
      if (since < 160) lid = 1 - 0.9 * Math.sin((since / 160) * Math.PI);

      /* the turn that brings the front of the ball to the face's
         spot: yaw about the vertical, pitch about the horizontal */
      const as = (v) => Math.asin(clamp(v, -0.92, 0.92));
      const yaw = as(t.x);
      const pitch = -as(t.y);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      /* the pair leans with a diagonal look and stands level on
         the axes: up-right and down-left lean one way, the other
         two the other, nothing straight on */
      const tilt = TILT * t.x * t.y;
      /* bigger eyes stand a little further apart */
      const g0 = GAP * Math.max(1, o.eyeScale * 0.8);

      [-g0, g0].forEach((x0, i) => {
        const g = eyes[i];
        if (!g) return;
        /* the eye as a point on the unit sphere, either side of
           the front, turned with the ball */
        const z0 = Math.sqrt(1 - x0 * x0);
        const x1 = x0 * cy + z0 * sy;
        const z1 = -x0 * sy + z0 * cy;
        const y2 = -z1 * sp;
        const z2 = z1 * cp;
        /* depth: the eye nearer the rim is further from you, so it
           is smaller all over and narrower still across the turn */
        const near = clamp(z2, 0, 1);
        const k = 0.45 + 0.55 * near;
        const sx = k * (0.7 + 0.3 * near);
        /* ── the size is written as a size, never as a scale ──
           A scale stretches the corner with the shape: an eye
           narrowed for depth or squashed by a blink had elliptical
           corners, rounder on one side than the other. Writing the
           width and height directly keeps every corner the same
           radius, clamped so it never exceeds half a side. */
        const w = eye.w * sx;
        const h = Math.max(0.6, eye.h * k * lid);
        const rect = g.firstElementChild;
        if (rect) {
          rect.setAttribute('x', (-w / 2).toFixed(2));
          rect.setAttribute('y', (-h / 2).toFixed(2));
          rect.setAttribute('width', w.toFixed(2));
          rect.setAttribute('height', h.toFixed(2));
          rect.setAttribute('rx', Math.min(eye.r, w / 2, h / 2).toFixed(2));
        }
        g.setAttribute(
          'transform',
          `translate(${(50 + x1 * R).toFixed(2)} ${(50 + y2 * R).toFixed(2)}) rotate(${tilt.toFixed(2)})`,
        );
        g.style.opacity = z2 < 0.05 ? '0' : '1';
      });
    };

    /* ── it only runs while it can be seen ───────────────────
       Off screen or in a background tab the loop stops; it starts
       again the moment the ball comes back into view */
    let seen = true;
    const tick = (now) => {
      if (!seen || document.hidden) { raf = 0; prev = 0; return; }
      const dt = prev ? Math.min(2.5, (now - prev) / 16.67) : 1;
      prev = now;
      if (still) {
        t.x = t.tx;
        t.y = t.ty;
      } else {
        /* one spring for both axes; Bounce loosens the damping */
        const k = 0.06;
        const d = 0.34 - (clamp(o.bounce, 0, 100) / 100) * 0.22;
        t.vx += ((t.tx - t.x) * k - t.vx * d) * dt;
        t.vy += ((t.ty - t.y) * k - t.vy * d) * dt;
        t.x += t.vx * dt;
        t.y += t.vy * dt;
      }
      draw(now);
      raf = requestAnimationFrame(tick);
    };
    /* draw the resting face straight away, so the eyes are in place
       before the first animation frame arrives */
    draw(performance.now());
    raf = requestAnimationFrame(tick);
    const resume = () => { if (!raf && seen && !document.hidden) raf = requestAnimationFrame(tick); };
    const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting; resume(); });
    io.observe(root);
    document.addEventListener('visibilitychange', resume);

    /* ── the face goes where you are ──────────────────────────
       A spot out along the pointer's direction, further the
       further away you are — so on top of it the face is dead
       centre, and off in a corner it is out by that corner's
       rim, turned, one eye smaller and the pair leaning. */
    /* ── only while you are in its frame ────────────────────
       It watches the pointer while the pointer is inside the box
       it is told to watch, and faces front again the moment you
       leave. The reach is measured against that box, so the eyes
       arrive at the rim as you arrive at its edge. On this site
       the box is the whole window. */
    const frameRect = () => {
      if (o.within === 'viewport') return { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
      const f = (o.within && root.closest(o.within)) || root;
      return f.getBoundingClientRect();
    };
    const aim = (e) => {
      const f = frameRect();
      if (e.clientX < f.left || e.clientX > f.right || e.clientY < f.top || e.clientY > f.bottom) {
        t.tx = 0;
        t.ty = 0;
        return;
      }
      const r = root.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.max(60, Math.min(f.width, f.height) * 0.28);
      const far = Math.min(0.85, Math.tanh(d / reach) * (clamp(o.follow, 0, 100) / 100) * 1.5);
      t.tx = (dx / d) * far;
      t.ty = (dy / d) * far;
      resume();
    };
    const rest = () => { t.tx = 0; t.ty = 0; };

    /* ── idle: straight ahead, and now and then a glance ──────
       Every 5 seconds it looks off in a random direction,
       holds it for a moment, and comes back to centre. */
    if (o.idle) {
      const look = () => {
        const a = Math.random() * Math.PI * 2;
        const far = 0.45 + Math.random() * 0.25;
        t.tx = Math.cos(a) * far;
        t.ty = Math.sin(a) * far;
        setTimeout(() => { rest(); setTimeout(look, 5000 - 900); }, 900);
      };
      setTimeout(look, 5000);
    } else {
      window.addEventListener('pointermove', aim, { passive: true });
      document.documentElement.addEventListener('pointerleave', rest);
    }

    /* ── a change of shape is a morph, not a swap ─────────────
       The first shape is drawn from its own path; every change
       after that eases the outline across in about half a second,
       with a little overshoot so it lands. Both the body and the
       clip the eyes sit in are written each frame. */
    let shown = null;
    let from = o.shape;
    let morph = 0;
    const setShape = (shape) => {
      if (from === shape) return;
      const start = shown || measure(from);
      const end = measure(shape);
      from = shape;
      cancelAnimationFrame(morph);
      if (still) {
        shown = end;
        const d = outline(end);
        bodyEl.setAttribute('d', d);
        clipEl.setAttribute('d', d);
        return;
      }
      const t0 = performance.now();
      const ms = 520;
      const step = (now) => {
        const u = Math.min(1, (now - t0) / ms);
        /* ease out with a touch of overshoot */
        const c = 1.3;
        const e = 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2);
        const r = start.map((a, i) => a + (end[i] - a) * e);
        shown = r;
        const d = outline(r);
        bodyEl.setAttribute('d', d);
        clipEl.setAttribute('d', d);
        if (u < 1) morph = requestAnimationFrame(step);
      };
      morph = requestAnimationFrame(step);
    };

    return { setShape, poke };
  }

  window.EyeTracker = { mount, SHAPES: Object.keys(SHAPES), STYLES: Object.keys(STYLES) };

  /* На этом сайте: круглый с глазами на стартовом экране, слева от приветствия,
     следит за курсором по всему окну */
  const spot = document.querySelector('[data-eye-tracker]');
  if (spot) mount(spot, { size: 56, shape: 'Ball', eyes: 'Slant', eyeScale: 1.3, within: 'viewport', talk: false });
})();
