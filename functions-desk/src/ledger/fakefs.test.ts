/**
 * TEST-ONLY in-memory Firestore, used by flow.test.ts when the Firestore emulator is not running. It supports exactly the
 * Admin SDK surface the desk money backend uses, is strict where Firestore is strict (undefined values, create on an
 * existing doc, update on a missing doc, reads-before-writes in transactions) and is NOT a substitute for the emulator run.
 * It contains no tests itself; node --test simply loads it.
 */
type Data = Record<string, unknown>;
const sentinel = (v: unknown): string | undefined => (v && typeof v === "object" ? (v as { methodName?: string }).methodName : undefined);
const err = (code: number, message: string) => Object.assign(new Error(message), { code });

function resolve(existing: Data | undefined, patch: Data, merge: boolean): Data {
  const out: Data = merge && existing ? { ...existing } : {};
  for (const [k, v] of Object.entries(patch)) {
    const s = sentinel(v);
    if (v === undefined) throw new Error(`Firestore rejects undefined (field "${k}")`);
    if (s === "FieldValue.delete") delete out[k];
    else if (s === "FieldValue.serverTimestamp") out[k] = new Date();
    else if (s === "FieldValue.arrayUnion") {
      const cur = Array.isArray(out[k]) ? (out[k] as unknown[]) : [];
      out[k] = [...cur, ...((v as { elements: unknown[] }).elements).filter((e) => !cur.includes(e))];
    } else out[k] = clone(v);
  }
  return out;
}
const clone = <T>(v: T): T => (v instanceof Date ? (new Date(v) as T) : v && typeof v === "object" ? (Array.isArray(v) ? (v.map(clone) as T) : (Object.fromEntries(Object.entries(v).map(([k, x]) => { if (x === undefined) throw new Error(`Firestore rejects undefined (field "${k}")`); return [k, clone(x)]; })) as T)) : v);

export class FakeFirestore {
  readonly store = new Map<string, Data>();
  private lock: Promise<unknown> = Promise.resolve();
  private auto = 0;
  collection(path: string): FakeCol { return new FakeCol(this, path); }
  doc(path: string): FakeDoc { return new FakeDoc(this, path); }
  newId(): string { return `AUTO${String(++this.auto).padStart(16, "0")}`; }
  clear(): void { this.store.clear(); this.auto = 0; }
  batch() {
    const ops: (() => void)[] = [];
    return { delete: (r: FakeDoc) => { ops.push(() => this.store.delete(r.path)); }, commit: async () => { ops.forEach((o) => o()); } };
  }
  runTransaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const tx = new FakeTx(this);
      const out = await fn(tx);
      tx.commit();
      return out;
    };
    const p = this.lock.then(run, run);
    this.lock = p.catch(() => undefined);
    return p;
  }
  all(colPath: string): { id: string; path: string; data: Data }[] {
    const prefix = colPath + "/";
    return [...this.store.entries()].filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
      .map(([path, data]) => ({ id: path.slice(prefix.length), path, data }));
  }
}

class FakeTx {
  private writes: (() => void)[] = [];
  private wrote = false;
  constructor(private fs: FakeFirestore) {}
  async get(x: FakeDoc | FakeQuery) {
    if (this.wrote) throw new Error("Firestore transactions require all reads to be executed before all writes");
    return x.get();
  }
  update(r: FakeDoc, d: Data) { this.wrote = true; this.writes.push(() => r.applyUpdate(d)); }
  set(r: FakeDoc, d: Data) { this.wrote = true; this.writes.push(() => r.applySet(d)); }
  create(r: FakeDoc, d: Data) { this.wrote = true; this.writes.push(() => r.applyCreate(d)); }
  delete(r: FakeDoc) { this.wrote = true; this.writes.push(() => { this.fs.store.delete(r.path); }); }
  commit() { this.writes.forEach((w) => w()); }
}

export class FakeSnap {
  constructor(readonly ref: FakeDoc, private d: Data | undefined) {}
  get id() { return this.ref.id; }
  get exists() { return this.d !== undefined; }
  data() { return this.d === undefined ? undefined : clone(this.d); }
}

