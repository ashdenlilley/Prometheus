import type { PrState } from '@shared/types'
import { PR_STATE_LABEL } from '@shared/git'
import { clsx } from '../util'

// Coloured state badge for a linked PR: table cell and issue panel.
export function PrPill({ state }: { state: PrState }) {
  return <span className={clsx('pr-pill', state)}>{PR_STATE_LABEL[state]}</span>
}
