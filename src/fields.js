// 欄位定義 —— 依照少年培力園 Google 報名表單的題目、選項與驗證規則。
// 前端表單、後台表格、CSV 匯出都共用這份定義，改這裡就會全站一起改。

/** 新北市 29 個行政區（表單限定學籍/居住區域只能新北市） */
export const NTPC_DISTRICTS = [
  '泰山區', '新莊區', '五股區', '林口區', '板橋區', '三重區', '蘆洲區',
  '中和區', '永和區', '土城區', '樹林區', '鶯歌區', '三峽區', '淡水區',
  '八里區', '三芝區', '石門區', '金山區', '萬里區', '汐止區', '深坑區',
  '石碇區', '瑞芳區', '平溪區', '新店區', '雙溪區', '貢寮區', '坪林區',
  '烏來區',
];

/**
 * 學生基本資料欄位。
 * 這些資料報名過一次就會存進後台，之後報名其他活動會自動帶出。
 *
 * type: text | email | tel | date | radio | checkbox | select
 * other: true 代表該選擇題允許「其他」自由填答
 */
export const STUDENT_FIELDS = [
  {
    key: 'name', label: '姓名', type: 'text', required: true,
    group: 'student', autocomplete: 'name',
  },
  {
    key: 'idNumber', label: '身分證字號', type: 'text', required: true,
    group: 'student', help: '保險用，請填正確', transform: 'idNumber',
  },
  {
    key: 'birthDate', label: '出生年月日', type: 'date', required: true,
    group: 'student', help: '填西元生日，民國生日會自動換算',
  },
  {
    key: 'gender', label: '生理性別', type: 'radio', required: true,
    group: 'student', options: ['男', '女'], other: true,
  },
  {
    key: 'identityType', label: '身分別', type: 'radio', required: true,
    group: 'student', options: ['一般', '原住民', '新住民'],
  },
  {
    key: 'familyStatus', label: '特殊家庭狀況', type: 'checkbox', required: false,
    group: 'student', options: ['低收入戶/中低收入戶', '單親', '無'], other: true,
  },
  {
    key: 'school', label: '就讀學校', type: 'text', required: true,
    group: 'student',
  },
  {
    key: 'grade', label: '年級', type: 'text', required: true,
    group: 'student', help: '以新學年為準，例：一年級、大二',
  },
  {
    key: 'district', label: '居住區域', type: 'select', required: true,
    group: 'student', options: NTPC_DISTRICTS, help: '限新北市，學籍或實際居住地皆可',
  },
  {
    key: 'address', label: '居住地址', type: 'text', required: true,
    group: 'student', help: '請填到樓層門牌',
  },
  {
    key: 'homePhone', label: '住家電話', type: 'text', required: true,
    group: 'student',
  },
  {
    key: 'mobile', label: '手機', type: 'tel', required: true,
    group: 'student', help: '號碼請標註「-」（範例：09xx-000000）',
    transform: 'phone', pattern: '-',
  },
  {
    key: 'lineId', label: 'LINE ID', type: 'text', required: true,
    group: 'student',
  },
  {
    key: 'email', label: 'Email', type: 'email', required: true,
    group: 'student', autocomplete: 'email',
  },

  // ---- 監護人（保險用）----
  {
    key: 'guardianName', label: '姓名', type: 'text', required: true,
    group: 'guardian', help: '請填身分證上的姓名',
  },
  {
    key: 'guardianIdNumber', label: '身分證字號', type: 'text', required: true,
    group: 'guardian', transform: 'idNumber',
  },
  {
    key: 'guardianBirthDate', label: '出生年月日', type: 'date', required: true,
    group: 'guardian',
  },
  {
    key: 'guardianNationality', label: '國籍', type: 'text', required: true,
    group: 'guardian', default: '中華民國',
  },
  {
    key: 'guardianRelation', label: '與少年的關係', type: 'text', required: true,
    group: 'guardian', help: '例：母女、父子',
  },
  {
    key: 'guardianPhone', label: '聯絡電話', type: 'tel', required: true,
    group: 'guardian', help: '號碼請標註「-」（範例：09xx-000000）',
    transform: 'phone', pattern: '-',
  },
];

/**
 * 活動分類 —— 只給工作人員看，不會顯示在前台。
 * 用來產出給政府的月報統計。
 */
export const PROGRAM_CATEGORIES = ['社區與親子培力方案', '微創實驗方案'];
export const SERVICE_TYPES = ['團體工作', '方案服務', '社區工作'];

/**
 * 每次報名都要重新填的題目（跟該次活動有關，不會存進學生基本資料）。
 */
export const REGISTRATION_FIELDS = [
  {
    // 選項是從過去表單的實際回答歸納出來的（IG、臉書、社工推薦、同學邀請、海報…）
    key: 'source', label: '從哪裡得知此活動？', type: 'radio', required: true,
    group: 'registration', other: true,
    options: [
      'IG', '臉書 Facebook', '培力園社工推薦', '其他單位社工介紹',
      '同學或朋友邀請', '家人或親戚推薦', '培力園海報、傳單', '學校老師介紹',
    ],
  },
  {
    key: 'reasons', label: '我想報名本活動的原因？', type: 'textarea', required: true,
    group: 'registration', rows: 4,
    help: '多說一點，讓我們更認識你',
    placeholder: '例如：想認識新朋友、對這個活動很有興趣、想挑戰看看自己…',
  },
  {
    key: 'commitment', label: '加 LINE 確認錄取結果',
    type: 'checkbox', required: true, minChoices: 1, group: 'registration',
    options: ['我知道了，會加 LINE 確認'],
    help: '報名成功不等於錄取　·　LINE ID：pilot.cafe',
  },
];

