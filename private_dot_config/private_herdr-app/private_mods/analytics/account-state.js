// Account snapshots are shared across panes; the default never starts a helper.
export const ACCOUNT_STATE_KEY = "analytics.accounts";
export const ACCOUNT_REFRESH_MS = 5 * 60 * 1000;

export class AccountState {
  constructor(host, machine = null) {
    this.host = host;
    this.key = machine === null ? ACCOUNT_STATE_KEY : `${ACCOUNT_STATE_KEY}.machine:${machine}`;
  }

  state() {
    const preference = this.host.shared(ACCOUNT_STATE_KEY) ?? { localOnly: true };
    const snapshot = this.host.shared(this.key) ?? {};
    return { ...snapshot, localOnly: preference.localOnly };
  }

  localOnly() {
    return this.state().localOnly !== false;
  }

  setLocalOnly(localOnly, cx) {
    // Invalidate in-flight work, retaining the last snapshot and cooldown so
    // toggling cannot bypass provider rate limits. Local-only never shows it.
    this.host.setShared(ACCOUNT_STATE_KEY, {
      ...this.host.shared(ACCOUNT_STATE_KEY), localOnly, request: null,
      generation: `${this.host.now()}-${Math.random()}`,
    });
    if (!localOnly) this.refresh(cx);
  }

  refreshStatus({ manual = false } = {}) {
    const state = this.state();
    const now = this.host.now();
    if (this.localOnly()) return { kind: "disabled" };
    if (!this.host.ready()) return { kind: "not-ready" };
    if (state.request && now - state.startedAt < 30_000) return { kind: "pending" };
    // Older snapshots stored server backoff only as a longer refresh interval.
    const retryAt = state.retryAt ?? (state.nextRefreshAt - state.updatedAt > ACCOUNT_REFRESH_MS ? state.nextRefreshAt : 0);
    if (retryAt > now) return { kind: "rate-limited", waitMs: retryAt - now };
    if (!manual && state.nextRefreshAt > now) return { kind: "scheduled" };
    return { kind: "ready" };
  }

  refresh(cx, options = {}) {
    const status = this.refreshStatus(options);
    if (status.kind !== "ready") return status;
    const state = this.state();
    const now = this.host.now();
    const request = `${now}-${Math.random()}`;
    const generation = this.host.shared(ACCOUNT_STATE_KEY)?.generation;
    this.host.setShared(this.key, { ...state, request, startedAt: now, nextRefreshAt: now + ACCOUNT_REFRESH_MS });
    cx.spawn(async (taskCx) => {
      let entries;
      let retryAfterMs = 0;
      try {
        const result = await this.host.collect();
        if (result.code !== 0) throw new Error("helper failed");
        const payload = JSON.parse(result.stdout);
        if (payload.version !== 1 || !Array.isArray(payload.entries)) throw new Error("invalid result");
        entries = payload.entries;
        if (Number.isFinite(payload.retryAfterMs)) retryAfterMs = Math.max(0, payload.retryAfterMs);
      } catch {
        // Never forward subprocess stderr or arbitrary errors: they can contain
        // credentials, response bodies or private paths.
        entries = [{ provider: "Accounts", status: "error", message: this.host.failureMessage ?? "Account lookup failed. Retry to check again." }];
      }
      if (this.state().request !== request || this.localOnly()
        || this.host.shared(ACCOUNT_STATE_KEY)?.generation !== generation) return;
      const updatedAt = this.host.now();
      this.host.setShared(this.key, {
        ...this.state(), localOnly: false, request: null, entries, updatedAt,
        retryAt: retryAfterMs > 0 ? updatedAt + retryAfterMs : 0,
        nextRefreshAt: updatedAt + Math.max(ACCOUNT_REFRESH_MS, retryAfterMs),
      });
      taskCx.notify();
    });
    cx.notify();
    return { kind: "started" };
  }
}
