import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: "*",
  },
})
export class SettingDataGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private userDeviceSockets: Map<string, Socket[]> = new Map();

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    // Xóa client khỏi tất cả rooms
    this.removeClientFromAllRooms(client);
  }

  @SubscribeMessage('joinUserDeviceRoom')
  handleJoinUserDeviceRoom(client: Socket, payload: { userId: string; deviceId: string }) {
    const { userId, deviceId } = payload;
    const roomName = `user_${userId}_device_${deviceId}`;
    client.join(roomName);
    
    // Lưu thông tin client
    const key = `${userId}_${deviceId}`;
    if (!this.userDeviceSockets.has(key)) {
      this.userDeviceSockets.set(key, []);
    }
    this.userDeviceSockets.get(key)?.push(client);
    
    console.log(`Client ${client.id} joined room: ${roomName}`);
    client.emit('joinedUserDeviceRoom', { userId, deviceId, roomName });
  }

  @SubscribeMessage('leaveUserDeviceRoom')
  handleLeaveUserDeviceRoom(client: Socket, payload: { userId: string; deviceId: string }) {
    const { userId, deviceId } = payload;
    const roomName = `user_${userId}_device_${deviceId}`;
    client.leave(roomName);
    
    // Xóa client khỏi danh sách
    const key = `${userId}_${deviceId}`;
    const userDeviceClients = this.userDeviceSockets.get(key);
    if (userDeviceClients) {
      const index = userDeviceClients.findIndex(socket => socket.id === client.id);
      if (index > -1) {
        userDeviceClients.splice(index, 1);
      }
      if (userDeviceClients.length === 0) {
        this.userDeviceSockets.delete(key);
      }
    }
    
    console.log(`Client ${client.id} left room: ${roomName}`);
    client.emit('leftUserDeviceRoom', { userId, deviceId, roomName });
  }

  // Phương thức để emit event khi setting thay đổi
  emitSettingChanged(userId: string, deviceId: string, setting: any) {
    const roomName = `user_${userId}_device_${deviceId}`;
    this.server.to(roomName).emit('settingChanged', {
      userId,
      deviceId,
      setting,
      timestamp: new Date().toISOString(),
    });
    console.log(`Emitted settingChanged to room: ${roomName}`, setting);
  }

  // Phương thức để emit event khi data thay đổi
  emitDataChanged(userId: string, deviceId: string, data: any) {
    const roomName = `user_${userId}_device_${deviceId}`;
    this.server.to(roomName).emit('dataChanged', {
      userId,
      deviceId,
      data,
      timestamp: new Date().toISOString(),
    });
    console.log(`Emitted dataChanged to room: ${roomName}`, data);
  }

  // Phương thức để emit event khi có data mới được thêm
  emitDataAdded(userId: string, deviceId: string, data: any) {
    const roomName = `user_${userId}_device_${deviceId}`;
    this.server.to(roomName).emit('dataAdded', {
      userId,
      deviceId,
      data,
      timestamp: new Date().toISOString(),
    });
    console.log(`Emitted dataAdded to room: ${roomName}`, data);
  }

  private removeClientFromAllRooms(client: Socket) {
    for (const [key, clients] of this.userDeviceSockets.entries()) {
      const index = clients.findIndex(socket => socket.id === client.id);
      if (index > -1) {
        clients.splice(index, 1);
        if (clients.length === 0) {
          this.userDeviceSockets.delete(key);
        }
      }
    }
  }
} 