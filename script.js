// Стартовый экран «Напиши мне»: пока посетитель не нажал «Отправить», анимации главной ждут
const introEl = document.querySelector('.intro');
const introPending = !!introEl && document.documentElement.classList.contains('has-intro');
const whenReady = (fn) => {
  if (introPending) document.addEventListener('intro:done', fn, { once: true });
  else fn();
};

// Плавное появление: элементы, видимые при открытии страницы, появляются по очереди.
// Всё, что ниже первого экрана, показывается сразу, без анимации.
whenReady(function () {
  const items = document.querySelectorAll('[data-reveal]');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STEP = 0.1; // задержка между элементами, сек
  let i = 0;

  items.forEach((el) => {
    const visible = el.getBoundingClientRect().top < window.innerHeight;
    if (reduce || !visible) {
      el.classList.add('is-shown');
      return;
    }
    el.style.setProperty('--reveal-delay', (i++ * STEP) + 's');
    el.classList.add('reveal');
    el.addEventListener('animationend', function done(e) {
      if (e.target !== el) return; // игнорируем анимации внутри элемента
      el.classList.add('is-shown');
      el.classList.remove('reveal');
      el.removeEventListener('animationend', done);
    });
  });
});

// Звук печати: короткий щелчок клавиши, синтезируется на лету (без аудиофайла).
// Браузеры не дают играть звук, пока человек не кликнул или не нажал клавишу на странице,
// поэтому до первого действия щелчков не слышно
const sound = (function () {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  const unlock = () => {
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((e) =>
    window.addEventListener(e, unlock, { passive: true }));
  // Chrome разрешает звук сразу, если человек уже кликал на этом сайте
  // (например, вернулся на главную по клику на аватар) — пробуем включить при загрузке
  unlock();

  // глубокий тихий «ток»: приглушённый шум + низкий тон. Оба нарастают плавно —
  // без этого звук стартует «ступенькой» и на каждой букве слышен грубый хлопок
  function click() {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;

    // 1) шумовой щелчок, срезаем высокие частоты — звук мягкий и глухой
    const len = 0.025; // 25 мс
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
    const data = buf.getChannelData(0);
    const attack = Math.floor(ctx.sampleRate * 0.002); // 2 мс плавного нарастания
    for (let i = 0; i < data.length; i++) {
      const fadeIn = i < attack ? i / attack : 1;
      data[i] = (Math.random() * 2 - 1) * fadeIn * Math.pow(1 - i / data.length, 6);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 360 + Math.random() * 80; // оставляем только низ
    lowpass.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.28;
    noise.connect(lowpass).connect(noiseGain).connect(ctx.destination);

    // 2) короткий низкий тон — «тело» щелчка
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160 + Math.random() * 20, t);
    osc.frequency.exponentialRampToValueAtTime(95, t + 0.038);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.0001, t);
    oscGain.gain.exponentialRampToValueAtTime(0.2, t + 0.004);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    osc.connect(oscGain).connect(ctx.destination);

    noise.start(t);
    osc.start(t);
    osc.stop(t + 0.055);
  }

  // запускаем звук, как только браузер разрешит (клик по кнопке темы — это действие человека)
  const play = (fn) => {
    unlock();
    if (!ctx) return;
    if (ctx.state === 'running') fn(ctx.currentTime + 0.02);
    else ctx.resume().then(() => fn(ctx.currentTime + 0.02)).catch(() => {});
  };

  // один короткий звуковой импульс: тон с плавной атакой и затуханием
  const blip = (t, freq, dur, vol, type) => {
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.01);
    return osc;
  };

  // сверчок (тёмная тема): три стрекотания, каждое — 4 быстрых импульса около 4.5 кГц
  function cricket() {
    play((t0) => {
      for (let c = 0; c < 3; c++) {
        for (let p = 0; p < 4; p++) {
          const t = t0 + c * 0.32 + p * 0.032;
          blip(t, 4400 + Math.random() * 120, 0.022, 0.06);
        }
      }
    });
  }

  // одна «птичья» нота: тон идёт по точкам [время, частота], поверх — быстрая трель
  // (частотная модуляция вторым осциллятором). Именно трель убирает «роботность» чистой синусоиды
  const birdNote = (t, curve, vol, vibRate, vibDepth) => {
    const dur = curve[curve.length - 1][0];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.012, dur * 0.25));
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(curve[0][1], t);
    curve.slice(1).forEach(([dt, f]) => osc.frequency.exponentialRampToValueAtTime(f, t + dt));

    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = vibRate;
    depth.gain.value = vibDepth;
    lfo.connect(depth).connect(osc.frequency);

    osc.connect(g);
    osc.start(t); osc.stop(t + dur + 0.02);
    lfo.start(t); lfo.stop(t + dur + 0.02);
  };

  // птичка (светлая тема): синица «зинь-зинь-тю» — два звонких высоких звука и один ниже
  function bird() {
    play((t0) => {
      const hi = 5200 + Math.random() * 300; // каждый раз звучит чуть иначе
      for (let i = 0; i < 2; i++) {
        const t = t0 + i * 0.2;
        birdNote(t, [[0, hi * 0.92], [0.02, hi], [0.09, hi * 0.97]], 0.06, 55 + Math.random() * 15, 180);
      }
      birdNote(t0 + 0.42, [[0, 4000], [0.03, 3700], [0.16, 3300]], 0.07, 30, 90);
    });
  }

  return { click, cricket, bird };
})();

