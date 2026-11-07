// 後台：某個活動的前後測分頁。
//
// 最上面是「填寫進度」：切前測／後測，誰還沒填一眼看到，每 10 秒自動更新；
// 開放填寫、連結、投影 QR 也在那裡。下面的題目設定與各種結果都收起來，要看再點開。

import { api, el, showNotice, hideNotice, formatDate } from './common.js';
import { confirmDelete, copyLink, showQrDialog } from './admin-common.js';
import { questionForm } from './admin-question-form.js';

const PHASE_LABEL = { pre: '前測', post: '後測', both: '前後測都問' };
const TYPE_LABEL = { scale: '量表', single: '單選', multi: '複選', text: '開放式問答' };

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
function pickerPanel({ bank, picked, onChange, persist, scaleLabels = [] }) {
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
            el('td', {}, el('span', { class: 'pill', text: TYPE_LABEL[q.type] || q.type })),
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
          el('span', { text: '用下面的「直接寫一題新的」，或到 ' }),
          el('a', { href: '/admin/questions', text: '前後測題庫' }),
          el('span', { text: ' 建題目。' }),
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
        el('div', { class: 'bank-cat' }, [
          el('span', { text: category }),
          el('span', { class: 'bank-cat-n', text: `${items.length} 題` }),
        ]),
        el('div', { class: 'chip-list bank-chips' }, items.map((item) => el('button', {
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

  /*
   * 題庫裡沒有想要的題目：當場寫一題。存進題庫（之後別的活動也挑得到），
   * 同時直接加進這個活動的題目，不用跳去題庫頁再回來。
   */
  const addNotice = el('div', { class: 'notice', hidden: true });
  let addForm = null;
  const addBody = el('div');
  // 寫新題目的那一塊：平常收著，按最上面的大按鈕才打開（打開時醒目一點，看得出正在新增）
  const addCard = el('div', { class: 'new-question', hidden: true }, [
    el('div', { class: 'new-question-head' }, [
      el('strong', { text: '✏️ 寫一題新的題目' }),
      el('span', { class: 'help', style: 'margin:0', text: '存進題庫（別的活動也挑得到），同時加進這個活動' }),
    ]),
    addNotice,
    addBody,
  ]);
  const openButton = el('button', { type: 'button', class: 'btn btn-sun', text: '✏️ 寫一題新的題目' });
  const topRow = el('div', { class: 'picker-top' }, [
    openButton,
    el('span', { class: 'help', style: 'margin:0' }, '題庫裡沒有想問的？直接寫一題，會加進下面的清單。'),
  ]);
  const toggleAdd = (open) => {
    addCard.hidden = !open;
    topRow.hidden = open;
    if (open) addCard.querySelector('textarea')?.focus();
  };
  openButton.addEventListener('click', () => toggleAdd(true));

  function resetAddForm() {
    addForm = questionForm({}, { scaleLabels: () => scaleLabels, allowArchive: false, idPrefix: 'nq' });
    const button = el('button', { class: 'btn', type: 'submit', text: '新增並加進這個活動' });
    const cancel = el('button', { class: 'btn btn-ghost', type: 'button', text: '取消', onClick: () => { hideNotice(addNotice); toggleAdd(false); resetAddForm(); } });
    addForm.append(el('div', { class: 'row row-end' }, [cancel, button]));
    addForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideNotice(addNotice);
      button.disabled = true;
      try {
        const { question } = await api('/api/admin/questions', { method: 'POST', body: addForm.readValues() });
        bank.push({ ...question, archived: false });
        chosen.set(question.id, 'both');
        order.push(question.id);
        redrawChosen();
        redrawBank();
        emit();
        // 「新增並加進這個活動」就是要它馬上生效，連同目前挑好的題目一起存
        await persist();
        resetAddForm();
        showNotice(addNotice, 'ok', `✅ 已加進這個活動並存好了：${question.text}。可以接著寫下一題，或按「取消」收起來。`);
      } catch (err) {
        showNotice(addNotice, 'error', err.message);
        button.disabled = false;
      }
    });
    addBody.innerHTML = '';
    addBody.append(addForm);
    addForm.refresh?.();
  }
  resetAddForm();

  const search = el('input', {
    type: 'search', class: 'search', placeholder: '搜尋題庫…', 'aria-label': '搜尋題庫',
  });
  search.addEventListener('input', () => { bankQuery = search.value.trim(); redrawBank(); });

  redrawChosen();
  redrawBank();

  return el('div', {}, [
    // 最上面：題庫沒有的題目直接寫（最常卡住的就是這一步，所以放第一個、按鈕做大）
    topRow,
    addCard,
    el('h3', { class: 'section-title', text: '這個活動要問的題目' }),
    chosenSlot,
    el('h3', { class: 'section-title', text: '從題庫挑題目' }),
    el('p', { class: 'help', style: 'margin:-6px 0 10px' }, [
      el('span', { text: '點一下就加進上面的清單。整理題庫（改字、停用）請到 ' }),
      el('a', { href: '/admin/questions', text: '前後測題庫' }),
      el('span', { text: '。' }),
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
    el('table', { class: 'freeze-name' }, [
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

/**
 * 開放式問答（還有單選、複選）的回答：一題一塊，每個人前測／後測各寫了什麼。
 * 上面的對照表只放得下量表的分數，文字回答要另外列出來才看得到。
 */
function answersSection(results) {
  const qs = results.questions.filter((q) => q.type !== 'scale');
  if (!qs.length || !results.people.length) return null;
  const show = (v) => (Array.isArray(v) ? v.join('、') : String(v ?? '').trim());
  return el('div', {}, qs.map((q) => {
    const phases = q.phase === 'both' ? ['pre', 'post'] : [q.phase];
    const rows = results.people
      .map((p) => ({ name: p.name, values: phases.map((ph) => show(p[ph]?.[q.id])) }))
      .filter((r) => r.values.some(Boolean));
    return el('div', { class: 'card answer-block' }, [
      el('div', { class: 'answer-q' }, [
        el('span', { class: 'pill', text: TYPE_LABEL[q.type] || q.type }),
        el('strong', { text: q.text }),
      ]),
      rows.length
        ? el('div', { class: 'table-scroll' }, el('table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: '姓名' }),
            ...phases.map((ph) => el('th', { text: PHASE_LABEL[ph] })),
          ])),
          el('tbody', {}, rows.map((r) => el('tr', {}, [
            el('td', { style: 'font-weight:700;white-space:nowrap', text: r.name }),
            ...r.values.map((v) => el('td', { class: 'wrap-cell answer-text', text: v || '—' })),
          ]))),
        ]))
        : el('p', { class: 'help', style: 'margin:6px 0 0', text: '還沒有人回答這一題。' }),
    ]);
  }));
}

// ---------------------------------------------------------------- 填寫進度（即時）

/**
 * 某一份（前測／後測）誰填了、誰還沒填。
 *
 * 應該要填的人＝正取的報名者＋有來簽到過的（後端給的 roster）。
 * 後測時，報名了卻一堂都沒來的人通常不會填，分開放，不混在「還沒填」裡一直看到；
 * 活動完全沒用簽到的話（大家都 0 堂）就不分，全部算應該要填。
 */
function progressOf(results, phase) {
  const filled = results.people.filter((p) => p[phase]);
  const filledIds = new Set(filled.map((p) => p.studentId));
  const roster = results.roster || [];
  const waiting = roster.filter((r) => !filledIds.has(r.studentId));
  const anyAttendance = roster.some((r) => r.attended > 0);
  const absent = phase === 'post' && anyAttendance ? waiting.filter((r) => r.attended === 0) : [];
  const missing = waiting.filter((r) => !absent.includes(r));
  const at = (p) => String(p[`${phase}At`] || '');
  return {
    filled: [...filled].sort((a, b) => at(b).localeCompare(at(a))), // 最新填的在前面
    missing,
    absent,
    total: filled.length + missing.length,
  };
}

const AUTO_REFRESH_MS = 10000;

/**
 * 最上面的「填寫進度」：切前測／後測，開關、連結、投影 QR 都在這裡，
 * 下面直接列出還沒填的人。每 10 秒自動更新，課堂上邊收邊看。
 */
function livePanel({ getResults, activity, activityId, base, notice, onRefresh }) {
  const results = () => getResults();
  // 後測開著就先看後測（課程尾聲最常用），不然看前測
  let phase = activity.postSurveyOpen ? 'post' : 'pre';
  const panel = el('div', { class: 'card survey-live' });
  const stamp = el('span', { class: 'help', style: 'margin:0' });
  let lastUpdated = new Date();

  const toggle = (label) => {
    const box = el('input', { type: 'checkbox' });
    box.checked = phase === 'pre' ? activity.preSurveyOpen : activity.postSurveyOpen;
    box.addEventListener('change', async () => {
      try {
        hideNotice(notice);
        await api(`/api/admin/activities/${activityId}`, {
          method: 'PATCH',
          body: { [phase === 'pre' ? 'preSurveyOpen' : 'postSurveyOpen']: box.checked },
        });
        if (phase === 'pre') activity.preSurveyOpen = box.checked; else activity.postSurveyOpen = box.checked;
        showNotice(notice, 'ok', `${label}已${box.checked ? '開放' : '關閉'}填寫。`);
        draw();
      } catch (err) {
        box.checked = !box.checked;
        showNotice(notice, 'error', err.message);
      }
    });
    return el('label', { class: `choice${box.checked ? '' : ' choice-off'}` }, [box, el('span', { text: box.checked ? `${label}開放填寫中` : `${label}還沒開放（勾起來才能填）` })]);
  };

  const nameChip = (name, cls, note = '') => el('span', { class: `name-chip ${cls}` }, [
    el('span', { text: name }),
    note ? el('small', { text: note }) : null,
  ]);

  function draw() {
    const r = results();
    const label = PHASE_LABEL[phase];
    const prog = progressOf(r, phase);
    const url = surveyUrl(base, activity.slug, phase);
    const path = `/survey/${encodeURIComponent(activity.slug)}/${phase}`;
    const pct = prog.total ? Math.round((prog.filled.length / prog.total) * 100) : 0;
    const tabs = el('div', { class: 'tabs survey-tabs' }, ['pre', 'post'].map((ph) => {
      const pg = progressOf(r, ph);
      return el('button', {
        type: 'button', class: 'tab', 'aria-selected': ph === phase ? 'true' : 'false',
        text: `${PHASE_LABEL[ph]}　${pg.filled.length} / ${pg.total || pg.filled.length}`,
        onClick: () => { phase = ph; draw(); },
      });
    }));
    const copy = el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', text: '複製連結',
      onClick: (event) => copyLink(event.currentTarget, url, { idleText: '複製連結' }),
    });
    panel.replaceChildren(
      tabs,
      el('div', { class: 'row survey-live-actions' }, [
        toggle(label),
        el('div', { class: 'row', style: 'gap:6px;margin-left:auto' }, [
          el('button', {
            class: 'btn btn-sm', type: 'button', text: '📱 投影 QR',
            onClick: () => showQrDialog({
              path, title: `${activity.title}　${label}`, big: true,
              note: `少年掃了就會到${label}。下載的圖片下面會印活動名稱跟網址。`,
            }),
          }),
          copy,
          el('a', { class: 'btn btn-ghost btn-sm', href: url, target: '_blank', rel: 'noopener', text: '預覽 ↗' }),
        ]),
      ]),
      el('div', { class: 'live-progress' }, [
        el('div', { class: 'live-count' }, [
          el('strong', { text: String(prog.filled.length) }),
          el('span', { text: ` / ${prog.total} 人已填${label}` }),
          prog.missing.length
            ? el('span', { class: 'live-left', text: `還差 ${prog.missing.length} 人` })
            : (prog.total ? el('span', { class: 'live-done', text: '🎉 全部都填了' }) : null),
        ]),
        el('div', { class: 'live-bar' }, el('div', { style: `width:${pct}%` })),
        stamp,
      ]),
      r.roster?.length
        ? el('div', {}, [
          el('h3', { class: 'live-h', text: `還沒填（${prog.missing.length}）` }),
          prog.missing.length
            ? el('div', { class: 'name-chips' }, prog.missing.map((m) => nameChip(m.name, 'chip-missing',
              !m.registered ? '現場參加' : '')))
            : el('p', { class: 'help', style: 'margin:0', text: '沒有了，大家都填好了。' }),
          prog.absent.length
            ? el('p', { class: 'help', style: 'margin:8px 0 0' },
              `另有 ${prog.absent.length} 位報名了但一堂都沒來，沒算在裡面：${prog.absent.map((a) => a.name).join('、')}`)
            : null,
        ])
        : el('p', { class: 'help', style: 'margin:0' },
          '這個活動還沒有正取的報名者，也還沒有人簽到，所以對不出誰還沒填。填了的人會列在下面。'),
      el('h3', { class: 'live-h', text: `已填（${prog.filled.length}）` }),
      prog.filled.length
        ? el('div', { class: 'name-chips' }, prog.filled.map((p) => nameChip(p.name, 'chip-done',
          String(p[`${phase}At`] || '').slice(11, 16))))
        : el('p', { class: 'help', style: 'margin:0', text: '還沒有人填。' }),
    );
    updateStamp();
  }

  function updateStamp() {
    const t = lastUpdated;
    const hms = [t.getHours(), t.getMinutes(), t.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    stamp.textContent = `最後更新 ${hms}（每 10 秒自動更新）`;
  }

  // 每 10 秒拿一次最新的；分頁看不到時不拿，離開這一頁就停
  const timer = setInterval(async () => {
    if (!panel.isConnected) { clearInterval(timer); return; }
    if (document.hidden) return;
    try {
      await onRefresh();
      lastUpdated = new Date();
      draw();
    } catch { /* 網路一時不通：下一輪再試 */ }
  }, AUTO_REFRESH_MS);

  draw();
  return { panel, redraw: draw };
}

/** 收合的一塊：標題右邊寫重點，點開才看內容（整頁才不會拉那麼長） */
function foldBlock(title, note, body, { open = false } = {}) {
  const box = el('details', { class: 'editor survey-fold' }, [
    el('summary', {}, [el('span', { text: title }), note ? el('span', { class: 'fold-note', text: note }) : null]),
    el('div', { class: 'editor-body' }, body),
  ]);
  box.open = open;
  return box;
}

// ---------------------------------------------------------------- 分頁本體

export async function renderSurvey(container, activityId, notice) {
  container.innerHTML = '';
  container.append(el('p', { class: 'loading', text: '載入中…' }));

  let [results, bankData, picked, site] = await Promise.all([
    api(`/api/admin/activities/${activityId}/survey`),
    api('/api/admin/questions'),
    api(`/api/admin/activities/${activityId}/questions`),
    api('/api/admin/site').catch(() => ({ baseUrl: location.origin })),
  ]);
  const base = site.baseUrl || location.origin;
  const { activity } = results;
  const reload = () => renderSurvey(container, activityId, notice);

  container.innerHTML = '';

  // ---- 最上面：填寫進度（即時）
  const resultsSlot = el('div');
  const live = livePanel({
    getResults: () => results,
    activity,
    activityId,
    base,
    notice,
    onRefresh: async () => {
      results = await api(`/api/admin/activities/${activityId}/survey`);
      drawResults();
    },
  });
  container.append(live.panel);

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
    scaleLabels: bankData.scaleLabels || [],
    picked: picked.questions,
    onChange: (next) => { draft = next; saveBtn.disabled = false; },
    persist: async () => {
      await api(`/api/admin/activities/${activityId}/questions`, { method: 'PUT', body: { questions: draft } });
      saveBtn.disabled = true;
    },
  });

  container.append(
    // 還沒挑題的時候打開，挑好之後就收起來
    foldBlock('題目設定', `目前 ${picked.questions.length} 題`, [
      picker,
      el('div', { class: 'row row-end', style: 'margin-top:16px' }, [saveBtn]),
    ], { open: !picked.questions.length }),
    resultsSlot,
  );

  // ---- 結果：每一塊都收起來，標題右邊寫重點（每 10 秒跟著進度一起更新）
  const openState = new Map();
  function drawResults() {
    // 記住哪幾塊是打開的，自動更新時不要突然收起來
    for (const d of resultsSlot.querySelectorAll('details[data-key]')) openState.set(d.dataset.key, d.open);
    const scaleBoth = results.questions.filter((q) => q.type === 'scale' && q.phase === 'both');
    const answers = answersSection(results);
    const blocks = [
      ['stats', '整體成效（每一題的前後平均）', `前後都填 ${results.counts.both} 人`, [statsTable(results)]],
      ['people', '每個人的前後對照', `${results.people.length} 人填過`, [
        results.people.length && scaleBoth.length
          ? el('p', { class: 'help', style: 'margin:0 0 10px' },
            `Q1…Qn 依序是「1-5 分量表且前後測都問」的題目：${scaleBoth.map((q, i) => `Q${i + 1} ${q.text}`).join('　')}`)
          : null,
        peopleTable(results, reload),
      ]],
      answers ? ['answers', '開放式問答與選擇題的回答', '', [answers]] : null,
    ].filter(Boolean);
    resultsSlot.replaceChildren(
      ...blocks.map(([key, title, note, body]) => {
        const box = foldBlock(title, note, body, { open: openState.get(key) || false });
        box.dataset.key = key;
        return box;
      }),
      el('div', { class: 'row', style: 'margin-top:16px' }, [
        el('a', {
          class: 'btn btn-ghost',
          href: `/api/admin/activities/${encodeURIComponent(activityId)}/survey.xlsx`,
          download: `${activity.title.replace(/[\\/:*?"<>|]+/g, '_')}_前後測.xlsx`,
          text: '⬇ 下載前後測資料（Excel）',
        }),
        el('span', { class: 'help', style: 'margin:0', text: `${formatDate(activity.eventDate || '')}` }),
      ]),
    );
  }
  drawResults();
}