export class FakeDoc {
  constructor(readonly fs: FakeFirestore, readonly path: string) {}
  get id() { return this.path.split("/").pop() as string; }
  collection(name: string) { return new FakeCol(this.fs, `${this.path}/${name}`); }
  async get() { return new FakeSnap(this, this.fs.store.get(this.path)); }
  applyCreate(d: Data) { if (this.fs.store.has(this.path)) throw err(6, `ALREADY_EXISTS: ${this.path}`); this.fs.store.set(this.path, resolve(undefined, d, false)); }
  applySet(d: Data) { this.fs.store.set(this.path, resolve(undefined, d, false)); }
  applyUpdate(d: Data) { const cur = this.fs.store.get(this.path); if (!cur) throw err(5, `NOT_FOUND: ${this.path}`); this.fs.store.set(this.path, resolve(cur, d, true)); }
  async create(d: Data) { this.applyCreate(d); }
  async set(d: Data) { this.applySet(d); }
  async update(d: Data) { this.applyUpdate(d); }
  async delete() { this.fs.store.delete(this.path); }
}

type Filter = { f: string; op: string; v: unknown };
const cmp = (a: unknown, b: unknown): number => { const x = a instanceof Date ? a.getTime() : a, y = b instanceof Date ? b.getTime() : b; return (x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0; };

export class FakeQuery {
  constructor(readonly fs: FakeFirestore, readonly colPath: string, private filters: Filter[] = [], private order: { f: string; dir: string }[] = [], private lim?: number, private after?: string) {}
  where(f: string, op: string, v: unknown) { return new FakeQuery(this.fs, this.colPath, [...this.filters, { f, op, v }], this.order, this.lim, this.after); }
  orderBy(f: string, dir = "asc") { return new FakeQuery(this.fs, this.colPath, this.filters, [...this.order, { f, dir }], this.lim, this.after); }
  limit(n: number) { return new FakeQuery(this.fs, this.colPath, this.filters, this.order, n, this.after); }
  startAfter(s: FakeSnap) { return new FakeQuery(this.fs, this.colPath, this.filters, this.order, this.lim, s.id); }
  async get() {
    let rows = this.fs.all(this.colPath).filter((r) => this.filters.every(({ f, op, v }) => {
      const x = r.data[f];
      switch (op) {
        case "==": return cmp(x, v) === 0 && x !== undefined;
        case "<": return x !== undefined && cmp(x, v) < 0;
        case "<=": return x !== undefined && cmp(x, v) <= 0;
        case ">": return x !== undefined && cmp(x, v) > 0;
        case ">=": return x !== undefined && cmp(x, v) >= 0;
        case "in": return (v as unknown[]).includes(x);
        default: throw new Error(`fake firestore: unsupported operator ${op}`);
      }
    }));
    const keys = this.order.length ? this.order : [{ f: "__name__", dir: "asc" }];
    const val = (r: { id: string; data: Data }, f: string) => (f === "__name__" ? r.id : r.data[f]);
    rows.sort((a, b) => { for (const { f, dir } of keys) { const c = cmp(val(a, f), val(b, f)); if (c) return dir === "desc" ? -c : c; } return cmp(a.id, b.id); });
    if (this.after !== undefined) { const i = rows.findIndex((r) => r.id === this.after); rows = rows.slice(i + 1); }
    if (this.lim !== undefined) rows = rows.slice(0, this.lim);
    const docs = rows.map((r) => new FakeSnap(new FakeDoc(this.fs, r.path), r.data));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

export class FakeCol extends FakeQuery {
  constructor(fs: FakeFirestore, readonly path: string) { super(fs, path); }
  doc(id?: string) { return new FakeDoc(this.fs, `${this.path}/${id ?? this.fs.newId()}`); }
}

/** Replaces the Admin SDK entry points db.ts uses, for the life of the process. */
export function installFakeFirestore(fs: FakeFirestore): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsMod = require("firebase-admin/firestore"); const appMod = require("firebase-admin/app");
  fsMod.getFirestore = () => fs;
  Object.defineProperty(appMod, "getApps", { configurable: true, value: () => [{ name: "[DEFAULT]" }] });
}