// Бабл: сначала «печатает…» (три точки), потом текст набирается по буквам со звуком клавиш.
// По клику на бабл текст набирается заново — так звук можно услышать, даже если при загрузке
// браузер его заблокировал
(function () {
  const bubble = document.querySelector('.bubble');
  if (!bubble) return;

  const out = bubble.querySelector('.bubble__text');
  const text = bubble.dataset.text;
  // Array.from корректно делит эмодзи, а не режет их пополам
  const chars = Array.from(text);

  const DOTS_DELAY = 1200; // сколько показываем точки, мс
  const CHAR_DELAY = 70;   // скорость печати, мс на символ

  bubble.setAttribute('aria-label', text);

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    bubble.classList.add('is-done');
    bubble.querySelector('.bubble__typing').remove();
    out.textContent = text;
    return;
  }

  let typing = false;
  const type = () => {
    typing = true;
    out.textContent = '';
    bubble.classList.add('is-typing');
    let i = 0;
    const tick = () => {
      const ch = chars[i++];
      out.textContent += ch;
      if (ch.trim()) sound.click(); // на пробелах — тишина
      if (i < chars.length) {
        setTimeout(tick, CHAR_DELAY + Math.random() * 40); // живой, неровный ритм
      } else {
        // курсор ещё немного мигает и исчезает
        setTimeout(() => {
          bubble.classList.remove('is-typing');
          const dots = bubble.querySelector('.bubble__typing');
          if (dots) dots.remove();
          typing = false;
        }, 1200);
      }
    };
    tick();
  };

  // после стартового экрана отвечаю чуть позже — сначала появляется сообщение посетителя
  whenReady(() => setTimeout(type, DOTS_DELAY + (introPending ? 500 : 0)));
  const replay = () => { if (!typing) setTimeout(type, 50); };
  bubble.addEventListener('click', replay);

  // клик по аватару на главной: не перезагружаем страницу, а поднимаемся наверх
  // и печатаем приветствие заново — со звуком, ведь это нажатие человека
  const avatar = document.querySelector('.avatar-link');
  if (avatar) avatar.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    replay();
  });
})();

// Переключатель темы: запоминает выбор, иначе следует настройке системы
(function () {
  const root = document.documentElement;
  const btn = document.querySelector('.theme-switch');
  if (!btn) return;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const isDark = () => root.dataset.theme
    ? root.dataset.theme === 'dark'
    : media.matches;

  const sync = () => {
    const dark = isDark();
    root.classList.toggle('is-dark', dark);
    btn.setAttribute('aria-checked', String(dark));
  };

  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    // звук смены темы: ночью стрекочет сверчок, днём поёт птичка
    if (next === 'dark') sound.cricket(); else sound.bird();
    const apply = () => {
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) {}
      sync();
    };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // плавный переход там, где браузер умеет; иначе мгновенно, без мерцания
    if (document.startViewTransition && !reduce) {
      document.startViewTransition(apply);
    } else {
      apply();
    }
  });

  // если тема не выбрана вручную, реагируем на смену системной
  media.addEventListener('change', () => { if (!root.dataset.theme) sync(); });
  sync();
})();

// Шапка прячется при прокрутке вниз и появляется при прокрутке вверх
(function () {
  const header = document.querySelector('.header');
  if (!header) return;
  let lastY = window.scrollY;
  const update = () => {
    const y = window.scrollY;
    const delta = y - lastY;
    if (y < 120) header.classList.remove('is-hidden');          // у самого верха — всегда видна
    else if (delta > 6) header.classList.add('is-hidden');      // листаем вниз
    else if (delta < -6) header.classList.remove('is-hidden');  // листаем вверх
    if (y < 120 || Math.abs(delta) > 6) lastY = y;
  };
  window.addEventListener('scroll', update, { passive: true });
})();

