import { api, $, showNotice } from './common.js';
import { fillActivities } from './activity-card.js';

(async () => {
  try {
    const [{ activities }, schema] = await Promise.all([
      api('/api/activities?scope=past'),
      api('/api/form-schema'),
    ]);
    // 這一頁就是「看全部」，所以不折疊，一次列出所有過往活動
    fillActivities(
      $('#list'), activities, schema.today,
      '還沒有過往活動',
      '活動日期過了之後，就會自動移到這裡。',
      { limit: Infinity },
    );
  } catch (err) {
    $('#list').innerHTML = '';
    showNotice($('#notice'), 'error', err.message);
  }
})();
