#!/usr/bin/env bash
# Install and start the F1 TV app on an LG TV in Developer Mode, without ares-cli.
#
#   ./tv.sh                     install the newest nl.davyschroeder.f1tv_*.ipk from ~/Downloads (or the current
#                               folder) and start it
#   ./tv.sh install <file.ipk>  install that file and start it
#   ./tv.sh launch [json]       start the app, optionally with launch params, e.g. '{"logout":true}'
#   ./tv.sh close               close the app
#   ./tv.sh ssh                 shell on the TV
#
# Settings (environment variables or ~/.config/f1tv-tv.conf):
#   TV_HOST  the TV's IP address              (default 192.168.2.27)
#   TV_KEY   the TV's SSH key (webos_rsa)     (default: ~/.ssh/webos_rsa, else ~/Downloads/webos_rsa)
#   TV_PASS  the key's passphrase, as shown in the Developer Mode app. Used once to remove the passphrase
#            from the private copy in ~/.ssh, so ssh never asks again. Keep it in the config file, not here.
# If no key is found it is downloaded from the TV's Key Server (turn Key Server on in the Developer Mode app).
set -euo pipefail

CONF="$HOME/.config/f1tv-tv.conf"
[ -f "$CONF" ] && . "$CONF"
TV_HOST="${TV_HOST:-192.168.2.27}"
APP_ID="nl.davyschroeder.f1tv"
SSH_OPTS=(-o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8)

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

find_key() {
  if [ -n "${TV_KEY:-}" ] && [ -f "$TV_KEY" ]; then return; fi
  for k in "$HOME/.ssh/webos_rsa" "$HOME/Downloads/webos_rsa" "./webos_rsa"; do
    if [ -f "$k" ]; then TV_KEY="$k"; break; fi
  done
  if [ -z "${TV_KEY:-}" ] || [ ! -f "$TV_KEY" ]; then
    say "No webos_rsa found; fetching it from the TV's Key Server…"
    mkdir -p "$HOME/.ssh"
    curl -fsS --max-time 8 -o "$HOME/.ssh/webos_rsa" "http://$TV_HOST:9991/webos_rsa" \
      || die "Could not get the key. Turn on Key Server in the Developer Mode app on the TV and try again."
    TV_KEY="$HOME/.ssh/webos_rsa"
  fi
  # ssh refuses keys that others can read; keep a private copy in ~/.ssh
  if [ "$TV_KEY" != "$HOME/.ssh/webos_rsa" ]; then
    mkdir -p "$HOME/.ssh"; cp "$TV_KEY" "$HOME/.ssh/webos_rsa"; TV_KEY="$HOME/.ssh/webos_rsa"
  fi
  chmod 600 "$TV_KEY"
  # passphrase-protected key: strip the passphrase from our private copy once
  if ! ssh-keygen -y -P "" -f "$TV_KEY" >/dev/null 2>&1; then
    if [ -z "${TV_PASS:-}" ]; then read -r -s -p "Passphrase from the Developer Mode app: " TV_PASS; echo; fi
    ssh-keygen -p -q -P "$TV_PASS" -N "" -f "$TV_KEY" >/dev/null 2>&1 \
      || die "Wrong passphrase. Check it in the Developer Mode app (it changes when Dev Mode is reset)."
    say "Key unlocked; ssh won't ask for the passphrase any more."
  fi
}

tv_ssh() { ssh "${SSH_OPTS[@]}" -i "$TV_KEY" -p 9922 "prisoner@$TV_HOST" "$@"; }

newest_ipk() {
  local f files=()
  for f in "$HOME"/Downloads/"$APP_ID"_*_all.ipk ./"$APP_ID"_*_all.ipk; do [ -f "$f" ] && files+=("$f"); done
  [ ${#files[@]} -gt 0 ] || return 0
  printf '%s\n' "${files[@]}" | awk -F_ '{print $(NF-1) "\t" $0}' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1 | cut -f2
}

install() {
  local ipk="${1:-}"
  [ -n "$ipk" ] || ipk="$(newest_ipk)"
  [ -n "$ipk" ] && [ -f "$ipk" ] || die "No ${APP_ID}_*.ipk found in ~/Downloads. Download it first or pass the file."
  find_key
  local name; name="$(basename "$ipk")"
  say "Copying $name to the TV ($TV_HOST)…"
  scp "${SSH_OPTS[@]}" -i "$TV_KEY" -P 9922 -q "$ipk" "prisoner@$TV_HOST:/media/developer/temp/" \
    || die "Copy failed. Is the TV on, in Developer Mode, and on the same network?"

  say "Installing…"
  local log; log="$(mktemp)"
  tv_ssh "luna-send-pub -i -f 'luna://com.webos.appInstallService/dev/install' '{\"id\":\"$APP_ID\",\"ipkUrl\":\"/media/developer/temp/$name\",\"subscribe\":true}'" >"$log" 2>&1 &
  local pid=$! state="" i
  for i in $(seq 1 120); do
    state="$(grep -o '"state": *"[^"]*"' "$log" | tail -1 | sed 's/.*: *"\(.*\)"/\1/')" || true
    case "$state" in
      installed) break ;;
      *fail*|*error*|*cancel*) break ;;
    esac
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
  if [ "$state" != "installed" ]; then
    tail -20 "$log"; rm -f "$log"; die "Install did not finish (last state: ${state:-none})."
  fi
  rm -f "$log"
  tv_ssh "rm -f '/media/developer/temp/$name'" || true
  say "Installed $name."
  launch
}

launch() {
  find_key
  local params="${1:-}" payload
  if [ -n "$params" ]; then payload="{\"id\":\"$APP_ID\",\"params\":$params}"; else payload="{\"id\":\"$APP_ID\"}"; fi
  tv_ssh "luna-send-pub -n 1 -f 'luna://com.webos.applicationManager/launch' '$payload'" >/dev/null
  say "F1 TV started on the TV."
}

case "${1:-}" in
  ""|install) shift || true; install "${1:-}" ;;
  launch) launch "${2:-}" ;;
  close) find_key; tv_ssh "luna-send-pub -n 1 -f 'luna://com.webos.applicationManager/close' '{\"id\":\"$APP_ID\"}'" >/dev/null ;;
  ssh) find_key; tv_ssh ;;
  *.ipk) install "$1" ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
