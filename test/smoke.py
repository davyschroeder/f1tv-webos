"""Smoke test: run the webOS app in headless Chrome with all F1 endpoints faked.
Exercises login (device code) -> home (menu + page) -> weekend page (gp banner + schedule) -> feeds -> player."""
import json, os, sys, time, base64
from playwright.sync_api import sync_playwright

SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "out"))
os.makedirs(OUT, exist_ok=True)

def jwt(payload):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return b({"alg": "none"}) + "." + b(payload) + ".sig"

SUB = jwt({"SessionId": "sess-1", "SubscriberId": 42, "exp": int(time.time()) + 4 * 86400,
           "FirstName": "Davy", "LastName": "S", "Email": "d@example.com", "HomeCountry": "NLD", "SubscriptionStatus": "active"})
ACCESS = jwt({"sub": "42", "subscriptionToken": SUB})
polls = {"n": 0}
log = []

def cors(extra=None):
    h = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*", "Content-Type": "application/json"}
    if extra: h.update(extra)
    return h

def video(title, cid, subtype="REPLAY", session=False, live=False, extra=None):
    emf = {"Series": "FORMULA 1", "Global_Meeting_Name": "Mexico City Grand Prix"}
    if session: emf["VideoType"] = "meetingSession"
    if extra: emf.update(extra)
    return {"metadata": {"title": title, "contentId": cid, "contentType": "VIDEO", "contentSubtype": "LIVE" if live else subtype,
                         "uiDuration": "03:01:14", "pictureUrl": "pic/%d.jpg" % cid, "emfAttributes": emf}}

def page_link(title, uri, extra=None):
    return {"metadata": {"title": title, "pictureUrl": "pic/x.jpg", "contentType": "BUNDLE", "emfAttributes": extra or {}},
            "actions": [{"key": "onClick", "uri": uri, "targetType": "PAGE"}]}

def section(layout, label, items, extra=None):
    d = {"layout": layout, "metadata": {"label": label}, "retrieveItems": {"resultCode": "OK", "resultObj": {"containers": items}}}
    if extra: d.update(extra)
    return d

MENU = {"resultCode": "OK", "resultObj": {"containers": [
    {"metadata": {"label": "Home"}, "actions": [{"key": "onClick", "uri": "/2.0/R/ENG/BIG_SCREEN_HLS/ALL/PAGE/395/F1_TV_Pro_Annual/14", "targetType": "PAGE"}]},
    {"metadata": {"label": "Archive"}, "actions": [{"key": "onClick", "uri": "/2.0/R/ENG/BIG_SCREEN_HLS/ALL/PAGE/493/F1_TV_Pro_Annual/14", "targetType": "PAGE"}]},
    {"metadata": {"label": "Shows"}, "actions": [{"key": "onClick", "uri": "/2.0/R/ENG/BIG_SCREEN_HLS/ALL/PAGE/410/F1_TV_Pro_Annual/14", "targetType": "PAGE"}]},
]}}

HOME = {"resultCode": "OK", "resultObj": {"containers": [
    section("hero", "", [video("Race in 30", 2001, extra={"Series": "F1"}), video("Qualifying", 2002, session=True, live=True)]),
    section("horizontal_thumbnail", "2026 Mexico City Grand Prix", [video("Race", 1003, session=True), video("Race Highlights", 1004), video("Radio Rewind", 1005), video("Post-Race Show", 1006), video("Pre-Race Show", 1007), video("Qualifying", 1008, session=True)],
            {"actions": [{"key": "onTitleClick", "uri": "/2.0/R/ENG/WEB_HLS/ALL/PAGE/SANDWICH/777/F1_TV_Pro_Annual/14"}]}),
    section("vertical_simple_poster", "Shows", [page_link("The Cooldown Room", "/2.0/R/ENG/WEB_HLS/ALL/PAGE/5001/F1_TV_Pro_Annual/14"), page_link("Tech Talk", "/2.0/R/ENG/WEB_HLS/ALL/PAGE/5002/F1_TV_Pro_Annual/14")]),
    {"layout": "horizontal_thumbnail", "metadata": {"label": "Continue Watching"}, "actions": [{"key": "onClick", "uri": "/2.0/R/ENG/WEB_HLS/ALL/CONTENT/WATCHING/14"}], "retrieveItems": {"resultObj": {"containers": [video("Secret", 9999)]}}},
    section("horizontal_thumbnail", "Popular Races From The Archive", [page_link("2025 Mexico City Grand Prix", "/2.0/R/ENG/WEB_HLS/ALL/PAGE/SANDWICH/555/F1_TV_Pro_Annual/14", {"Meeting_Display_Date": "24 - 26 OCT"}), page_link("2021 Abu Dhabi Grand Prix", "/2.0/R/ENG/WEB_HLS/ALL/PAGE/SANDWICH/556/F1_TV_Pro_Annual/14")]),
]}}

