import { api, $, showNotice } from './common.js';
import { fillActivities } from './activity-card.js';

(async () => {
  try {
    const [{ activities }, schema] = await Promise.all([
      api('/api/activities?scope=past'),
      api('/api/form-schema'),
    ]);
    fillActivities(
      $('#list'), activities, schema.today,
      '還沒有過往活動',
      '活動日期過了之後，就會自動移到這裡。',
    );
  } catch (err) {
    $('#list').innerHTML = '';
    showNotice($('#notice'), 'error', err.message);
  }
})();
