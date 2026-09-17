// Constructor design recovery across a same-tab OAuth redirect.
//
// WHY. Google / Apple sign-in (LoginModal → lovable.auth.signInWithOAuth with a
// redirect_uri) is a FULL-PAGE navigation: the browser leaves for the OAuth
// broker and comes back to window.location.href as a fresh document. The
// constructor keeps its layers (frontData / backData) and the latest AI result
// in plain React state, so every uploaded photo, generated design and edit was
// gone on return. Only product / colour / side survived, because
// useProductConfig writes those to sessionStorage. A guest who hit the
// generation cap was told to sign in and paid for it with their design —
// the opposite of what the cap is for. Email sign-in never had this problem:
// it stays on the page.
//
// HOW. SimplePage registers a snapshot PROVIDER while it is mounted.
// LoginModal calls stashDesignForRedirect() right before starting an OAuth
// redirect; it snapshots the design and writes it away. On the next mount
// SimplePage calls consumeDesignRecovery(), which hands the snapshot back
// exactly once and clears everything it wrote.
//
// WHERE THE BYTES GO. Photo layers are base64 data URLs and are NOT downscaled
// on upload (SimplePage.handleFileUpload reads the file as-is), so a single
// phone photo is 3–8 MB of base64 and an AI result is three ~1–2 MB PNGs.
// sessionStorage is capped at ~5 MB per origin and throws QuotaExceededError
// past that, so it cannot reliably hold even ONE real design. The payload
// therefore goes to IndexedDB, which has no such ceiling. sessionStorage
// keeps ONLY a tiny per-tab MARKER, which is the mechanism that makes this
// tab-scoped and one-shot: an OAuth redirect returns to the SAME tab, so the
// marker is there; any other tab has no marker and never resurrects a
// design; and the marker is deleted the moment it is read.
//
// FALLBACK. When IndexedDB is unavailable or refuses the write, the payload
// falls back to sessionStorage and DEGRADES rather than throws: first the AI
// result is dropped, then photo layers largest-first, until it fits. What was
// dropped is recorded on the marker so the constructor can SAY so on return
// — a partial restore is acceptable, a silent one is not.
//
// SELF-CLEANING. The marker is consumed on read. The payload is deleted on
// read. Anything older than RECOVERY_TTL_MS is discarded unread, and stale
// IndexedDB records are swept on every consume, so an abandoned sign-in
// cannot resurrect an old design over a new one.

const MARKER_KEY = "maika-design-recovery";
const SS_PAYLOAD_KEY = "maika-design-recovery-payload";
const DB_NAME = "maika-design-recovery";
const DB_STORE = "snapshots";
const DB_VERSION = 1;
/** A sign-in round trip takes seconds; half an hour is generous. */
export const RECOVERY_TTL_MS = 30 * 60 * 1000;
/** IndexedDB can hang indefinitely in some private-browsing modes. */
const IDB_TIMEOUT_MS = 1500;

/** Minimal shape the degradation logic needs; SimplePage's SideData satisfies it. */
export interface SnapshotSideLike {
  photos: { image: string }[];
  texts: unknown[];
}

export interface DesignSnapshot<S extends SnapshotSideLike = SnapshotSideLike, R = unknown> {
  front: S;
  back: S;
  aiResult: R | null;
}

export interface RecoveryDropped {
  /** Photo layers left out because they did not fit the fallback store. */
  photos: number;
  /** The AI result was left out for the same reason. */
  aiResult: boolean;
}

export interface RecoveredDesign<S extends SnapshotSideLike = SnapshotSideLike, R = unknown> {
  snapshot: DesignSnapshot<S, R>;
  dropped: RecoveryDropped;
}

interface Marker {
  v: 1;
  id: string;
  ts: number;
  store: "idb" | "ss";
  dropped: RecoveryDropped;
}

interface StoredRecord {
  v: 1;
  id: string;
  ts: number;
  snapshot: DesignSnapshot;
}

type SnapshotProvider = () => DesignSnapshot | null;

let provider: SnapshotProvider | null = null;

/**
 * Register the constructor's snapshot source. Returns the unregister function;
 * SimplePage calls it on unmount so a sign-in from any other page is a no-op.
 */
export function registerDesignSnapshotProvider(fn: SnapshotProvider): () => void {
  provider = fn;
  return () => {
    if (provider === fn) provider = null;
  };
}

export function isSnapshotEmpty(s: DesignSnapshot): boolean {
  return (
    s.front.photos.length === 0 &&
    s.front.texts.length === 0 &&
    s.back.photos.length === 0 &&
    s.back.texts.length === 0 &&
    s.aiResult == null
  );
}

// ── sessionStorage marker ─────────────────────────────────────────────────

