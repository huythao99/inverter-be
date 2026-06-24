# Home Assistant MQTT Authentication API

This document describes the API endpoints for integrating Home Assistant MQTT authentication into your mobile app.

## Overview

Each user gets unique MQTT credentials to connect their Home Assistant instance to your inverter devices. Users can only access their own devices.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Mobile App    │────►│   NestJS API    │────►│    MongoDB      │
│                 │     │                 │     │  (Credentials)  │
│ Get MQTT Config │     │ /api/mqtt-auth  │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Home Assistant  │────►│  MQTT Broker    │
│ (User's device) │     │                 │
└─────────────────┘     └─────────────────┘
```

---

## Base URL

```
https://your-server.com/api/mqtt-auth
```

---

## API Endpoints

### 1. Get MQTT Configuration

Get the MQTT credentials and configuration for a user to set up Home Assistant.

**Endpoint:** `GET /api/mqtt-auth/config/:userId`

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| userId | string | The user's unique ID |

**Request:**
```bash
GET /api/mqtt-auth/config/6jgAGTN7VtWC0IC3o7aFnLHiuL42
```

**Response:**
```json
{
  "success": true,
  "data": {
    "broker": "giabao-inverter.com",
    "port": 1883,
    "username": "ha_6jgAGTN7",
    "password": "xK9mN2pQ7vX4bE9f",
    "ssl": false,
    "discoveryPrefix": "homeassistant",
    "stateTopicPrefix": "inverter_ha/6jgAGTN7VtWC0IC3o7aFnLHiuL42",
    "devices": [
      {
        "deviceId": "GTIControl402",
        "deviceName": "My Inverter",
        "stateTopic": "inverter_ha/6jgAGTN7VtWC0IC3o7aFnLHiuL42/GTIControl402/state",
        "availabilityTopic": "inverter_ha/6jgAGTN7VtWC0IC3o7aFnLHiuL42/GTIControl402/availability"
      }
    ],
    "setupInstructions": {
      "step1": "Open Home Assistant",
      "step2": "Go to Settings → Devices & Services",
      "step3": "Click \"Add Integration\" and search for \"MQTT\"",
      "step4": "Enter the broker, port, username, and password below",
      "step5": "Your inverter devices will appear automatically!"
    }
  }
}
```

**Notes:**
- Credentials are auto-generated on first call
- Same credentials are returned on subsequent calls
- Credentials are unique per user

---

### 2. Regenerate Password

Generate a new password for the user (username stays the same).

**Endpoint:** `POST /api/mqtt-auth/regenerate/:userId`

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| userId | string | The user's unique ID |

**Request:**
```bash
POST /api/mqtt-auth/regenerate/6jgAGTN7VtWC0IC3o7aFnLHiuL42
```

**Response:**
```json
{
  "success": true,
  "message": "Password regenerated successfully. Please update Home Assistant with the new credentials.",
  "data": {
    "broker": "giabao-inverter.com",
    "port": 1883,
    "username": "ha_6jgAGTN7",
    "password": "newPassword123ABC",
    "ssl": false,
    "discoveryPrefix": "homeassistant",
    "stateTopicPrefix": "inverter_ha/6jgAGTN7VtWC0IC3o7aFnLHiuL42",
    "devices": [...]
  }
}
```

**Use Case:**
- User forgot password
- Security concern (password may have been compromised)
- User wants to disconnect old Home Assistant and connect new one

---

### 3. Get Credential Status

Check if a user has MQTT credentials and their status.

**Endpoint:** `GET /api/mqtt-auth/status/:userId`

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| userId | string | The user's unique ID |

**Request:**
```bash
GET /api/mqtt-auth/status/6jgAGTN7VtWC0IC3o7aFnLHiuL42
```

**Response (has credentials):**
```json
{
  "success": true,
  "data": {
    "hasCredentials": true,
    "isActive": true,
    "mqttUsername": "ha_6jgAGTN7",
    "allowedDevices": ["GTIControl402", "GTIControl403"],
    "lastUsedAt": "2025-01-15T10:30:00.000Z",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

**Response (no credentials):**
```json
{
  "success": true,
  "data": {
    "hasCredentials": false,
    "isActive": false
  }
}
```

---

### 4. Revoke Access

Disable MQTT access for a user.

**Endpoint:** `DELETE /api/mqtt-auth/revoke/:userId`

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| userId | string | The user's unique ID |

**Request:**
```bash
DELETE /api/mqtt-auth/revoke/6jgAGTN7VtWC0IC3o7aFnLHiuL42
```

**Response:**
```json
{
  "success": true,
  "message": "MQTT access revoked successfully"
}
```

**Use Case:**
- User wants to disconnect Home Assistant
- Account suspended
- Security concern

---

### 5. Health Check

Check if the MQTT auth service is running.

**Endpoint:** `GET /api/mqtt-auth/health`

**Request:**
```bash
GET /api/mqtt-auth/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

---

## Mobile App Implementation Guide

### Flutter Example

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class MqttAuthService {
  final String baseUrl = 'https://your-server.com/api/mqtt-auth';

  /// Get MQTT configuration for Home Assistant
  Future<MqttConfig?> getConfig(String userId) async {
    final response = await http.get(
      Uri.parse('$baseUrl/config/$userId'),
    );

    if (response.statusCode == 200) {
      final json = jsonDecode(response.body);
      if (json['success'] == true) {
        return MqttConfig.fromJson(json['data']);
      }
    }
    return null;
  }

  /// Regenerate MQTT password
  Future<MqttConfig?> regeneratePassword(String userId) async {
    final response = await http.post(
      Uri.parse('$baseUrl/regenerate/$userId'),
    );

    if (response.statusCode == 200) {
      final json = jsonDecode(response.body);
      if (json['success'] == true) {
        return MqttConfig.fromJson(json['data']);
      }
    }
    return null;
  }

  /// Check credential status
  Future<CredentialStatus?> getStatus(String userId) async {
    final response = await http.get(
      Uri.parse('$baseUrl/status/$userId'),
    );

    if (response.statusCode == 200) {
      final json = jsonDecode(response.body);
      if (json['success'] == true) {
        return CredentialStatus.fromJson(json['data']);
      }
    }
    return null;
  }

  /// Revoke MQTT access
  Future<bool> revokeAccess(String userId) async {
    final response = await http.delete(
      Uri.parse('$baseUrl/revoke/$userId'),
    );

    if (response.statusCode == 200) {
      final json = jsonDecode(response.body);
      return json['success'] == true;
    }
    return false;
  }
}

class MqttConfig {
  final String broker;
  final int port;
  final String username;
  final String password;
  final bool ssl;
  final String discoveryPrefix;
  final String stateTopicPrefix;
  final List<DeviceConfig> devices;

  MqttConfig({
    required this.broker,
    required this.port,
    required this.username,
    required this.password,
    required this.ssl,
    required this.discoveryPrefix,
    required this.stateTopicPrefix,
    required this.devices,
  });

  factory MqttConfig.fromJson(Map<String, dynamic> json) {
    return MqttConfig(
      broker: json['broker'],
      port: json['port'],
      username: json['username'],
      password: json['password'],
      ssl: json['ssl'] ?? false,
      discoveryPrefix: json['discoveryPrefix'],
      stateTopicPrefix: json['stateTopicPrefix'],
      devices: (json['devices'] as List)
          .map((d) => DeviceConfig.fromJson(d))
          .toList(),
    );
  }
}

class DeviceConfig {
  final String deviceId;
  final String deviceName;
  final String stateTopic;
  final String availabilityTopic;

  DeviceConfig({
    required this.deviceId,
    required this.deviceName,
    required this.stateTopic,
    required this.availabilityTopic,
  });

  factory DeviceConfig.fromJson(Map<String, dynamic> json) {
    return DeviceConfig(
      deviceId: json['deviceId'],
      deviceName: json['deviceName'],
      stateTopic: json['stateTopic'],
      availabilityTopic: json['availabilityTopic'],
    );
  }
}

class CredentialStatus {
  final bool hasCredentials;
  final bool isActive;
  final String? mqttUsername;
  final List<String>? allowedDevices;
  final DateTime? lastUsedAt;
  final DateTime? createdAt;

  CredentialStatus({
    required this.hasCredentials,
    required this.isActive,
    this.mqttUsername,
    this.allowedDevices,
    this.lastUsedAt,
    this.createdAt,
  });

  factory CredentialStatus.fromJson(Map<String, dynamic> json) {
    return CredentialStatus(
      hasCredentials: json['hasCredentials'] ?? false,
      isActive: json['isActive'] ?? false,
      mqttUsername: json['mqttUsername'],
      allowedDevices: json['allowedDevices'] != null
          ? List<String>.from(json['allowedDevices'])
          : null,
      lastUsedAt: json['lastUsedAt'] != null
          ? DateTime.parse(json['lastUsedAt'])
          : null,
      createdAt: json['createdAt'] != null
          ? DateTime.parse(json['createdAt'])
          : null,
    );
  }
}
```

### React Native Example

```typescript
const API_BASE_URL = 'https://your-server.com/api/mqtt-auth';

interface MqttConfig {
  broker: string;
  port: number;
  username: string;
  password: string;
  ssl: boolean;
  discoveryPrefix: string;
  stateTopicPrefix: string;
  devices: DeviceConfig[];
}

interface DeviceConfig {
  deviceId: string;
  deviceName: string;
  stateTopic: string;
  availabilityTopic: string;
}

interface CredentialStatus {
  hasCredentials: boolean;
  isActive: boolean;
  mqttUsername?: string;
  allowedDevices?: string[];
  lastUsedAt?: string;
  createdAt?: string;
}

// Get MQTT configuration
async function getMqttConfig(userId: string): Promise<MqttConfig | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/config/${userId}`);
    const json = await response.json();

    if (json.success) {
      return json.data as MqttConfig;
    }
    return null;
  } catch (error) {
    console.error('Failed to get MQTT config:', error);
    return null;
  }
}

