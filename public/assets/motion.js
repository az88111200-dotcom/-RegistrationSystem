/**
 * 前台的動畫（貼紙貼上來、飛機飛、跑馬燈、螢光筆刷過去）。
 *
 * 用 GSAP（/assets/vendor/，免費授權）。三種情況一律不動、直接顯示完成的樣子：
 *   - 手機設定了「減少動態效果」
 *   - GSAP 沒載到（網路不好）
 *   - 後台（後台不載這支）
 * 所有東西沒有動畫也都看得到、按得到；動畫只是加分，不能拿來藏內容。
 */

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

export const motionOK = () => !reduce.matches && Boolean(window.gsap);

let registered = false;
function ready() {
  if (!motionOK()) return false;
  if (!registered && window.ScrollTrigger) {
    window.gsap.registerPlugin(window.ScrollTrigger);
    registered = true;
  }
  return true;
}

/** 貼紙「啪」一下貼上去：從大一點、歪一點，落回原本的角度。 */
export function slap(elements, delay = 0) {
  const els = [...elements];
  if (!els.length || !ready()) return;
  const { gsap } = window;
  gsap.fromTo(els,
    { scale: 1.14, rotation: (i) => (i % 2 ? -6 : 6), y: -16, opacity: 0 },
    {
      scale: 1, rotation: 0, y: 0, opacity: 1, duration: .55, ease: 'back.out(2.2)',
      stagger: .1, delay, clearProps: 'transform,opacity',
    });
}

/**
 * 捲到才貼上來。一開始就在畫面上的不藏（第一眼就要看得到內容），
 * 只有畫面下方、還沒捲到的才先藏起來，捲到時貼上。
 */
export function slapOnScroll(elements) {
  const els = [...elements];
  if (!els.length || !ready() || !window.ScrollTrigger) return;
  const below = els.filter((el) => el.getBoundingClientRect().top > window.innerHeight);
  if (!below.length) return;
  window.gsap.set(below, { opacity: 0 });
  window.ScrollTrigger.batch(below, { start: 'top 90%', once: true, onEnter: (batch) => slap(batch) });
}

/** 標題一行一行彈出來（字一直看得到，只是位置、角度在動）。 */
export function popIn(elements, delay = 0) {
  const els = [...elements];
  if (!els.length || !ready()) return;
  window.gsap.from(els, { y: 24, rotation: -2.5, scale: .94, duration: .65, ease: 'back.out(1.8)', stagger: .09, delay });
}

/** 螢光筆從左刷到右（.mark 的背景）。scroll=true 時捲到才刷。 */
export function sweep(marks, { delay = 0, scroll = false } = {}) {
  const els = [...marks];
  if (!els.length || !ready()) return;
  const vars = { backgroundSize: '0% .52em' };
  const to = { backgroundSize: '100% .52em', duration: .6, ease: 'power3.out', delay };
  els.forEach((el) => {
    window.gsap.fromTo(el, vars, scroll && window.ScrollTrigger
      ? { ...to, scrollTrigger: { trigger: el, start: 'top 88%' } }
      : to);
  });
}

/** 吉祥物小飛機：飛進來、輕輕上下飄；往下捲時往右邊飛走。 */
export function plane(wrapper, scrollTrigger) {
  if (!wrapper || !ready()) return;
  const { gsap } = window;
  const img = wrapper.querySelector('img');
  gsap.from(img, { x: -140, y: 30, rotation: -28, duration: 1.1, ease: 'power3.out', delay: .15 });
  gsap.to(img, { y: -6, rotation: -4, duration: 1.4, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.25 });
  if (window.ScrollTrigger && scrollTrigger) {
    gsap.to(wrapper, {
      x: () => window.innerWidth * .7, ease: 'power1.in',
      scrollTrigger: { trigger: scrollTrigger, start: 'top top', end: 'bottom top', scrub: .8 },
    });
  }
}

/** 跑馬燈：平常慢慢跑，捲得越快跑越快，往上捲就倒著跑。沒有動畫時就停在原地。 */
export function marquee(track) {
  if (!track || !ready()) return;
  const { gsap } = window;
  const loop = gsap.to(track, { xPercent: -50, duration: 40, ease: 'none', repeat: -1 });
  if (!window.ScrollTrigger) return;
  let settle = null;
  window.ScrollTrigger.create({
    onUpdate: (self) => {
      const v = gsap.utils.clamp(-6, 6, self.getVelocity() / 260);
      settle?.kill();
      loop.timeScale(v === 0 ? 1 : v);
      settle = gsap.to(loop, { timeScale: self.direction > 0 ? 1 : -1, duration: 1.2, ease: 'power2.out', delay: .1 });
    },
  });
}

/** 版面變了（例如切分頁、展開「查看更多」）之後，重新計算捲動的觸發點。 */
export function refresh() {
  if (window.ScrollTrigger) window.ScrollTrigger.refresh();
}

/**
 * 平滑捲到某個區塊（例如查詢結果、場地當天的預約詳情），讓人看得出畫面往哪裡走。
 * 自己算、不靠瀏覽器的 smooth：有些瀏覽器或設定下 smooth 會直接跳過去。
 * 「減少動態效果」的人直接跳到位置，不捲。
 */
export function scrollToEl(target, { offset = 16, duration = 650 } = {}) {
  if (!target) return;
  const to = Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset);
  const from = window.scrollY;
  if (reduce.matches || Math.abs(to - from) < 4) { window.scrollTo(0, to); return; }
  const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
  const start = performance.now();
  // 捲動途中使用者自己滑了，就停下來不要跟他搶
  let cancelled = false;
  const stop = () => { cancelled = true; };
  window.addEventListener('wheel', stop, { once: true, passive: true });
  window.addEventListener('touchstart', stop, { once: true, passive: true });
  const step = (now) => {
    if (cancelled) return;
    const t = Math.min(1, (now - start) / duration);
    window.scrollTo(0, from + (to - from) * ease(t));
    if (t < 1) requestAnimationFrame(step);
    else { window.removeEventListener('wheel', stop); window.removeEventListener('touchstart', stop); }
  };
  requestAnimationFrame(step);
}

/** 新出現的內容由下往上浮出來（一張一張接著出現）。 */
export function rise(elements, delay = 0) {
  const els = [...elements];
  if (!els.length || !ready()) return;
  window.gsap.from(els, { y: 26, opacity: 0, duration: .45, ease: 'power3.out', stagger: .07, delay, clearProps: 'transform,opacity' });
}
