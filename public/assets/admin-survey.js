// 後台：某個活動的前後測分頁。
//
// 三件事在同一頁：挑題、開放填寫、看結果。
// 挑題跟看結果分開兩塊 —— 課前在挑題，課後在看結果，不會同時用到。

import { api, el, showNotice, hideNotice, formatDate } from './common.js';
import { qrSvg } from './qr.js';
import { confirmDelete } from './admin-common.js';

const PHASE_LABEL = { pre: '前測', post: '後測', both: '前後測都問' };

/** 前後測的網址。QR 印出來給少年掃，連結可以貼在 LINE 群組。 */
function surveyUrl(base, slug, phase) {
  return `${base}/survey/${encodeURIComponent(slug)}/${phase}`;
}

// ---------------------------------------------------------------- 挑題

/**
 * 從題庫挑題。
 *
 * 左邊是題庫（照分類分段），勾起來就加到右邊；右邊是這個活動用的題目，
 * 可以調順序、改「前測／後測／前後都問」。
 * 要比較前後差異的題目一定要選「前後都問」—— 只出現一邊的題目沒得比，
 * 所以每一題旁邊都寫明白，不用另外去看說明。
 */
function pickerPanel({ bank, picked, onChange }) {
  const chosen = new Map(picked.map((q) => [q.id, q.phase || 'both']));
  const order = picked.map((q) => q.id);

  const chosenSlot = el('div');
  const bankSlot = el('div');
  let bankQuery = '';

  const emit = () => onChange(order.map((id) => ({ questionId: id, phase: chosen.get(id) })));

  function redrawChosen() {
    chosenSlot.innerHTML = '';
    if (!order.length) {
      chosenSlot.append(el('div', { class: 'empty' }, [
        el('strong', { text: '還沒挑題目' }),
        el('p', { class: 'help', text: '從下面的題庫勾選要用的題目。沒有題目的話，少年掃 QR 進來會看到空白。' }),
      ]));
      return;
    }
    chosenSlot.append(el('div', { class: 'table-scroll' }, [
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: '#' }), el('th', { text: '題目' }), el('th', { text: '題型' }),
          el('th', { text: '出現在' }), el('th', { text: '順序' }), el('th', { text: '' }),
        ])),
        el('tbody', {}, order.map((id, i) => {
          const q = bank.find((b) => b.id === id);
          if (!q) return null;
          const select = el('select', {}, ['both', 'pre', 'post'].map((p) => {
            const o = el('option', { value: p, text: PHASE_LABEL[p] });
            if (chosen.get(id) === p) o.selected = true;
            return o;
          }));
          select.addEventListener('change', () => { chosen.set(id, select.value); emit(); });

          const move = (delta) => {
            const target = i + delta;
            if (target < 0 || target >= order.length) return;
            [order[i], order[target]] = [order[target], order[i]];
            redrawChosen();
            emit();
          };

          return el('tr', {}, [
            el('td', { class: 'num', text: String(i + 1) }),
            el('td', { class: 'wrap-cell' }, [
              el('div', { style: 'font-weight:700', text: q.text }),
              q.category ? el('div', { class: 'help', style: 'margin:2px 0 0', text: q.category }) : null,
            ]),
            el('td', {}, el('span', { class: 'pill', text: q.type === 'scale' ? '量表' : q.type })),
            el('td', {}, [
              select,
              q.type === 'scale' && chosen.get(id) !== 'both'
                ? el('div', { class: 'help', style: 'margin:2px 0 0;color:var(--danger)', text: '只問一邊就比不出前後差異' })
                : null,
            ]),
            el('td', {}, el('div', { class: 'row', style: 'flex-wrap:nowrap;gap:4px' }, [
              el('button', { class: 'btn btn-ghost btn-sm', text: '↑', title: '往上', onClick: () => move(-1) }),
              el('button', { class: 'btn btn-ghost btn-sm', text: '↓', title: '往下', onClick: () => move(1) }),
            ])),
            el('td', {}, el('button', {
              class: 'btn btn-danger btn-sm', text: '移除',
              onClick: () => {
                chosen.delete(id);
                order.splice(i, 1);
                redrawChosen();
                redrawBank();
                emit();
              },
            })),
          ]);
        })),
      ]),
    ]));
  }

  function redrawBank() {
    const q = bankQuery.toLowerCase();
    // 停用的題目不出現在挑題清單 —— 那正是「停用」的用途
    const available = bank
      .filter((b) => !b.archived && !chosen.has(b.id))
      .filter((b) => !q || `${b.text} ${b.category}`.toLowerCase().includes(q));

    bankSlot.innerHTML = '';
    if (!bank.length) {
      bankSlot.append(el('div', { class: 'empty' }, [
        el('strong', { text: '題庫是空的' }),
        el('p', { class: 'help' }, [
          el('span', { text: '要先到 ' }),
          el('a', { href: '/admin/questions', text: '前後測題庫' }),
          el('span', { text: ' 建題目，這裡才挑得到。' }),
        ]),
      ]));
      return;
    }
    if (!available.length) {
      bankSlot.append(el('p', { class: 'help', text: '題庫裡的題目都挑進來了，或沒有符合搜尋的題目。' }));
      return;
    }

    const groups = new Map();
    for (const item of available) {
      const key = item.category || '未分類';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    for (const [category, items] of groups) {
      bankSlot.append(
        el('div', { class: 'field-label', style: 'margin-top:12px' }, category),
        el('div', { class: 'chip-list' }, items.map((item) => el('button', {
          type: 'button', class: 'btn btn-ghost btn-sm',
          title: item.text,
          onClick: () => {
            chosen.set(item.id, 'both');
            order.push(item.id);
            redrawChosen();
            redrawBank();
            emit();
          },
        }, [
          el('span', { text: `＋ ${item.text}` }),
        ]))),
      );
    }
  }

  const search = el('input', {
    type: 'search', class: 'search', placeholder: '搜尋題庫…', 'aria-label': '搜尋題庫',
  });
  search.addEventListener('input', () => { bankQuery = search.value.trim(); redrawBank(); });

  redrawChosen();
  redrawBank();

  return el('div', {}, [
    el('h3', { class: 'section-title', style: 'margin-top:0', text: '這個活動要問的題目' }),
    chosenSlot,
    el('h3', { class: 'section-title', text: '從題庫加題目' }),
    el('p', { class: 'help', style: 'margin:-6px 0 10px' }, [
      el('span', { text: '點題目就加進去。題目要先建在 ' }),
      el('a', { href: '/admin/questions', text: '前後測題庫' }),
      el('span', { text: '，這裡才挑得到；停用的題目不會出現。' }),
    ]),
    search,
    bankSlot,
  ]);
}

