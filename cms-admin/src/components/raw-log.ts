/** One UART line seen by the ESP32 (from hybrid/{uid}/{id}/data or /raw). */
export interface RawLogLine {
  id: number;
  at: string; // ISO time received by the CMS
  dir: 'RX' | 'TX' | 'SYS';
  /** DATA (forwarded to /data) | ACK | NOFRAME | BADCRC | LONG | UNKNOWN | SILENT | FRAME | LEGACY | STATUS */
  tag: string;
  text: string;
}

/** Parse a /raw payload: "<RX|TX> <TAG>[ (+N skipped)] <line>". */
export function parseRawLog(payload: string): Omit<RawLogLine, 'id' | 'at'> {
  const m = /^(RX|TX)\s+(\S+)(\s+\(\+\d+ skipped\))?\s?([\s\S]*)$/.exec(payload);
  if (!m) return { dir: 'RX', tag: '?', text: payload };
  return {
    dir: m[1] as 'RX' | 'TX',
    tag: m[2] + (m[3] ? m[3] : ''),
    text: m[4],
  };
}

