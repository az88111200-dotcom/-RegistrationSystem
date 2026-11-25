#!/usr/bin/env node
/**
 * 把 Google 表單匯出的 CSV 匯進報名系統。
 *
 *   node scripts/import-google-form.mjs <CSV檔> --activity "活動名稱" --date 2026-08-14
 *   node scripts/import-google-form.mjs <CSV檔> --activity-id <既有活動的id或slug>
 *   node scripts/import-google-form.mjs <CSV檔> --activity "..." --date ... --dry-run
 *
 * 已經存在的學生（身分證字號相同）會更新資料，不會重複建檔；
 * 已經報名過同一個活動的人會自動略過。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  findActivity, createActivity, normalizeStudentInput, validateStudent,
} from '../src/model.js';
import * as repo from '../src/repo.js';
import { ensureSchema, closePool } from '../src/db.js';
import {
  newId, nowInTaipei, ageOn, ageBucket, toArray, normalizeIdNumber,
} from '../src/util.js';

// CSV 解析與欄位對應跟後台的「匯入名單」共用
import { parseCsv, buildHeaderIndex } from '../src/roster-import.js';

/**
 * Google 表單的時間戳記（例：2026/07/23 11:51:40 上午 GMT）
 * 轉成系統用的 YYYY-MM-DD HH:mm:ss，這樣名單才排得出正確順序。
 * 認不出來就回空字串，交給呼叫端用現在時間。
 */
function parseGoogleTimestamp(raw) {
  const s = String(raw || '').trim();
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[\sT]+(\d{1,2}):(\d{2}):(\d{2})?\s*(上午|下午|AM|PM)?/i.exec(s);
  if (!m) return '';
  let hour = Number(m[4]);
  const marker = (m[7] || '').toUpperCase();
  if (marker === '下午' || marker === 'PM') { if (hour < 12) hour += 12; }
  else if (marker === '上午' || marker === 'AM') { if (hour === 12) hour = 0; }
  const p = (n) => String(Number(n)).padStart(2, '0');
  return `${m[1]}-${p(m[2])}-${p(m[3])} ${p(hour)}:${p(m[5])}:${p(m[6] || 0)}`;
}

// ---------------------------------------------------------------- 主流程