// ---------------------------------------------------------------- 結果

function diffCell(diff) {
  if (diff === null || diff === undefined) return el('td', { class: 'num', text: '—' });
  const cls = diff > 0 ? 'diff-up' : (diff < 0 ? 'diff-down' : 'diff-same');
  return el('td', { class: `num ${cls}`, text: `${diff > 0 ? '+' : ''}${diff}` });
}

function statsTable(results) {
  if (!results.stats.length) {
    return el('p', { class: 'help' },
      '沒有可以比較的題目。要比出前後差異，題目必須是「1-5 分量表」而且設成「前後測都問」。');
  }
  return el('div', { class: 'table-scroll' }, [
    el('table', { class: 'survey-stat-table' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: '題目' }),
        el('th', { class: 'num', text: '人數' }),
        el('th', { class: 'num', text: '前測' }),
        el('th', { class: 'num', text: '後測' }),
        el('th', { class: 'num', text: '進步' }),
        el('th', { class: 'num', text: '進步/持平/退步' }),
      ])),
      el('tbody', {}, results.stats.map((s) => el('tr', {}, [
        el('td', { class: 'wrap-cell' }, [
          el('div', { style: 'font-weight:700', text: s.text }),
          s.category ? el('div', { class: 'help', style: 'margin:2px 0 0', text: s.category }) : null,
        ]),
        el('td', { class: 'num', text: String(s.n) }),
        el('td', { class: 'num', text: s.pre === null ? '—' : s.pre.toFixed(2) }),
        el('td', { class: 'num', text: s.post === null ? '—' : s.post.toFixed(2) }),
        diffCell(s.diff),
        el('td', { class: 'num', text: `${s.improved} / ${s.same} / ${s.dropped}` }),
      ]))),
    ]),
  ]);
}

