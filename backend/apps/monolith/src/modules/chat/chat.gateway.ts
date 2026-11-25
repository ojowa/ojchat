import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';

interface ChatRoom {
  conversationId: string;
  userIds: string[];
}

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private userSockets = new Map<string, string>(); // userId -> socketId
  private conversationRooms = new Map<string, Set<string>>(); // conversationId -> Set<socketId>

  handleConnection(client: Socket) {
    const token = (client.handshake.auth as any)?.token || client.handshake.query.token;
    let userId: string | undefined;

    if (token) {
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        this.logger.warn('JWT_SECRET not set, rejecting chat connection');
        client.disconnect();
        return;
      }
      try {
        const payload: any = jwt.verify(token, jwtSecret);
        userId = payload.sub;
      } catch {
        this.logger.warn('Invalid JWT token, rejecting chat connection');
        client.disconnect();
        return;
      }
    } else {
      userId = client.handshake.query.userId as string;
    }

    if (userId) {
      this.userSockets.set(userId, client.id);
      client.data.userId = userId;
      this.logger.log(`Chat client connected: ${client.id} (user: ${userId})`);
    } else {
      this.logger.warn(`Chat client connected without userId: ${client.id}`);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId as string;
    if (userId) {
      this.userSockets.delete(userId);
      // Leave all conversation rooms
      for (const [convId, socketIds] of this.conversationRooms.entries()) {
        socketIds.delete(client.id);
        if (socketIds.size === 0) {
          this.conversationRooms.delete(convId);
        }
      }
      this.logger.log(`Chat client disconnected: ${client.id} (user: ${userId})`);
    }
  }

  @SubscribeMessage('message.sent')
  handleMessageSent(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; messageId: string; senderId: string; recipientId: string; content: string; type: string },
  ) {
    const userId = client.data.userId as string;
    if (!userId || userId !== data.senderId) return;

    const room = this.conversationRooms.get(data.conversationId);
    if (room) {
      for (const socketId of room) {
        if (socketId !== client.id) {
          this.server.to(socketId).emit('message.received', {
            conversationId: data.conversationId,
            messageId: data.messageId,
            senderId: data.senderId,
            content: data.content,
            type: data.type,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    // Notify recipient if online
    const recipientSocketId = this.userSockets.get(data.recipientId);
    if (recipientSocketId) {
      this.server.to(recipientSocketId).emit('message.received', {
        conversationId: data.conversationId,
        messageId: data.messageId,
        senderId: data.senderId,
        content: data.content,
        type: data.type,
        createdAt: new Date().toISOString(),
      });
    }

    this.logger.log(`Message sent: ${data.messageId} in ${data.conversationId}`);
  }

  @SubscribeMessage('typing.start')
  handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; userId: string },
  ) {
    const userId = client.data.userId as string;
    if (!userId || userId !== data.userId) return;

    const room = this.conversationRooms.get(data.conversationId);
    if (room) {
      for (const socketId of room) {
        if (socketId !== client.id) {
          this.server.to(socketId).emit('user.typing', {
            conversationId: data.conversationId,
            userId: data.userId,
          });
        }
      }
    }
  }

  @SubscribeMessage('typing.stop')
  handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; userId: string },
  ) {
    const userId = client.data.userId as string;
    if (!userId || userId !== data.userId) return;

    const room = this.conversationRooms.get(data.conversationId);
    if (room) {
      for (const socketId of room) {
        if (socketId !== client.id) {
          this.server.to(socketId).emit('user.typing.stop', {
            conversationId: data.conversationId,
            userId: data.userId,
          });
        }
      }
    }
  }

  @SubscribeMessage('message.read')
  handleMessageRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; messageId: string; userId: string },
  ) {
    const userId = client.data.userId as string;
    if (!userId || userId !== data.userId) return;

    const room = this.conversationRooms.get(data.conversationId);
    if (room) {
      for (const socketId of room) {
        this.server.to(socketId).emit('message.read', {
          conversationId: data.conversationId,
          messageId: data.messageId,
          userId: data.userId,
          readAt: new Date().toISOString(),
        });
      }
    }
  }

  @SubscribeMessage('conversation.join')
  handleConversationJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.data.userId as string;
    if (!userId) return;

    let sockets = this.conversationRooms.get(data.conversationId);
    if (!sockets) {
      sockets = new Set();
      this.conversationRooms.set(data.conversationId, sockets);
    }
    sockets.add(client.id);
    client.join(data.conversationId);

    // Notify others in conversation that user is online
    for (const socketId of sockets) {
      if (socketId !== client.id) {
        this.server.to(socketId).emit('user.online', {
          conversationId: data.conversationId,
          userId,
        });
      }
    }

    this.logger.log(`User ${userId} joined conversation ${data.conversationId}`);
  }

  @SubscribeMessage('conversation.leave')
  handleConversationLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.data.userId as string;
    const sockets = this.conversationRooms.get(data.conversationId);
    if (sockets) {
      sockets.delete(client.id);
      if (sockets.size === 0) {
        this.conversationRooms.delete(data.conversationId);
      }
    }
    client.leave(data.conversationId);

    this.logger.log(`User ${userId} left conversation ${data.conversationId}`);
  }

  sendToUser(userId: string, event: string, data: any) {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }

  sendToConversation(conversationId: string, event: string, data: any) {
    const sockets = this.conversationRooms.get(conversationId);
    if (sockets) {
      for (const socketId of sockets) {
        this.server.to(socketId).emit(event, data);
      }
    }
  }
}
