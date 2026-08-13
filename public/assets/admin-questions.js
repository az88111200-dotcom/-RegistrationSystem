// 後台：前後測題庫。
//
// 每個活動的題目都不一樣，但都是從這裡挑出去的，所以題目本身只寫一次。
// 用過的題目不能刪只能停用 —— 舊活動的作答是照題目代號存的。

import { api, $, el, showNotice, hideNotice } from './common.js';
import { requireLogin, adminHeader, confirmDelete } from './admin-common.js';

let questions = [];
let typeLabels = {};
let scaleLabels = [];
let query = '';
let showArchived = false;

const notice = el('div', { class: 'notice', hidden: true });
const listSlot = el('div');

const TYPES = [
  ['scale', '1-5 分量表', '前後測的主力。前後相減就知道進步幾分。'],
  ['single', '單選', '從幾個選項挑一個。'],
  ['multi', '複選', '可以挑很多個。'],
  ['text', '簡答', '自由書寫，質性資料用。'],
];

// ---------------------------------------------------------------- 新增／編輯

/**
 * 題目的編輯表單。
 * 題型選「單選」或「複選」才需要選項，所以選項那格會跟著題型出現或收起來。
 */
function questionForm(values = {}) {
  const form = el('form', { novalidate: true });

  const textInput = el('textarea', {
    id: 'q_text', name: 'text', rows: 2,
    placeholder: '例：我知道遇到困難的時候可以找誰幫忙',
  });
  textInput.value = values.text || '';

  const categoryInput = el('input', {
    id: 'q_category', name: 'category', type: 'text',
    placeholder: '例：自我效能、人際支持、情緒管理',
  });
  categoryInput.value = values.category || '';

  const optionsInput = el('textarea', {
    id: 'q_options', name: 'options', rows: 4,
    placeholder: '一行一個選項\n溝通表達\n情緒管理\n團隊合作',
  });
  optionsInput.value = (values.options || []).join('\n');

  const optionsField = el('div', { class: 'field span-2' }, [
    el('label', { for: 'q_options' }, [
      el('span', { text: '選項' }),
      el('span', { class: 'req', text: '*' }),
      el('span', { class: 'help', text: '一行一個，至少兩個' }),
    ]),
    optionsInput,
  ]);

  // 量表的 5 級是全園統一的，這裡只是讓工作人員知道少年會看到什麼
  const scaleHint = el('p', { class: 'help', style: 'margin:0' },
    `少年會看到：${scaleLabels.map((l, i) => `${i + 1} ${l}`).join('　')}`);
  const scaleField = el('div', { class: 'field span-2' }, [scaleHint]);

  let type = values.type || 'scale';
  const syncType = () => {
    optionsField.hidden = type !== 'single' && type !== 'multi';
    scaleField.hidden = type !== 'scale';
  };
  const typeChoices = TYPES.map(([value, label, tip]) => {
    const radio = el('input', { type: 'radio', name: 'type', value });
    radio.checked = value === type;
    radio.addEventListener('change', () => { type = value; syncType(); });
    return el('label', { class: 'choice', title: tip }, [radio, el('span', { text: label })]);
  });
  syncType();

  const archivedBox = el('input', { type: 'checkbox', name: 'archived' });
  archivedBox.checked = values.archived === true;

  form.append(el('div', { class: 'grid-2' }, [
    el('div', { class: 'field span-2' }, [
      el('label', { for: 'q_text' }, [
        el('span', { text: '題目' }),
        el('span', { class: 'req', text: '*' }),
      ]),
      textInput,
    ]),
    el('div', { class: 'field span-2' }, [
      el('div', { class: 'field-label' }, [
        el('span', { text: '題型' }),
        el('span', { class: 'help', text: '量表題才算得出前後差幾分' }),
      ]),
      el('div', { class: 'choices' }, typeChoices),
    ]),
    scaleField,
    optionsField,
    el('div', { class: 'field span-2' }, [
      el('label', { for: 'q_category' }, [
        el('span', { text: '分類' }),
        el('span', { class: 'help', text: '挑題時好找，可留白' }),
      ]),
      categoryInput,
    ]),
    el('div', { class: 'field span-2' }, [
      el('div', { class: 'choices' }, [
        el('label', { class: 'choice' }, [archivedBox, el('span', { text: '停用（挑題時不出現）' })]),
      ]),
    ]),
  ]));

  form.readValues = () => ({
    text: textInput.value.trim(),
    type,
    category: categoryInput.value.trim(),
    archived: archivedBox.checked,
    options: optionsInput.value.split('\n').map((s) => s.trim()).filter(Boolean),
  });
  return form;
}

function createPanel() {
  const form = questionForm();
  const button = el('button', { class: 'btn', type: 'submit', text: '加進題庫' });
  form.append(el('div', { class: 'row row-end' }, [button]));

  const details = el('details', { class: 'editor' }, [
    el('summary', { text: '新增題目' }),
    el('div', { class: 'editor-body' }, form),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      const { question } = await api('/api/admin/questions', { method: 'POST', body: form.readValues() });
      showNotice(notice, 'ok', `已加入題庫：${question.text}`);
      details.open = false;
      const fresh = createPanel();
      details.replaceWith(fresh);
      await load();
    } catch (err) {
      showNotice(notice, 'error', err.message);
    } finally {
      button.disabled = false;
    }
  });
  return details;
}