WEEKEND = {"resultCode": "OK", "resultObj": {"containers": [
    {"layout": "gp_banner", "metadata": {"label": "2025 Mexico City Grand Prix", "pictureUrl": "pic/gp.jpg", "emfAttributes": {"Meeting_Country_Name": "Mexico", "Meeting_Official_Name": "FORMULA 1 GRAN PREMIO DE LA CIUDAD DE MÉXICO 2025", "Championship_Meeting_Ordinal": 19, "Meeting_Display_Date": "24 - 26 OCT"}}},
    {"layout": "interactive_schedule", "metadata": {"label": "Schedule"}, "retrieveItems": {"resultObj": {"containers": [
        {"eventName": "THURSDAY", "eventShortName": "Thursday", "events": [video("Weekend Warm-Up", 3001, session=True, extra={"sessionStartDate": 1761840000000})]},
        {"eventName": "FRIDAY", "eventShortName": "Friday", "events": [video("Practice 1", 3002, session=True), video("Practice 2", 3003, session=True)]},
        {"eventName": "SATURDAY", "eventShortName": "Saturday", "events": [video("Practice 3", 3004, session=True), video("Qualifying", 3005, session=True)]},
        {"eventName": "SUNDAY", "eventShortName": "Sunday", "events": [video("Pre-Race Show", 3006), video("Race", 3007, session=True), video("Post-Race Show", 3008)]},
    ]}}},
    section("horizontal_thumbnail", "Replays", [video("Race", 3007, session=True), video("Qualifying", 3005, session=True)]),
]}}

def handle(route, request):
    url = request.url; m = request.method
    if url.startswith("file://"):
        return route.continue_()
    log.append(f"{m} {url[:140]}")
    if m == "OPTIONS":
        return route.fulfill(status=204, headers=cors())
    if "id.formula1.com/as/device_authorization" in url:
        return route.fulfill(status=200, headers=cors(), body=json.dumps({
            "device_code": "dev123", "user_code": "ABCD-EFGH", "verification_uri": "https://f1tv.com/pair",
            "verification_uri_complete": "https://f1tv.com/pair?user_code=ABCD-EFGH", "expires_in": 600, "interval": 1}))
    if "id.formula1.com/as/token" in url:
        polls["n"] += 1
        if polls["n"] < 2:
            return route.fulfill(status=400, headers=cors(), body=json.dumps({"error": "authorization_pending"}))
        return route.fulfill(status=200, headers=cors(), body=json.dumps({"access_token": ACCESS, "token_type": "Bearer", "expires_in": 3600, "refresh_token": "rt1"}))
    if "/MENU/PREMIUM/" in url:
        return route.fulfill(status=200, headers=cors(), body=json.dumps(MENU))
    if "/PAGE/395/" in url:
        return route.fulfill(status=200, headers=cors(), body=json.dumps(HOME))
    if "/PAGE/SANDWICH/555/" in url:
        return route.fulfill(status=200, headers=cors(), body=json.dumps(WEEKEND))
    if "/PAGE/" in url:
        return route.fulfill(status=200, headers=cors(), body=json.dumps({"resultCode": "OK", "resultObj": {"containers": [section("horizontal_thumbnail", "Episodes", [video("Ep 1", 7001), video("Ep 2", 7002)])]}}))
    if "CONTENT/VIDEO/" in url:
        add = [{"title": "Pit Lane", "type": "additional", "playbackUrl": "CONTENT/PLAY?channelId=1022&contentId=3007"},
               {"type": "obc", "playbackUrl": "CONTENT/PLAY?channelId=1030&contentId=3007", "driverFirstName": "Max", "driverLastName": "Verstappen", "teamName": "Red Bull Racing", "racingNumber": 1, "hex": "3671C6", "title": "Max Verstappen"}]
        return route.fulfill(status=200, headers=cors(), body=json.dumps({"resultCode": "OK", "resultObj": {"containers": [{"metadata": {"additionalStreams": add}}]}}))
    if "CONTENT/PLAY" in url:
        if "BIG_SCREEN_DASH" in url:
            return route.fulfill(status=200, headers=cors(), body=json.dumps({"resultCode": "OK", "resultObj": {"url": "https://cdn.example/stream.mpd?token=x", "streamType": "DASHWV", "drmType": "widevine", "laURL": "https://cdn.example/license", "entitlementToken": "ent1", "channelId": 1030}}))
        return route.fulfill(status=404, headers=cors(), body=json.dumps({"resultCode": "KO", "errorDescription": "not found"}))
    if "image-resizer" in url:
        ph = os.path.join(os.path.dirname(__file__), "placeholders")
        name = "hero.png" if "w=1920" in url else "poster.png" if "w=244" in url else "thumb%d.png" % (sum(map(ord, url.split("?")[0][-12:])) % 8)
        return route.fulfill(status=200, headers={"Content-Type": "image/png"}, body=open(os.path.join(ph, name), "rb").read())
    if "shaka-player" in url:
        return route.fulfill(status=200, headers={"Content-Type": "application/javascript"}, body=open(os.path.join(os.path.dirname(__file__), "shaka_stub.js")).read())
    return route.fulfill(status=404, headers=cors(), body="{}")

def key(page, code):
    page.evaluate("c => document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: c, which: c, bubbles: true}))", code)
    page.wait_for_timeout(120)

