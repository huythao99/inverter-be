import { Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentFirebaseUser } from '../auth/decorators/firebase-user.decorator';
import type { FirebaseUser } from '../auth/strategies/firebase.strategy';
import { HassAccountService } from './hass-account.service';

/**
 * Home Assistant access of the signed-in user (read-only data, phase 1).
 * The response holds the broker password: never cached.
 */
@Controller('api/user/hass')
// Global short/medium/long limits per IP, plus 10 changes a minute below.
@UseGuards(FirebaseAuthGuard, ThrottlerGuard)
export class HassController {
  constructor(private readonly hass: HassAccountService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentFirebaseUser() user: FirebaseUser) {
    return this.hass.get(user.uid);
  }

  @Post('enable')
  @Throttle({ long: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  enable(@CurrentFirebaseUser() user: FirebaseUser) {
    return this.hass.enable(user.uid);
  }

  @Post('disable')
  @Throttle({ long: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  disable(@CurrentFirebaseUser() user: FirebaseUser) {
    return this.hass.disable(user.uid);
  }

  @Post('regenerate')
  @Throttle({ long: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  regenerate(@CurrentFirebaseUser() user: FirebaseUser) {
    return this.hass.regenerate(user.uid);
  }
}
