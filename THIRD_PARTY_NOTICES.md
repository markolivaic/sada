# Data and services from other people

## Buildings: ZG3D

- Creator: Grad Zagreb (City of Zagreb)
- Dataset: ZG3D 2022 3D model Grada Zagreba, https://data.zagreb.hr/dataset/zg3d-2022-3d-model-gz
- Licence: Otvorena dozvola (Open Licence), http://data.gov.hr/otvorena-dozvola
- In this repository: `data/source/zg3d_buildings.geojson`, and `public/data/buildings.bin.gz`
  with its manifest `public/data/buildings.json`, both made from it

What was done to it. The GeoJSON file holds the buildings of that dataset inside the box
15.968-15.998 E, 45.808-45.820 N: footprints, the survey each building comes from, and the
lowest and highest point of its 3D solid. The roofs themselves are not in it.
`scripts/buildings.ts` turns that file into the binary bundle. It keeps the footprints on a
5 cm grid and the highest point of each building, and replaces the lowest point by an
estimate of the ground where the two disagree by more than 3 m. The manifest records the
hash of both files and how many buildings were changed.

## Cafés and benches: OpenStreetMap

- Creator: OpenStreetMap contributors
- Source: Overpass API, https://overpass-api.de, with the query stored in the file
- Licence: Open Database License 1.0, https://opendatacommons.org/licenses/odbl/1-0/
- In this repository: `data/osm/places.json`

What was done to it. `scripts/fetch-places.ts` asks for every `amenity=cafe` and
`amenity=bench` inside the box and keeps the id, kind, name, position and the
`outdoor_seating` tag. The file is a database derived from OpenStreetMap and stays under
the same licence. The date of the data is in the file.

## Map and walking routes: Mapbox

The running app loads the Mapbox Standard style, its tiles and terrain, and asks the Mapbox
Directions API for walking routes, all under Mapbox's terms of service with the token of
whoever runs the app. Nothing from Mapbox is stored in this repository.

## Libraries

Installed from npm and listed in `package.json`, each under its own licence: Next.js and
React (MIT), mapbox-gl (Mapbox Web SDK terms), react-map-gl (MIT), SunCalc (BSD 2-Clause),
flatbush (ISC), lucide-react (ISC).

## What the app's answers are not

The sun and shade shown here are computed from simplified buildings. They are not a
measurement, not a survey of any café's terrace, and not a statement about any business.
A place's name and position are whatever OpenStreetMap held on the snapshot date.
