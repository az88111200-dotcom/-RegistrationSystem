// Postgres 連線與資料表結構。
//
// 為什麼要用資料庫：Vercel 是 serverless，檔案系統唯讀且用完即丟，
// 資料一定要放在外部。這裡用 Postgres（Neon 免費額度就夠用）。
//
// 本機開發：設 DATABASE_URL=postgres://postgres:test@localhost:5432/peiliyuan
// Vercel：在專案設定裡加 DATABASE_URL 環境變數（接 Neon 會自動帶入）

import pg from 'pg';

const { Pool } = pg;

// DATE 欄位預設會被轉成 JS Date 物件，再轉回字串時會被時區推移一天。
// 直接拿原始的 YYYY-MM-DD 字串最安全，系統其他地方也都用字串比對日期。
pg.types.setTypeParser(1082, (value) => value);

// Neon 等雲端 Postgres 都要 TLS；本機 localhost 不用。
function poolConfig() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error(
      '找不到 DATABASE_URL 環境變數。\n'
      + '本機測試：DATABASE_URL=postgres://postgres:test@localhost:5432/peiliyuan node server.js\n'
      + 'Vercel：到專案 Settings → Environment Variables 加上 DATABASE_URL。',
    );
  }
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(connectionString);
  return {
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: true },
    // serverless 每個實例只需要少量連線，開太多會把 Neon 的連線數吃光
    max: Number(process.env.PG_POOL_MAX || 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  };
}

let pool = null;

/** 取得連線池。serverless 環境下同一個實例會重複使用。 */
export function getPool() {
  if (!pool) pool = new Pool(poolConfig());
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

/**
 * 在一個交易裡執行，並對整份資料上鎖。
 *
 * 報名的流程是「先讀名額、再寫入」，如果兩個少年同時按送出，
 * 沒有鎖的話會兩個人都讀到「還有 1 個名額」而一起報名成功。
 * 用 advisory lock 把同一個活動的寫入排成一列，就不會超收。
 */
export async function withLock(lockKey, fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [hashLockKey(lockKey)]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** 把字串鎖名轉成 advisory lock 需要的 64 位元整數。 */
function hashLockKey(key) {
  let h = 0n;
  for (const ch of String(key)) {
    h = (h * 131n + BigInt(ch.codePointAt(0))) % 9223372036854775783n;
  }
  return h.toString();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS activities (
  id                      TEXT PRIMARY KEY,
  slug                    TEXT NOT NULL UNIQUE,
  title                   TEXT NOT NULL,
  summary                 TEXT NOT NULL DEFAULT '',
  description             TEXT NOT NULL DEFAULT '',
  event_date              DATE NOT NULL,
  event_time              TEXT NOT NULL DEFAULT '',
  location                TEXT NOT NULL DEFAULT '',
  gathering_place         TEXT NOT NULL DEFAULT '',
  capacity                INTEGER NOT NULL DEFAULT 0,
  registration_deadline   DATE,
  contact                 TEXT NOT NULL DEFAULT '',
  closed                  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id            TEXT PRIMARY KEY,
  -- 身分證字號是一個人的唯一識別，用它判斷是不是老朋友
  id_number     TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  birth_date    DATE NOT NULL,
  profile       JSONB NOT NULL,
  -- 後台搜尋用的小寫字串，寫入時一併算好。
  -- 裡面也放了民國生日，社工才能直接用「99/10/14」查得到人。
  search_text   TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

ALTER TABLE students ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';

-- 老朋友快速報名要用姓名 + 身分證 + 生日三項比對，建索引加速
CREATE INDEX IF NOT EXISTS students_lookup_idx ON students (id_number, name, birth_date);

CREATE TABLE IF NOT EXISTS registrations (
  id            TEXT PRIMARY KEY,
  activity_id   TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
  answers       JSONB NOT NULL,
  age_at_event  TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  registered_at TEXT NOT NULL,
  -- 同一個人不能重複報名同一個活動，交給資料庫把關最保險
  UNIQUE (activity_id, student_id)
);

CREATE INDEX IF NOT EXISTS registrations_activity_idx ON registrations (activity_id);
CREATE INDEX IF NOT EXISTS registrations_student_idx  ON registrations (student_id);

-- 後台密碼輸錯次數的記錄。serverless 每次請求可能換一台機器，
-- 存在記憶體裡的計數會失效，所以要放進資料庫才擋得住暴力猜密碼。
CREATE TABLE IF NOT EXISTS login_attempts (
  ip          TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  first_at    BIGINT  NOT NULL
);
`;

let ready = null;

/** 建立資料表（重複執行安全）。第一次請求時自動跑一次。 */
export function ensureSchema() {
  if (!ready) {
    ready = query(SCHEMA).catch((err) => {
      ready = null; // 失敗就讓下一次請求重試，不要卡死
      throw err;
    });
  }
  return ready;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
