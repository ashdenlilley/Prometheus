import type { Issue } from '@shared/types'
import { useStore } from '../store'
import { clsx } from '../util'

// Narrow left gutter on every entry. Not a column: an outline star shows on row hover,
// a click makes it a live favourite (yellow star), which stays visible until unstarred.
export function FavGutter({ issue }: { issue: Issue }) {
  const { dispatch } = useStore()
  const on = !!issue.favourite
  return (
    <span className="fav-gutter">
      <button
        type="button"
        className={clsx('fav-btn', on && 'on')}
        aria-pressed={on}
        aria-label={on ? 'Remove from favourites' : 'Add to favourites'}
        title={on ? 'Remove from favourites' : 'Add to favourites'}
        onClick={e => {
          e.stopPropagation()
          dispatch({ type: 'patchIssue', id: issue.id, patch: { favourite: !on } })
        }}
      >
        {on ? '★' : '☆'}
      </button>
    </span>
  )
}
