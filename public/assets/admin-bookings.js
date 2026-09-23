// 後台：場地借用的管理端。外面的人是在前台 /booking 自己登記的，
// 這一頁做的是社工這邊的事：
//
//   ⚡ 社工鎖場地 —— 園內自己要用的時段（不受時數與開館時間限制）
//   ＋ 代登記借用 —— 有人打電話來，社工幫他登記
//   ⛔ 閉館公告 —— 某個空間或整棟在某個時段不開放
//   📥 下載 CSV、每月使用統計、場地本身的維護
//
// 不管從哪裡進來，時段撞到都會被擋下來並講出跟誰撞到 ——
// 包含園裡自己的活動（活動選了空間就會佔用那個空間）。

import { api, $, el, formatDate, showNotice, hideNotice } from './common.js';
import { requireLogin, adminHeader, confirmDelete } from './admin-common.js';

const notice = el('div', { class: 'notice', hidden: true });
const body = el('div');
const formSlot = el('div');

let data = { bookings: [], venues: [], months: [] };
/*
 * 篩選只留「月份」與「場地」兩個。
 *
 * 原本還有「狀態」與「來源」兩個下拉，但那等於要人先想清楚要看什麼
 * 才看得到東西 —— 現在一律全部列出來，每一列自己標「已取消」「閉館公告」
 * 「社工鎖場地」，一眼就分得出來。
 */
const filter = { month: '', venueId: '' };

/** 2026-09 → 2026 年 9 月 */
function monthLabel(m) {
  const parts = /^(\d{4})-(\d{2})$/.exec(m || '');
  return parts ? `${parts[1]} 年 ${Number(parts[2])} 月` : m;
}

const activeVenues = () => data.venues.filter((v) => v.active);

/** 負責工作人員的代號，跟活動那邊同一套。 */
const STAFF_CODES = ['W', 'H', 'V', 'J', 'R', 'L'];
function staffBox(current) {
  const value = String(current || '').toUpperCase();
  const box = el('div', { class: 'choices' });
  for (const code of STAFF_CODES) {
    const input = el('input', { type: 'checkbox', name: 'staffCode', value: code });
    input.checked = value !== 'ALL' && value.includes(code);
    box.append(el('label', { class: 'choice' }, [input, el('span', { text: code })]));
  }
  const all = el('input', { type: 'checkbox', name: 'staffAll' });
  all.checked = value === 'ALL';
  box.append(el('label', { class: 'choice' }, [all, el('span', { text: '全園（ALL）' })]));
  return box;
}

// ---------------------------------------------------------------- 借用單

/**
 * 借用登記表。existing 有值就是修改。
 * 場地、日期、起訖時間、借用人是必填 —— 少了任何一個就判斷不出撞不撞得到。
 */
