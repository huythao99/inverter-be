import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseConfig implements OnModuleInit {
  private app: admin.app.App;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.configService
      .get<string>('FIREBASE_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      console.warn(
        'Firebase credentials not configured. Firebase authentication will not work.',
      );
      return;
    }

    // Check if Firebase app already initialized
    if (admin.apps.length === 0) {
      this.app = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    } else {
      this.app = admin.apps[0]!;
    }
  }

  getAuth(): admin.auth.Auth {
    if (!this.app) {
      throw new Error('Firebase not initialized');
    }
    return this.app.auth();
  }

  async verifyIdToken(token: string): Promise<admin.auth.DecodedIdToken> {
    return this.getAuth().verifyIdToken(token);
  }
}
