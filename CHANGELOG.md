# Changelog

Each `## <version>` section becomes the release notes of the GitHub release for that version tag.

## 0.2.3 — 2026-11-03

- Orbitron display font (SIL Open Font License) for the logo, tabs and titles, bundled as static regular/bold cuts
- The whole app in English
- Playback: the PLAY request tries the known header/device-info/provider combinations until one streams and remembers it
- Magic Remote pointer only highlights; the arrow keys and scroll wheel move through the page

## 0.2.2 — 2026-11-03

First public release of the unofficial F1 TV app for LG webOS TVs.

- Sign in with a code on your phone (device-code flow, no password on the TV)
- Browse the F1 TV catalogue like the official apps: home, race weekends with schedule, Archive, Shows; LIVE button when a session is live
- Pick a feed: main broadcast, pit lane, data channel, driver onboards
- Widevine playback through Shaka Player; H.264/AAC up to 1080p; audio language switching
- Runs on webOS 4.5+ (tested on an LG OLED B9, 2019)
