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
export class DeviceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private userSockets: Map<string, Socket[]> = new Map();

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    // Xóa client khỏi tất cả rooms
    this.removeClientFromAllRooms(client);
  }

  @SubscribeMessage('joinUserRoom')
  handleJoinUserRoom(client: Socket, userId: string) {
    const roomName = `user_${userId}`;
    client.join(roomName);
    
    // Lưu thông tin client
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, []);
    }
    this.userSockets.get(userId)?.push(client);
    
    console.log(`Client ${client.id} joined room: ${roomName}`);
    client.emit('joinedUserRoom', { userId, roomName });
  }

  @SubscribeMessage('leaveUserRoom')
  handleLeaveUserRoom(client: Socket, userId: string) {
    const roomName = `user_${userId}`;
    client.leave(roomName);
    
    // Xóa client khỏi danh sách
    const userClients = this.userSockets.get(userId);
    if (userClients) {
      const index = userClients.findIndex(socket => socket.id === client.id);
      if (index > -1) {
        userClients.splice(index, 1);
      }
      if (userClients.length === 0) {
        this.userSockets.delete(userId);
      }
    }
    
    console.log(`Client ${client.id} left room: ${roomName}`);
    client.emit('leftUserRoom', { userId, roomName });
  }

  // Phương thức để emit event khi có device mới được thêm
  emitDeviceAdded(userId: string, device: any) {
    const roomName = `user_${userId}`;
    this.server.to(roomName).emit('deviceAdded', {
      userId,
      device,
      timestamp: new Date().toISOString(),
    });
    console.log(`Emitted deviceAdded to room: ${roomName}`, device);
  }

  // Phương thức để emit event khi có device bị xóa
  emitDeviceRemoved(userId: string, device: any) {
    const roomName = `user_${userId}`;
    this.server.to(roomName).emit('deviceRemoved', {
      userId,
      device,
      timestamp: new Date().toISOString(),
    });
    console.log(`Emitted deviceRemoved to room: ${roomName}`, device);
  }

  // Phương thức để emit event khi có device được cập nhật
  emitDeviceUpdated(userId: string, device: any) {
    const roomName = `user_${userId}`;
    this.server.to(roomName).emit('deviceUpdated', {
      userId,
      device,
      timestamp: new Date().toISOString(),
    });
    console.log(`Emitted deviceUpdated to room: ${roomName}`, device);
  }

  private removeClientFromAllRooms(client: Socket) {
    for (const [userId, clients] of this.userSockets.entries()) {
      const index = clients.findIndex(socket => socket.id === client.id);
      if (index > -1) {
        clients.splice(index, 1);
        if (clients.length === 0) {
          this.userSockets.delete(userId);
        }
      }
    }
  }
} 