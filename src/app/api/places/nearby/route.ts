import { config } from "@/lib/config";

const KEY_HEADERS = () => ({ "Content-Type": "application/json", "X-Goog-Api-Key": config.googleApiKey });

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const s = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

/** Suburb name like "Thornbury VIC" from "12 X St, Thornbury VIC 3071, Australia". */
function suburbOf(address: string): string | null {
  const parts = address.replace(/, Australia$/, "").split(",").map((p) => p.trim());
  const last = parts[parts.length - 1] ?? "";
  const m = last.match(/^(.*?\b(?:VIC|NSW|QLD|WA|SA|TAS|ACT|NT))\b/);
  return m ? m[1].trim() : null;
}

// Given a picked suburb/postcode, list the suburbs around it within the radius.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const placeId = url.searchParams.get("placeId") ?? "";
  const radiusKm = Math.min(50, Math.max(1, Number(url.searchParams.get("radius") ?? 10)));
  if (!placeId || !config.googleApiKey) return Response.json({ center: null, suburbs: [] });

  const det = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { ...KEY_HEADERS(), "X-Goog-FieldMask": "location,formattedAddress" },
  });
  if (!det.ok) return Response.json({ center: null, suburbs: [] });
  const d = (await det.json()) as { location: { latitude: number; longitude: number }; formattedAddress: string };
  const center = { lat: d.location.latitude, lng: d.location.longitude };

  const found = new Map<string, number>();
  // Sample the centre plus four points around it so larger radii still find the outer suburbs.
  const offsets = radiusKm > 6 ? [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]] : [[0, 0]];
  await Promise.all(
    offsets.map(async ([dy, dx]) => {
      const lat = center.lat + (dy * radiusKm) / 111;
      const lng = center.lng + (dx * radiusKm) / (111 * Math.cos((center.lat * Math.PI) / 180));
      const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST",
        headers: { ...KEY_HEADERS(), "X-Goog-FieldMask": "places.formattedAddress,places.location" },
        body: JSON.stringify({
          includedTypes: ["locality"],
          maxResultCount: 20,
          locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(50000, (radiusKm * 1000) / (offsets.length > 1 ? 2 : 1)) } },
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { places?: Array<{ formattedAddress: string; location: { latitude: number; longitude: number } }> };
      for (const p of data.places ?? []) {
        const name = suburbOf(p.formattedAddress);
        if (!name) continue;
        const km = haversineKm(center, { lat: p.location.latitude, lng: p.location.longitude });
        if (km > radiusKm) continue;
        if (!found.has(name) || found.get(name)! > km) found.set(name, km);
      }
    }),
  );
  const centerName = suburbOf(d.formattedAddress) ?? d.formattedAddress.replace(/, Australia$/, "");
  found.delete(centerName);
  return Response.json({
    center: centerName,
    suburbs: [...found.entries()].sort((a, b) => a[1] - b[1]).map(([name, km]) => ({ name, km: Math.round(km * 10) / 10 })),
  });
}
