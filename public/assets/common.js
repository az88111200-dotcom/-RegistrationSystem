// 前後台共用的小工具：API 呼叫、日期格式、動態表單產生。

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

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 2026-08-14 → 2026/08/14（五） */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso || '';
  const d = new Date(`${iso}T00:00:00+08:00`);
  return `${m[1]}/${m[2]}/${m[3]}（${WEEKDAYS[d.getUTCDay()]}）`;
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
  const wrap = el('div', { class: `field${field.type === 'checkbox' || field.type === 'radio' ? ' span-2' : ''}` });
  const id = `f_${field.key}`;
  const labelText = [
    el('span', { text: field.label }),
    field.required ? el('span', { class: 'req', text: '*' }) : null,
  ];

  if (field.type === 'radio' || field.type === 'checkbox') {
    wrap.append(el('div', { class: 'field-label' }, labelText));
    if (field.help) wrap.append(el('p', { class: 'help', text: field.help }));

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
  if (field.help) wrap.append(el('p', { class: 'help', text: field.help }));

  const input = el('input', {
    id,
    name: field.key,
    type: field.type === 'date' ? 'date' : field.type,
    value: value ?? field.default ?? '',
    autocomplete: field.autocomplete || 'off',
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
    // 生日欄位下方即時顯示民國年，讓工作人員核對保險資料方便
    return wrap;
  }

  wrap.append(input);

  if (field.type === 'date') {
    const roc = el('p', { class: 'help', text: value ? `民國 ${toRoc(value)}` : '' });
    input.addEventListener('input', () => {
      roc.textContent = input.value ? `民國 ${toRoc(input.value)}` : '';
    });
    wrap.append(roc);
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
