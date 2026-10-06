"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface Suggestion {
  placeId: string;
  label: string;
}

/**
 * Pick a suburb or postcode from Google's autocomplete, choose a radius, then tick the
 * surrounding suburbs to search. Submits as a hidden newline-separated "locations" field.
 */
export function LocationPicker() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [center, setCenter] = useState<Suggestion | null>(null);
  const [radius, setRadius] = useState(8);
  const [nearby, setNearby] = useState<Array<{ name: string; km: number }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [centerName, setCenterName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [extra, setExtra] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // Autocomplete as you type.
  useEffect(() => {
    if (query.trim().length < 2 || (center && query === center.label)) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/places/suggest?q=${encodeURIComponent(query)}`);
      setSuggestions(res.ok ? await res.json() : []);
      setOpen(true);
    }, 220);
    return () => clearTimeout(t);
  }, [query, center]);

  // Load surrounding suburbs whenever the centre or radius changes.
  useEffect(() => {
    if (!center) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await fetch(`/api/places/nearby?placeId=${encodeURIComponent(center.placeId)}&radius=${radius}`);
      const data = res.ok ? ((await res.json()) as { center: string | null; suburbs: Array<{ name: string; km: number }> }) : { center: null, suburbs: [] };
      if (cancelled) return;
      setCenterName(data.center ?? center.label);
      setNearby(data.suburbs);
      // Pre-tick the closest few; Google returns at most 60 businesses per suburb query.
      setSelected(new Set(data.suburbs.slice(0, 5).map((s) => s.name)));
      setLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [center, radius]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const locations = useMemo(() => {
    const list = [centerName ?? center?.label, ...nearby.filter((n) => selected.has(n.name)).map((n) => n.name), ...extra.split(/[;\n]/)]
      .map((s) => s?.trim())
      .filter(Boolean) as string[];
    return [...new Set(list)];
  }, [center, centerName, nearby, selected, extra]);

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="grid gap-3">
      <input type="hidden" name="locations" value={locations.join("\n")} />
      <input type="hidden" name="radius" value={radius} />
      <div ref={boxRef} className="relative">
        <span className="label">Suburb or postcode</span>
        <input
          className="input"
          value={query}
          placeholder="e.g. Preston or 3072"
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setCenter(null);
            setNearby([]);
            setCenterName(null);
          }}
          onFocus={() => suggestions.length && setOpen(true)}
        />
        {open && suggestions.length > 0 && query.trim().length >= 2 && !center && (
          <ul className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-black/10">
            {suggestions.map((s) => (
              <li key={s.placeId}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-black/5"
                  onClick={() => {
                    setCenter(s);
                    setQuery(s.label);
                    setOpen(false);
                  }}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label>
        <span className="label flex justify-between">
          <span>Radius</span>
          <span className="normal-case tracking-normal text-black">{radius} km</span>
        </span>
        <input type="range" min={2} max={30} step={1} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full accent-black" />
      </label>

      {center && (
        <div>
          <span className="label">Suburbs to search {loading && "· loading…"}</span>
          <div className="flex flex-wrap gap-1.5">
            <span className="pill bg-ink px-2.5 py-1 text-white">{centerName ?? center.label}</span>
            {nearby.map((n) => (
              <button
                type="button"
                key={n.name}
                onClick={() => toggle(n.name)}
                className={`pill px-2.5 py-1 ring-1 transition ${selected.has(n.name) ? "bg-ink/90 text-white ring-ink" : "bg-white text-black/60 ring-black/15 hover:ring-black/40"}`}
                title={`${n.km} km away`}
              >
                {n.name.replace(/ (VIC|NSW|QLD|WA|SA|TAS|ACT|NT)$/, "")}
              </button>
            ))}
            {!loading && nearby.length === 0 && <span className="text-xs text-black/40">No other suburbs found in this radius.</span>}
          </div>
          {nearby.length > 0 && (
            <div className="mt-1.5 flex gap-3 text-xs">
              <button type="button" className="text-indigo-600 hover:underline" onClick={() => setSelected(new Set(nearby.map((n) => n.name)))}>
                Select all
              </button>
              <button type="button" className="text-indigo-600 hover:underline" onClick={() => setSelected(new Set())}>
                Clear
              </button>
              <span className="text-black/40">
                {locations.length} suburb{locations.length === 1 ? "" : "s"} · up to {locations.length * 60} results
              </span>
            </div>
          )}
        </div>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-black/50">Add suburbs manually</summary>
        <textarea className="input mt-2" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={"Coburg VIC\nBrunswick VIC"} />
      </details>
    </div>
  );
}