function openForm(existing) {
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const value = existing || {
    venueId: filter.venueId || (activeVenues()[0]?.id ?? ''),
    date: today,
    startTime: '',
    endTime: '',
    purpose: '',
    org: '',
    borrower: '',
    phone: '',
    headcount: '',
    equipment: '',
    note: '',
  };

  const field = (label, input, help, required = false) => el('div', { class: 'field' }, [
    el('label', {}, [
      el('span', { text: label }),
      required ? el('span', { class: 'req', text: '*' }) : null,
      help ? el('span', { class: 'help', text: help }) : null,
    ]),
    input,
  ]);

  const venue = el('select', { name: 'venueId', required: true });
  // 停用的場地不出現在新的借用單裡，但既有那一筆如果借的是它，要留著才改得動
  const options = data.venues.filter((v) => v.active || v.id === value.venueId);
  for (const v of options) {
    const option = el('option', {
      value: v.id,
      text: v.name + (v.capacity ? `（可容納 ${v.capacity} 人）` : '') + (v.active ? '' : '（已停用）'),
    });
    if (v.id === value.venueId) option.selected = true;
    venue.append(option);
  }

  const formNotice = el('div', { class: 'notice', hidden: true });
  const form = el('form', { class: 'card' }, [
    el('h3', { style: 'margin:0 0 12px;font-size:1.02rem', text: existing ? '修改借用' : '登記借用' }),
    formNotice,
    el('div', { class: 'grid-2' }, [
      field('場地', venue, '', true),
      field('借用日期', el('input', { type: 'date', name: 'date', value: value.date, required: true }), '', true),
      field('開始時間', el('input', { type: 'time', name: 'startTime', value: value.startTime, required: true }), '', true),
      field('結束時間', el('input', { type: 'time', name: 'endTime', value: value.endTime, required: true }), '', true),
      field('借用人', el('input', {
        type: 'text', name: 'borrower', value: value.borrower, required: true,
        placeholder: '聯絡人姓名',
      }), '', true),
      field('借用單位', el('input', {
        type: 'text', name: 'org', value: value.org, placeholder: '例：某某國中輔導室、園內方案',
      })),
      field('聯絡電話', el('input', { type: 'text', name: 'phone', value: value.phone })),
      field('使用人數', el('input', {
        type: 'number', name: 'headcount', min: '0', step: '1',
        value: value.headcount === '' ? '' : String(value.headcount),
      })),
      el('div', { class: 'span-2' }, field('用途', el('input', {
        type: 'text', name: 'purpose', value: value.purpose,
        placeholder: '例：小團體、家長座談、社區共餐',
      }))),
      // 社工自己鎖場地時記一下是誰負責，之後查「誰鎖的」比較快
      el('div', { class: 'span-2' }, field('負責工作人員', staffBox(value.staff || ''),
        '選填。只有後台看得到')),
      el('div', { class: 'span-2' }, field('需要的設備', el('input', {
        type: 'text', name: 'equipment', value: value.equipment,
        placeholder: '例：投影機、音響、桌椅 20 套',
      }))),
      el('div', { class: 'span-2' }, field('備註', el('input', {
        type: 'text', name: 'note', value: value.note,
      }))),
    ]),
    el('div', { class: 'row row-end' }, [
      el('button', { type: 'button', class: 'btn btn-ghost', text: '取消', onClick: closeForm }),
      el('button', { type: 'submit', class: 'btn', text: existing ? '儲存' : '登記' }),
    ]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice(formNotice);
    const values = Object.fromEntries(new FormData(form).entries());
    const staff = form.querySelector('[name="staffAll"]').checked
      ? 'ALL'
      : [...form.querySelectorAll('[name="staffCode"]')]
        .filter((box) => box.checked).map((box) => box.value).join('');
    delete values.staffCode;
    delete values.staffAll;
    try {
      await api(existing ? `/api/admin/bookings/${existing.id}` : '/api/admin/bookings', {
        method: existing ? 'PATCH' : 'POST',
        body: { ...values, staff, headcount: Number(values.headcount) || 0 },
      });
      closeForm();
      // 登記到別的月份也要看得到，直接跳過去那個月
      if (filter.month && values.date.slice(0, 7) !== filter.month) {
        filter.month = values.date.slice(0, 7);
      }
      await load();
      showNotice(notice, 'ok', existing ? '借用紀錄已更新。' : '登記完成。');
    } catch (err) {
      showNotice(formNotice, 'error', err.message);
    }
  });

  formSlot.innerHTML = '';
  formSlot.append(form);
  form.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function closeForm() {
  formSlot.innerHTML = '';
}

/**
 * 閉館公告：其實就是一筆佔著時段的特別紀錄。
 * 那個時段如果已經有人借了，發布之後會列出來提醒你要通知誰 ——
 * 舊系統也是這樣，園方有權休館，但不能讓人家白跑一趟。
 */
function openClosureForm() {
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const venue = el('select', { name: 'venueId', required: true });
  for (const v of activeVenues()) {
    venue.append(el('option', { value: v.id, text: v.name }));
  }
  const field = (label, input, help) => el('div', { class: 'field' }, [
    el('label', {}, [el('span', { text: label }), help ? el('span', { class: 'help', text: help }) : null]),
    input,
  ]);
  const formNotice = el('div', { class: 'notice', hidden: true });
  const form = el('form', { class: 'card' }, [
    el('h3', { style: 'margin:0 0 12px;font-size:1.02rem;color:var(--danger)', text: '⛔ 發布閉館公告' }),
    formNotice,
    el('p', { class: 'help', style: 'margin:0 0 12px' },
      '公告的時段在借用表上會標成休館，外面的人就借不到。整棟都不開放就選「全館」。'),
    el('div', { class: 'grid-2' }, [
      field('空間', venue),
      field('日期', el('input', { type: 'date', name: 'date', value: today, required: true })),
      field('開始', el('input', { type: 'time', name: 'startTime', value: '10:00', required: true })),
      field('結束', el('input', { type: 'time', name: 'endTime', value: '20:30', required: true })),
      el('div', { class: 'span-2' }, field('原因（對外顯示）', el('input', {
        type: 'text', name: 'reason', placeholder: '例：設備維修、中心休館',
      }))),
    ]),
    el('div', { class: 'row row-end' }, [
      el('button', { type: 'button', class: 'btn btn-ghost', text: '取消', onClick: closeForm }),
      el('button', { type: 'submit', class: 'btn btn-danger', text: '發布公告' }),
    ]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice(formNotice);
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await api('/api/admin/closures', { method: 'POST', body: values });
      closeForm();
      if (values.date.slice(0, 7) !== filter.month) filter.month = values.date.slice(0, 7);
      await load();
      showNotice(notice, result.affected.length ? 'error' : 'ok',
        result.affected.length
          ? `已發布閉館公告。⚠️ 這個時段已經有 ${result.affected.length} 筆借用，記得先通知他們：`
            + result.affected.map((a) => `${a.borrower}（${a.venueName} ${a.time}${a.phone ? `，${a.phone}` : ''}）`).join('、')
          : '已發布閉館公告。');
    } catch (err) {
      showNotice(formNotice, 'error', err.message);
    }
  });
  formSlot.innerHTML = '';
  formSlot.append(form);
  form.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/**
 * 社工快速鎖場地。
 *
 * 舊系統的「社工內部快速預約」：只要填活動名稱、空間、時間跟負責人，
 * 其他欄位自動帶（借用人＝培力園社工、設備＝內部借用免登記），
 * 借用表上會顯示成「培力園(活動名)」。不受時數、人數、開館時間限制。
 */
function openStaffForm() {
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const venue = el('select', { name: 'venueId', required: true });
  for (const v of activeVenues()) venue.append(el('option', { value: v.id, text: v.name }));

  const field = (label, input, help) => el('div', { class: 'field' }, [
    el('label', {}, [el('span', { text: label }), help ? el('span', { class: 'help', text: help }) : null]),
    input,
  ]);
  const formNotice = el('div', { class: 'notice', hidden: true });
  const staff = staffBox('');
  const form = el('form', { class: 'card' }, [
    el('h3', { style: 'margin:0 0 4px;font-size:1.02rem;color:var(--leaf-700)', text: '⚡ 社工鎖場地' }),
    el('p', { class: 'help', style: 'margin:0 0 12px' },
      '園內自己要用的時段。不受 3 小時、最少人數與開館時間限制，'
      + '借用表上顯示成「培力園(活動名)」。'),
    formNotice,
    el('div', { class: 'grid-2' }, [
      el('div', { class: 'span-2' }, field('活動名稱', el('input', {
        type: 'text', name: 'org', required: true, placeholder: '例：少年工班培訓',
      }), '會顯示在借用表上')),
      field('空間', venue),
      field('日期', el('input', { type: 'date', name: 'date', value: today, required: true })),
      field('開始', el('input', { type: 'time', name: 'startTime', required: true })),
      field('結束', el('input', { type: 'time', name: 'endTime', required: true })),
      field('借用人數', el('input', { type: 'number', name: 'headcount', min: '0', value: '1' })),
      el('div', { class: 'span-2' }, field('負責工作人員', staff, '選填，只有後台看得到')),
    ]),
    el('div', { class: 'row row-end' }, [
      el('button', { type: 'button', class: 'btn btn-ghost', text: '取消', onClick: closeForm }),
      el('button', { type: 'submit', class: 'btn', text: '鎖定場地' }),
    ]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice(formNotice);
    const values = Object.fromEntries(new FormData(form).entries());
    const codes = form.querySelector('[name="staffAll"]').checked
      ? 'ALL'
      : [...form.querySelectorAll('[name="staffCode"]')]
        .filter((box) => box.checked).map((box) => box.value).join('');
    delete values.staffCode;
    delete values.staffAll;
    try {
      await api('/api/admin/bookings', {
        method: 'POST',
        body: {
          ...values,
          borrower: '培力園社工',
          purpose: values.org,
          activityType: '內部活動',
          equipment: '內部借用免登記',
          staff: codes,
          headcount: Number(values.headcount) || 1,
        },
      });
      closeForm();
      if (values.date.slice(0, 7) !== filter.month) filter.month = values.date.slice(0, 7);
      await load();
      showNotice(notice, 'ok', `已鎖定 ${values.date} 的場地。`);
    } catch (err) {
      showNotice(formNotice, 'error', err.message);
    }
  });
  formSlot.innerHTML = '';
  formSlot.append(form);
  form.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/**
 * 匯入舊的借用紀錄。
 *
 * 直接上傳原本那張「預約資料」試算表（.xlsx），欄位照舊表的順序認。
 * 先「試算」一次看會匯進幾筆、有沒有讀不懂的列，確認了再真的寫入。
 * 同一筆不會匯兩次，所以檔案重傳也安全。
 */
function openImportForm() {
  const fileInput = el('input', { type: 'file', accept: '.xlsx' });
  const result = el('div', { style: 'margin-top:12px' });
  const formNotice = el('div', { class: 'notice', hidden: true });
  const dryButton = el('button', { type: 'button', class: 'btn btn-ghost', text: '先試算看看' });
  const realButton = el('button', { type: 'button', class: 'btn', text: '確定匯入' });
  realButton.disabled = true;

  /**
   * 匯入時對不到的那幾筆。
   *
   * 最常見的是「舊版程式匯了兩次不同時間匯出的檔案」留下來的殘影：
   * 某一筆後來被取消了，舊版當成新的一筆又存一份，於是同一個借用同時有
   * 「有效」跟「已取消」兩列，統計就一直多算那筆。
   * 列出來讓社工看清楚，按一下就清掉。
   */
  function orphanBox(orphans) {
    const box = el('div', { class: 'notice notice-warn', style: 'margin:10px 0 0' });
    const button = el('button', {
      type: 'button', class: 'btn btn-sm', style: 'margin-top:10px',
      text: `🧹 清掉這 ${orphans.length} 筆`,
    });
    button.addEventListener('click', async () => {
      const yes = await confirmDelete({
        title: `清掉這 ${orphans.length} 筆`,
        message: '這幾筆是之前匯入留下的、新的檔案裡已經沒有了。'
          + '清掉之後統計就會跟舊系統一致。只會刪從舊表匯進來的，'
          + '你在系統裡自己登記的借用不會被動到。',
        danger: '清掉',
      });
      if (!yes) return;
      button.disabled = true;
      button.textContent = '清除中…';
      try {
        const r = await api('/api/admin/bookings/cleanup', {
          method: 'POST', body: { ids: orphans.map((o) => o.id) },
        });
        box.innerHTML = '';
        box.append(el('strong', { text: `✅ 已清掉 ${r.removed} 筆` }));
        await load();
      } catch (err) {
        button.disabled = false;
        button.textContent = `🧹 清掉這 ${orphans.length} 筆`;
        showNotice(notice, 'error', err.message);
      }
    });
    box.append(
      el('strong', { text: `有 ${orphans.length} 筆之前匯過、但這次的檔案裡對不到` }),
      el('div', { class: 'help', style: 'margin-top:4px' },
        '多半是之前匯了兩次、中間那筆又被取消，系統裡就留下一份舊的 —— '
        + '統計會因此多算。確認下面這幾筆可以清掉的話按按鈕：'),
      el('ul', { style: 'margin:6px 0 0;padding-left:1.3em' },
        orphans.slice(0, 20).map((o) => el('li', { class: 'help', text: o.text }))),
      ...(orphans.length > 20
        ? [el('div', { class: 'help', text: `…還有 ${orphans.length - 20} 筆` })]
        : []),
      button,
    );
    return box;
  }

  const run = async (dryRun) => {
    hideNotice(formNotice);
    const file = fileInput.files[0];
    if (!file) { showNotice(formNotice, 'error', '請先選一個 .xlsx 檔。'); return; }
    dryButton.disabled = true;
    realButton.disabled = true;
    result.innerHTML = '';
    result.append(el('p', { class: 'help', text: dryRun ? '試算中…' : '匯入中…（資料多的話要一點時間）' }));
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new window.FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('檔案讀取失敗。'));
        reader.readAsDataURL(file);
      });
      const data = await api('/api/admin/bookings/import', {
        method: 'POST', body: { file: base64, dryRun },
      });
      result.innerHTML = '';
      // append 會把 null 變成字串 "null" 印在畫面上，所以最後要濾掉
      result.append(...[
        el('p', { style: 'margin:0 0 6px;font-weight:700',
          text: dryRun
            ? `試算結果：新增 ${data.imported} 筆、更新 ${data.updated || 0} 筆`
            : `✅ 匯入完成，新增 ${data.imported} 筆、更新 ${data.updated || 0} 筆` }),
        el('p', { class: 'help', style: 'margin:0' },
          `檔案裡共 ${data.total} 筆　·　沒變略過 ${data.skipped} 筆　·　讀不懂 ${data.failed} 筆　·　`
          + `新增的當中：有效 ${data.byStatus.booked || 0}／已取消 ${data.byStatus.cancelled || 0}／閉館 ${data.byStatus.closed || 0}`),
        // 「更新」多半是狀態改了（例如後來被取消），這是重新匯出的檔案才會有的
        data.updated
          ? el('p', { class: 'help', style: 'margin:4px 0 0' },
            '「更新」是這幾筆在舊系統裡改過了（最常見是後來被取消），'
            + '系統照新的檔案改掉，不會變成兩筆。')
          : null,
        (data.orphans && data.orphans.length) ? orphanBox(data.orphans) : null,
        ...(data.problems.length
          ? [el('ul', { class: 'guide-list', style: 'margin-top:8px' },
            data.problems.slice(0, 20).map((p) => el('li', { class: 'help', style: 'margin:0', text: p })))]
          : []),
      ].filter(Boolean));
      if (dryRun) {
        // 只有「更新」沒有「新增」時也要能按 —— 那是狀態改了要同步回來
        realButton.disabled = (data.imported + (data.updated || 0)) === 0;
      } else {
        await load();
      }
    } catch (err) {
      result.innerHTML = '';
      showNotice(formNotice, 'error', err.message);
    } finally {
      dryButton.disabled = false;
    }
  };

  dryButton.addEventListener('click', () => run(true));
  realButton.addEventListener('click', () => run(false));
  fileInput.addEventListener('change', () => { realButton.disabled = true; result.innerHTML = ''; });

  formSlot.innerHTML = '';
  const box = el('div', { class: 'card' }, [
    el('h3', { style: 'margin:0 0 4px;font-size:1.02rem', text: '📤 匯入舊的借用紀錄' }),
    el('p', { class: 'help', style: 'margin:0 0 12px' },
      '選原本那張「預約資料」試算表（.xlsx）。欄位照舊表的順序認：'
      + '時間戳記／預約人／電話／單位／人數／活動類型／空間／日期／開始／結束／設備／狀態。'
      + '同一筆不會匯兩次，所以同一個檔案重傳也沒關係。'),
    formNotice,
    el('div', { class: 'row' }, [fileInput]),
    el('div', { class: 'row', style: 'margin-top:12px' }, [dryButton, realButton,
      el('button', { type: 'button', class: 'btn btn-ghost', text: '關閉', onClick: closeForm })]),
    result,
  ]);
  formSlot.append(box);
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

const KIND_LABEL = { public: '外面登記', staff: '社工鎖場地', closure: '閉館公告' };

/** 把現在篩出來的這批下載成 CSV（交月報、備查都用得到）。 */
function downloadCsv(label) {
  const columns = [
    ['date', '日期'], ['startTime', '開始'], ['endTime', '結束'], ['venueName', '空間'],
    ['kindLabel', '來源'], ['borrower', '借用人'], ['org', '單位'], ['phone', '電話'],
    ['headcount', '人數'], ['activityType', '活動類型'], ['purpose', '用途'],
    ['equipment', '設備'], ['staff', '負責人'], ['statusLabel', '狀態'], ['note', '備註'],
  ];
  const statusLabel = { booked: '有效', cancelled: '已取消', closed: '閉館公告' };
  const rows = data.bookings.map((b) => ({
    ...b,
    kindLabel: KIND_LABEL[b.kind] || b.kind,
    statusLabel: statusLabel[b.status] || b.status,
  }));
  // 開頭是 = + - @ 的值在 Excel 裡會被當成公式，前面補一個單引號擋掉
  const escape = (v) => {
    const text = String(v ?? '');
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = [
    columns.map(([, label]) => escape(label)).join(','),
    ...rows.map((r) => columns.map(([key]) => escape(r[key])).join(',')),
  ].join('\r\n');
  const link = el('a', {
    href: `data:text/csv;charset=utf-8,\uFEFF${encodeURIComponent(csv)}`,
    download: `培力園_場地借用_${label || filter.month || '全部'}.csv`,
  });
  document.body.append(link);
  link.click();
  link.remove();
}

/** 全部紀錄（不管月份與篩選），資料調閱用。 */
async function downloadAllCsv() {
  try {
    const all = await api('/api/admin/bookings');
    const keep = data;
    data = all;
    downloadCsv('全部');
    data = keep;
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
}

/** 這個月每個空間借了幾次、多少人次。 */
function statsPanel(stats) {
  if (!stats || !stats.rows.length) {
    return el('p', { class: 'help', text: '這個月還沒有有效的借用紀錄。' });
  }
  return el('div', { class: 'table-scroll' }, [
    el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: '空間' }), el('th', { class: 'num', text: '借用次數' }),
        el('th', { class: 'num', text: '使用人次' }),
      ])),
      el('tbody', {}, [
        ...stats.rows.map((r) => el('tr', {}, [
          el('td', { text: r.venueName }),
          el('td', { class: 'num', text: String(r.times) }),
          el('td', { class: 'num', text: String(r.people) }),
        ])),
        el('tr', {}, [
          el('td', {}, el('strong', { text: '合計' })),
          el('td', { class: 'num' }, el('strong', { text: String(stats.total.times) })),
          el('td', { class: 'num' }, el('strong', { text: String(stats.total.people) })),
        ]),
      ]),
    ]),
  ]);
}

