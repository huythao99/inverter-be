import { Controller, Delete, Get, GoneException, Logger } from '@nestjs/common';

/**
 * Old unauthenticated energy API (`?userId=` in the query): anyone knowing a
 * user id could read that user's energy, or wipe the current month with
 * DELETE clear-current-month. Closed: every route answers 410.
 *
 * App builds since 2026-09-25 and the web app use the authenticated
 * /api/user/devices/:deviceId/(day-totals|monthly-totals|chart-data|
 * calculate-daily-totals) instead. Hits are logged (at most once a minute,
 * with a count) to see how many old app builds are still around.
 */
@Controller('api/daily-totals')
export class DailyTotalsController {
  private readonly logger = new Logger(DailyTotalsController.name);
  private hits = 0;
  private lastLogAt = 0;

  private gone(route: string): never {
    this.hits++;
    const now = Date.now();
    if (now - this.lastLogAt > 60_000) {
      this.logger.warn(
        `closed legacy API called: ${route} (${this.hits} call(s) since last log)`,
      );
      this.lastLogAt = now;
      this.hits = 0;
    }
    throw new GoneException('Use /api/user/devices/:deviceId/...');
  }

  @Get('by-day')
  getDailyTotalsByDay(): never {
    return this.gone('GET by-day');
  }

  @Get('monthly')
  getMonthlyTotals(): never {
    return this.gone('GET monthly');
  }

  @Get('monthly/chart')
  getMonthlyChart(): never {
    return this.gone('GET monthly/chart');
  }

  @Delete('clear-current-month')
  clearCurrentMonthTotals(): never {
    return this.gone('DELETE clear-current-month');
  }

  @Get('calculate/:userId/:deviceId')
  calculateTotalsByUserAndDevice(): never {
    return this.gone('GET calculate');
  }
}
