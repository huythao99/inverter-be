# Giabao Inverter Management System

A production-ready NestJS application for monitoring and managing solar inverter devices with real-time data processing, caching, and analytics.

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| NestJS | 11.0.1 | Core framework |
| MongoDB | - | Primary database |
| Mongoose | 8.17.0 | MongoDB ODM |
| Redis | - | Caching layer |
| ioredis | 5.7.0 | Redis client |
| MQTT | 5.14.0 | Real-time device communication |
| TypeScript | 5.7.3 | Language |

## Project Structure

```
nestjs-app/
├── src/
│   ├── controllers/        # 7 API controllers
│   ├── services/           # 8 business logic services
│   ├── models/             # 5 MongoDB schemas
│   ├── modules/            # 5 NestJS modules
│   ├── dto/                # 14 Data Transfer Objects
│   ├── config/             # Configuration files
│   ├── auth/               # Authentication (placeholder)
│   ├── utils/              # Utilities
│   ├── app.module.ts       # Root module
│   ├── app.controller.ts   # Root controller
│   ├── app.service.ts      # Root service
│   └── main.ts             # Entry point
├── dist/                   # Compiled output
├── test/                   # Test files
├── package.json            # Dependencies
├── tsconfig.json           # TypeScript config
├── nest-cli.json           # NestJS CLI config
└── .env                    # Environment variables
```

## Modules

### 1. Inverter Data Module
- **Purpose**: Manages real-time inverter telemetry data
- **Features**:
  - MQTT message deduplication (3-second window)
  - Batch processing to Redis (every 5 seconds)
  - Batch flushing to MongoDB (every 60 seconds)
  - Memory-efficient Map-based storage for O(1) lookups
  - Caching with 10-30 second TTL

### 2. Inverter Device Module
- **Purpose**: CRUD operations for inverter devices
- **Features**:
  - Device registration and management
  - Firmware version tracking and updates
  - Multi-device per user support

### 3. Inverter Setting Module
- **Purpose**: Device configuration management
- **Features**:
  - Store and retrieve device-specific settings
  - Dynamic value updates
  - Timeout handling for database lookups

### 4. Inverter Schedule Module
- **Purpose**: Schedule operation management
- **Features**:
  - Define and manage operation schedules
  - Per-device scheduling

### 5. Daily Totals Module
- **Purpose**: Energy aggregation and reporting
- **Features**:
  - Track daily energy totals (totalA, totalA2)
  - Redis caching for current day performance
  - Monthly and date-range analytics
  - Automatic daily reset at GMT+7

## Database Entities

### InverterDevice
| Field | Type | Description |
|-------|------|-------------|
| userId | String | User identifier |
| deviceId | String | Device identifier |
| deviceName | String | Device name |
| firmwareVersion | String | Current firmware version |
| updatedAt | Date | Last update timestamp |

### InverterData
| Field | Type | Description |
|-------|------|-------------|
| userId | String | User identifier |
| deviceId | String | Device identifier |
| value | Mixed | Telemetry data |
| totalACapacity | Number | Total A capacity |
| totalA2Capacity | Number | Total A2 capacity |
| updatedAt | Date | Last update timestamp |

### InverterSetting
| Field | Type | Description |
|-------|------|-------------|
| userId | String | User identifier |
| deviceId | String | Device identifier |
| value | Mixed | Configuration data |
| updatedAt | Date | Last update timestamp |

### InverterSchedule
| Field | Type | Description |
|-------|------|-------------|
| userId | String | User identifier |
| deviceId | String | Device identifier |
| schedule | Mixed | Schedule data |
| updatedAt | Date | Last update timestamp |

### DailyTotals
| Field | Type | Description |
|-------|------|-------------|
| userId | String | User identifier |
| deviceId | String | Device identifier |
| date | String | Date (YYYY-MM-DD) |
| totalA | Number | Daily total A |
| totalA2 | Number | Daily total A2 |
| timezone | String | Timezone (default: GMT+7) |
| createdAt | Date | Creation timestamp |
| updatedAt | Date | Last update timestamp |
| deletedAt | Date | Soft delete timestamp |

