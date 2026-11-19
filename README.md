# sada

Sada is Croatian for "now". Tap Sun or Shade and it names the nearest café or bench in the
centre of Zagreb that has it at this moment, says until what time, and draws the walk there.

Live: https://sada-hackathon.vercel.app

[![Asking for a café in the sun at 13:00, then moving the clock to 15:00](docs/walkthrough/app-walkthrough.webp)](docs/walkthrough/app-walkthrough.mp4)

In the recording the clock is fixed at 13:00 on 19 September 2026 and the person stands on
the main square. The walking routes in it are answers the routing service gave once, kept in
`scripts/walkthrough-routes.json`. `npm run walkthrough` makes it again.

Sun and shade are worked out from the city's 3D building model and the position of the sun.
Only buildings cast shadows here: trees, awnings and clouds are not in the model, so a bench
under a plane tree reads as sun. It covers a box of about 2.3 by 1.3 km around the main
square, with 8,732 buildings, 147 cafés and 342 benches.

## What you get

- **The pick.** The nearest place of the kind you asked for that is in the light you asked
  for and keeps it for at least 20 minutes. If none lasts that long, the nearest that has it
  now.
- **A headline** such as "Sun until 13:32", and under it how long that is and how far the
  walk is.
- **The city in 3D, lit from where the sun stands** at the moment shown, so the shadows
  fall where the answer says they do. A dot marks every café or bench: filled for sun, a
  ring for shade, small and grey where the app cannot tell.
- **A clock** you can move from twelve hours back to a day ahead. The shadows and the pick
  follow it.

## How the answer is worked out

Each building is treated as a flat-roofed block: its footprint, raised from the ground to
the highest point of its roof. For a point on the ground, the app follows a line from that
point toward the sun and looks for the first footprint the line enters. If the roof there
is higher than the line at that distance, the point is in shade. A point under a roof is in
shade. A spatial index keeps this to the few buildings that lie along the line.

"Until when" is the same question asked again for each minute ahead, up to sunset.

The map draws the same blocks. The base map's own buildings are switched off, the blocks
are drawn in their place, and one light is put where the sun stands, so the shadows on
screen are cast by the buildings the answer was worked out from.

All of it runs in a web worker in the browser. There is no server. The pages are static
files, and the one outside service is Mapbox, for the map and for the walking route. When
a route is asked for, the two ends of it go to Mapbox, and one of them is where you are.

## Where the seats are

OpenStreetMap marks most cafés as a point inside their building, where it is always shade.
For a place mapped under a roof, the app judges a point 2 m outside the nearest wall that
has open ground in front of it. Walls shared with the next building are skipped. Of the
147 cafés, 126 are moved this way and 5 are left out because none of their walls opens
onto free ground.

This is an assumption. Where the tables really stand is not mapped, and the app says so
under every pick it applies to.

## What the model assumes

- **Flat roofs.** Each building is a block up to its highest point, so a pitched roof or a
  spire throws a slightly longer shadow than the real one.
- **Ground from the buildings.** Ground level comes from the bases of the 3D solids, checked
  against a plane through each building's neighbours; for 771 of the 8,732 buildings the
  plane is used instead. 55 buildings end up no higher than the ground around them.
- **The city as surveyed.** 6,452 buildings (74%) come from a 2008 aerial survey and 2,280
  from a 2022 survey. 3 records in the source outline whole blocks rather than buildings,
  and are left out.
- **The edge of the map.** A low sun near the edge could be blocked by a building outside
  the box. Where the box ends before a 30 m building could be ruled out, a place shows as
  "sun too low to tell" and is not picked.
- **One sun for the box,** taken at its centre. Across the box it differs by less than
  0.05 degrees.
- **Places as of one day.** The cafés and benches are an OpenStreetMap snapshot from
  2026-11-18.
- **Two kinds of shadow.** The answers come from the tested geometry. The shadows on the map
  are drawn by the graphics card on level ground, so on the slope of the upper town they can
  end a few metres from where the answer changes.

## Run it

Node 24.

```bash
npm ci
npm run dev
```

That is enough to get answers. For the map and walking routes, copy `.env.example` to
`.env.local` and put a public Mapbox token in it.

## Check it

```bash
npm test
npm run build
npx playwright install chromium
npm run smoke
```

`npm test` covers the geometry on cases with a known answer (a 10 m block with the sun 45
degrees up, an L-shaped footprint, a courtyard, the compass bearing of the sun through a
day), compares the fast query with a second method on the real buildings, and rebuilds the
building bundle from its source to check it is the committed one byte for byte.

`npm run smoke` opens the built app in a browser at phone and desktop size with the clock
fixed, and checks the pick, the words under it, the clock, and what the app says when it
has no location, when you are far from Zagreb, when the buildings do not load, and at
night.

`npm run walkthrough` builds the app and records `docs/walkthrough`. It needs the Mapbox
token, ffmpeg on the PATH, and a Chromium that draws with the graphics card.

To rebuild the data:

```bash
npm run build:data     # public/data/buildings.bin.gz and its manifest, from data/source
npm run fetch:places   # data/osm/places.json, from OpenStreetMap
```

The building bundle is 583 kB, and 366 kB as it is sent, gzip-compressed.

## Data

- Buildings: ZG3D 2022 3D model Grada Zagreba, Grad Zagreb, under the Open Licence
  (Otvorena dozvola).
- Cafés and benches: © OpenStreetMap contributors, Open Database License.
- Map and routes: Mapbox.

Sources, licences and what was done to each are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Authors

First built at the Zagreb Hackathon in March 2026 by Francesco Marko Livaic and Antonio
Brkić ([@Brkic365](https://github.com/Brkic365)).

## License

MIT, see [LICENSE](LICENSE). The data keeps its own licences, listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
