// 後台共用：登入閘門、頁首、確認對話框。

import { api, $, el, showNotice, applyBrandLogo } from './common.js';

/**
 * 檢查登入狀態；沒登入就把整頁換成登入畫面。
 * 回傳 Promise，resolve 代表已通過驗證。
 */
export function requireLogin() {
  return new Promise((resolve) => {
    api('/api/admin/session').then(({ authenticated }) => {
      if (authenticated) return resolve();
      renderLogin();
    }).catch(() => renderLogin());
  });
}

/**
 * 換成登入畫面。這裡刻意不 resolve 外面的 Promise ——
 * 登入成功會直接 location.reload()，讓頁面帶著 cookie 重跑一次，
 * 所以呼叫端的後續程式碼在未登入時永遠不會執行。
 */
function renderLogin() {
  document.body.innerHTML = '';
  document.body.className = 'admin-body';

  const notice = el('div', { class: 'notice notice-error', hidden: true });
  const input = el('input', {
    type: 'password', name: 'password', id: 'pw',
    autocomplete: 'current-password', inputmode: 'numeric',
    placeholder: '請輸入工作人員密碼',
  });
  const button = el('button', { class: 'btn btn-block', type: 'submit', text: '登入' });

  const form = el('form', { class: 'card login-card', novalidate: true }, [
    el('div', { style: 'font-size:2rem;line-height:1;margin-bottom:6px', text: '🔒' }),
    el('h1', { text: '培力園 工作人員後台' }),
    notice,
    el('div', { class: 'field' }, [el('label', { for: 'pw', text: '密碼' }), input]),
    button,
    el('p', { class: 'help', style: 'margin-top:14px;text-align:center' }, [
      el('a', { href: '/', text: '← 回報名首頁' }),
    ]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    button.textContent = '登入中…';
    try {
      await api('/api/admin/login', { method: 'POST', body: { password: input.value } });
      location.reload();
    } catch (err) {
      showNotice(notice, 'error', err.message);
      input.value = '';
      input.focus();
      button.disabled = false;
      button.textContent = '登入';
    }
  });

  document.body.append(el('div', { class: 'login-shell' }, form));
  input.focus();
}

/** 後台共用頁首。 */
export function adminHeader(current) {
  const link = (href, text) => el('a', {
    href, text, 'aria-current': href === current ? 'page' : null,
  });
  const header = el('header', { class: 'site-header' }, [
    el('div', { class: 'wrap-wide bar' }, [
      el('a', { class: 'brand', href: '/admin' }, [
        el('span', { class: 'mark', 'aria-hidden': 'true' }, '🛠'),
        el('span', {}, '培力園 後台'),
      ]),
      el('nav', { class: 'site-nav' }, [
        link('/admin', '活動管理'),
        link('/admin/checkin', '簽到 QR'),
        link('/admin/students', '學生資料總集'),
        link('/admin/reports', '月報統計'),
        el('a', { href: '/', text: '前台' }),
        el('a', {
          href: '#',
          text: '登出',
          onClick: async (event) => {
            event.preventDefault();
            await api('/api/admin/logout', { method: 'POST' });
            location.href = '/admin';
          },
        }),
      ]),
    ]),
  ]);
  // 後台頁首是這裡才產生的，所以自己換一次標誌
  applyBrandLogo(header);
  return header;
}

/**
 * 刪除前的確認對話框。要求輸入指定文字才能按下刪除，
 * 避免手滑刪掉整個活動的報名資料。
 */
export function confirmDelete({ title, message, confirmWord, danger = '確定刪除' }) {
  return new Promise((resolve) => {
    const dialog = el('dialog');
    const input = confirmWord
      ? el('input', { type: 'text', placeholder: `請輸入「${confirmWord}」` })
      : null;
    const ok = el('button', { class: 'btn btn-danger', text: danger });
    if (input) ok.disabled = true;

    if (input) {
      input.addEventListener('input', () => {
        ok.disabled = input.value.trim() !== confirmWord;
      });
    }

    const close = (result) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };

    dialog.append(
      el('div', { class: 'dlg-head', text: title }),
      el('div', { class: 'dlg-body' }, [
        el('p', { style: 'margin:0 0 12px;white-space:pre-wrap', text: message }),
        input,
      ]),
      el('div', { class: 'dlg-foot' }, [
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => close(false) }),
        ok,
      ]),
    );
    ok.addEventListener('click', () => close(true));
    dialog.addEventListener('cancel', () => close(false));
    document.body.append(dialog);
    dialog.showModal();
    (input || ok).focus();
  });
}

export { api, $, el };
