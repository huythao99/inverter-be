import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

interface SubscriptionPayload {
  userId: string;
  deviceId: string;
}

@WebSocketGateway({
  namespace: '/cms',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class CmsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CmsGateway.name);
  private clientSubscriptions = new Map<string, Set<string>>(); // clientId -> Set of "userId:deviceId"
  // Reverse index: "userId:deviceId" -> Set of clientId. Lets each device frame
  // reach its subscribers with one lookup instead of scanning every client.
  private subscribers = new Map<string, Set<string>>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Verify JWT token from handshake
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Client ${client.id} connection rejected: No token`);
        client.disconnect();
        return;
      }

      const secret = this.configService.get<string>(
        'CMS_JWT_SECRET',
        'cms_default_secret_change_in_production',
      );

      try {
        this.jwtService.verify(token, { secret });
      } catch {
        this.logger.warn(
          `Client ${client.id} connection rejected: Invalid token`,
        );
        client.disconnect();
        return;
      }

      this.clientSubscriptions.set(client.id, new Set());
      this.logger.log(`CMS client connected: ${client.id}`);
    } catch (error) {
      this.logger.error(`Connection error: ${error}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    for (const key of this.clientSubscriptions.get(client.id) ?? []) {
      this.removeSubscriber(key, client.id);
    }
    this.clientSubscriptions.delete(client.id);
    this.logger.log(`CMS client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SubscriptionPayload,
  ) {
    const { userId, deviceId } = data;
    const subscriptionKey = `${userId}:${deviceId}`;

    const subscriptions = this.clientSubscriptions.get(client.id);
    if (subscriptions) {
      subscriptions.add(subscriptionKey);
      let clients = this.subscribers.get(subscriptionKey);
      if (!clients) {
        clients = new Set();
        this.subscribers.set(subscriptionKey, clients);
      }
      clients.add(client.id);
      this.logger.log(`Client ${client.id} subscribed to ${subscriptionKey}`);

      return { success: true, subscribed: subscriptionKey };
    }

    return { success: false, error: 'Client not found' };
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SubscriptionPayload,
  ) {
    const { userId, deviceId } = data;
    const subscriptionKey = `${userId}:${deviceId}`;

    const subscriptions = this.clientSubscriptions.get(client.id);
    if (subscriptions) {
      subscriptions.delete(subscriptionKey);
      this.removeSubscriber(subscriptionKey, client.id);
      this.logger.log(
        `Client ${client.id} unsubscribed from ${subscriptionKey}`,
      );

      return { success: true, unsubscribed: subscriptionKey };
    }

    return { success: false, error: 'Client not found' };
  }

  // Listen to MQTT inverter data events and broadcast to subscribed clients
  @OnEvent('inverter.data.received')
  handleInverterData(payload: {
    currentUid: string;
    wifiSsid: string;
    data: { value: string; totalACapacity: number; totalA2Capacity: number };
  }) {
    const clients = this.subscribers.get(
      `${payload.currentUid}:${payload.wifiSsid}`,
    );
    if (!clients?.size) return;

    // Device frames are "a#b#c…" strings, not JSON; only parse when it looks
    // like JSON (avoids a thrown exception on every frame).
    let parsedValue: unknown = null;
    const value = payload.data.value;
    if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        // keep null; clients fall back to the raw value
      }
    }

    this.emitToClients(clients, 'deviceData', {
      userId: payload.currentUid,
      deviceId: payload.wifiSsid,
      data: { ...payload.data, parsedValue },
      timestamp: new Date().toISOString(),
    });
  }

  // Listen to device message events
  @OnEvent('device.message.received')
  handleDeviceMessage(payload: {
    currentUid: string;
    wifiSsid: string;
    data: { deviceName: string };
  }) {
    this.emitToSubscribers(payload.currentUid, payload.wifiSsid, 'deviceInfo', {
      userId: payload.currentUid,
      deviceId: payload.wifiSsid,
      data: payload.data,
      timestamp: new Date().toISOString(),
    });
  }

  // ---- Charger realtime (separate firmware type) ----

  // Charger telemetry/cfg/info (STM32 frame parsed by backend from
  // charger/{uid}/{deviceId}/data — clients get a decoded object)
  @OnEvent('charger.data.received')
  handleChargerData(payload: {
    userId: string;
    deviceId: string;
    data: Record<string, unknown>;
  }) {
    this.emitToSubscribers(payload.userId, payload.deviceId, 'chargerData', {
      userId: payload.userId,
      deviceId: payload.deviceId,
      data: payload.data,
      timestamp: new Date().toISOString(),
    });
  }

  // Charger heartbeat -> online/offline indicator
  @OnEvent('charger.status.received')
  handleChargerStatus(payload: {
    userId: string;
    deviceId: string;
    status: string;
  }) {
    this.emitToSubscribers(payload.userId, payload.deviceId, 'chargerStatus', {
      userId: payload.userId,
      deviceId: payload.deviceId,
      status: payload.status,
      timestamp: new Date().toISOString(),
    });
  }

  // Charger OTA progress
  @OnEvent('charger.ota.status.received')
  handleChargerOtaStatus(payload: {
    userId: string;
    deviceId: string;
    status?: string;
    progress?: number;
    message?: string;
    timestamp: string;
  }) {
    this.emitToSubscribers(
      payload.userId,
      payload.deviceId,
      'chargerOtaStatus',
      {
        userId: payload.userId,
        deviceId: payload.deviceId,
        status: payload.status,
        progress: payload.progress,
        message: payload.message,
        timestamp: payload.timestamp,
      },
    );
  }

  // Emit an event to every client subscribed to userId:deviceId.
  private emitToSubscribers(
    userId: string,
    deviceId: string,
    event: string,
    body: Record<string, unknown>,
  ) {
    const clients = this.subscribers.get(`${userId}:${deviceId}`);
    if (clients?.size) this.emitToClients(clients, event, body);
  }

  private emitToClients(
    clients: Set<string>,
    event: string,
    body: Record<string, unknown>,
  ) {
    for (const clientId of clients) {
      this.server.sockets.sockets.get(clientId)?.emit(event, body);
    }
  }

  private removeSubscriber(key: string, clientId: string) {
    const clients = this.subscribers.get(key);
    if (!clients) return;
    clients.delete(clientId);
    if (clients.size === 0) this.subscribers.delete(key);
  }

  // STM32 FOTA status (forwarded as 'stmOtaStatus')
  @OnEvent('stm.ota.status.received')
  handleStmOtaStatus(payload: {
    userId: string;
    deviceId: string;
    status?: string;
    progress?: number;
    message?: string;
    timestamp: string;
  }) {
    this.emitToSubscribers(
      payload.userId,
      payload.deviceId,
      'stmOtaStatus',
      payload,
    );
  }

  // Listen to OTA firmware update status events
  @OnEvent('ota.status.received')
  handleOtaStatus(payload: {
    userId: string;
    deviceId: string;
    status: string;
    progress?: number;
    message?: string;
    timestamp: string;
  }) {
    this.emitToSubscribers(payload.userId, payload.deviceId, 'otaStatus', {
      userId: payload.userId,
      deviceId: payload.deviceId,
      status: payload.status,
      progress: payload.progress,
      message: payload.message,
      timestamp: payload.timestamp,
    });
  }
}
