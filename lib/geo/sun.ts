import SunCalc from "suncalc";
import { ORIGIN } from "./frame.ts";

/** Where the sun is: elevation above the horizon and compass bearing, both in radians. */
export interface Sun {
  elevation: number;
  /** Compass bearing of the sun: 0 north, clockwise, so 90 degrees is east. */
  bearing: number;
  /** Unit horizontal vector pointing toward the sun. */
  east: number;
  north: number;
}

const TAU = 2 * Math.PI;

export function sunFromAngles(elevation: number, bearing: number): Sun {
  return { elevation, bearing, east: Math.sin(bearing), north: Math.cos(bearing) };
}

/**
 * Sun position for the whole box, taken at its centre. Across a box this small the
 * position differs by hundredths of a degree, so every point shares one sun.
 */
export function sunAt(date: Date, lat: number = ORIGIN.lat, lng: number = ORIGIN.lng): Sun {
  const position = SunCalc.getPosition(date, lat, lng);
  // SunCalc measures azimuth from south, growing toward the west. Everything else here
  // uses compass bearings, so convert once.
  const bearing = (((position.azimuth + Math.PI) % TAU) + TAU) % TAU;
  return sunFromAngles(position.altitude, bearing);
}

/** Sunrise and sunset of the local day that contains `date`, at the box centre. */
export function daylight(date: Date): { sunrise: Date; sunset: Date } {
  const times = SunCalc.getTimes(date, ORIGIN.lat, ORIGIN.lng);
  return { sunrise: times.sunrise, sunset: times.sunset };
}
