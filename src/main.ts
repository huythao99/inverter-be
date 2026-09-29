import { NestFactory } from '@nestjs/core';
import { LogLevel, ValidationPipe } from '@nestjs/common';
import * as compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // Debug/verbose logs are off by default: every MQTT auth/ACL check logs a
  // line, and pm2 writing them costs real CPU. LOG_LEVELS=error,warn,log,debug
  // turns them back on while investigating.
  const logLevels = (process.env.LOG_LEVELS || 'error,warn,log')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean) as LogLevel[];
  const app = await NestFactory.create(AppModule, { logger: logLevels });

  // Security headers (XSS, Clickjacking, MIME sniffing protection)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Landing page font (Google Fonts): stylesheet + font files.
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      crossOriginEmbedderPolicy: false, // Allow embedding for API
    }),
  );

  // Enable CORS for CMS admin frontend and User app
  const corsOrigins = [
    process.env.CMS_CORS_ORIGIN || 'http://localhost:5173',
    process.env.USER_APP_CORS_ORIGIN || 'http://localhost:5174',
  ].filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.use(compression());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
