import ExcelJS from 'exceljs';
import path from 'path';
import { getAllJobs } from './db';

const EXCEL_PATH = path.resolve(__dirname, '../../data/queue/jobs.xlsx');

const STATUS_COLORS: Record<string, string> = {
  new:              'FFFFFFFF',
  matched:          'FFE2EFDA',
  resume_generated: 'FFDDEBF7',
  ready_to_apply:   'FFFFF2CC',
  applying:         'FFFCE4D6',
  needs_answer:     'FFFFEB9C',
  submitted:        'FFC6EFCE',
  failed:           'FFFFC7CE',
  skipped:          'FFF2F2F2',
  duplicate:        'FFF2F2F2',
  paused:           'FFD9D9D9',
  review:           'FFFFF2CC',
};

export async function exportToExcel(): Promise<void> {
  const jobs = getAllJobs();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Job Queue');

  sheet.columns = [
    { header: 'job_id',         key: 'job_id',         width: 12 },
    { header: 'status',         key: 'status',         width: 18 },
    { header: 'company',        key: 'company',        width: 22 },
    { header: 'title',          key: 'title',          width: 35 },
    { header: 'location',       key: 'location',       width: 18 },
    { header: 'source',         key: 'source_site',    width: 14 },
    { header: 'ats_platform',   key: 'ats_platform',   width: 14 },
    { header: 'fit_score',      key: 'fit_score',      width: 10 },
    { header: 'fit_decision',   key: 'fit_decision',   width: 10 },
    { header: 'resume_version', key: 'resume_version', width: 28 },
    { header: 'salary_min',     key: 'salary_min',     width: 12 },
    { header: 'salary_max',     key: 'salary_max',     width: 12 },
    { header: 'apply_url',      key: 'apply_url',      width: 50 },
    { header: 'posted_date',    key: 'posted_date',    width: 14 },
    { header: 'notes',          key: 'notes',          width: 40 },
    { header: 'created_at',     key: 'created_at',     width: 20 },
    { header: 'updated_at',     key: 'updated_at',     width: 20 },
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E79' },
  };

  jobs.forEach(job => {
    const row = sheet.addRow(job);
    const color = STATUS_COLORS[job.status] ?? 'FFFFFFFF';
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };

    // Make apply_url a clickable hyperlink
    if (job.apply_url) {
      const cell = row.getCell('apply_url');
      cell.value = { text: job.apply_url, hyperlink: job.apply_url };
      cell.font = { color: { argb: 'FF0563C1' }, underline: true };
    }
  });

  // Freeze header, add auto-filter
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: 'Q1' };

  await workbook.xlsx.writeFile(EXCEL_PATH);
  console.log(`Excel queue updated: ${jobs.length} rows → ${EXCEL_PATH}`);
}
