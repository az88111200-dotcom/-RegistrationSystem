/**
 * 月報上那幾塊「系統裡沒有、只能手填」的欄位。
 *
 * 社會局那張月報表除了場地使用與活動明細之外，還有參訪單位、外部資源
 * 連結、會議與教育訓練、FB／IG 數據。這些本來沒有地方可以記，社工每個月
 * 都要另外翻紀錄再打進 Excel。
 *
 * 這份定義是前台表單、後端驗證、Excel 產生三邊共用的 —— 要加欄位或
 * 改名稱改這裡就好，三邊會一起跟著改（跟 fields.js 同一套做法）。
 *
 * kind 是資料庫裡的鍵，改了會對不到舊資料，不要動。
 */

import { NTPC_DISTRICTS } from './fields.js';
import { AGE_BUCKETS } from './util.js';

/*
 * 補登人次的居住地區與年齡。
 *
 * 補登的那些課沒有個別的報名資料，所以系統算不出他們住哪、幾歲 ——
 * 但月報的三張分佈表要這些數字。這兩塊讓社工照整個月的總量填一次，
 * 分佈表就會顯示「系統統計 ＋ 手動填入」。
 *
 * 身分別不用填：補登時已經分過一般生與原住民，直接換算得出來。
 */
export const PROFILE_KINDS = {
  district: {
    title: '補登人次的居住地區',
    help: '補登的那些課，這個月的人次分別來自哪幾區。加起來要等於補登的總人次。',
    labelName: '地區',
    labelOptions: NTPC_DISTRICTS,
    numbers: ['人次'],
  },
  age: {
    title: '補登人次的年齡',
    help: '補登的那些課，這個月的人次分別是幾歲。加起來要等於補登的總人次。',
    labelName: '年齡',
    labelOptions: AGE_BUCKETS,
    numbers: ['人次'],
  },
};

export const EXTRA_KINDS = {
  visit: {
    title: '參訪單位',
    help: '別的單位來參訪培力園，一次一列。',
    hasDate: true,
    labelName: '參訪單位',
    labelPlaceholder: '例：○○高中輔導室',
    numbers: ['人次'],
  },
  community: {
    title: '社區工作（外部資源連結或合作）',
    help: '跟外面的單位連結或合作，一次一列。',
    hasDate: true,
    labelName: '連結單位',
    labelPlaceholder: '例：華山基金會石門站',
    numbers: ['人次'],
  },
  meeting: {
    title: '各項會議及教育訓練',
    help: '一位同工一列，填這個月各參加幾次。',
    hasDate: false,
    labelName: '同工',
    labelPlaceholder: '同工姓名',
    numbers: ['個督', '團/外督', '行政/其他會議', '教育訓練/研習(討)會'],
  },
  fb: {
    title: '少年培力園FB粉專',
    help: '這個月的粉專數據。',
    single: true,
    numbers: ['貼文數', '瀏覽人次', '內容互動總數(按讚、留言、分享)'],
  },
  ig: {
    title: '少年培力園IG',
    help: '這個月的 IG 數據。',
    single: true,
    numbers: ['貼文數', '檢視次數', '觸及人數', '內容互動次數'],
  },
};

export const EXTRA_KEYS = Object.keys(EXTRA_KINDS);
export const PROFILE_KEYS = Object.keys(PROFILE_KINDS);

/** 所有手填欄位（社會局月報那幾塊 ＋ 補登人次的分佈），共用同一張表。 */
export const ALL_KINDS = { ...EXTRA_KINDS, ...PROFILE_KINDS };

/** 一筆要存幾個數字（最多 4 個，資料庫就是 n1～n4）。 */
export function numberCount(kind) {
  return (ALL_KINDS[kind]?.numbers || []).length;
}

/** 前台要畫幾列空白給人填（已經有資料就在後面多留幾列）。 */
export const BLANK_ROWS = 3;
