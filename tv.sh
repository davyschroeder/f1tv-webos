#!/usr/bin/env bash
# Hulpscript voor de LG tv in Developer Mode (zonder ares-cli): installeren, starten, log tonen.
#   ./tv.sh install out/nl.davyschroeder.f1tv_0.1.1_all.ipk
#   ./tv.sh launch
#   ./tv.sh launch '{"cookie":"<login-session waarde>"}'     # handmatige login
#   ./tv.sh launch '{"logout":true}'                         # sessie wissen
#   ./tv.sh ssh                                               # shell op de tv
set -euo pipefail

TV_HOST="${TV_HOST:-192.168.2.27}"
TV_KEY="${TV_KEY:-webos_rsa}"
APP_ID="nl.davyschroeder.f1tv"
SSH_OPTS=(-o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa -i "$TV_KEY")

tv_ssh() { ssh "${SSH_OPTS[@]}" -p 9922 "prisoner@$TV_HOST" "$@"; }

case "${1:-}" in
  install)
    ipk="${2:?geef het .ipk-bestand op}"
    name="$(basename "$ipk")"
    scp "${SSH_OPTS[@]}" -P 9922 "$ipk" "prisoner@$TV_HOST:/media/developer/temp/"
    tv_ssh "luna-send-pub -i -f 'luna://com.webos.appInstallService/dev/install' '{\"id\":\"$APP_ID\",\"ipkUrl\":\"/media/developer/temp/$name\",\"subscribe\":true}'"
    ;;
  launch)
    params="${2:-}"
    if [ -n "$params" ]; then
      payload="{\"id\":\"$APP_ID\",\"params\":$params}"
    else
      payload="{\"id\":\"$APP_ID\"}"
    fi
    tv_ssh "luna-send-pub -n 1 -f 'luna://com.webos.applicationManager/launch' '$payload'"
    ;;
  close)
    tv_ssh "luna-send-pub -n 1 -f 'luna://com.webos.applicationManager/close' '{\"id\":\"$APP_ID\"}'"
    ;;
  ssh)
    tv_ssh
    ;;
  *)
    echo "gebruik: $0 install <ipk> | launch [json-params] | close | ssh"; exit 1
    ;;
esac
