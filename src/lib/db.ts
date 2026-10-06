import Database from "better-sqlite3";
import path from "node:path";
import { config } from "./config";

export type BusinessStatus =
  | "discovered"
  | "no_website"
  | "scanning"
  | "scan_failed"
  | "qualified"
  | "skipped"
  | "building"
  | "build_failed"
  | "foundation_ready"
  | "demo_ready"
  | "demo_approved"
  | "rejected"
  | "contacted";

export interface Campaign {
  id: number;
  industry: string;
  locations: string;
  radius_km: number;
  max_results: number;
  status: string;
  created_at: string;
}

export interface Business {
  id: number;
  campaign_id: number;
  place_id: string;
  name: string;
  category: string | null;
  types: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  maps_url: string | null;
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
  status: BusinessStatus;
  opportunity_score: number | null;
  status_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScanRow {
  business_id: number;
  metrics: string | null;
  pagespeed: string | null;
  ai: string | null;
  score_breakdown: string | null;
  desktop_shot: string | null;
  mobile_shot: string | null;
  error: string | null;
  scanned_at: string;
}

export interface DemoRow {
  business_id: number;
  slug: string;
  template: string;
  extraction: string | null;
  content: string | null;
  warnings: string | null;
  desktop_shot: string | null;
  mobile_shot: string | null;
  published_url: string | null;
  review: string | null;
  built_at: string | null;
}

export interface FoundationRow {
  business_id: number;
  status: "draft" | "approved";
  extraction: string | null;
  research: string | null;
  audit: string | null;
  data: string | null;
  critique: string | null;
  warnings: string | null;
  instructions: string | null;
  created_at: string;
  approved_at: string | null;
}

export interface ReportRow {
  business_id: number;
  slug: string;
  data: string | null;
  built_at: string;
}

export interface OutreachRow {
  business_id: number;
  to_email: string | null;
  subject: string | null;
  body: string | null;
  status: "draft" | "sent";
  sent_at: string | null;
  updated_at: string;
}

export interface JobRow {
  id: number;
  type: string;
  business_id: number | null;
  campaign_id: number | null;
  payload: string | null;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const globalForDb = globalThis as unknown as { __db?: Database.Database };

function open(): Database.Database {
  const db = new Database(path.join(config.dataDir, "engine.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      industry TEXT NOT NULL,
      locations TEXT NOT NULL,
      radius_km REAL NOT NULL DEFAULT 10,
      max_results INTEGER NOT NULL DEFAULT 100,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      place_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT,
      types TEXT,
      address TEXT,
      phone TEXT,
      website TEXT,
      rating REAL,
      review_count INTEGER,
      maps_url TEXT,
      lat REAL,
      lng REAL,
      distance_km REAL,
      status TEXT NOT NULL DEFAULT 'discovered',
      opportunity_score REAL,
      status_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_business_campaign ON businesses(campaign_id, status);
    CREATE TABLE IF NOT EXISTS scans (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      metrics TEXT,
      pagespeed TEXT,
      ai TEXT,
      score_breakdown TEXT,
      desktop_shot TEXT,
      mobile_shot TEXT,
      error TEXT,
      scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS demos (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      slug TEXT NOT NULL UNIQUE,
      template TEXT NOT NULL,
      extraction TEXT,
      content TEXT,
      warnings TEXT,
      desktop_shot TEXT,
      mobile_shot TEXT,
      published_url TEXT,
      built_at TEXT
    );
    CREATE TABLE IF NOT EXISTS foundations (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'draft',
      extraction TEXT,
      research TEXT,
      audit TEXT,
      data TEXT,
      critique TEXT,
      warnings TEXT,
      instructions TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS reports (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      data TEXT,
      built_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS outreach (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      to_email TEXT,
      subject TEXT,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      sent_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      business_id INTEGER,
      campaign_id INTEGER,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, id);
  `);
  // Migrations for databases created by older versions.
  const demoCols = (db.prepare("PRAGMA table_info(demos)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!demoCols.includes("review")) db.exec("ALTER TABLE demos ADD COLUMN review TEXT");
  return db;
}

export const db: Database.Database = globalForDb.__db ?? (globalForDb.__db = open());

export function parseJSON<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function setBusinessStatus(id: number, status: BusinessStatus, note: string | null = null) {
  db.prepare(
    "UPDATE businesses SET status = ?, status_note = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(status, note, id);
}

export function getBusiness(id: number): Business | undefined {
  return db.prepare("SELECT * FROM businesses WHERE id = ?").get(id) as Business | undefined;
}

export function getScan(id: number): ScanRow | undefined {
  return db.prepare("SELECT * FROM scans WHERE business_id = ?").get(id) as ScanRow | undefined;
}

export function getDemo(id: number): DemoRow | undefined {
  return db.prepare("SELECT * FROM demos WHERE business_id = ?").get(id) as DemoRow | undefined;
}

export function getFoundation(id: number): FoundationRow | undefined {
  return db.prepare("SELECT * FROM foundations WHERE business_id = ?").get(id) as FoundationRow | undefined;
}

export function getReport(id: number): ReportRow | undefined {
  return db.prepare("SELECT * FROM reports WHERE business_id = ?").get(id) as ReportRow | undefined;
}

export function getOutreach(id: number): OutreachRow | undefined {
  return db.prepare("SELECT * FROM outreach WHERE business_id = ?").get(id) as OutreachRow | undefined;
}

export type JobType =
  | "discover"
  | "scan"
  | "build"
  | "redesign"
  | "rerender"
  | "foundation"
  | "custom_build"
  | "report"
  | "outreach"
  | "publish";

export function enqueue(
  type: JobType,
  opts: { businessId?: number; campaignId?: number; payload?: unknown } = {},
): number {
  const res = db
    .prepare("INSERT INTO jobs (type, business_id, campaign_id, payload) VALUES (?, ?, ?, ?)")
    .run(
      type,
      opts.businessId ?? null,
      opts.campaignId ?? null,
      opts.payload === undefined ? null : JSON.stringify(opts.payload),
    );
  return Number(res.lastInsertRowid);
}
