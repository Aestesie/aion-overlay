/**
 * App updates, checked by hand from the Settings page: the latest GitHub release of the overlay
 * (electron-updater, reading the release's latest.yml), downloaded and installed over this copy.
 */
export type UpdateStatus =
  /** Not checked since the app started. */
  | 'idle'
  | 'checking'
  /** The newest release is this version. */
  | 'current'
  | 'available'
  | 'downloading'
  /** Downloaded: installs on restart. */
  | 'ready'
  | 'error'
  /** Running from source (npm run dev): there is nothing to update. */
  | 'dev'

export interface UpdateState {
  status: UpdateStatus
  /** This copy's version. */
  current: string
  /** The newest release's version, once checked. */
  latest: string | null
  /** When it was released (ISO), and its notes (HTML or text, from the release). */
  releasedAt: string | null
  notes: string | null
  /** 0..100 while downloading. */
  percent: number
  error: string | null
  /** When it was last checked (ms since epoch). */
  checkedAt: number | null
  /** Run from the portable zip, not installed: an update is a new zip, from the release page. */
  portable: boolean
}
