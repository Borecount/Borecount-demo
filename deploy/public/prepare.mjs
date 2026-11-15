import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const source = (await readFile(new URL('./prepare.sql', import.meta.url), 'utf8')).replace(/^\\set.*$/gm, '');
  await sql.unsafe(source);
  console.log('Public demo permissions and disposable lifecycle installed');
} catch {
  console.error('Public demo setup failed; check migration role and target');
  process.exitCode = 1;
} finally { await sql.end({ timeout: 5 }); }
