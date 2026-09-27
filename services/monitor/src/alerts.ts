// Lightweight alert store with edge-trigger (only fires on state transitions).
export interface Alert {
  level: "INFO" | "WARN" | "CRITICAL";
  key: string;
  message: string;
  at: string;
}

/**
 * 告警去抖 + 重复提醒。
 * - 边沿触发：状态 false→true 时立即推送一次。
 * - 重复提醒：只要状态仍为 true，每 reNotifyMs 再推一次（默认 15 分钟）。
 *   原实现只推一次，运维漏看那一条 CRITICAL 后就再无提示（可清算仓位会一直躺在那里）。
 *   设 reNotifyMs = 0 可退回旧的"只推一次"行为。
 */
export class AlertStore {
  private prev = new Map<string, boolean>();
  private lastSent = new Map<string, number>();

  constructor(
    private out: (a: Alert) => void,
    private reNotifyMs = 15 * 60_000,
  ) {}

  set(key: string, level: Alert["level"], active: boolean, message: string): void {
    const was = this.prev.get(key) ?? false;
    const now = Date.now();
    const last = this.lastSent.get(key) ?? 0;
    if (active && (!was || (this.reNotifyMs > 0 && now - last >= this.reNotifyMs))) {
      this.out({ level, key, message, at: new Date().toISOString() });
      this.lastSent.set(key, now);
    }
    if (!active) this.lastSent.delete(key);
    this.prev.set(key, active);
  }

  reset(): void {
    this.prev.clear();
    this.lastSent.clear();
  }
}

/** Fire-and-forget webhook notifier (Telegram bot / generic JSON). Never throws into the poll loop. */
export function notifyWebhook(url: string | undefined, alert: Alert): void {
  if (!url) return;
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: `[${alert.level}] ${alert.message} (${alert.at})`, alert }),
  }).catch((e) => console.error(`webhook failed: ${(e as Error).message}`));
}

/**
 * Telegram bot notifier via Bot API sendMessage.
 * Only WARN/CRITICAL are pushed; INFO is skipped to avoid noise.
 * Never throws into the poll loop.
 */
export function notifyTelegram(botToken: string | undefined, chatId: string | undefined, alert: Alert): void {
  if (!botToken || !chatId) return;
  if (alert.level === "INFO") return;
  const text = `[${alert.level}] ${alert.message}\n${alert.at}`;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  }).catch((e) => console.error(`telegram push failed: ${(e as Error).message}`));
}

