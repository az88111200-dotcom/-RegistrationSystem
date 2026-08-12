/*
 * 寄信 —— 目前接 Brevo 的 HTTP API。
 *
 * 為什麼不用 SMTP：Vercel 這種 serverless 環境連 SMTP 伺服器常常被擋，
 * 而且要多裝套件。走 HTTP API 只要一個 fetch，穩定也不用相依套件。
 *
 * 沒設定 BREVO_API_KEY 時整個模組就是靜靜地不做事 ——
 * 本機開發與還沒申請帳號的期間，報名照樣能用，只是不寄信。
 */

import { MAIL } from './config.js';

/** 把使用者填的文字放進 HTML 前一律跳脫，避免有人在姓名裡塞標籤。 */
function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 2026-09-13 → 2026/09/13 */
const showDate = (iso) => String(iso || '').replace(/-/g, '/');

/**
 * 報名確認信的內容。
 *
 * 刻意只放「這次活動」的資訊與姓名，不放身分證、地址、電話 ——
 * 信箱被看到的風險比報名網站高得多，個資沒必要跟著寄出去。
 */
export function registrationEmail({ student, activity, waitlisted, waitlistPosition }) {
  const status = waitlisted
    ? `已列入候補（第 ${waitlistPosition} 位）`
    : '已收到你的報名';

  const rows = [
    ['活動', activity.title],
    ['日期', showDate(activity.eventDate)
      + (activity.endDate && activity.endDate !== activity.eventDate
        ? ` ~ ${showDate(activity.endDate)}` : '')
      + (activity.eventTime ? `　${activity.eventTime}` : '')],
    ['地點', activity.location],
    ['集合地點', activity.gatheringPlace],
    ['狀態', status],
  ].filter(([, v]) => v);

  const warn = waitlisted
    ? '這個活動名額已滿，你排在候補。有人取消時我們會照順序通知你。'
    : '報名成功不代表錄取成功，請務必加 LINE 確認是否錄取。';

  const text = [
    `${student.name} 你好，`,
    '',
    `我們已經收到你報名「${activity.title}」。`,
    '',
    ...rows.map(([k, v]) => `${k}：${v}`),
    '',
    `※ ${warn}`,
    `少年培力園 LINE ID：${MAIL.lineId}`,
    '',
    '若有任何疑問，歡迎透過 LINE 私訊詢問。',
    '',
    '少年培力園',
    '新北市政府社會局委託社團法人中華民國更生少年關懷協會辦理',
  ].join('\n');

  const html = `
<div style="font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;
            font-size:15px;line-height:1.8;color:#16281f;max-width:560px">
  <p>${esc(student.name)} 你好，</p>
  <p>我們已經收到你報名「<strong>${esc(activity.title)}</strong>」。</p>
  <table style="border-collapse:collapse;margin:16px 0">
    ${rows.map(([k, v]) => `<tr>
      <td style="padding:6px 16px 6px 0;color:#7b8c82;white-space:nowrap;vertical-align:top">${esc(k)}</td>
      <td style="padding:6px 0"><strong>${esc(v)}</strong></td>
    </tr>`).join('')}
  </table>
  <div style="border:2px solid #e8332a;border-radius:8px;padding:12px 14px;color:#e8332a">
    <strong>${esc(warn)}</strong><br>
    少年培力園 LINE ID：<strong>${esc(MAIL.lineId)}</strong>
  </div>
  <p style="color:#4c6055">若有任何疑問，歡迎透過 LINE 私訊詢問。</p>
  <hr style="border:0;border-top:1px solid #dbe6de;margin:20px 0">
  <p style="color:#7b8c82;font-size:13px;margin:0">
    少年培力園<br>新北市政府社會局委託社團法人中華民國更生少年關懷協會辦理
  </p>
</div>`.trim();

  return {
    subject: waitlisted
      ? `【少年培力園】已列入候補：${activity.title}`
      : `【少年培力園】報名已收到：${activity.title}`,
    text,
    html,
  };
}

/** 有沒有設定好可以寄信。沒有的話呼叫端就直接跳過。 */
export function mailEnabled() {
  return Boolean(MAIL.apiKey && MAIL.fromEmail);
}

/**
 * 實際送出一封信。
 *
 * 一律不丟例外 —— 寄信失敗不能讓少年的報名跟著失敗。
 * 回傳 { ok, skipped?, error? } 讓呼叫端決定要不要記錄。
 */
export async function sendMail({ to, toName, subject, text, html }) {
  if (!mailEnabled()) return { ok: false, skipped: 'not-configured' };
  if (!to) return { ok: false, skipped: 'no-recipient' };

  // serverless 上函式回應後就會被凍結，所以這裡要等寄完再往下走；
  // 但也不能無限等，超過就放棄，不要拖著報名的人一直轉圈圈。
  const abort = AbortSignal.timeout(MAIL.timeoutMs);
  try {
    const res = await fetch(`${MAIL.apiUrl}/v3/smtp/email`, {
      method: 'POST',
      headers: {
        'api-key': MAIL.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: MAIL.fromEmail, name: MAIL.fromName },
        to: [{ email: to, name: toName || undefined }],
        subject,
        textContent: text,
        htmlContent: html,
      }),
      signal: abort,
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `${res.status} ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** 報名確認信：組信 + 寄出，失敗只記錄不影響報名。 */
export async function sendRegistrationEmail(payload) {
  const { student } = payload;
  if (!student?.email) return { ok: false, skipped: 'no-email' };
  const mail = registrationEmail(payload);
  const result = await sendMail({ to: student.email, toName: student.name, ...mail });
  if (!result.ok && !result.skipped) {
    console.error('[mail] 報名確認信寄送失敗：', result.error);
  }
  return result;
}
