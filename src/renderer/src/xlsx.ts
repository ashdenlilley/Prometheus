// Excel export and import for the table. The rows are the same ones CSV uses (issuesToRows in @shared/query).
import writeXlsxFile from 'write-excel-file/browser'
import { readSheet } from 'read-excel-file/browser'
import { sheetText } from '@shared/query'

// Every cell is written as text, so the file reads back the way the CSV did. The header row is bold.
export async function exportXlsx(rows: string[][], fileName: string) {
  const sheet = rows.map((r, n) => r.map(value => ({ value, fontWeight: n === 0 ? ('bold' as const) : undefined })))
  const blob = await writeXlsxFile(sheet).toBlob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  a.click()
  URL.revokeObjectURL(a.href)
}

// First sheet, with every cell as text (dates as YYYY-MM-DD).
export async function importXlsx(file: File): Promise<string[][]> {
  return sheetText(await readSheet(file))
}
