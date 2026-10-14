// 後台：前後測題庫。
//
// 每個活動的題目都不一樣，但都是從這裡挑出去的，所以題目本身只寫一次。
// 用過的題目不能刪只能停用 —— 舊活動的作答是照題目代號存的。

import { api, $, el, showNotice, hideNotice } from './common.js';
import { requireLogin, adminHeader, confirmDelete } from './admin-common.js';
import { questionForm as sharedQuestionForm } from './admin-question-form.js';

let questions = [];
let typeLabels = {};
let scaleLabels = [];
let query = '';
let showArchived = false;

const notice = el('div', { class: 'notice', hidden: true });
const listSlot = el('div');

// ---------------------------------------------------------------- 新增／編輯

// 表單本身在 admin-question-form.js，活動的挑題畫面（當場寫一題新的）也用同一份
const questionForm = (values = {}) => sharedQuestionForm(values, { scaleLabels: () => scaleLabels });

let createForm = null;
function createPanel() {
  const form = questionForm();
  createForm = form;
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
      details.open = false;
      const fresh = createPanel();
      details.replaceWith(fresh);
      await load();
      // 放在 load() 之後：load 一開始會把提示收掉
      showNotice(notice, 'ok', `已加入題庫：${question.text}`);
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
      await load();
      showNotice(notice, 'ok', '題目已更新。');
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
  createForm?.refresh();
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
