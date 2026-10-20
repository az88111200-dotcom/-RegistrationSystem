// 前後台共用的小工具：API 呼叫、日期格式、動態表單產生。

import { weekdayOf, WEEKDAY_NAMES } from './schedule.js';

/** 呼叫後端 API，錯誤一律丟出帶訊息的 Error。 */
export async function api(path, { method = 'GET', body, ...rest } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    ...rest,
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }
  if (!res.ok) {
    const err = new Error(data.error || `發生錯誤（${res.status}）`);
    err.status = res.status;
    // 錯誤回應多帶的資料（例如人機驗證的題目）
    err.data = data;
    throw err;
  }
  return data;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 建立元素的簡便寫法。 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * 2026-08-14 → 2026/08/14（五）
 *
 * 星期一律用 schedule.js 的 weekdayOf 算。
 * 曾經在這裡自己算過一次：用 T00:00:00+08:00 建日期、再讀 getUTCDay()，
 * 台北的午夜換算成 UTC 是前一天下午四點，於是整個系統的星期都少一天。
 * 只留一份實作就不會再犯。
 */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso || '';
  return `${m[1]}/${m[2]}/${m[3]}（${WEEKDAY_NAMES[weekdayOf(iso)]}）`;
}

/** 2026-08-14 → { d: '14', m: '8月' }，活動卡片的日期方塊用。 */
export function dateChip(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return { d: '?', m: '' };
  return { d: String(Number(m[3])), m: `${Number(m[2])}月` };
}

/** 西元 → 民國，例：2005-02-16 → 94/02/16 */
export function toRoc(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const y = Number(m[1]) - 1911;
  return y > 0 ? `${y}/${m[2]}/${m[3]}` : '';
}