## API Endpoints

> Global prefix: `api/`

### Root Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Landing page (HTML) |
| GET | `/version` | API version |
| GET | `/app-ads.txt` | AdSense configuration |

### Inverter Data (`/inverter`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/data` | Get all data (paginated, cached 30s) |
| GET | `/data/:userId/:deviceId/latest` | Get latest device data (cached 10s) |
| GET | `/data/:userId/:deviceId` | Get paginated data by user/device |
| GET | `/data/:id` | Get single record (cached 60s) |
| DELETE | `/data/:id` | Delete single record |
| DELETE | `/data` | Delete all records |

### Inverter Device (`/inverter-device`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/data` | Create device |
| GET | `/data` | Get all devices |
| GET | `/data/device/:userId` | Get devices by user |
| GET | `/data/:userId/:deviceId` | Get specific device |
| GET | `/data/:id` | Get device by ID |
| PATCH | `/data/:id` | Update device |
| PATCH | `/data/:userId/:deviceId/firmware` | Update firmware version |
| DELETE | `/data/:id` | Delete device |
| DELETE | `/data` | Delete all devices |

### Inverter Setting (`/inverter-setting`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/data` | Create setting |
| GET | `/data` | Get all settings |
| GET | `/data/:userId/:deviceId` | Get setting by user/device |
| PATCH | `/data/:userId/:deviceId/value` | Update value only |
| DELETE | `/data/:id` | Delete setting |

### Inverter Schedule (`/inverter-schedule`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/data` | Create schedule |
| GET | `/data` | Get all schedules |
| GET | `/data/:userId/:deviceId` | Get schedule by user/device |
| PATCH | `/data/:userId/:deviceId/schedule` | Update schedule value |
| DELETE | `/data/:id` | Delete schedule |

### Daily Totals (`/daily-totals`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/` | Create daily totals |
| GET | `/` | Get all with filtering |
| GET | `/summary` | Get totals by date range |
| GET | `/by-day` | Get totals for specific day |
| GET | `/monthly` | Get monthly totals |
| GET | `/monthly/chart` | Get monthly chart data |
| GET | `/calculate/:userId/:deviceId` | Calculate totals |
| POST | `/upsert` | Upsert by user/device/date |
| POST | `/increment` | Increment totals |
| DELETE | `/clear-current-month` | Clear current month data |

### Firmware (`/firmware`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Get firmware URL for device |
| GET | `/version` | Get device firmware version |
| GET | `/newest` | Get newest firmware version |

### Redis Totals (`/redis-totals`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/current` | Get today's totals |
| GET | `/by-date` | Get totals for specific date |
| GET | `/range` | Get totals by date range |
| GET | `/today` | Get today's totals with devices |
| GET | `/health` | Health check |
| POST | `/flush` | Force flush to database |
| POST | `/reset` | Manual daily reset |

## Performance Optimizations

### Batch Processing
- **Redis batch**: Every 5 seconds
- **MongoDB flush**: Every 60 seconds
- **Daily totals flush**: Every 5 minutes

### Deduplication
- MQTT messages deduplicated within 3-second windows
- Prevents duplicate processing of same device data

### Memory Management
- Map-based storage for O(1) lookups
- Maximum 2000 in-memory entries
- Cleanup intervals every 60 seconds

### Caching Strategy
- Cache manager with configurable TTL (10-60 seconds)
- Cache interceptor on read-heavy endpoints
- Global cache module

## Configuration

### Environment Variables
```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017/inverter

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# MQTT
MQTT_BROKER_URL=mqtt://localhost:1883

# Server
PORT=3000
```

### MongoDB Connection
- Connection pooling: 10-100 connections
- Timeouts: Connection 10s, Socket 30s, Server Selection 5s
- Retry mechanism with connection management

## Scripts

```bash
# Development
npm run start:dev

# Production build
npm run build
npm run start:prod

# Testing
npm run test
npm run test:e2e
npm run test:cov

# Linting
npm run lint
npm run format
```

## Current Version

**0.2.27**

## License

Giabao Technology - All rights reserved
