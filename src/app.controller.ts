import { Controller, Get, Header } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Header('Content-Type', 'text/html')
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('version')
  getVersion(): { version: string } {
    return { version: '0.2.24' };
  }

  @Get('app-ads.txt')
  @Header('Content-Type', 'text/plain')
  getAppAdsTxt(): string {
    return 'google.com, pub-3726952827286259, DIRECT, f08c47fec0942fa0';
  }
}