/** 距離活動還有幾天（負數代表已經過去）。 */
export function daysUntil(iso, today) {
  if (!iso || !today) return null;
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

/**
 * 活動現在該標什麼狀態。首頁卡片與活動頁共用同一套判斷。
 *
 * 倒數不能用第一堂的日期算 —— 連續性團體開課之後仍然可以中途加入，
 * 用第一堂算會變成「剩 -1 天報名」。所以：
 *   已經開課但還沒結束 → 講「已開課」，不倒數
 *   還沒開課           → 倒數到報名截止日（沒設就是第一堂那天）
 *
 * 回傳 { key, days }：
 *   past / waitlist / full / closed / started / today / soon / open
 */
export function activityStatus(activity, today) {
  if (activity.isPast) return { key: 'past' };
  if (activity.isFull && activity.isOpen && activity.acceptingWaitlist) return { key: 'waitlist' };
  if (activity.isFull) return { key: 'full' };
  if (!activity.isOpen) return { key: 'closed' };

  const first = activity.eventDate || '';
  const end = activity.endDate || first;
  // 第一堂已經過了、但最後一堂還沒到 —— 課還在上，可以中途加入
  if (first && today && first < today && end >= today) {
    return { key: 'started', days: daysUntil(activity.registrationDeadline, today) };
  }

  const days = daysUntil(activity.registrationDeadline || first, today);
  if (days === null || days < 0) return { key: 'open' };
  if (days === 0) return { key: 'today', days };
  if (days <= 7) return { key: 'soon', days };
  return { key: 'open', days };
}

export function showNotice(node, type, message) {
  if (!node) return;
  node.className = `notice notice-${type}`;
  node.textContent = message;
  node.hidden = false;
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function hideNotice(node) {
  if (node) node.hidden = true;
}

/** 多行錯誤訊息拆成清單顯示。 */
export function showErrors(node, message) {
  if (!node) return;
  const lines = String(message).split('\n').filter(Boolean);
  node.className = 'notice notice-error';
  node.innerHTML = '';
  if (lines.length <= 1) {
    node.textContent = message;
  } else {
    node.append(el('strong', { text: '請修正以下欄位：' }));
    node.append(el('ul', {}, lines.map((line) => el('li', { text: line }))));
  }
  node.hidden = false;
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------------------------------------------------------------- 動態表單

const OTHER_PREFIX = '__other__';

/**
 * 依照後端的欄位定義產生一個表單欄位。
 * value 可以是字串或陣列（複選題）。
 */
export function renderField(field, value) {
  // 選擇題與長文字題都佔滿整行，才不會被擠在半欄裡
  const fullWidth = ['checkbox', 'radio', 'textarea'].includes(field.type);
  const wrap = el('div', { class: `field${fullWidth ? ' span-2' : ''}` });
  const id = `f_${field.key}`;

  // 說明文字跟標題排同一行（標題粗、說明淡），輸入框在下面一行。
  // 說明就算是空的也照樣建出來，subgrid 才能靠固定的兩段把輸入框對齊。
  const hint = el('span', { class: 'help', text: field.help || '' });
  const labelText = [
    el('span', { text: field.label }),
    field.required ? el('span', { class: 'req', text: '*' }) : null,
    hint,
  ];

  if (field.type === 'radio' || field.type === 'checkbox') {
    wrap.append(el('div', { class: 'field-label' }, labelText));

    const selected = Array.isArray(value) ? value.map(String) : (value ? [String(value)] : []);
    const known = new Set(field.options || []);
    const otherValue = selected.find((v) => !known.has(v)) || '';

    const choices = el('div', { class: 'choices' });
    for (const option of field.options || []) {
      const input = el('input', {
        type: field.type, name: field.key, value: option,
      });
      input.checked = selected.includes(option);
      choices.append(el('label', { class: 'choice' }, [input, el('span', { text: option })]));
    }
    if (field.other) {
      const box = el('input', { type: field.type, name: field.key, value: OTHER_PREFIX });
      box.checked = Boolean(otherValue);
      const free = el('input', {
        type: 'text', name: `${field.key}${OTHER_PREFIX}`, placeholder: '其他（請填寫）',
        value: otherValue,
      });
      free.addEventListener('input', () => { box.checked = Boolean(free.value.trim()); });
      choices.append(el('label', { class: 'choice choice-other' }, [box, free]));
    }
    wrap.append(choices);
    return wrap;
  }

  wrap.append(el('label', { for: id }, labelText));

  // 需要寫比較多字的題目（例如報名原因）用多行輸入框
  if (field.type === 'textarea') {
    const area = el('textarea', {
      id, name: field.key, rows: field.rows || 4, placeholder: field.placeholder || '',
      maxlength: field.maxLength || 1000,
    });
    area.value = value ?? field.default ?? '';
    if (field.required) area.required = true;
    wrap.append(area);
    return wrap;
  }

  const input = el('input', {
    id,
    name: field.key,
    type: field.type === 'date' ? 'date' : field.type,
    value: value ?? field.default ?? '',
    autocomplete: field.autocomplete || 'off',
    placeholder: field.placeholder || '',
  });
  if (field.required) input.required = true;
  if (field.type === 'date') input.max = '2100-12-31';

  if (field.type === 'select') {
    const select = el('select', { id, name: field.key });
    if (field.required) select.required = true;
    select.append(el('option', { value: '', text: '請選擇…' }));
    for (const option of field.options || []) {
      const node = el('option', { value: option, text: option });
      if (String(value) === option) node.selected = true;
      select.append(node);
    }
    wrap.append(select);
    return wrap;
  }

  wrap.append(input);

  if (field.type === 'date') {
    // 生日的民國年即時顯示在標題旁邊，方便核對保險資料。
    // 跟欄位說明併成同一段，畫面才不會因為多一行而跳動。
    const render = () => {
      const roc = input.value ? `民國 ${toRoc(input.value)}` : '';
      hint.textContent = [roc, field.help].filter(Boolean).join('　·　');
    };
    render();
    input.addEventListener('input', render);
  }
  return wrap;
}

/** 產生一整組欄位。 */
export function renderFields(fields, values = {}) {
  const grid = el('div', { class: 'grid-2' });
  for (const field of fields) grid.append(renderField(field, values[field.key]));
  return grid;
}

/**
 * 從表單讀出資料，並把「其他」選項的自由填答併回去。
 * 複選題回傳陣列，其餘回傳字串。
 */
export function collectFields(fields, formEl) {
  const data = new FormData(formEl);
  const out = {};
  for (const field of fields) {
    if (field.type === 'checkbox' || field.type === 'radio') {
      const picked = data.getAll(field.key).map(String);
      const free = String(data.get(`${field.key}${OTHER_PREFIX}`) || '').trim();
      const values = picked
        .filter((v) => v !== OTHER_PREFIX)
        .concat(picked.includes(OTHER_PREFIX) && free ? [free] : []);
      out[field.key] = field.type === 'checkbox' ? values : (values[0] || '');
    } else {
      out[field.key] = String(data.get(field.key) ?? '').trim();
    }
  }
  return out;
}

/** 顯示用：陣列轉成「A、B」。 */
export function displayValue(value) {
  if (Array.isArray(value)) return value.join('、');
  return value ?? '';
}

// ---------------------------------------------------------------- 人機驗證
//
// 有設定 Cloudflare Turnstile 時：每個表單的送出按鈕上面會出現 Cloudflare 的小框框，
// 它自己確認是不是真人、打勾顯示「成功」，絕大多數人什麼都不用做；
// Cloudflare 覺得可疑時，框框裡才會出現一個方塊讓人點一下。
// 沒設定時用自己做的：頁面一打開就領一張入場券，送出時一起帶上，
// 伺服器覺得可疑才回一題加法。詳細的設計寫在 src/human.js。

let configPromise = null;
function humanConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/human/ticket', { credentials: 'same-origin' })
      .then((r) => r.json()).catch(() => ({}));
  }
  return configPromise;
}
// 前台頁面一載入就先領（領的時間就是「打開頁面的時間」）
if (typeof window !== 'undefined' && !location.pathname.startsWith('/admin')) humanConfig();

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const widgets = new WeakMap();   // 框框（.ts-slot）→ { id, token, error, waiters, off }
let scriptPromise = null;

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = el('script', { src: TURNSTILE_SCRIPT });
      script.addEventListener('load', () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('no turnstile'))));
      script.addEventListener('error', () => reject(new Error('turnstile script failed')));
      document.head.append(script);
    }).catch((err) => { scriptPromise = null; throw err; });
  }
  return scriptPromise;
}

