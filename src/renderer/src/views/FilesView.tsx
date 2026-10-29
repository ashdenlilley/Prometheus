import type { Project } from '@shared/types'
import { applyFilter } from '@shared/query'
import { isImageFile, projectFiles } from '@shared/files'
import { issueKey, useStore } from '../store'
import { FilterBar, useViewQuery } from '../components/FilterBar'

// Every file attached in the project's 'files' columns, as a gallery. Shares filters with the Issues page.
export function FilesView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data } = useStore()
  const query = useViewQuery(project, 'list')
  const issues = applyFilter(data.issues.filter(i => i.projectId === project.id && !i.archivedAt), query.filter, project)
  const files = projectFiles(issues, project.columns)
  const byId = new Map(issues.map(i => [i.id, i]))

  return (
    <div className="view files-view">
      <div className="toolbar">
        <FilterBar project={project} kind="list" query={query} showGroup={false} />
      </div>
      {!files.length && <div className="muted">No files yet</div>}
      <div className="files-grid">
        {files.map((f, n) => {
          const issue = byId.get(f.issueId)
          const ext = f.file.name.includes('.') ? f.file.name.split('.').pop()!.toUpperCase() : ''
          return (
            <div key={`${f.issueId}-${f.columnId}-${n}`} className="file-card">
              {isImageFile(f.file) ? (
                <img className="file-thumb" src={f.file.dataUrl} alt={f.file.name} />
              ) : (
                <div className="file-thumb file-ext">
                  <span aria-hidden="true">📄</span>
                  <span className="small">{ext}</span>
                </div>
              )}
              <a className="link-btn ellipsis" href={f.file.dataUrl} download={f.file.name}>{f.file.name}</a>
              {issue && (
                <button className="link-btn muted small ellipsis" onClick={() => onOpen(issue.id)}>
                  {issueKey(data, issue)} {issue.title}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