async function cancelBooking(booking) {
  try {
    await api(`/api/admin/bookings/${booking.id}`, {
      method: 'PATCH', body: { status: 'cancelled' },
    });
    await load();
    showNotice(notice, 'ok', `已取消 ${booking.venueName} ${formatDate(booking.date)} 的借用。`);
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
}

async function restoreBooking(booking) {
  try {
    await api(`/api/admin/bookings/${booking.id}`, { method: 'PATCH', body: { status: 'booked' } });
    await load();
    showNotice(notice, 'ok', '已恢復這筆借用。');
  } catch (err) {
    // 恢復時可能已經被別人借走了，錯誤訊息會講清楚跟誰撞到
    showNotice(notice, 'error', err.message);
  }
}

async function removeBooking(booking) {
  const ok = await confirmDelete({
    title: '刪除借用紀錄',
    message: `${booking.venueName}　${formatDate(booking.date)} ${booking.startTime}-${booking.endTime}\n`
      + `（${booking.borrower}）刪掉之後就查不到了。只是不借了的話，用「取消」就好。`,
    danger: '刪除',
  });
  if (!ok) return;
  try {
    await api(`/api/admin/bookings/${booking.id}`, { method: 'DELETE' });
    await load();
    showNotice(notice, 'ok', '已刪除這筆借用紀錄。');
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
}

// ---------------------------------------------------------------- 清單

/** 這一筆是誰登記的、現在是什麼狀態 —— 沒有篩選器了，就靠標籤分。 */
function bookingTags(b) {
  const tags = [];
  if (b.status === 'cancelled') {
    tags.push(el('span', { class: 'badge badge-closed', text: '已取消' }));
  }
  if (b.status === 'closed' || b.kind === 'closure') {
    tags.push(el('span', { class: 'badge badge-full', text: '閉館公告' }));
  } else if (b.kind === 'staff') {
    tags.push(el('span', { class: 'badge badge-wait', text: '社工鎖場地' }));
  }
  return tags;
}

function bookingRow(b) {
  const cancelled = b.status === 'cancelled';
  return el('tr', { style: cancelled ? 'opacity:.55' : null }, [
    el('td', { class: 'wrap-cell' }, [
      el('strong', { text: `${b.startTime}-${b.endTime}` }),
      el('div', { class: 'help', style: 'margin:2px 0 0', text: b.venueName }),
    ]),
    el('td', { class: 'wrap-cell' }, [
      el('span', { text: b.purpose || '—' }),
      ...bookingTags(b).map((tag) => {
        tag.style.marginLeft = '6px';
        return tag;
      }),
      b.equipment ? el('div', { class: 'help', style: 'margin:2px 0 0', text: `設備：${b.equipment}` }) : null,
      b.note ? el('div', { class: 'help', style: 'margin:2px 0 0', text: b.note }) : null,
    ]),
    el('td', { class: 'wrap-cell' }, [
      el('span', { text: b.borrower }),
      b.org ? el('div', { class: 'help', style: 'margin:2px 0 0', text: b.org }) : null,
      b.phone ? el('div', { class: 'help', style: 'margin:2px 0 0', text: b.phone }) : null,
    ]),
    el('td', { class: 'num', text: b.headcount ? String(b.headcount) : '—' }),
    el('td', {}, el('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, [
      el('button', { class: 'btn btn-ghost btn-sm', text: '修改', onClick: () => openForm(b) }),
      cancelled
        ? el('button', { class: 'btn btn-ghost btn-sm', text: '恢復', onClick: () => restoreBooking(b) })
        : el('button', { class: 'btn btn-ghost btn-sm', text: '取消', onClick: () => cancelBooking(b) }),
      el('button', { class: 'btn btn-danger btn-sm', text: '刪除', onClick: () => removeBooking(b) }),
    ])),
  ]);
}

/** 一天一段：同一天的借用排在一起，一眼看得出那天空間被用掉多少。 */
/** 「3 筆借用，另有 1 筆已取消」——取消的不要混進數字裡。 */
function dayCountLabel(list) {
  const cancelled = list.filter((b) => b.status === 'cancelled').length;
  const active = list.length - cancelled;
  return `${active} 筆借用${cancelled ? `，另有 ${cancelled} 筆已取消` : ''}`;
}

function dayBlock(date, list) {
  return el('div', { class: 'day-block' }, [
    el('h3', { class: 'day-head' }, [
      el('span', { text: formatDate(date) }),
      el('span', { class: 'help', style: 'margin:0', text: dayCountLabel(list) }),
    ]),
    el('div', { class: 'table-scroll' }, [
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: '時間與場地' }),
          el('th', { text: '用途' }),
          el('th', { text: '借用人' }),
          el('th', { class: 'num', text: '人數' }),
          el('th', { text: '操作' }),
        ])),
        el('tbody', {}, list.map(bookingRow)),
      ]),
    ]),
  ]);
}

