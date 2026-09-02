import type { HealthStatus } from "./types.js";

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60000;

export class HealthTracker {
  private map = new Map<string, HealthStatus>();

  private ensure(provider: string): HealthStatus {
    let s = this.map.get(provider);
    if (!s) {
      s = {
        provider,
        healthy: true,
        failures: 0,
        lastCheck: 0,
        circuitOpen: false,
        cooldownUntil: 0,
      };
      this.map.set(provider, s);
    }
    return s;
  }

  recordSuccess(provider: string): void {
    const s = this.ensure(provider);
    s.healthy = true;
    s.failures = 0;
    s.circuitOpen = false;
    s.cooldownUntil = 0;
    s.lastError = undefined;
    s.lastCheck = Date.now();
  }

  recordFailure(provider: string, error?: string): void {
    const s = this.ensure(provider);
    s.failures += 1;
    s.healthy = false;
    s.lastError = error;
    s.lastCheck = Date.now();
    if (s.failures >= FAILURE_THRESHOLD) {
      s.circuitOpen = true;
      s.cooldownUntil = Date.now() + COOLDOWN_MS;
    }
  }

  getStatus(provider: string): HealthStatus {
    const s = this.ensure(provider);
    const now = Date.now();
    if (s.circuitOpen) {
      if (now >= s.cooldownUntil) {
        // half-open: allow one probe
        s.circuitOpen = false;
        s.cooldownUntil = 0;
      } else {
        return { ...s };
      }
    }
    s.lastCheck = now;
    return { ...s };
  }

  isAvailable(provider: string): boolean {
    const s = this.ensure(provider);
    if (!s.circuitOpen) return true;
    if (Date.now() >= s.cooldownUntil) {
      s.circuitOpen = false;
      s.cooldownUntil = 0;
      return true;
    }
    return false;
  }

  getAll(): HealthStatus[] {
    return Array.from(this.map.values()).map((s) => ({ ...s }));
  }

  reset(provider: string): void {
    const s = this.ensure(provider);
    s.healthy = true;
    s.failures = 0;
    s.circuitOpen = false;
    s.cooldownUntil = 0;
    s.lastError = undefined;
  }

  resetAll(): void {
    this.map.clear();
  }
}
