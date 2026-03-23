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

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Verify JWT token from handshake
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Client ${client.id} connection rejected: No token`);
        client.disconnect();
        return;
      }

      const secret = this.configService.get<string>('CMS_JWT_SECRET', 'cms_default_secret_change_in_production');

      try {
        this.jwtService.verify(token, { secret });
      } catch {
        this.logger.warn(`Client ${client.id} connection rejected: Invalid token`);
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
      this.logger.log(`Client ${client.id} unsubscribed from ${subscriptionKey}`);

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
    const subscriptionKey = `${payload.currentUid}:${payload.wifiSsid}`;

    // Find all clients subscribed to this device
    for (const [clientId, subscriptions] of this.clientSubscriptions.entries()) {
      if (subscriptions.has(subscriptionKey)) {
        const client = this.server.sockets.sockets.get(clientId);
        if (client) {
          // Parse the value JSON if possible
          let parsedValue: any = null;
          try {
            parsedValue = JSON.parse(payload.data.value);
          } catch {
            // Value is not JSON, keep as string
          }

          client.emit('deviceData', {
            userId: payload.currentUid,
            deviceId: payload.wifiSsid,
            data: {
              ...payload.data,
              parsedValue,
            },
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  // Listen to device message events
  @OnEvent('device.message.received')
  handleDeviceMessage(payload: {
    currentUid: string;
    wifiSsid: string;
    data: { deviceName: string };
  }) {
    const subscriptionKey = `${payload.currentUid}:${payload.wifiSsid}`;

    for (const [clientId, subscriptions] of this.clientSubscriptions.entries()) {
      if (subscriptions.has(subscriptionKey)) {
        const client = this.server.sockets.sockets.get(clientId);
        if (client) {
          client.emit('deviceInfo', {
            userId: payload.currentUid,
            deviceId: payload.wifiSsid,
            data: payload.data,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }
}