// Regenerate password
async function regeneratePassword(userId: string): Promise<MqttConfig | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/regenerate/${userId}`, {
      method: 'POST',
    });
    const json = await response.json();

    if (json.success) {
      return json.data as MqttConfig;
    }
    return null;
  } catch (error) {
    console.error('Failed to regenerate password:', error);
    return null;
  }
}

// Get credential status
async function getCredentialStatus(userId: string): Promise<CredentialStatus | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/status/${userId}`);
    const json = await response.json();

    if (json.success) {
      return json.data as CredentialStatus;
    }
    return null;
  } catch (error) {
    console.error('Failed to get credential status:', error);
    return null;
  }
}

// Revoke access
async function revokeAccess(userId: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/revoke/${userId}`, {
      method: 'DELETE',
    });
    const json = await response.json();
    return json.success === true;
  } catch (error) {
    console.error('Failed to revoke access:', error);
    return false;
  }
}
```

---

## UI/UX Recommendations

### Home Assistant Setup Screen

```
┌─────────────────────────────────────────┐
│         Home Assistant Setup            │
├─────────────────────────────────────────┤
│                                         │
│  Connect your inverter devices to       │
│  Home Assistant for monitoring and      │
│  control.                               │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ MQTT Broker                     │    │
│  │ giabao-inverter.com             │    │
│  │                          [Copy] │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Port                            │    │
│  │ 1883                            │    │
│  │                          [Copy] │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Username                        │    │
│  │ ha_6jgAGTN7                     │    │
│  │                          [Copy] │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Password                        │    │
│  │ ••••••••••••••••         [Show] │    │
│  │                          [Copy] │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │      Regenerate Password        │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │    View Setup Instructions      │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Your Devices:                          │
│  • GTIControl402 (My Inverter)          │
│  • GTIControl403 (Garage Inverter)      │
│                                         │
└─────────────────────────────────────────┘
```

### Setup Instructions Modal

```
┌─────────────────────────────────────────┐
│      How to Connect Home Assistant      │
├─────────────────────────────────────────┤
│                                         │
│  1. Open Home Assistant                 │
│                                         │
│  2. Go to Settings → Devices & Services │
│                                         │
│  3. Click "Add Integration"             │
│                                         │
│  4. Search for "MQTT"                   │
│                                         │
│  5. Enter the credentials shown above   │
│                                         │
│  6. Click "Submit"                      │
│                                         │
│  7. Your devices will appear            │
│     automatically in Home Assistant!    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │            Got it!              │    │
│  └─────────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

---

## Error Handling

| HTTP Status | Meaning | Action |
|-------------|---------|--------|
| 200 | Success | Process response |
| 400 | Bad request | Check userId format |
| 404 | User not found | Verify userId |
| 500 | Server error | Retry later |

**Error Response Format:**
```json
{
  "success": false,
  "error": "Error message here"
}
```

---

## Security Considerations

1. **HTTPS**: Always use HTTPS in production
2. **Authentication**: Add your app's auth token to requests
3. **Rate Limiting**: Don't call regenerate too frequently
4. **Password Display**: Hide password by default, show on tap

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-01-15 | Initial release |