/**
 * 報名表下方要顯示的兩段說明。
 *
 * 放在這裡跟欄位定義一起，是因為這兩段跟表單題目一樣是「園方的內容」，
 * 之後要改字只要動這一個檔案，前台會跟著改。
 */
export const PRIVACY_NOTICE = {
  title: '【個人資料保護聲明】',
  body: '為保障您的隱私權益，本表單蒐集之個人資料，僅供本次課程報名、活動聯繫及'
    + '辦理保險等相關事宜使用。主辦單位將嚴格遵守《個人資料保護法》之規定，'
    + '妥善保管您的資料，未經同意絕不提供給任何第三方或作其他用途。',
};

export const COURSE_NOTES = {
  title: '※ 課程備註',
  items: [
    '送出後畫面會顯示報名結果，請截圖保留。',
    '若報名超過名額，以未參加過中心活動者為優先。',
    '培力園保有隨時修改及終止活動之權利，如有任何變更內容或詳細注意事項將公布於本網頁，恕不另行通知。',
    '若有任何疑問，歡迎透過 LINE 私訊詢問。',
  ],
};

/** CSV 匯出的欄位順序與標題（跟 Google 表單的匯出欄位對齊）。 */
export const EXPORT_COLUMNS = [
  { key: 'registeredAt', label: '報名時間' },
  { key: 'activityTitle', label: '活動名稱' },
  { key: 'name', label: '少年姓名' },
  { key: 'gender', label: '生理性別' },
  { key: 'ageAtEvent', label: '參加者年齡' },
  { key: 'idNumber', label: '身份證字號' },
  { key: 'identityType', label: '身分別' },
  { key: 'familyStatus', label: '特殊家庭狀況' },
  { key: 'birthDate', label: '出生年月日' },
  { key: 'birthDateRoc', label: '出生年月日(民國)' },
  { key: 'school', label: '就讀學校' },
  { key: 'grade', label: '年級(新學年為準)' },
  { key: 'homePhone', label: '住家電話' },
  { key: 'mobile', label: '少年手機' },
  { key: 'district', label: '學籍/居住區域' },
  { key: 'address', label: '居住地址(*保險用*)' },
  { key: 'guardianName', label: '監護人姓名(*保險用*)' },
  { key: 'guardianIdNumber', label: '監護人身分證號' },
  { key: 'guardianBirthDate', label: '監護人出生年月日' },
  { key: 'guardianBirthDateRoc', label: '監護人出生年月日(民國)' },
  { key: 'guardianNationality', label: '監護人國籍' },
  { key: 'guardianRelation', label: '監護人與學生關係' },
  { key: 'guardianPhone', label: '監護人聯絡人電話' },
  { key: 'source', label: '從哪裡得知此活動？' },
  { key: 'lineId', label: '少年LINE ID' },
  { key: 'reasons', label: '報名本活動的原因' },
  { key: 'commitment', label: '已知悉需加LINE確認' },
  { key: 'email', label: 'Email' },
  { key: 'note', label: '備註' },
];

/** 學生總表匯出（沒有活動相關欄位）。 */
export const STUDENT_EXPORT_COLUMNS = [
  { key: 'name', label: '少年姓名' },
  { key: 'gender', label: '生理性別' },
  { key: 'age', label: '目前年齡' },
  { key: 'idNumber', label: '身份證字號' },
  { key: 'identityType', label: '身分別' },
  { key: 'familyStatus', label: '特殊家庭狀況' },
  { key: 'birthDate', label: '出生年月日' },
  { key: 'birthDateRoc', label: '出生年月日(民國)' },
  { key: 'school', label: '就讀學校' },
  { key: 'grade', label: '年級' },
  { key: 'homePhone', label: '住家電話' },
  { key: 'mobile', label: '少年手機' },
  { key: 'district', label: '學籍/居住區域' },
  { key: 'address', label: '居住地址' },
  { key: 'lineId', label: '少年LINE ID' },
  { key: 'email', label: 'Email' },
  { key: 'guardianName', label: '監護人姓名' },
  { key: 'guardianIdNumber', label: '監護人身分證號' },
  { key: 'guardianBirthDate', label: '監護人出生年月日' },
  { key: 'guardianBirthDateRoc', label: '監護人出生年月日(民國)' },
  { key: 'guardianNationality', label: '監護人國籍' },
  { key: 'guardianRelation', label: '監護人與學生關係' },
  { key: 'guardianPhone', label: '監護人聯絡人電話' },
  { key: 'registrationCount', label: '累計報名次數' },
  { key: 'lastRegisteredAt', label: '最近報名時間' },
  { key: 'createdAt', label: '首次建檔時間' },
];
