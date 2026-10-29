import type { Column, FileRef, Issue } from './types'

export interface ProjectFile {
  file: FileRef
  issueId: string
  columnId: string // 'comment:<id>' for a comment attachment
}

// Every attachment on the given issues: all 'files' columns, then comment attachments. Other column types are ignored.
export function projectFiles(issues: Issue[], columns: Column[]): ProjectFile[] {
  const out: ProjectFile[] = []
  for (const issue of issues) {
    for (const col of columns) {
      const v = issue.values[col.id]
      if (col.type !== 'files' || !Array.isArray(v)) continue
      for (const file of v as FileRef[]) out.push({ file, issueId: issue.id, columnId: col.id })
    }
    for (const c of issue.comments ?? []) for (const file of c.files ?? []) out.push({ file, issueId: issue.id, columnId: 'comment:' + c.id })
  }
  return out
}

export const isImageFile = (f: FileRef) => /^data:image\//.test(f.dataUrl) || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(f.name)
