import type { HealthIssue } from '../services/api';

export const ISSUE_META: Record<HealthIssue, { label: string; hint: string; tone: 'bad' | 'warn' | 'info' }> = {
  offline: { label: 'Offline', hint: 'No telemetry for 10+ minutes', tone: 'bad' },
  reboot_loop: { label: 'Reboot loop', hint: '3+ boots in 24 h', tone: 'bad' },
  crash: { label: 'Crash / WDT', hint: 'Panic or watchdog reset in 24 h', tone: 'bad' },
  brownout: { label: 'Brownout', hint: 'Power dip reset in 24 h', tone: 'warn' },
  uart: { label: 'STM32 UART', hint: 'Bad frames from the power board (last 30 min)', tone: 'bad' },
  plain_mqtt: { label: 'MQTT no TLS', hint: 'Fell back to plain MQTT 1883', tone: 'warn' },
  mqtt_fail: { label: 'MQTT failures', hint: 'Reset WiFi after repeated MQTT failures (24 h)', tone: 'warn' },
  low_heap: { label: 'Low memory', hint: 'Min free heap < 20 KB', tone: 'warn' },
  weak_wifi: { label: 'Weak WiFi', hint: 'RSSI below -80 dBm', tone: 'warn' },
  outdated: { label: 'Old firmware', hint: 'Older than the stable build', tone: 'info' },
};
export const ISSUE_ORDER = Object.keys(ISSUE_META) as HealthIssue[];

export const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