function renderList() {
  body.innerHTML = '';

  if (!data.venues.length) {
    body.append(el('div', { class: 'empty' }, [
      el('strong', { text: '還沒有建立場地' }),
      '先在下面的「場地」把可以借的空間建起來，才能登記借用。',
    ]));
    return;
  }
  if (!data.bookings.length) {
    body.append(el('div', { class: 'empty' }, [
      el('strong', { text: filter.month ? `${monthLabel(filter.month)}沒有借用紀錄` : '還沒有借用紀錄' }),
      '按上面的「＋ 代登記借用」新增一筆。',
    ]));
    return;
  }

  const byDate = new Map();
  for (const b of data.bookings) {
    if (!byDate.has(b.date)) byDate.set(b.date, []);
    byDate.get(b.date).push(b);
  }
  for (const [date, list] of byDate) body.append(dayBlock(date, list));
}

// ---------------------------------------------------------------- 場地

function venueRow(v) {
  return el('tr', {}, [
    el('td', { class: 'wrap-cell' }, [
      el('strong', { text: v.name }),
      v.active ? null : el('span', { class: 'badge badge-closed', style: 'margin-left:6px', text: '停用中' }),
      v.note ? el('div', { class: 'help', style: 'margin:2px 0 0', text: v.note }) : null,
    ]),
    el('td', { class: 'num', text: v.capacity ? String(v.capacity) : '—' }),
    el('td', { class: 'num', text: String(v.bookingCount ?? 0) }),
    el('td', {}, el('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm', text: v.active ? '停用' : '啟用',
        onClick: async () => {
          try {
            await api(`/api/admin/venues/${v.id}`, { method: 'PATCH', body: { active: !v.active } });
            await load();
          } catch (err) {
            showNotice(notice, 'error', err.message);
          }
        },
      }),
      el('button', {
        class: 'btn btn-danger btn-sm', text: '刪除',
        onClick: async () => {
          const ok = await confirmDelete({
            title: '刪除場地',
            message: `確定要刪除「${v.name}」嗎？借過的場地不能刪，只能停用。`,
            danger: '刪除',
          });
          if (!ok) return;
          try {
            await api(`/api/admin/venues/${v.id}`, { method: 'DELETE' });
            await load();
            showNotice(notice, 'ok', `已刪除場地「${v.name}」。`);
          } catch (err) {
            showNotice(notice, 'error', err.message);
          }
        },
      }),
    ])),
  ]);
}

