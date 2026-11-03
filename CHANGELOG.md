# Changelog

Each `## <version>` section becomes the release notes of the GitHub release for that version tag.

## 0.2.8 — 2026-11-03

- Progress bar: red knob at the current position; click anywhere on the bar with the pointer to jump there
- Moving the pointer or scrolling shows the bar and controls
- ⚙ button next to the bar opens the commentary-language menu, dropping up from the button (green button still works)

## 0.2.7 — 2026-11-03

- Every video starts on English (International) commentary; the green-button menu changes it for that video only
- Narrower headings: Orbitron only, slightly smaller tabs and titles

## 0.2.6 — 2026-11-03

- Always transmux MPEG-TS to MP4 (the TV reports TS support but then refuses it), fixing older archive videos

## 0.2.5 — 2026-11-03

- Older archive videos (HLS with MPEG-TS segments) play: mux.js is loaded so Shaka converts them to MP4 for the TV
- Progress bar in the player: play/pause state, elapsed and total time, or LIVE and time behind live; stays visible while paused

## 0.2.4 — 2026-11-03

- Audio menu on the green button: pick the commentary by name (International (English), Nederlands, Deutsch, …, natural sound) instead of cycling language codes; the choice is remembered and applied to every stream

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
