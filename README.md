# Lokthar overlay

> **Lokthar's based on** [xCROv/aion2-nyerk](https://github.com/xCROv/aion2-nyerk)

A Windows overlay that counts your Aion 2 Pet Collection souls as they drop, so you don't have
to keep opening the Pets menu.

- **Live counts:** every soul is counted the moment it drops, with level-ups (5 → 25 → 75) and the
  genus crystals that maxed (Lv3) pets give instead.
- **Login sync:** when you enter the world, your whole collection is taken from the game, so the
  counts always match the Pets menu.
- **In-game HUD:** a small click-through overlay with nearby soul monsters, this fight's pets and
  a feed of drops. It clears itself between fights.
- **Collection panel:** every pet with its genus, level and progress; search, filter, pin pets to
  the HUD, and see where each soul drops on a map.
- **Kina per hour:** this session's Kina rate with a timeline, in the panel and on the HUD.
- **Timers:** the game's events (Shugo Festival, the Black Cloud Merchant, rifts, the siege…) and
  Verteron's field bosses, read from the map's field boss list, with optional alerts. Field boss
  times come only from your own map.
- **Countdown bar:** the timers whose alert you turned on, starting within 13 hours, as a small
  bar of icons and countdowns over the game.
- **PvP log and kill feed:** every player kill around you, as the game credits it, in the panel's
  PvP tab and in a small kill feed over the game; yours and your legion's marked.
- **Black Cloud Merchant:** when you open one of its tabs, a window lists the pets it sells that
  you have not maxed, with where their soul monsters spawn.
- **One collection per server:** as in the game, your characters on a server share one; one on
  another server has its own.
- **DPS meter:** its own window while you play, from A2Tools DPS Meter's parser: everyone hitting
  your target, the target's HP and the fight's time.
- **Stays out of the way:** it sits in the tray and sleeps while Aion 2 is closed, waking when the
  game starts.
- And whatever else I randomly find useful while I play Aion2. :D


![The collection panel and the in-game HUD](assets/screenshot.webp)

## How it works

The tracker **only listens** and functions the exact same as popular DPS Meters used in Aion 2. It reads the game's network traffic passively through
[Npcap](https://npcap.com). It never sends anything to the game
or its servers, never reads or changes the game's memory, and sends no input.

No update checks, no shared timers, no machine id. Everything it reads stays on your PC
(`%APPDATA%\Lokthar`; an older `%APPDATA%\Nyerk` is moved there on first start). Links you click
(questlog.gg) open in your browser.

### Lokthar sync (optional)

With **Settings → Lokthar sync** on, the field boss list your map shows is posted to the Lokthar
site's timers (`POST <site>/api/aion2/field_bosses`), so the guild's spawn tracker follows the
game's own respawn times. It is the only request the app makes: to that one address (https only),
whenever the list changes while your map is open, carrying the bosses' ids, whether each is up and
its time, and your game server id. Nothing else: no character name, no collection, no packets.

It needs a token, issued on the site's server for an account that may report kills:

```bash
bin/rails 'overlay:token[<user id, Discord username or email>]'   # bin/rails 'overlay:revoke[...]' to revoke
```

## Install

1. Install [Npcap](https://npcap.com) (the default options are fine).
2. Download `Lokthar-Setup-<version>.exe` from this repo's Releases (built by
   `.github/workflows/build.yml` on a tag push), or build it from source (below), and run it. It
   installs for your Windows account only. The installer is not code-signed, so Windows may show "Windows protected your
   PC": choose **More info → Run anyway**.
3. Start the tracker **before you log in** to your character, so it picks up your collection.

The overlay draws over **borderless or windowed** mode, not exclusive fullscreen. There are no
automatic updates: to update, pull the new upstream version, review it, and rebuild.

## Build from source

Needs Windows, [Node.js 24](https://nodejs.org), [Rust](https://rustup.rs) (with the Visual
Studio Build Tools rustup offers to install) and Npcap.

```bash
cd app && npm install && npm run dist
```

The installer is written to `app/dist/`. For development, build the engine once and run the app
with hot reload; it finds `engine/target/release` on its own:

```bash
cd engine && cargo build --release
cd ../app && npm install && npm run dev
```

After changing the engine, build it again and use Settings → Restart engine. `A2T_REPLAY=<file>`
plays a recording (`.pcap`, `.pcapng` or an A2Tools packet log) instead of the game.

## Credits

- Lokthar Overlay started as a fork of [xCROv/aion2-nyerk](https://github.com/xCROv/aion2-nyerk)
  (GPL-3.0), which gave it its overlay UI and its first pet tracker features (since ported to
  Rust in `engine/src/tracker/`). The PvP log and kill feed are copied from Nyerk 0.2.17.
- The DPS meter, packet capture and combat parsing use code from
  [taengu/A2Tools-DPS-Meter](https://github.com/taengu/A2Tools-DPS-Meter) (GPL-3.0): its parser
  crate as a dependency, and its capture code copied into `engine/`. Its monster, skill and
  buff tables are in `engine/data/`, and the meter's class icons are its too.
- Pet record layouts and soul counting rules follow the pet-souls plugin of
  [taengu/A2Tools-Plugins](https://github.com/taengu/A2Tools-Plugins) (GPL-3.0).
- The Shugo Festival and Spacetime Rift icons of the timer bar come from
  [guildmanager.app](https://guildmanager.app), kept in `app/src/renderer/public/events/`.
- Pet names, genus, portraits, spawn locations and zone maps come from
  [questlog.gg](https://questlog.gg/aion-2/en/db/pets).
- Aion 2 and its game data and art belong to NCSoft. This project is not affiliated with or
  endorsed by NCSoft or questlog.gg.

## License

GPL-3.0-only: see [LICENSE](LICENSE). The projects credited above are GPL-3.0 too; their code
keeps its authors' copyright.

## Disclaimer

Use at your own risk. The tracker is passive, but whether third-party tools are allowed is up to
the game's Terms of Service.
