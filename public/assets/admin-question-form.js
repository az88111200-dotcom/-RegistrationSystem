// 前後測題目的表單。題庫頁（新增／編輯）和活動的挑題畫面（當場新增）共用這一份。

import { el } from './common.js';

const TYPES = [
  ['scale', '1-5 分量表', '前後測的主力。前後相減就知道進步幾分。'],
  ['single', '單選', '從幾個選項挑一個。'],
  ['multi', '複選', '可以挑很多個。'],
  ['text', '簡答', '自由書寫，質性資料用。'],
];

// ---------------------------------------------------------------- 新增／編輯

/**
 * 題目的編輯表單。
 * 題型選「單選」或「複選」才需要選項，所以選項那格會跟著題型出現或收起來。
 */
export function questionForm(values = {}, { scaleLabels = () => [], allowArchive = true, idPrefix = 'q' } = {}) {
  const form = el('form', { novalidate: true });

  const textInput = el('textarea', {
    id: `${idPrefix}_text`, name: 'text', rows: 2,
    placeholder: '例：我知道遇到困難的時候可以找誰幫忙',
  });
  textInput.value = values.text || '';

  const categoryInput = el('input', {
    id: `${idPrefix}_category`, name: 'category', type: 'text',
    placeholder: '例：自我效能、人際支持、情緒管理',
  });
  categoryInput.value = values.category || '';

  const optionsInput = el('textarea', {
    id: `${idPrefix}_options`, name: 'options', rows: 4,
    placeholder: '一行一個選項\n溝通表達\n情緒管理\n團隊合作',
  });
  optionsInput.value = (values.options || []).join('\n');

  const optionsField = el('div', { class: 'field span-2' }, [
    el('label', { for: `${idPrefix}_options` }, [
      el('span', { text: '選項' }),
      el('span', { class: 'req', text: '*' }),
      el('span', { class: 'help', text: '一行一個，至少兩個' }),
    ]),
    optionsInput,
  ]);

  // 量表的 5 級是全園統一的，這裡只是讓工作人員知道少年會看到什麼
  const scaleHint = el('p', { class: 'help', style: 'margin:0' });
  const scaleField = el('div', { class: 'field span-2' }, [scaleHint]);

  let type = values.type || 'scale';
  const syncType = () => {
    optionsField.hidden = type !== 'single' && type !== 'multi';
    scaleField.hidden = type !== 'scale';
    scaleHint.textContent = `少年會看到：${scaleLabels().map((l, i) => `${i + 1} ${l}`).join('　')}`;
  };
  const typeChoices = TYPES.map(([value, label, tip]) => {
    const radio = el('input', { type: 'radio', name: `${idPrefix}_type`, value });
    radio.checked = value === type;
    radio.addEventListener('change', () => { type = value; syncType(); });
    return el('label', { class: 'choice', title: tip }, [radio, el('span', { text: label })]);
  });
  syncType();

  const archivedBox = el('input', { type: 'checkbox', name: 'archived' });
  archivedBox.checked = values.archived === true;

  form.append(el('div', { class: 'grid-2' }, [
    el('div', { class: 'field span-2' }, [
      el('label', { for: `${idPrefix}_text` }, [
        el('span', { text: '題目' }),
        el('span', { class: 'req', text: '*' }),
      ]),
      textInput,
    ]),
    el('div', { class: 'field span-2' }, [
      el('div', { class: 'field-label' }, [
        el('span', { text: '題型' }),
        el('span', { class: 'help', text: '量表題才算得出前後差幾分' }),
      ]),
      el('div', { class: 'choices' }, typeChoices),
    ]),
    scaleField,
    optionsField,
    el('div', { class: 'field span-2' }, [
      el('label', { for: `${idPrefix}_category` }, [
        el('span', { text: '分類' }),
        el('span', { class: 'help', text: '挑題時好找，可留白' }),
      ]),
      categoryInput,
    ]),
    allowArchive ? el('div', { class: 'field span-2' }, [
      el('div', { class: 'choices' }, [
        el('label', { class: 'choice' }, [archivedBox, el('span', { text: '停用（挑題時不出現）' })]),
      ]),
    ]) : null,
  ]));

  // 量表的說法是從後端讀回來的，表單可能比它早畫好 —— 讀到之後叫一次 refresh
  form.refresh = syncType;
  form.readValues = () => ({
    text: textInput.value.trim(),
    type,
    category: categoryInput.value.trim(),
    archived: archivedBox.checked,
    options: optionsInput.value.split('\n').map((s) => s.trim()).filter(Boolean),
  });
  return form;
}