/** 每個人自己的前 → 後。量表題直接標出進退步。 */
function peopleTable(results, onReload) {
  if (!results.people.length) {
    return el('div', { class: 'empty' }, [
      el('strong', { text: '還沒有人填' }),
      el('p', { class: 'help', text: '把上面的 QR 或連結給少年，填完就會出現在這裡。' }),
    ]);
  }
  const scaleBoth = results.questions.filter((q) => q.type === 'scale' && q.phase === 'both');

  return el('div', { class: 'table-scroll' }, [
    el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: '姓名' }),
        el('th', { text: '前測' }),
        el('th', { text: '後測' }),
        ...scaleBoth.map((q, i) => el('th', { class: 'num', title: q.text, text: `Q${i + 1}` })),
        el('th', { text: '操作' }),
      ])),
      el('tbody', {}, results.people.map((p) => el('tr', {}, [
        el('td', { style: 'font-weight:700', text: p.name }),
        el('td', {}, p.preAt
          ? el('span', { class: 'badge badge-open', text: p.preAt.slice(5, 16) })
          : el('span', { class: 'badge badge-closed', text: '未填' })),
        el('td', {}, p.postAt
          ? el('span', { class: 'badge badge-open', text: p.postAt.slice(5, 16) })
          : el('span', { class: 'badge badge-closed', text: '未填' })),
        ...scaleBoth.map((q) => {
          const pre = p.pre?.[q.id];
          const post = p.post?.[q.id];
          if (pre === undefined && post === undefined) return el('td', { class: 'num', text: '—' });
          if (pre === undefined || post === undefined) {
            return el('td', { class: 'num', text: `${pre ?? '—'} → ${post ?? '—'}` });
          }
          const cls = post > pre ? 'diff-up' : (post < pre ? 'diff-down' : 'diff-same');
          return el('td', { class: `num ${cls}`, text: `${pre} → ${post}` });
        }),
        el('td', {}, el('div', { class: 'row', style: 'flex-wrap:nowrap;gap:4px' }, [
          p.preId ? el('button', {
            class: 'btn btn-ghost btn-sm', text: '刪前測',
            onClick: () => removeOne(p.preId, `${p.name} 的前測`, onReload),
          }) : null,
          p.postId ? el('button', {
            class: 'btn btn-ghost btn-sm', text: '刪後測',
            onClick: () => removeOne(p.postId, `${p.name} 的後測`, onReload),
          }) : null,
        ])),
      ]))),
    ]),
  ]);
}

async function removeOne(id, label, onReload) {
  const yes = await confirmDelete({
    title: '刪除這筆作答？',
    message: `${label} 會被刪掉，少年可以重新填一次。`,
    confirmWord: '刪除',
    danger: '刪除這筆作答',
  });
  if (!yes) return;
  await api(`/api/admin/survey-responses/${id}`, { method: 'DELETE' });
  await onReload();
}

// ---------------------------------------------------------------- 分頁本體

