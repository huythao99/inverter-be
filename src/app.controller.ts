import { Controller, Get, Header } from '@nestjs/common';
import { AppService, BACKEND_VERSION } from './app.service';
import { LANDING_JS } from './landing/landing.script';
import { FAVICON_SVG } from './landing/landing.page';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Public landing page (live status + device count, so never cached long).
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=60')
  getLanding(): Promise<string> {
    return this.appService.getLandingPage();
  }

  // Landing page script (the CSP forbids inline scripts).
  @Get('landing.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  getLandingScript(): string {
    return LANDING_JS;
  }

  @Get('favicon.svg')
  @Header('Content-Type', 'image/svg+xml')
  @Header('Cache-Control', 'public, max-age=86400')
  getFavicon(): string {
    return FAVICON_SVG;
  }

  @Get('version')
  getVersion(): { version: string } {
    return { version: BACKEND_VERSION };
  }

  @Get('app-ads.txt')
  @Header('Content-Type', 'text/plain')
  getAppAdsTxt(): string {
    return 'google.com, pub-3726952827286259, DIRECT, f08c47fec0942fa0';
  }
}
