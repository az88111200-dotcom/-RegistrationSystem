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
    key: 'name', label: '少年姓名', type: 'text', required: true,
    group: 'student', autocomplete: 'name',
  },
  {
    key: 'idNumber', label: '身份證字號', type: 'text', required: true,
    group: 'student', help: '活動保險需要，請填正確', transform: 'idNumber',
  },
  {
    key: 'birthDate', label: '出生年月日', type: 'date', required: true,
    group: 'student', help: '填西元生日，民國生日會自動換算',
  },
  {
    key: 'gender', label: '少年性別', type: 'radio', required: true,
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
    group: 'student', help: '以新學年為準，例：一年級、大二、畢業',
  },
  {
    key: 'district', label: '學籍/居住區域', type: 'select', required: true,
    group: 'student', options: NTPC_DISTRICTS, help: '限新北市，填學籍或實際居住地',
  },
  {
    key: 'address', label: '居住地址', type: 'text', required: true,
    group: 'student', help: '保險用，請填到樓層門牌',
  },
  {
    key: 'homePhone', label: '住家電話', type: 'text', required: true,
    group: 'student',
  },
  {
    key: 'mobile', label: '少年手機', type: 'tel', required: true,
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
    key: 'guardianName', label: '監護人姓名', type: 'text', required: true,
    group: 'guardian', help: '保險用，請填身分證上的姓名',
  },
  {
    key: 'guardianIdNumber', label: '監護人身分證號', type: 'text', required: true,
    group: 'guardian', help: '保險用', transform: 'idNumber',
  },
  {
    key: 'guardianBirthDate', label: '監護人出生年月日', type: 'date', required: true,
    group: 'guardian', help: '保險用',
  },
  {
    key: 'guardianNationality', label: '監護人國籍', type: 'text', required: true,
    group: 'guardian', help: '保險用', default: '中華民國',
  },
  {
    key: 'guardianRelation', label: '監護人與學生關係', type: 'text', required: true,
    group: 'guardian', help: '例：母女、父子',
  },
  {
    key: 'guardianPhone', label: '監護人聯絡電話', type: 'tel', required: true,
    group: 'guardian', help: '號碼請標註「-」（範例：09xx-000000）',
    transform: 'phone', pattern: '-',
  },
];

/**
 * 每次報名都要重新填的題目（跟該次活動有關，不會存進學生基本資料）。
 */
export const REGISTRATION_FIELDS = [
  {
    key: 'source', label: '從哪裡得知此活動？', type: 'text', required: true,
    group: 'registration', help: '例：IG、臉書、同學邀請、社工推薦、培力園海報',
  },
  {
    key: 'reasons', label: '報名這個活動的原因', type: 'checkbox',
    help: '請至少選 2 項',
    required: true, minChoices: 2, group: 'registration', other: true,
    options: ['拓展朋友圈', '擴寬視野', '來放鬆抒壓', '升學所需備的技能、證照'],
  },
  {
    key: 'commitment', label: '我一定會全程參與，享受每個活動', type: 'checkbox',
    required: true, minChoices: 1, group: 'registration',
    options: ['沒有問題!!'],
  },
];

/** CSV 匯出的欄位順序與標題（跟 Google 表單的匯出欄位對齊）。 */
export const EXPORT_COLUMNS = [
  { key: 'registeredAt', label: '報名時間' },
  { key: 'activityTitle', label: '活動名稱' },
  { key: 'name', label: '少年姓名' },
  { key: 'gender', label: '少年性別' },
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
  { key: 'reasons', label: '請問您報名本活動的原因？' },
  { key: 'commitment', label: '我一定會全程參與' },
  { key: 'email', label: 'Email' },
  { key: 'note', label: '備註' },
];

/** 學生總表匯出（沒有活動相關欄位）。 */
export const STUDENT_EXPORT_COLUMNS = [
  { key: 'name', label: '少年姓名' },
  { key: 'gender', label: '少年性別' },
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
