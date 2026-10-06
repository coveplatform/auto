import { config } from "@/lib/config";

// Suburb / postcode autocomplete (Places API (New) Autocomplete, Australia only).
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || !config.googleApiKey) return Response.json([]);
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": config.googleApiKey },
    body: JSON.stringify({ input: q, includedRegionCodes: ["au"], includedPrimaryTypes: ["locality", "postal_code"] }),
  });
  if (!res.ok) return Response.json([]);
  const data = (await res.json()) as {
    suggestions?: Array<{ placePrediction?: { placeId: string; text: { text: string } } }>;
  };
  return Response.json(
    (data.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter(Boolean)
      .map((p) => ({ placeId: p!.placeId, label: p!.text.text.replace(/, Australia$/, "") })),
  );
}