/** 把等著拿通行碼的人叫醒 */
function settle(widget) {
  const { waiters } = widget;
  widget.waiters = [];
  for (const wake of waiters) wake();
}

/** 框框移到送出按鈕的上面（陷阱欄位是加在表單最後面的） */
function placeSlot(slot) {
  const form = slot.closest('form');
  const button = form?.querySelector('button[type="submit"]');
  if (!button) return;
  let row = button;
  while (row.parentElement && row.parentElement !== form) row = row.parentElement;
  if (row.parentElement === form) form.insertBefore(slot, row);
}

/** 在這個框框裡放 Cloudflare 的小工具（每個框框只放一次） */
async function renderWidget(slot) {
  if (widgets.has(slot)) return widgets.get(slot);
  const widget = { id: null, token: '', error: '', waiters: [], off: false };
  widgets.set(slot, widget);
  const { turnstile: siteKey } = await humanConfig();
  if (!siteKey) {
    widget.off = true;
    return widget;
  }
  placeSlot(slot);
  slot.hidden = false;
  try {
    const turnstile = await loadTurnstileScript();
    widget.id = turnstile.render(slot, {
      sitekey: siteKey,
      language: 'zh-tw',
      theme: 'light',
      size: 'flexible',
      'refresh-expired': 'auto',
      callback: (token) => {
        widget.token = token;
        widget.error = '';
        settle(widget);
      },
      'expired-callback': () => { widget.token = ''; },
      'error-callback': (code) => {
        widget.error = String(code || 'error');
        settle(widget);
        return true;   // 自己處理，不要讓 Cloudflare 的程式丟錯
      },
    });
  } catch {
    widget.error = 'load';
    settle(widget);
  }
  return widget;
}

/** 表單出現在畫面上（不是藏在別的分頁）時才放小工具 */
function renderWhenShown(slot) {
  let attached = false;
  const timer = setInterval(() => {
    // 表單被換掉（例如重新整理畫面）就不用再等了
    if (attached && !slot.isConnected) return clearInterval(timer);
    attached = attached || slot.isConnected;
    const form = slot.closest('form');
    if (!slot.isConnected || !form || form.offsetParent === null) return;
    clearInterval(timer);
    renderWidget(slot);
  }, 300);
}

/**
 * 這次送出要用哪個框框：表單自己的，不然就畫面上看得到的第一個；
 * 都沒有（例如查詢結果頁上的「取消預約」）就在畫面下方暫時浮一個出來。
 */
function pickSlot(form) {
  const own = form?.querySelector('.ts-slot');
  if (own) return own;
  const shown = [...document.querySelectorAll('form .ts-slot')].find((slot) => slot.closest('form').offsetParent);
  if (shown) return shown;
  let box = document.querySelector('.ts-float');
  if (!box) {
    box = el('div', { class: 'ts-float', role: 'status' }, [
      el('p', { text: '🤖 確認你不是機器人…' }),
      el('div', { class: 'ts-slot', hidden: true }),
    ]);
    document.body.append(box);
  }
  return box.querySelector('.ts-slot');
}

