import { env } from "$env/dynamic/public";
import { NEAREST_PANO_RADIUS_M, greatCircleMeters } from "@geo-coach/shared";

// The nearest official Google Street View pano to a point, looked up in the browser
// with the Maps JavaScript API's StreetViewService. Needs PUBLIC_GOOGLE_MAPS_API_KEY,
// a browser key for the Maps JavaScript API (a Maps demo key works).

export type NearestPano =
  | { found: true; panoId: string; lat: number; lng: number; distanceMeters: number }
  | { found: false; reason: "no-key" | "none" | "failed"; message?: string };

// Only the parts of google.maps this module touches.
interface LatLng {
  lat(): number;
  lng(): number;
}
interface StreetViewLibrary {
  StreetViewService: new () => {
    getPanorama(request: {
      location: { lat: number; lng: number };
      radius: number;
      sources: unknown[];
      preference: unknown;
    }): Promise<{ data: { location: { pano: string; latLng: LatLng } } }>;
  };
  StreetViewSource: { GOOGLE: unknown };
  StreetViewPreference: { NEAREST: unknown };
}
interface GoogleMaps {
  maps: { importLibrary(name: "streetView"): Promise<StreetViewLibrary> };
}

let loading: Promise<GoogleMaps> | null = null;

function loadMapsJs(key: string): Promise<GoogleMaps> {
  loading ??= new Promise<GoogleMaps>((resolve, reject) => {
    const callback = "__geoCoachMapsReady";
    const w = window as unknown as Record<string, unknown>;
    w[callback] = () => resolve(w.google as GoogleMaps);
    const script = document.createElement("script");
    const params = new URLSearchParams({ key, v: "weekly", loading: "async", callback });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      loading = null; // let a later click try again
      reject(new Error("Could not load Google Maps"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export async function nearestOfficialPano(lat: number, lng: number): Promise<NearestPano> {
  const key = env.PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return { found: false, reason: "no-key" };
  try {
    const google = await loadMapsJs(key);
    const { StreetViewService, StreetViewSource, StreetViewPreference } =
      await google.maps.importLibrary("streetView");
    const { data } = await new StreetViewService().getPanorama({
      location: { lat, lng },
      radius: NEAREST_PANO_RADIUS_M,
      sources: [StreetViewSource.GOOGLE], // official coverage only, no user photospheres
      preference: StreetViewPreference.NEAREST,
    });
    const at = { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() };
    return {
      found: true,
      panoId: data.location.pano,
      ...at,
      distanceMeters: Math.round(greatCircleMeters({ lat, lng }, at)),
    };
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === "ZERO_RESULTS"
      ? { found: false, reason: "none" }
      : { found: false, reason: "failed", message: (e as Error).message };
  }
}