// В Safari на iPhone :active срабатывает, только если на странице есть обработчик касаний —
// нужен для эффекта нажатия на карточки кейсов
document.addEventListener('touchstart', function () {}, { passive: true });

// Отправка сообщения со стартового экрана
(function () {
  if (!introPending) return;
  const root = document.documentElement;
  const form = introEl.querySelector('.intro__composer');
  const out = document.querySelector('.bubble-out');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sent = false;

  // Enter тоже отправляет приветствие
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !sent) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (sent) return;
    sent = true;
    if (out) out.textContent = 'Привет 👋';
    try { sessionStorage.setItem('introDone', '1'); } catch (err) {}
    introEl.classList.add('is-leaving');
    setTimeout(() => {
      root.classList.remove('has-intro');
      root.classList.add('intro-sent');
      introEl.remove();
      window.scrollTo(0, 0);
      document.dispatchEvent(new Event('intro:done'));
    }, reduce ? 0 : 450);
  });
})();


// Карточки с экранами: на компьютере листаются перетаскиванием мышью.
// Привязку браузера на компьютере выключили в CSS, поэтому после отпускания карточку
// доводим до телефона сами — плавной анимацией по направлению движения.
document.querySelectorAll('.phones--scroll').forEach((box) => {
  let startX = 0, startLeft = 0, down = false, anim = 0;
  const snapPoints = () => {
    const pad = parseFloat(getComputedStyle(box).paddingLeft) || 0;
    const max = box.scrollWidth - box.clientWidth;
    const left = box.getBoundingClientRect().left - box.scrollLeft;
    return [...box.children].map((el) => Math.min(max, Math.max(0, Math.round(el.getBoundingClientRect().left - left - pad))));
  };
  const glide = (to) => {
    cancelAnimationFrame(anim);
    const from = box.scrollLeft, dist = to - from;
    if (Math.abs(dist) < 1) return;
    const dur = Math.min(500, 250 + Math.abs(dist) * 0.6);
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3); // плавное замедление в конце
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      box.scrollLeft = from + dist * ease(t);
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  };
  box.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return; // на тачскрине работает обычная прокрутка
    cancelAnimationFrame(anim);
    down = true; startX = e.clientX; startLeft = box.scrollLeft;
    box.classList.add('is-dragging');
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', (e) => {
    if (down) box.scrollLeft = startLeft - (e.clientX - startX);
  });
  const stop = () => {
    if (!down) return;
    down = false;
    box.classList.remove('is-dragging');
    const moved = startLeft - box.scrollLeft; // >0 — тянули вправо (назад)
    const points = snapPoints();
    const cur = box.scrollLeft;
    let target;
    if (Math.abs(moved) > 30) {
      // дотягиваем до следующего телефона в сторону движения
      target = moved < 0 ? points.find((p) => p > cur + 1) : [...points].reverse().find((p) => p < cur - 1);
    }
    if (target === undefined) target = points.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a), points[0]);
    glide(target);
  };
  box.addEventListener('pointerup', stop);
  box.addEventListener('pointercancel', stop);
});

// Мобильное меню: кнопка с тремя полосками раскрывает пункты меню под шапкой.
// Закрывается по повторному нажатию, по клику мимо, по Esc и когда шапка уезжает при прокрутке
(function () {
  const header = document.querySelector('.header');
  const btn = header && header.querySelector('.menu-toggle');
  if (!btn) return;
  const set = (open) => {
    header.classList.toggle('menu-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Закрыть меню' : 'Меню');
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); set(!header.classList.contains('menu-open')); });
  document.addEventListener('click', (e) => {
    if (header.classList.contains('menu-open') && !e.target.closest('.menu')) set(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  header.querySelectorAll('.menu__item').forEach((a) => a.addEventListener('click', () => set(false)));
  new MutationObserver(() => { if (header.classList.contains('is-hidden')) set(false); })
    .observe(header, { attributes: true, attributeFilter: ['class'] });
})();

// Анимированная обложка: раскладываем надпись по буквам по окружности
(function () {
  const N = 48; // сколько букв на кольце
  document.querySelectorAll('.cover-orbit__ring[data-orbit-text]').forEach((ring) => {
    const base = ring.dataset.orbitText;
    let text = '';
    while (text.length < N) text += base;
    text = text.slice(0, N);
    const spin = document.createElement('span');
    spin.className = 'cover-orbit__spin';
    spin.style.setProperty('--n', N);
    [...text].forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch;
      s.style.setProperty('--i', i);
      spin.appendChild(s);
    });
    ring.appendChild(spin);
  });
})();
