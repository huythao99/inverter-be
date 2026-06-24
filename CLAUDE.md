# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Giabao Inverter Management System - an IoT/energy management platform built with NestJS that manages solar inverter devices, collects real-time telemetry data via MQTT, and provides an administrative CMS dashboard.

## Common Commands

```bash
# Development
npm run start:dev          # Start in watch mode (development)
npm run start:debug        # Start with debug support and watch mode

# Build & Production
npm run build              # Compile TypeScript to JavaScript
npm run start:prod         # Run compiled application from dist/

# Testing
npm test                   # Run Jest unit tests
npm run test:watch         # Run Jest in watch mode
npm run test:cov           # Generate code coverage report
npm run test:e2e           # Run end-to-end tests

# Code Quality
npm run lint               # Run ESLint with auto-fix
npm run format             # Format code using Prettier
```

## Architecture

### Layered Structure
- **Controllers** (`src/controllers/`): HTTP request handling & routing
- **Services** (`src/services/`): Business logic & data operations
- **Models** (`src/models/`): Mongoose schemas for MongoDB
- **DTOs** (`src/dto/`): Input validation using class-validator & class-transformer
- **Gateways** (`src/gateways/`): WebSocket/Socket.io for real-time communication
- **Guards & Strategies** (`src/auth/`): JWT-based authentication

### Key Subsystems

**Real-Time Data Pipeline**
1. Devices publish telemetry via MQTT broker
2. `MqttService` receives and parses messages (handles encryption if enabled)
3. `InverterDataService` deduplicates within 3-second window using in-memory Maps
4. Data batched to MongoDB every 60 seconds, Redis every 5 seconds
5. Events emitted via `@nestjs/event-emitter` to WebSocket clients

**Authentication Flow**
- Admin JWT strategy (`AdminJwtStrategy`) validates Bearer tokens
- Tokens extracted from Authorization header, verified against MongoDB
- CMS gateway (`/cms` namespace) validates JWT during WebSocket handshake
- Passwords hashed with bcrypt

**WebSocket Subscriptions**
- Clients subscribe to `userId:deviceId` pairs
- Gateway listens to MQTT data events and broadcasts only to subscribed clients

### Module Pattern
Each feature module follows:
```typescript
@Module({
  imports: [MongooseModule.forFeature([...schemas])],
  controllers: [XyzController],
  providers: [XyzService],
  exports: [XyzService],
})
```

### MongoDB Schemas
All schemas use compound indexes on `userId/deviceId` for performance. Key collections:
- `InverterData`: Device telemetry with deduplication
- `InverterDevice`: Device metadata and firmware version
- `InverterSetting`: Device configuration parameters
- `InverterSchedule`: Scheduled device operations
- `DailyTotals`: Pre-aggregated daily statistics
- `Admin`: CMS users with roles (super_admin/admin)

## Environment Configuration

Required environment variables (see `.env.example`):
- `MONGODB_URI`, `MONGODB_USERNAME`, `MONGODB_PASSWORD`, `MONGODB_DATABASE`
- `MQTT_URL`, `MQTT_CLIENT_ID`, `MQTT_USERNAME`, `MQTT_PASSWORD`
- `MQTT_ENCRYPTION_KEY` (optional, for encrypted messages)
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`
- `CMS_JWT_SECRET`, `CMS_JWT_EXPIRES_IN`, `CMS_CORS_ORIGIN`

## Important Implementation Notes

- **Cluster Safety**: MQTT service only initializes on primary PM2 instance (checks `pm_id`)
- **Deduplication**: 3-second window in `InverterDataService` prevents duplicate processing
- **Batch Processing**: Reduces database writes with 60-second flush intervals
- **Cache Headers**: Device endpoints disable browser caching via `@Header('Cache-Control')`
- **CORS**: Configured via `CMS_CORS_ORIGIN` environment variable
