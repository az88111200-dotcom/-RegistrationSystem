import { api, $, showNotice } from './common.js';
import { fillActivities } from './activity-card.js';

(async () => {
  try {
    const [{ activities }, schema] = await Promise.all([
      api('/api/activities'),
      api('/api/form-schema'),
    ]);
    const { today } = schema;

    fillActivities(
      $('#upcoming'),
      activities.filter((a) => !a.isPast),
      today,
      '目前沒有開放報名的活動',
      '之後有新活動會出現在這裡，記得回來看看。',
    );
    fillActivities(
      $('#recent-past'),
      activities.filter((a) => a.isPast).slice(0, 4),
      today,
      '還沒有過往活動',
      '活動結束後會自動出現在這裡。',
    );
  } catch (err) {
    $('#upcoming').innerHTML = '';
    $('#recent-past').innerHTML = '';
    showNotice($('#notice'), 'error', err.message);
  }
})();