function readMarker(): Marker | null {
  try {
    const raw = sessionStorage.getItem(MARKER_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<Marker>;
    if (m.v !== 1 || typeof m.id !== "string" || typeof m.ts !== "number") return null;
    if (m.store !== "idb" && m.store !== "ss") return null;
    return {
      v: 1,
      id: m.id,
      ts: m.ts,
      store: m.store,
      dropped: {
        photos: typeof m.dropped?.photos === "number" ? m.dropped.photos : 0,
        aiResult: m.dropped?.aiResult === true,
      },
    };
  } catch {
    return null;
  }
}

function writeMarker(m: Marker): boolean {
  try {
    sessionStorage.setItem(MARKER_KEY, JSON.stringify(m));
    return true;
  } catch (e) {
    console.warn("[designRecovery] could not write marker:", e);
    return false;
  }
}

function removeMarker(): void {
  try { sessionStorage.removeItem(MARKER_KEY); } catch { /* ignore */ }
}

// ── IndexedDB payload ─────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[designRecovery] ${what} timed out`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function openDb(): Promise<IDBDatabase> {
  return withTimeout(
    new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("indexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
      req.onblocked = () => reject(new Error("indexedDB open blocked"));
    }),
    IDB_TIMEOUT_MS,
    "open",
  );
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
  });
}

async function idbPut(record: StoredRecord): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(DB_STORE, "readwrite");
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("indexedDB put failed"));
        tx.onabort = () => reject(tx.error ?? new Error("indexedDB put aborted"));
        tx.objectStore(DB_STORE).put(record);
      }),
      IDB_TIMEOUT_MS * 4,
      "put",
    );
  } finally {
    db.close();
  }
}

/** Read one record and delete it, in ONE transaction, so it is handed out once. */
async function idbTake(id: string): Promise<StoredRecord | null> {
  const db = await openDb();
  try {
    return await withTimeout(
      new Promise<StoredRecord | null>((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        const store = tx.objectStore(DB_STORE);
        // Both requests are queued synchronously so the transaction cannot
        // auto-commit between the read and the delete.
        const getReq = store.get(id) as IDBRequest<StoredRecord | undefined>;
        store.delete(id);
        let rec: StoredRecord | null = null;
        getReq.onsuccess = () => { rec = getReq.result ?? null; };
        tx.oncomplete = () => resolve(rec);
        tx.onerror = () => reject(tx.error ?? new Error("indexedDB take failed"));
        tx.onabort = () => reject(tx.error ?? new Error("indexedDB take aborted"));
      }),
      IDB_TIMEOUT_MS * 4,
      "take",
    );
  } finally {
    db.close();
  }
}

/** Delete every record older than the TTL. Best-effort, never throws. */
async function idbSweep(now: number): Promise<void> {
  try {
    const db = await openDb();
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(DB_STORE, "readwrite");
          const store = tx.objectStore(DB_STORE);
          const req = store.getAll() as IDBRequest<StoredRecord[]>;
          // Deletes are issued inside the success callback, while the
          // transaction is still active.
          req.onsuccess = () => {
            for (const r of req.result ?? []) {
              if (typeof r?.ts !== "number" || now - r.ts > RECOVERY_TTL_MS) store.delete(r.id);
            }
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error("indexedDB sweep failed"));
          tx.onabort = () => reject(tx.error ?? new Error("indexedDB sweep aborted"));
        }),
        IDB_TIMEOUT_MS * 4,
        "sweep",
      );
    } finally {
      db.close();
    }
  } catch {
    /* sweeping is housekeeping; a failure here changes nothing for the customer */
  }
}

// ── sessionStorage fallback payload ───────────────────────────────────────

