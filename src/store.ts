import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MonitorConfig, MonitorEvent, Settings, Snapshot } from './types.ts';

const MAX_EVENTS = 500;

interface Data {
  monitors: MonitorConfig[];
  snapshots: Record<string, Snapshot>;
  events: MonitorEvent[];
  settings: Settings;
}

/** Tiny JSON-file persistence. Everything lives in memory; writes are atomic and coalesced. */
export class Store {
  dir: string;
  data: Data = { monitors: [], snapshots: {}, events: [], settings: {} };
  private saving: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(dir: string) {
    this.dir = dir;
  }

  private get file() {
    return path.join(this.dir, 'db.json');
  }

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<Data>;
      this.data = { ...this.data, ...parsed };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  /** Schedules a write; concurrent calls collapse into one follow-up write. */
  save(): Promise<void> {
    if (this.dirty) return this.saving;
    this.dirty = true;
    this.saving = this.saving.then(async () => {
      this.dirty = false;
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data, null, 2));
      await rename(tmp, this.file);
    });
    return this.saving;
  }

  addEvent(event: MonitorEvent): void {
    this.data.events.unshift(event);
    this.data.events.length = Math.min(this.data.events.length, MAX_EVENTS);
  }
}
