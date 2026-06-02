# Temperature Dashboard (Plant Layout)

Stage 2 Temperature Monitoring Dashboard. The Temperature page now shows the
**plant-layout monitor** ported from the `01MyMonitor` desktop app: the factory
floor image with a live temperature reading overlaid on each of the 96 rooms.

## Run Locally

```powershell
pip install -r requirements.txt
python app.py
```

Open:

```text
http://127.0.0.1:5001/Temperature/index.html
```

## How the display works

- Background image: `frontend/Temperature/assets/plantlayout_r2.png`
- Each room reading is positioned by its `(x, y)` pixel coordinate from `ROOM_LIST`
  in `app.py` (the same coordinates used by the original desktop monitor).
- A reading turns **red** when it exceeds that room's `max_temp` (default 25 deg C;
  room 37 is 10 deg C), and **green** when within limit. Rooms with no data show `-- deg C`.
- The summary cards count rooms Within Limit vs Over Limit. The filter buttons
  highlight only one group at a time.

## Live data

The Flask backend runs a background WebSocket client (ported from `app_gui.py`)
that subscribes to the plant feed, updates the live map, and logs one row per
room per minute into `factory_monitor.db`.

Configure via environment variables before `python app.py`:

```text
COOKIE_SESSION   e.g. "PHPSESSID=xxxxxxxx"   (required for the live feed)
WEBSOCKET_URL    default wss://globallink.itc-group.co.th:9443/ws/
SITE_ID          default 3C6AD26B24ECSM
ENABLE_WS        set to 0 to disable the live feed (stored values only)
```

When the WebSocket cannot connect (no/expired cookie, offline), the page still
renders the most recent values stored in `factory_monitor.db`. The status pill
shows **Live**, **Stored data**, or **Offline** accordingly.

## Endpoints

- `/api/temperature/live` - layout + current reading/status per room (polled every 5s)
- `/api/temperature/history.csv` - full history export (the Export CSV button)
- `/api/page-sync/temperature` - last-synced timestamp for the navbar card

## Adjusting room positions

Edit the `(x, y)` values in `ROOM_LIST` (in `app.py`); the front-end reads the
coordinates from the live endpoint, so no front-end changes are needed.
Coordinates use the image's native space (1921 x 729). A few rooms near the
bottom callouts (8, 9, 11, 21, 22) have `y` values just below this export of the
image and sit at the lower edge - nudge their `y` up if you re-export the layout.

## Settings page (password protected)

Open **⚙ Settings** from the Temperature page, or go to:

```text
http://127.0.0.1:5001/Temperature/settings/index.html
```

You will be asked for a password before editing. Set it via env before launch:

```text
SETTINGS_PASSWORD   default "sats1234"
APP_SECRET_KEY      session signing key (set your own in production)
```

In the editor you can:

- **Move labels** - drag any numbered label to sit exactly on its real room.
  (Rooms whose default coordinate falls below this image export - e.g. 8, 10,
  18, 22 - appear at the bottom of the editor canvas and can be dragged up onto
  the correct room.)
- **Draw area** - pick a room, then click on the map to drop corner points and
  outline that room's floor area; drag the points to fine-tune, or use Undo
  point / Clear area. Each saved area is shown on the dashboard and its size
  (in image px²) appears in the hover popup.
- Adjust each room's **Limit °C** (over-limit threshold).

Click **Save** to store everything. Saved edits live in `room_config.json` next
to `app.py` and are merged over the defaults by `/api/temperature/live` and
`/api/temperature/config`. **Reset all** clears `room_config.json` and returns
to the built-in coordinates.

## 24-hour Hi/Low popup

Hover any room (its label or its drawn area) on the dashboard to see a popup with
the current reading, the **24h High and Low**, the number of readings in that
window, the room's limit, and the area size. The figures come from
`/api/temperature/stats`, computed from `factory_monitor.db`.

## New endpoints

- `/api/temperature/stats` - last-24h high/low/count per room
- `/api/temperature/config` - GET effective room layout; POST to save (auth required)
- `/api/settings/login`, `/api/settings/logout`, `/api/settings/status` - password gate