function venuePanel() {
  const name = el('input', { type: 'text', placeholder: '場地名稱（例：一樓團體室）', style: 'flex:1 1 200px' });
  const capacity = el('input', { type: 'number', min: '0', step: '1', placeholder: '可容納人數', style: 'width:130px' });
  const note = el('input', { type: 'text', placeholder: '備註（設備、注意事項）', style: 'flex:1 1 220px' });
  const add = el('button', { class: 'btn', text: '新增場地' });

  add.addEventListener('click', async () => {
    if (!name.value.trim()) {
      showNotice(notice, 'error', '請填場地名稱。');
      name.focus();
      return;
    }
    try {
      await api('/api/admin/venues', {
        method: 'POST',
        body: { name: name.value, capacity: Number(capacity.value) || 0, note: note.value },
      });
      name.value = '';
      capacity.value = '';
      note.value = '';
      await load();
    } catch (err) {
      showNotice(notice, 'error', err.message);
    }
  });

  const panel = el('details', { class: 'editor' }, [
    el('summary', { text: `場地（${data.venues.length}）` }),
    el('div', { class: 'editor-body' }, [
      el('div', { class: 'row', style: 'margin-bottom:14px' }, [name, capacity, note, add]),
      data.venues.length
        ? el('div', { class: 'table-scroll' }, [
          el('table', {}, [
            el('thead', {}, el('tr', {}, [
              el('th', { text: '場地' }),
              el('th', { class: 'num', text: '可容納' }),
              el('th', { class: 'num', text: '借用次數' }),
              el('th', { text: '操作' }),
            ])),
            el('tbody', {}, data.venues.map(venueRow)),
          ]),
        ])
        : el('p', { class: 'help', style: 'margin:0', text: '還沒有建立場地。' }),
    ]),
  ]);
  return panel;
}

