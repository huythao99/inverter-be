import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';

type Listener = (topic: string, payload: string) => void;

/** Concurrent live streams per instance (public links), and per link. */
export const MAX_STREAMS = 200;
export const MAX_STREAMS_PER_LINK = 20;

/**
 * Relays live MQTT messages of a few exact device topics to public-link
 * viewers (Server-Sent Events). Uses its OWN broker connection, created on the
 * first viewer: the main MqttService client (primary instance only) persists
 * every message, and a second subscriber there would process them twice.
 * Viewers never get broker credentials nor learn the owner's uid.
 */
@Injectable()
export class PublicStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(PublicStreamService.name);
  private client: mqtt.MqttClient | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly perLink = new Map<string, number>();
  private streams = 0;

  constructor(private readonly config: ConfigService) {}

  private ensureClient(): mqtt.MqttClient {
    if (this.client) return this.client;
    const base = this.config.get<string>('MQTT_CLIENT_ID', 'nestjs-app');
    const options: mqtt.IClientOptions = {
      clientId: `${base}-relay-${process.pid}`,
      keepalive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 30000,
      clean: true,
    };
    const username = this.config.get<string>('MQTT_USERNAME');
    const password = this.config.get<string>('MQTT_PASSWORD');
    if (username) options.username = username;
    if (password) options.password = password;

    const client = mqtt.connect(
      this.config.get<string>('MQTT_URL', 'mqtt://localhost:1883'),
      options,
    );
    client.on('message', (topic, message) => {
      const set = this.listeners.get(topic);
      if (!set) return;
      const payload = message.toString();
      for (const fn of set) {
        try {
          fn(topic, payload);
        } catch {
          /* a broken stream must not stop the others */
        }
      }
    });
    client.on('connect', () => {
      // clean session: restore the live subscriptions after a reconnect
      const topics = [...this.listeners.keys()];
      if (topics.length) client.subscribe(topics, { qos: 0 });
    });
    client.on('error', (err) => this.logger.warn(`relay MQTT: ${err.message}`));
    this.client = client;
    return client;
  }

  /** Reserve a stream slot for a link, or false when over the limits. */
  acquire(linkKey: string): boolean {
    const n = this.perLink.get(linkKey) ?? 0;
    if (this.streams >= MAX_STREAMS || n >= MAX_STREAMS_PER_LINK) return false;
    this.streams++;
    this.perLink.set(linkKey, n + 1);
    return true;
  }

  release(linkKey: string): void {
    this.streams = Math.max(0, this.streams - 1);
    const n = (this.perLink.get(linkKey) ?? 1) - 1;
    if (n <= 0) this.perLink.delete(linkKey);
    else this.perLink.set(linkKey, n);
  }

  /** Listen to exact topics; returns the unsubscribe function. */
  listen(topics: string[], fn: Listener): () => void {
    const client = this.ensureClient();
    const fresh: string[] = [];
    for (const t of topics) {
      let set = this.listeners.get(t);
      if (!set) {
        set = new Set();
        this.listeners.set(t, set);
        fresh.push(t);
      }
      set.add(fn);
    }
    if (fresh.length && client.connected) client.subscribe(fresh, { qos: 0 });

    return () => {
      const gone: string[] = [];
      for (const t of topics) {
        const set = this.listeners.get(t);
        if (!set) continue;
        set.delete(fn);
        if (set.size === 0) {
          this.listeners.delete(t);
          gone.push(t);
        }
      }
      if (gone.length && this.client?.connected) this.client.unsubscribe(gone);
    };
  }

  onModuleDestroy(): void {
    this.client?.end(true);
    this.client = null;
  }
}