function parseArgs(argv) {
  const opts = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--')) { opts[arg.slice(2)] = argv[i + 1]; i += 1; }
    else opts.positional.push(arg);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const file = opts.positional[0];

  if (!file) {
    console.error(`用法：
  node scripts/import-google-form.mjs <CSV檔> --activity "活動名稱" --date YYYY-MM-DD
  node scripts/import-google-form.mjs <CSV檔> --activity-id <既有活動 id 或 slug>

選項：
  --activity      新建活動的名稱
  --date          新建活動的日期（YYYY-MM-DD）
  --activity-id   匯入到已存在的活動
  --dry-run       只檢查不寫入`);
    process.exit(1);
  }

  await ensureSchema();

  const rows = parseCsv(fs.readFileSync(path.resolve(file), 'utf8'));
  if (rows.length < 2) {
    console.error('這個 CSV 沒有資料列。');
    process.exit(1);
  }

  const index = buildHeaderIndex(rows[0]);
  const missing = ['name', 'idNumber', 'birthDate'].filter((k) => index[k] === undefined);
  if (missing.length) {
    console.error(`CSV 缺少必要欄位：${missing.join('、')}`);
    console.error('讀到的標題：', rows[0].join(' | '));
    process.exit(1);
  }

  // 決定要匯入到哪個活動
  let activity = opts['activity-id'] ? await findActivity(opts['activity-id']) : null;
  if (!activity && opts['activity-id']) {
    console.error(`找不到活動：${opts['activity-id']}`);
    process.exit(1);
  }
  if (!activity) {
    if (!opts.activity || !opts.date) {
      console.error('請用 --activity "活動名稱" --date YYYY-MM-DD 指定活動，或用 --activity-id 匯入既有活動。');
      process.exit(1);
    }
    if (opts.dryRun) {
      activity = { id: '(dry-run)', title: opts.activity, eventDate: opts.date };
    } else {
      activity = await createActivity({ title: opts.activity, eventDate: opts.date, closed: true });
      console.log(`已建立活動「${activity.title}」（${activity.eventDate}），報名先設為關閉。`);
    }
  }

  const summary = { imported: 0, updated: 0, skipped: 0, failed: 0 };
  const seenInFile = new Set();

  for (const [n, row] of rows.slice(1).entries()) {
    const line = n + 2;
    const pick = (key) => (index[key] === undefined ? '' : String(row[index[key]] ?? '').trim());

    const profile = {
      name: pick('name'),
      idNumber: pick('idNumber'),
      birthDate: pick('birthDate') || pick('__birthRoc'),
      gender: pick('gender'),
      identityType: pick('identityType') || '一般',
      familyStatus: toArray(pick('familyStatus')),
      school: pick('school'),
      grade: pick('grade'),
      district: pick('district'),
      address: pick('address'),
      homePhone: pick('homePhone'),
      mobile: pick('mobile'),
      lineId: pick('lineId'),
      email: pick('email'),
      guardianName: pick('guardianName'),
      guardianIdNumber: pick('guardianIdNumber'),
      guardianBirthDate: pick('guardianBirthDate') || pick('__guardianBirthRoc'),
      guardianNationality: pick('guardianNationality'),
      guardianRelation: pick('guardianRelation'),
      guardianPhone: pick('guardianPhone'),
    };

    const data = normalizeStudentInput(profile);
    const errors = validateStudent(data);
    if (errors.length) {
      summary.failed += 1;
      console.warn(`第 ${line} 行（${profile.name || '無姓名'}）跳過：${errors.join(' ')}`);
      continue;
    }

    const idKey = normalizeIdNumber(data.idNumber);
    if (seenInFile.has(idKey)) {
      summary.skipped += 1;
      console.warn(`第 ${line} 行（${data.name}）跳過：這個檔案裡有重複的身分證字號。`);
      continue;
    }
    seenInFile.add(idKey);

    if (opts.dryRun) {
      summary.imported += 1;
      continue;
    }

    const existing = await repo.findStudentByIdNumber(idKey);
    const student = await repo.upsertStudentRow(existing?.id ?? newId(), data, nowInTaipei());
    if (existing) summary.updated += 1;

    if (await repo.hasRegistered(activity.id, student.id)) {
      summary.skipped += 1;
      continue;
    }

    await repo.insertRegistration({
      id: newId(),
      activityId: activity.id,
      studentId: student.id,
      answers: {
        source: pick('source'),
        // 舊表單這題是複選，值以分號隔開；現在改成填空題，直接存原文
        reasons: pick('reasons').replace(/;/g, '、'),
        commitment: toArray(pick('commitment')),
      },
      ageAtEvent: ageBucket(ageOn(student.birthDate, activity.eventDate)),
      note: '',
      registeredAt: parseGoogleTimestamp(pick('__timestamp')) || nowInTaipei(),
    });
    summary.imported += 1;
  }

  console.log(`
匯入${opts.dryRun ? '試跑' : ''}完成 —— 活動「${activity.title}」
  成功報名 ${summary.imported} 筆
  更新既有學生 ${summary.updated} 位
  略過（重複報名或重複身分證） ${summary.skipped} 筆
  資料有問題略過 ${summary.failed} 筆
`);
  if (!opts.dryRun && activity.id !== '(dry-run)') {
    const decorated = await findActivity(activity.id);
    console.log(`目前這個活動共 ${decorated.registrationCount} 人報名。`);
  }
}

try {
  await main();
} catch (err) {
  console.error(`\n匯入失敗：${err.message}\n`);
  process.exitCode = 1;
} finally {
  await closePool();
}