// ---------------------------------------------------------------- 工具列

let toolbarSlot;

function renderToolbar() {
  toolbarSlot.innerHTML = '';

  const select = (key, placeholder, options, current) => {
    const node = el('select', { 'aria-label': placeholder });
    node.append(el('option', { value: '', text: placeholder }));
    for (const opt of options) {
      const option = el('option', { value: opt.value, text: opt.label });
      if (opt.value === current) option.selected = true;
      node.append(option);
    }
    node.addEventListener('change', () => {
      filter[key] = node.value;
      load().catch((err) => showNotice(notice, 'error', err.message));
    });
    return node;
  };

  toolbarSlot.append(el('div', { class: 'toolbar' }, [
    select('month', '全部月份', data.months.map((m) => ({ value: m, label: monthLabel(m) })), filter.month),
    select('venueId', '全部場地', data.venues.map((v) => ({ value: v.id, label: v.name })), filter.venueId),
    el('button', { class: 'btn', text: '⚡ 社工鎖場地', onClick: openStaffForm }),
    el('button', { class: 'btn btn-ghost', text: '＋ 代登記借用', onClick: () => openForm(null) }),
    el('button', { class: 'btn btn-ghost', text: '⛔ 閉館公告', onClick: openClosureForm }),
    el('button', { class: 'btn btn-ghost', text: '📥 下載這個月', onClick: () => downloadCsv() }),
    el('button', { class: 'btn btn-ghost', text: '📂 下載全部月份', onClick: downloadAllCsv }),
    el('button', { class: 'btn btn-ghost', text: '📤 匯入舊資料', onClick: openImportForm }),
    el('button', { class: 'btn btn-ghost', text: '列印', onClick: () => window.print() }),
  ]));
}

