/**
 * طبقة توافق: تعطي الكود نفس واجهة D1 (prepare / bind / first / all / run / batch)
 * لكنها تنفّذ الاستعلامات على PostgreSQL. الكود الأصلي في worker/ لا يتغير.
 */
import pg from 'pg';

// COUNT(*) وأمثاله يرجعون int8، وpg يرجعه نصاً افتراضياً؛ نحوّله إلى رقم.
pg.types.setTypeParser(20, (v: string) => Number(v));

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

/** تحويل صيغ SQLite إلى PostgreSQL: علامات الاستفهام إلى $1..$n، وINSERT OR IGNORE إلى ON CONFLICT DO NOTHING. */
export function toPostgres(sql: string): string {
  let out = sql;
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(out)) {
    out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO').trimEnd() + ' ON CONFLICT DO NOTHING';
  }
  let i = 0;
  return out.replace(/\?/g, () => `$${++i}`);
}

export function makeDB(connectionString: string): D1Database {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    // Render's external URL requires SSL; the internal URL works with it too.
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  });

  const runOn = async (
    client: { query: (text: string, values?: unknown[]) => Promise<QueryResult> },
    sql: string,
    params: unknown[],
  ): Promise<QueryResult> => client.query(toPostgres(sql), params);

  const statement = (sql: string, params: unknown[] = []): D1PreparedStatement => {
    const stmt = {
      bind: (...p: unknown[]) => statement(sql, p),
      first: async <T>() => {
        const r = await runOn(pool, sql, params);
        return ((r.rows[0] as T | undefined) ?? null) as T | null;
      },
      all: async <T>() => {
        const r = await runOn(pool, sql, params);
        return { results: r.rows as T[], success: true, meta: { changes: r.rowCount ?? 0 } };
      },
      run: async () => {
        const r = await runOn(pool, sql, params);
        return { results: [], success: true, meta: { changes: r.rowCount ?? 0 } };
      },
      _sql: sql,
      _params: params,
    };
    return stmt as unknown as D1PreparedStatement;
  };

  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: D1PreparedStatement[]) => {
      // D1 تنفّذ الدفعة كمعاملة واحدة؛ نفعل الشيء نفسه.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out: unknown[] = [];
        for (const s of stmts as unknown as Array<{ _sql: string; _params: unknown[] }>) {
          const r = await runOn(client, s._sql, s._params);
          out.push({ results: r.rows, success: true, meta: { changes: r.rowCount ?? 0 } });
        }
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    exec: async (sql: string) => {
      await pool.query(sql);
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;
}
