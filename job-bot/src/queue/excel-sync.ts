import ExcelJS from 'exceljs';
import path from 'path';
import { db } from './db';

const EXCEL_PATH = path.resolve(__dirname, '../../data/queue/jobs.xlsx');

// Only these fields are safe to sync back from Excel → SQLite
const SYNCABLE_FIELDS = ['status', 'notes', 'fit_score', 'fit_decision'];

export async function syncFromExcel(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);

  const sheet = workbook.getWorksheet('Job Queue');
  if (!sheet) throw new Error('Job Queue sheet not found in Excel file');

  // Build header index from row 1
  const headers: string[] = [];
  sheet.getRow(1).eachCell(cell => headers.push(cell.value as string));

  let updated = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const jobIdIdx = headers.indexOf('job_id') + 1;
    const jobId = row.getCell(jobIdIdx).value as string;
    if (!jobId) return;

    const excelRow: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      excelRow[header] = row.getCell(idx + 1).value;
    });

    const updates: Record<string, unknown> = {};
    for (const field of SYNCABLE_FIELDS) {
      if (excelRow[field] !== undefined && excelRow[field] !== null) {
        updates[field] = excelRow[field];
      }
    }

    if (Object.keys(updates).length > 0) {
      const sets = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE jobs SET ${sets}, updated_at = datetime('now') WHERE job_id = @jobId`)
        .run({ ...updates, jobId });
      updated++;
    }
  });

  console.log(`Synced ${updated} rows from Excel → SQLite`);
}