def check(cond, msg):
    print(("OK   " if cond else "FAIL ") + msg)
    if not cond: sys.exit(1)

def focused(page):
    return page.evaluate("() => { const e = document.querySelector('.focus'); return e ? e.className + '|' + e.textContent.trim().slice(0, 40) : '' }")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files", "--disable-web-security"])
    page = b.new_page(viewport={"width": 1920, "height": 1080})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/*", handle)
    page.goto("file://" + SRC + "/index.html")
    page.wait_for_timeout(600)
    check(page.is_visible("#scr-login"), "login screen shown without session")
    check(page.inner_text("#login-code") == "ABCD-EFGH", "user code displayed")
    check("pair?user_code=ABCD-EFGH" in page.inner_text("#login-full"), "full pair url displayed")
    page.screenshot(path=os.path.join(OUT, "1-login.png"))
    page.wait_for_timeout(2500)
    check(page.is_visible("#scr-browse"), "browse screen shown after device-code approval")
    page.wait_for_timeout(600)
    check(page.locator("#tabs .tab").count() == 4, "3 menu tabs + LIVE tab rendered")
    check(page.locator(".hero .hero-slide").count() == 2, "hero with 2 slides")
    check(page.locator(".section .section-title").count() == 3, "3 titled rows (Continue Watching skipped)")
    check("hero-btn" in focused(page), "hero button focused first")
    page.screenshot(path=os.path.join(OUT, "2-home.png"))
    key(page, 39)
    check(page.locator(".hero-slide.current .badge.live").count() == 1, "right switches hero slide to live item")
    key(page, 40)
    check("card" in focused(page) and "Race" in focused(page), "down moves to first row card")
    for _ in range(5): key(page, 39)
    check("Qualifying" in focused(page), "right x5 reaches last card in row")
    x = page.evaluate("() => document.querySelector('[data-sec=\"1\"] .row').style.transform")
    check("translate3d(-" in x, "row scrolled horizontally: " + x)
    key(page, 40)
    check("poster" in focused(page), "down moves to shows poster row (column clamped)")
    page.screenshot(path=os.path.join(OUT, "3-rows.png"))
    key(page, 40); key(page, 37); key(page, 13)
    page.wait_for_timeout(500)
    check(page.locator(".gp .gp-name").count() == 1 and "MEXICO" in page.inner_text(".gp-name").upper(), "weekend page with gp banner opened")
    check(page.locator(".schedule .day").count() == 4, "schedule with 4 days")
    check("sess" in focused(page) and "Warm-Up" in focused(page), "first schedule session focused")
    key(page, 39); key(page, 39); key(page, 39); key(page, 40)
    check("Race" in focused(page), "schedule navigation: Sunday, 2nd item = Race")
    page.screenshot(path=os.path.join(OUT, "4-weekend.png"))
    key(page, 13)
    page.wait_for_timeout(500)
    check(page.is_visible("#scr-feeds"), "session opens feeds screen")
    check(page.locator("#feeds-list .lrow").count() == 3, "main + 2 feeds rendered")
    key(page, 40); key(page, 13)
    page.wait_for_timeout(1200)
    check(page.is_visible("#scr-player"), "player screen shown")
    check(page.evaluate("window.__stubLoaded && window.__stubLoaded.url") == "https://cdn.example/stream.mpd?token=x", "shaka.load called with stream url")
    check(page.evaluate("window.__stubLoaded.licHeaders.ascendontoken") == SUB, "license request filter adds ascendontoken")
    key(page, 461)
    page.wait_for_timeout(200)
    check(page.is_visible("#scr-feeds"), "back from player returns to feeds")
    key(page, 461)
    page.wait_for_timeout(200)
    check(page.is_visible("#scr-browse") and page.locator(".gp").count() == 1, "back from feeds returns to weekend page")
    check("Race" in focused(page), "focus restored on the weekend page")
    key(page, 461)
    page.wait_for_timeout(300)
    check(page.locator(".hero").count() == 1, "back pops to home")
    for _ in range(6):
        if "tab" in focused(page): break
        key(page, 38)
    check("tab" in focused(page), "up repeatedly reaches tabs")
    key(page, 39); key(page, 39); key(page, 39)
    check("live" in focused(page), "LIVE tab reachable")
    key(page, 13)
    page.wait_for_timeout(400)
    check(page.is_visible("#scr-feeds"), "LIVE tab opens the live session feeds directly")
    key(page, 461); page.wait_for_timeout(200)
    check("live" in focused(page), "focus back on LIVE tab after returning")
    key(page, 37); key(page, 37); key(page, 13)
    page.wait_for_timeout(500)
    check(page.locator(".section-title").first.inner_text().startswith("Episodes"), "Archive tab loads its page")
    key(page, 461); page.wait_for_timeout(400)
    check(page.locator(".hero").count() == 1, "back from a tab returns to Home")
    page.screenshot(path=os.path.join(OUT, "5-home-again.png"))
    page.reload(); page.wait_for_timeout(900)
    check(page.is_visible("#scr-browse"), "session persisted across restart")
    check(not errors, "no page errors: " + "; ".join(errors))
    b.close()
print("ALL OK")
