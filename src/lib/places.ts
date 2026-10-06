import { config } from "./config";

/** Google Places API (New) — Text Search. https://developers.google.com/maps/documentation/places/web-service/text-search */
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

const FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.businessStatus",
  "places.location",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

export interface PlaceResult {
  placeId: string;
  name: string;
  category: string | null;
  types: string[];
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  mapsUrl: string | null;
  lat: number | null;
  lng: number | null;
  distanceKm: number | null;
}

interface RawPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  primaryTypeDisplayName?: { text: string };
  types?: string[];
  businessStatus?: string;
  location?: { latitude: number; longitude: number };
  googleMapsUri?: string;
}

async function searchText(body: Record<string, unknown>, fieldMask: string) {
  if (!config.googleApiKey) throw new Error("GOOGLE_API_KEY is not set (needs Places API (New) enabled)");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": config.googleApiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify({ regionCode: "AU", languageCode: "en", ...body }),
  });
  if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);
  return (await res.json()) as { places?: RawPlace[]; nextPageToken?: string };
}

async function geocode(location: string): Promise<{ lat: number; lng: number } | null> {
  const data = await searchText({ textQuery: location, pageSize: 1 }, "places.location");
  const loc = data.places?.[0]?.location;
  return loc ? { lat: loc.latitude, lng: loc.longitude } : null;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Find businesses for `industry` around each of `locations` (e.g. "Preston VIC").
 * Text Search returns at most 60 results (3 pages) per query, so several nearby
 * suburbs give better coverage than one big radius.
 */
export async function discoverBusinesses(opts: {
  industry: string;
  locations: string[];
  radiusKm: number;
  maxResults: number;
  onProgress?: (msg: string) => void;
}): Promise<PlaceResult[]> {
  const seen = new Map<string, PlaceResult>();

  for (const location of opts.locations) {
    if (seen.size >= opts.maxResults) break;
    const center = await geocode(location);
    if (!center) {
      opts.onProgress?.(`Could not locate "${location}", skipping`);
      continue;
    }
    let pageToken: string | undefined;
    for (let page = 0; page < 3; page++) {
      const data = await searchText(
        {
          textQuery: `${opts.industry} in ${location}`,
          pageSize: 20,
          pageToken,
          locationBias: {
            circle: {
              center: { latitude: center.lat, longitude: center.lng },
              radius: Math.min(50000, Math.max(1000, opts.radiusKm * 1000)),
            },
          },
        },
        FIELDS,
      );
      for (const p of data.places ?? []) {
        if (seen.has(p.id)) continue;
        if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
        const loc = p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null;
        const distanceKm = loc ? Math.round(haversineKm(center, loc) * 10) / 10 : null;
        if (distanceKm !== null && opts.radiusKm > 0 && distanceKm > opts.radiusKm) continue;
        seen.set(p.id, {
          placeId: p.id,
          name: p.displayName?.text ?? "Unknown",
          category: p.primaryTypeDisplayName?.text ?? null,
          types: p.types ?? [],
          address: p.formattedAddress ?? null,
          phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
          website: p.websiteUri ?? null,
          rating: p.rating ?? null,
          reviewCount: p.userRatingCount ?? null,
          mapsUrl: p.googleMapsUri ?? null,
          lat: loc?.lat ?? null,
          lng: loc?.lng ?? null,
          distanceKm,
        });
        if (seen.size >= opts.maxResults) break;
      }
      opts.onProgress?.(`${location}: page ${page + 1}, ${seen.size} businesses so far`);
      pageToken = data.nextPageToken;
      if (!pageToken || seen.size >= opts.maxResults) break;
    }
  }
  return [...seen.values()];
}

export const hostOf = (url: string) => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/**
 * Find the Google listing for a site you added by hand. Only accepts a listing whose website
 * matches the same domain, so a wrong business never gets attached.
 */
export async function findPlaceForWebsite(opts: { website: string; name?: string | null; area?: string | null }): Promise<PlaceResult | null> {
  const host = hostOf(opts.website);
  if (!host) return null;
  const queries = [
    [opts.name, opts.area].filter(Boolean).join(" "),
    [host.split(".")[0].replace(/-/g, " "), opts.area].filter(Boolean).join(" "),
    host,
  ].filter((q, i, a) => q && a.indexOf(q) === i);
  for (const textQuery of queries) {
    const data = await searchText({ textQuery, pageSize: 10 }, FIELDS);
    const p = (data.places ?? []).find((x) => x.websiteUri && hostOf(x.websiteUri) === host);
    if (!p) continue;
    return {
      placeId: p.id,
      name: p.displayName?.text ?? host,
      category: p.primaryTypeDisplayName?.text ?? null,
      types: p.types ?? [],
      address: p.formattedAddress ?? null,
      phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
      website: p.websiteUri ?? null,
      rating: p.rating ?? null,
      reviewCount: p.userRatingCount ?? null,
      mapsUrl: p.googleMapsUri ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      distanceKm: null,
    };
  }
  return null;
}