async function load() {
  hideNotice(notice);
  const params = new URLSearchParams(
    Object.entries(filter).filter(([, v]) => v !== ''),
  );
  data = await api(`/api/admin/bookings?${params.toString()}`);
  wipSlot.innerHTML = '';
  if (data.underConstruction) {
    wipSlot.append(el('div', { class: 'wip' }, [
      el('strong', { text: '🚧 建置中，還沒對外開放' }),
      el('span', {
        text: '前台的借用頁面上掛著「請勿使用」的公告，而且外面的人真的送不出去；'
          + '這裡（後台代登記、鎖場地）可以先試用。'
          + '要正式啟用時跟維護的人說一聲（把公告拿掉）。',
      }),
    ]));
  }
  renderToolbar();
  renderList();
  venueSlot.innerHTML = '';
  venueSlot.append(venuePanel());

  statsSlot.innerHTML = '';
  statsTitle.textContent = filter.month ? `${monthLabel(filter.month)}的使用統計` : '使用統計';
  if (filter.month) {
    try {
      statsSlot.append(statsPanel(await api(`/api/admin/booking-stats?month=${filter.month}`)));
    } catch {
      // 統計讀不到不影響下面的清單
    }
  } else {
    statsSlot.append(el('p', { class: 'help', text: '下面選一個月份才看得到統計。' }));
  }
}