export async function renderSurvey(container, activityId, notice) {
  container.innerHTML = '';
  container.append(el('p', { class: 'loading', text: '載入中…' }));

  const [results, bankData, picked, site] = await Promise.all([
    api(`/api/admin/activities/${activityId}/survey`),
    api('/api/admin/questions'),
    api(`/api/admin/activities/${activityId}/questions`),
    api('/api/admin/site').catch(() => ({ baseUrl: location.origin })),
  ]);
  const base = site.baseUrl || location.origin;
  const { activity } = results;
  const reload = () => renderSurvey(container, activityId, notice);

  container.innerHTML = '';

  // ---- 開關與連結
  const toggle = (phase, label) => {
    const box = el('input', { type: 'checkbox' });
    box.checked = phase === 'pre' ? activity.preSurveyOpen : activity.postSurveyOpen;
    box.addEventListener('change', async () => {
      try {
        hideNotice(notice);
        await api(`/api/admin/activities/${activityId}`, {
          method: 'PATCH',
          body: { [phase === 'pre' ? 'preSurveyOpen' : 'postSurveyOpen']: box.checked },
        });
        showNotice(notice, 'ok', `${label}已${box.checked ? '開放' : '關閉'}填寫。`);
      } catch (err) {
        box.checked = !box.checked;
        showNotice(notice, 'error', err.message);
      }
    });
    return el('label', { class: 'choice' }, [box, el('span', { text: `開放填寫${label}` })]);
  };

  const linkBlock = (phase, label) => {
    const url = surveyUrl(base, activity.slug, phase);
    const copy = el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', text: '複製連結',
      onClick: async (event) => {
        try {
          await navigator.clipboard.writeText(url);
          event.target.textContent = '已複製 ✓';
        } catch {
          window.prompt('請複製這個連結：', url);
        }
        setTimeout(() => { event.target.textContent = '複製連結'; }, 1600);
      },
    });
    const qr = el('div', { style: 'width:150px;flex:0 0 auto' });
    qr.innerHTML = qrSvg(url, { scale: 4 });
    return el('div', { class: 'card', style: 'flex:1 1 320px' }, [
      el('div', { style: 'font-weight:800;margin-bottom:8px', text: label }),
      toggle(phase, label),
      el('div', { class: 'row', style: 'margin-top:12px;align-items:flex-start' }, [
        qr,
        el('div', { class: 'survey-links', style: 'flex:1 1 180px' }, [
          el('code', { text: url }),
          el('div', { class: 'survey-link-row' }, [
            copy,
            el('a', { class: 'btn btn-ghost btn-sm', href: url, target: '_blank', rel: 'noopener', text: '預覽 ↗' }),
          ]),
        ]),
      ]),
    ]);
  };

  container.append(
    el('div', { class: 'stat-grid' }, [
      ['前測回收', results.counts.pre],
      ['後測回收', results.counts.post],
      ['前後都填', results.counts.both],
      ['題目數', results.questions.length],
    ].map(([l, n]) => el('div', { class: 'stat' }, [
      el('div', { class: 'n', text: String(n) }),
      el('div', { class: 'l', text: l }),
    ]))),
    el('p', { class: 'help', style: 'margin:0 0 14px' },
      '前測在第一堂課開始前填、後測在最後一堂課結束時填。'
      + '各自有自己的 QR，用哪一張就決定少年填到哪一份。'),
    el('div', { class: 'row', style: 'align-items:stretch' }, [
      linkBlock('pre', '前測'),
      linkBlock('post', '後測'),
    ]),
  );

  // ---- 挑題
  let draft = picked.questions.map((q) => ({ questionId: q.id, phase: q.phase }));
  const saveBtn = el('button', { class: 'btn', text: '儲存題目設定' });
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      hideNotice(notice);
      await api(`/api/admin/activities/${activityId}/questions`, {
        method: 'PUT', body: { questions: draft },
      });
      showNotice(notice, 'ok', '題目設定已儲存。');
      await reload();
    } catch (err) {
      showNotice(notice, 'error', err.message);
      saveBtn.disabled = false;
    }
  });

  const picker = pickerPanel({
    bank: bankData.questions,
    picked: picked.questions,
    onChange: (next) => { draft = next; saveBtn.disabled = false; },
  });

  container.append(el('details', { class: 'editor', style: 'margin-top:20px' }, [
    el('summary', { text: `題目設定（目前 ${picked.questions.length} 題）` }),
    el('div', { class: 'editor-body' }, [
      picker,
      el('div', { class: 'row row-end', style: 'margin-top:16px' }, [saveBtn]),
    ]),
  ]));

  // ---- 結果
  container.append(
    el('h2', { class: 'section-title', text: '整體成效（每一題的前後平均）' }),
    statsTable(results),
    el('h2', { class: 'section-title', text: '每個人的前後對照' }),
    results.people.length
      ? el('p', { class: 'help', style: 'margin:-6px 0 10px' },
        `Q1…Qn 依序是「1-5 分量表且前後測都問」的題目：${
          results.questions.filter((q) => q.type === 'scale' && q.phase === 'both')
            .map((q, i) => `Q${i + 1} ${q.text}`).join('　')}`)
      : null,
    peopleTable(results, reload),
    el('div', { class: 'row', style: 'margin-top:16px' }, [
      el('a', {
        class: 'btn btn-ghost',
        href: `/api/admin/activities/${encodeURIComponent(activityId)}/survey.csv`,
        download: `${activity.title.replace(/[\\/:*?"<>|]+/g, '_')}_前後測.csv`,
        text: '⬇ 下載前後測資料（CSV）',
      }),
      el('span', { class: 'help', style: 'margin:0', text: `${formatDate(activity.eventDate || '')}` }),
    ]),
  );
}