function openEditor(question) {
  const dialog = el('dialog');
  const form = questionForm(question);
  const save = el('button', { class: 'btn', text: '儲存' });
  const close = () => { dialog.close(); dialog.remove(); };

  save.addEventListener('click', async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      await api(`/api/admin/questions/${question.id}`, { method: 'PATCH', body: form.readValues() });
      close();
      showNotice(notice, 'ok', '題目已更新。');
      await load();
    } catch (err) {
      showNotice(notice, 'error', err.message);
      close();
    } finally {
      save.disabled = false;
    }
  });

  dialog.append(
    el('div', { class: 'dlg-head', text: '編輯題目' }),
    el('div', { class: 'dlg-body' }, form),
    el('div', { class: 'dlg-foot' }, [
      el('button', { class: 'btn btn-ghost', text: '取消', onClick: close }),
      save,
    ]),
  );
  dialog.addEventListener('cancel', close);
  document.body.append(dialog);
  dialog.showModal();
}

// ---------------------------------------------------------------- 列表

function questionRow(q) {
  return el('tr', {}, [
    el('td', { class: 'wrap-cell' }, [
      el('div', { style: 'font-weight:700', text: q.text }),
      q.options.length
        ? el('div', { class: 'help', style: 'margin:2px 0 0', text: q.options.join('｜') })
        : null,
    ]),
    el('td', {}, el('span', { class: 'pill', text: typeLabels[q.type] || q.type })),
    el('td', { text: q.category || '—' }),
    el('td', { class: 'num', text: q.usedBy ? `${q.usedBy} 個活動` : '—' }),
    el('td', {}, q.archived
      ? el('span', { class: 'badge badge-closed', text: '已停用' })
      : el('span', { class: 'badge badge-open', text: '使用中' })),
    el('td', {}, el('div', { class: 'row', style: 'flex-wrap:nowrap' }, [
      el('button', { class: 'btn btn-ghost btn-sm', text: '編輯', onClick: () => openEditor(q) }),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        text: q.archived ? '重新啟用' : '停用',
        onClick: async () => {
          try {
            await api(`/api/admin/questions/${q.id}`, {
              method: 'PATCH', body: { archived: !q.archived },
            });
            await load();
          } catch (err) {
            showNotice(notice, 'error', err.message);
          }
        },
      }),
      el('button', {
        class: 'btn btn-danger btn-sm', text: '刪除',
        onClick: async () => {
          const yes = await confirmDelete({
            title: '刪除這一題？',
            message: `「${q.text}」會從題庫消失。已經被活動用過的題目不能刪，請改用「停用」。`,
            confirmWord: '刪除',
            danger: '刪除這一題',
          });
          if (!yes) return;
          try {
            await api(`/api/admin/questions/${q.id}`, { method: 'DELETE' });
            showNotice(notice, 'ok', '題目已刪除。');
            await load();
          } catch (err) {
            showNotice(notice, 'error', err.message);
          }
        },
      }),
    ])),
  ]);
}

function renderList() {
  const q = query.toLowerCase();
  const rows = questions
    .filter((x) => showArchived || !x.archived)
    .filter((x) => !q || `${x.text} ${x.category}`.toLowerCase().includes(q));

  listSlot.innerHTML = '';
  if (!rows.length) {
    listSlot.append(el('div', { class: 'empty' }, [
      el('strong', { text: questions.length ? '沒有符合的題目' : '題庫還是空的' }),
      el('p', { class: 'help', text: '按上面的「新增題目」加第一題。之後每個活動都從這裡挑題。' }),
    ]));
    return;
  }

  // 照分類分段，題目一多才找得到
  const groups = new Map();
  for (const item of rows) {
    const key = item.category || '未分類';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  for (const [category, items] of groups) {
    listSlot.append(
      el('h2', { class: 'section-title', text: `${category}（${items.length} 題）` }),
      el('div', { class: 'table-scroll' }, [
        el('table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: '題目' }), el('th', { text: '題型' }), el('th', { text: '分類' }),
            el('th', { class: 'num', text: '用過' }), el('th', { text: '狀態' }), el('th', { text: '操作' }),
          ])),
          el('tbody', {}, items.map(questionRow)),
        ]),
      ]),
    );
  }
}

async function load() {
  hideNotice(notice);
  const data = await api('/api/admin/questions');
  questions = data.questions;
  typeLabels = data.typeLabels;
  scaleLabels = data.scaleLabels;
  renderList();
}

(async () => {
  await requireLogin();
  const root = $('#root');
  root.innerHTML = '';

  const search = el('input', {
    type: 'search', class: 'search', placeholder: '搜尋題目或分類…', 'aria-label': '搜尋題目',
  });
  search.addEventListener('input', () => { query = search.value.trim(); renderList(); });

  const archivedBox = el('input', { type: 'checkbox' });
  archivedBox.addEventListener('change', () => { showArchived = archivedBox.checked; renderList(); });

  root.append(
    adminHeader('/admin/questions'),
    el('main', { class: 'wrap-wide' }, [
      el('div', { class: 'page-head' }, [
        el('h1', { text: '前後測題庫' }),
        el('p', {},
          '題目寫在這裡，每個活動再從這裡挑適合的題目。'
          + '同一題被不同活動用，前後測的數字就能互相比較。'),
      ]),
      notice,
      createPanel(),
      el('div', { class: 'row', style: 'margin:18px 0 4px' }, [
        search,
        el('label', { class: 'choice' }, [archivedBox, el('span', { text: '顯示已停用的題目' })]),
      ]),
      listSlot,
    ]),
  );

  try {
    await load();
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
})();
