# Updates

How the app updates itself, and how to publish a release it can update to.

## How it works

There is no update server. The installed app reads the latest GitHub release of
[matiasmoya/aion-overlay](https://github.com/matiasmoya/aion-overlay) with
[electron-updater](https://www.electron.build/auto-update), and installs it over itself.

1. **Settings → Updates → Check for updates.** The app downloads `latest.yml` from the latest
   release: the version, the installer's file name, size and SHA-512.
2. **A newer version** shows its version, date and release notes, and a **Download** button. A
   pill in the dashboard's title bar says "Update x.y.z available" (it opens Settings).
3. **Download** fetches the installer, with a progress bar.
4. **Restart and install** closes the app, runs the installer silently over this copy (per-user
   NSIS, no admin rights) and starts the app again. If you don't restart, the update installs
   when the app quits.

Nothing happens by itself: the app never checks or downloads unless you press the button.
Downloaded updates don't carry Windows' "downloaded from the internet" mark, so SmartScreen
only warns on the first, hand-installed copy.

### Where it lives

| Piece | File |
|---|---|
| The updater: check, download, install, state | `app/src/main/updater.ts` |
| Its state, shared with the windows | `app/src/shared/update.ts` |
| IPC: `update:get`, `update:check`, `update:download`, `update:install`; event `update:state` | `app/src/shared/ipc.ts`, `app/src/main/ipc.ts` |
| The Updates section | `app/src/renderer/src/components/dashboard/SettingsView.vue` |
| The title bar pill | `app/src/renderer/src/pages/PanelPage.vue` |
| Where releases are read from (`publish:`) | `app/electron-builder.yml` |
| Attaching `latest.yml` and the blockmap to the release | `.github/workflows/build.yml` |

The updater's requests go through electron-updater's own session (`electron-updater`
partition), not the windows' session that `app/src/main/index.ts` blocks. The app goes online
only for this check (by hand) and the optional Lokthar field boss sync.

In development (`npm run dev`) there is nothing to update: the section says so and the button is
off.

### The portable copy

A copy unpacked from `Lokthar-<version>-portable.zip` has no installer to run (it is told apart by
having no `Uninstall Lokthar.exe` next to it). It checks the same way, but **Download** becomes
**Get the x.y.z zip**: it opens the release page, and the new zip is unpacked over the old folder.

## Requirements

- **The repo must be public.** The app reads releases without a token; a private repo's
  releases are invisible to it (and a token shipped in the app could be pulled out of it).
- **The release must be a normal release**, not a draft or a pre-release.
- **The tag must be `v` + the app's version**, exactly: `app/package.json` `"version": "0.3.1"`
  is released as `v0.3.1`. A version with a suffix (`0.3.1-beta.1`) is a pre-release and the
  updater skips it.
- **The release must hold `latest.yml`** next to the installer (the workflow attaches it).

## Publishing a release

1. Set the version in `app/package.json`:
   ```json
   "version": "0.3.1"
   ```
2. Commit it, then tag the same version and push the tag:
   ```sh
   git commit -am "0.3.1"
   git tag v0.3.1
   git push origin main v0.3.1
   ```
3. The **Build** workflow (`.github/workflows/build.yml`) runs on the tag: engine tests,
   typecheck, `npm run dist`, then a release named after the tag with:
   - `Lokthar-Setup-0.3.1.exe`, the installer
   - `Lokthar-Setup-0.3.1.exe.sha256`
   - `Lokthar-Setup-0.3.1.exe.blockmap`, for downloading only what changed
   - `latest.yml`, what the app reads
   - `Lokthar-0.3.1-portable.zip` and its `.sha256`, the portable copy
4. Installed copies see it at Settings → Updates → Check for updates.

To build without releasing, run the workflow by hand (Actions → Build → Run workflow): the
same files are kept as the run's artifact, and no release is made.

## First install

Copies installed before the updater existed (0.3.0 and older) can't update themselves:
install the first release that has it by hand, once. Every release after that can come through
Settings → Updates.

The installer is not code-signed, so Windows shows "Windows protected your PC" on that first
install: **More info → Run anyway**. Npcap (https://npcap.com) must be installed too.

## Testing an update

1. Release `v0.3.1` and install it by hand.
2. Release `v0.3.2`.
3. In 0.3.1: Settings → Updates → Check for updates → Download → Restart and install.
4. The app comes back as 0.3.2 (the version shows in Settings and at the bottom of the
   sidebar).

## When it fails

The Updates section shows the error; the details are in the log (Settings → Show log, lines
starting `update:`).

| Message | Cause |
|---|---|
| 404, or "Cannot find latest.yml" | The repo is private, the release has no `latest.yml`, or it is a draft or pre-release |
| "No published versions on GitHub" | No normal release exists yet |
| The check says you're up to date after a release | The tag doesn't match `app/package.json`'s version, or the version wasn't raised |
| SHA-512 checksum mismatch | The installer on the release was replaced after `latest.yml` was made: build and release again |
| The install fails | The app couldn't close (the engine still running); quit from the tray and run the downloaded installer from `%LOCALAPPDATA%\aion2-drop-tracker-updater` |

## Signing

Updates work without code signing. If the installer is signed later (SignPath Foundation's free
signing for open-source projects, or a Certum certificate), electron-updater also checks that each update is signed by the
same publisher before installing it; set `win.publisherName` in `electron-builder.yml` then.