const venueSlot = el('div', { style: 'margin-top:28px' });
const statsSlot = el('div', { style: 'margin-bottom:28px' });
const statsTitle = el('h2', { class: 'section-title', text: '使用統計' });
const wipSlot = el('div');

(async () => {
  await requireLogin();
  const root = $('#root');
  root.innerHTML = '';
  toolbarSlot = el('div');

  // 預設看這個月：借用大部分是看當月怎麼排
  filter.month = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);

  root.append(
    adminHeader('/admin/bookings'),
    el('main', { class: 'wrap-wide' }, [
      el('div', { class: 'page-head' }, [
        el('h1', { text: '場地借用' }),
        el('p', { text: '哪個場地、哪一天、幾點到幾點被誰借走了。同一個場地同一時段不會被借兩次，撞到會擋下來並告訴你跟誰撞到。' }),
      ]),
      notice,
      wipSlot,
      // 統計放在最上面：一進來先看到這個月各空間被用了多少
      statsTitle,
      statsSlot,
      toolbarSlot,
      formSlot,
      body,
      el('h2', { class: 'section-title', text: '場地' }),
      venueSlot,
    ]),
  );

  try {
    await load();
    // 這個月沒有借用紀錄的話，退回最近有紀錄的月份，免得一進來像壞掉
    if (!data.bookings.length && data.months.length && !data.months.includes(filter.month)) {
      filter.month = data.months[0];
      await load();
    }
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
})();