function ssTryWrite(record: StoredRecord): boolean {
  try {
    sessionStorage.setItem(SS_PAYLOAD_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function ssRemovePayload(): void {
  try { sessionStorage.removeItem(SS_PAYLOAD_KEY); } catch { /* ignore */ }
}

function ssTake(): StoredRecord | null {
  try {
    const raw = sessionStorage.getItem(SS_PAYLOAD_KEY);
    ssRemovePayload();
    return raw ? (JSON.parse(raw) as StoredRecord) : null;
  } catch {
    return null;
  }
}

/**
 * Write to sessionStorage, shedding weight until it fits: AI result first
 * (it is a preview of artwork that is usually already placed as a layer),
 * then photo layers largest-first. Text layers are bytes, never dropped.
 * Returns what was dropped, or null when not even the text fits.
 */
function ssWriteDegrading(record: StoredRecord): RecoveryDropped | null {
  const dropped: RecoveryDropped = { photos: 0, aiResult: false };
  if (ssTryWrite(record)) return dropped;

  let snap: DesignSnapshot = record.snapshot;
  if (snap.aiResult != null) {
    snap = { ...snap, aiResult: null };
    dropped.aiResult = true;
    if (ssTryWrite({ ...record, snapshot: snap })) return dropped;
  }

  // Largest photo first, on either side, one at a time.
  for (;;) {
    let largest: { side: "front" | "back"; index: number; size: number } | null = null;
    for (const side of ["front", "back"] as const) {
      for (let i = 0; i < snap[side].photos.length; i++) {
        const img = snap[side].photos[i].image;
        const size = typeof img === "string" ? img.length : 0;
        if (!largest || size > largest.size) largest = { side, index: i, size };
      }
    }
    if (!largest) break;
    const { side, index } = largest;
    snap = { ...snap, [side]: { ...snap[side], photos: snap[side].photos.filter((_, i) => i !== index) } };
    dropped.photos += 1;
    if (ssTryWrite({ ...record, snapshot: snap })) return dropped;
  }

  ssRemovePayload();
  return null;
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * Snapshot the constructor and put it away for the redirect that is about to
 * happen. Never throws; never blocks sign-in. A no-op when no constructor is
 * mounted or there is nothing worth keeping.
 */
export async function stashDesignForRedirect(): Promise<void> {
  // Whatever happens below, a marker from an EARLIER attempt must not survive
  // to point at a payload that no longer matches this design.
  removeMarker();
  ssRemovePayload();

  const snapshot = provider?.() ?? null;
  if (!snapshot || isSnapshotEmpty(snapshot)) return;

  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ts = Date.now();
  const record: StoredRecord = { v: 1, id, ts, snapshot };

  try {
    await idbPut(record);
    writeMarker({ v: 1, id, ts, store: "idb", dropped: { photos: 0, aiResult: false } });
    return;
  } catch (e) {
    console.warn("[designRecovery] IndexedDB unavailable, falling back to sessionStorage:", e);
  }

  const dropped = ssWriteDegrading(record);
  if (!dropped) {
    console.warn("[designRecovery] design too large for any available store; nothing stashed");
    return;
  }
  if (!writeMarker({ v: 1, id, ts, store: "ss", dropped })) ssRemovePayload();
}

/**
 * Forget a stash that will not be needed — the OAuth call resolved WITHOUT
 * navigating away (popup / embedded mode), so the design never left the page.
 */
export function discardDesignStash(): void {
  const m = readMarker();
  removeMarker();
  ssRemovePayload();
  if (m?.store === "idb") {
    idbTake(m.id).catch(() => { /* best-effort */ });
  }
}

let pendingConsume: Promise<RecoveredDesign | null> | null = null;

async function doConsume(): Promise<RecoveredDesign | null> {
  const now = Date.now();
  const marker = readMarker();
  // Read-and-delete in one step: a second caller finds nothing.
  removeMarker();
  // Housekeeping for records no marker points at any more (other tabs,
  // abandoned sign-ins). Not awaited: it must never delay the restore.
  void idbSweep(now);

  if (!marker) {
    ssRemovePayload();
    return null;
  }

  let record: StoredRecord | null = null;
  try {
    record = marker.store === "idb" ? await idbTake(marker.id) : ssTake();
  } catch (e) {
    console.warn("[designRecovery] could not read stashed design:", e);
    return null;
  }
  // Belt and braces: whichever store was used, leave neither behind.
  ssRemovePayload();

  if (!record || record.v !== 1 || record.id !== marker.id) return null;
  if (now - record.ts > RECOVERY_TTL_MS) return null;

  const s = record.snapshot;
  const sideOk = (x: unknown): x is SnapshotSideLike =>
    !!x && typeof x === "object" &&
    Array.isArray((x as SnapshotSideLike).photos) &&
    Array.isArray((x as SnapshotSideLike).texts);
  if (!s || !sideOk(s.front) || !sideOk(s.back)) return null;

  return { snapshot: s, dropped: marker.dropped };
}

/**
 * Hand back the design stashed before an OAuth redirect, exactly once per
 * page load, and clear it. Memoised so React's double-invoked dev effects and
 * any two callers in one load see the same result instead of the second one
 * finding an empty store.
 */
export function consumeDesignRecovery<S extends SnapshotSideLike, R>(): Promise<RecoveredDesign<S, R> | null> {
  if (!pendingConsume) pendingConsume = doConsume();
  return pendingConsume as Promise<RecoveredDesign<S, R> | null>;
}

/** Test hook: forget the memoised consume so the next call reads storage again. */
export function __resetDesignRecoveryForTests(): void {
  pendingConsume = null;
  provider = null;
}