/** 拿一個通行碼（每個只能用一次，拿完就請 Cloudflare 再準備下一個）。 */
async function turnstileToken(form) {
  const slot = pickSlot(form);
  if (!slot) return '';
  const floating = slot.closest('.ts-float');
  floating?.classList.add('show');
  const widget = await renderWidget(slot);
  if (widget.off) return '';
  if (!widget.token && !widget.error) await new Promise((resolve) => widget.waiters.push(resolve));
  floating?.classList.remove('show');
  if (widget.error) {
    const loadFailed = widget.error === 'load';
    widget.error = '';
    if (loadFailed) widgets.delete(slot);
    else window.turnstile.reset(widget.id);
    throw new Error(loadFailed
      ? '人機驗證載入失敗，請確認網路之後重新整理頁面再試一次。'
      : '人機驗證沒有通過，請再按一次送出；一直不行的話請重新整理頁面。');
  }
  const { token } = widget;
  widget.token = '';
  window.turnstile.reset(widget.id);
  return token;
}

/**
 * 陷阱欄位：人看不到、也跳不進去（tabindex -1），機器人會把它填起來。
 * 一起附上放 Cloudflare 小工具的框框（有設定 Turnstile 才會出現，會移到送出按鈕上面）。
 * 放進表單裡，送出時 apiHuman 會順便讀它們。
 */
export function honeypot() {
  const slot = el('div', { class: 'ts-slot', hidden: true });
  if (typeof window !== 'undefined') renderWhenShown(slot);
  return el('div', { class: 'human-check' }, [
    el('div', { class: 'hp-field', 'aria-hidden': 'true' }, [
      el('label', {}, ['網站（請留白）', el('input', {
        type: 'text', name: 'hp_website', tabindex: '-1', autocomplete: 'off',
      })]),
    ]),
    slot,
  ]);
}

/** 跳出一題，回傳答案（按取消就是 null）。 */
function askChallenge(challenge, wrong) {
  return new Promise((resolve) => {
    const input = el('input', {
      type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '3',
      'aria-label': '答案', class: 'hc-answer',
    });
    const ok = el('button', { class: 'btn', type: 'submit', text: '確定' });
    const cancel = el('button', { class: 'btn btn-ghost', type: 'button', text: '取消' });
    const form = el('form', { class: 'hc-form' }, [
      el('img', { src: challenge.image, alt: '加法題目（看不到圖的話請重新整理頁面）', class: 'hc-image' }),
      el('div', { class: 'hc-row' }, [el('span', { text: '答案：' }), input]),
      wrong ? el('p', { class: 'hc-wrong', text: '答案不對，換一題再試一次。' }) : null,
    ]);
    const dialog = el('dialog', { class: 'hc-dialog' }, [
      el('div', { class: 'dlg-head', text: '🤖 確認一下你不是機器人' }),
      el('div', { class: 'dlg-body' }, [
        el('p', { class: 'help', style: 'margin:0 0 10px', text: '請算出圖上的加法，填數字就好。' }),
        form,
      ]),
      el('div', { class: 'dlg-foot' }, [cancel, ok]),
    ]);
    let answer = null;
    const done = () => dialog.close();
    form.addEventListener('submit', (e) => { e.preventDefault(); answer = input.value; done(); });
    ok.addEventListener('click', (e) => { e.preventDefault(); answer = input.value; done(); });
    cancel.addEventListener('click', done);
    dialog.addEventListener('close', () => { dialog.remove(); resolve(answer); });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}

/**
 * 前台送出用的 api()：自動帶上人機驗證需要的東西。
 * 用 Turnstile 時帶通行碼；沒有的話帶入場券，伺服器要出題就跳題目、答完再送一次。
 * form：這一次送出的表單（讀它裡面的陷阱欄位），沒有就找頁面上的。
 */
export async function apiHuman(path, { body = {}, form = null, ...rest } = {}) {
  const trap = (form || document).querySelector('input[name="hp_website"]');
  const config = await humanConfig();
  const human = { ticket: config.ticket || '', website: trap ? trap.value : '' };
  for (let tries = 0; tries < 5; tries += 1) {
    if (config.turnstile) human.turnstile = await turnstileToken(form);
    try {
      return await api(path, { method: 'POST', ...rest, body: { ...body, human } });
    } catch (err) {
      if (err.status !== 428) throw err;
      // Turnstile 的通行碼沒過：重新拿一個再送（最多再試一次）
      if (err.data?.turnstile) {
        if (tries >= 1) throw err;
        continue;
      }
      if (!err.data?.challenge) throw err;
      const answer = await askChallenge(err.data.challenge, err.data.wrong);
      if (answer === null) throw new Error('已取消送出。');
      human.challengeToken = err.data.challenge.token;
      human.answer = answer;
    }
  }
  throw new Error('驗證沒有通過，請重新整理頁面再試一次。');
}
