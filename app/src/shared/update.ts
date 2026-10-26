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
  /** Run from the portable zip, not installed: an update is the release's zip, copied over this folder. */
  portable: boolean
}

/** Where the releases are: electron-builder.yml's `publish` says the same for the installed copy. */
export const RELEASE_REPO = { owner: 'erylopez', repo: 'aion-overlay' } as const

/** The releases page, or one release's. */
export const releasePage = (version: string | null = null): string =>
  `https://github.com/${RELEASE_REPO.owner}/${RELEASE_REPO.repo}/releases/${version ? `tag/v${version}` : 'latest'}`

/** One of a release's files, as the build names them: the installer and the portable zip. */
export const releaseFile = (version: string, kind: 'installer' | 'portable' | 'portable.sha256'): string => {
  const name = kind === 'installer' ? `Lokthar-Setup-${version}.exe` : kind === 'portable' ? `Lokthar-${version}-portable.zip` : `Lokthar-${version}-portable.zip.sha256`
  return `https://github.com/${RELEASE_REPO.owner}/${RELEASE_REPO.repo}/releases/download/v${version}/${name}`
}
