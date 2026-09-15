/**
 * LINE 推播。
 *
 * 園方原本那支機器人是「只推播、不接收」—— 有人登記借用就發訊息給社工，
 * 每天下午再發一次今日匯報。搬過來之後做的是同一件事，只是改由這台伺服器發。
 * 機器人帳號、好友、官方帳號 ID 都不用動，webhook 也沒有要設。
 *
 * 沒設環境變數就整個空轉，本機開發與測試不會真的發訊息出去。
 */

const API_URL = process.env.LINE_API_URL || 'https://api.line.me/v2/bot/message/push';
const TOKEN = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
// 要收通知的人或群組（社工自己的 LINE user ID，或群組 ID）
const TARGET = (process.env.LINE_TARGET_ID || process.env.LINE_USER_ID || '').trim();

export function isConfigured() {
  return Boolean(TOKEN && TARGET);
}

export function configSummary() {
  return {
    configured: isConfigured(),
    missing: [
      TOKEN ? '' : 'LINE_CHANNEL_ACCESS_TOKEN',
      TARGET ? '' : 'LINE_TARGET_ID',
    ].filter(Boolean),
    // 只回報後四碼，看得出有沒有設對人，又不會把 ID 整串攤在畫面上
    targetTail: TARGET ? `…${TARGET.slice(-4)}` : '',
  };
}

/**
 * 發一則文字訊息。回傳有沒有真的送出去。
 *
 * 刻意不丟例外 —— LINE 掛掉、金鑰過期都不該害得場地借不成，
 * 失敗就寫進伺服器紀錄，人再從借用表上看。
 */
export async function notify(text) {
  if (!isConfigured()) return false;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        to: TARGET,
        messages: [{ type: 'text', text: String(text).slice(0, 4900) }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[LINE] 推播失敗（${res.status}）：${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[LINE] 推播失敗：', err.message);
    return false;
  }
}
