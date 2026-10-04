import { GoneException } from '@nestjs/common';
import { DailyTotalsController } from './controllers/daily-totals.controller';

describe('legacy /api/daily-totals (unauthenticated) is closed', () => {
  const c = new DailyTotalsController();
  it.each([
    () => c.getDailyTotalsByDay(),
    () => c.getMonthlyTotals(),
    () => c.getMonthlyChart(),
    () => c.clearCurrentMonthTotals(),
    () => c.calculateTotalsByUserAndDevice(),
  ])('every route answers 410 (%#)', (call) => {
    expect(call).toThrow(GoneException);
  });
});
