import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService, BACKEND_VERSION } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: { getLandingPage: () => Promise.resolve('<html></html>') },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('serves the landing page', async () => {
    await expect(appController.getLanding()).resolves.toContain('<html>');
  });

  it('reports the backend version', () => {
    expect(appController.getVersion()).toEqual({ version: BACKEND_VERSION });
  });

  it('serves the landing script and favicon', () => {
    expect(appController.getLandingScript()).toContain('IntersectionObserver');
    expect(appController.getFavicon()).toContain('<svg');
  });
});
