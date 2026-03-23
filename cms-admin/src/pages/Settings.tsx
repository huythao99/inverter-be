import React, { useEffect, useState } from 'react';
import { getSettings, getMqttConfig } from '../services/api';
import { Server, Shield, Users } from 'lucide-react';

interface SettingsData {
  mqtt: {
    brokerHost: string;
    brokerPort: number;
    haStatePrefix: string;
  };
  cms: {
    jwtExpiresIn: string;
  };
}

interface MqttConfig {
  broker: {
    host: string;
    port: number;
  };
  topics: {
    statePrefix: string;
    discoveryPrefix: string;
  };
  superusers: string[];
  totalCredentials: number;
}

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [mqttConfig, setMqttConfig] = useState<MqttConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [settingsRes, mqttRes] = await Promise.all([
          getSettings(),
          getMqttConfig(),
        ]);
        setSettings(settingsRes.data);
        setMqttConfig(mqttRes.data);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load settings');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  if (isLoading) {
    return <div className="loading">Loading settings...</div>;
  }

  if (error) {
    return <div className="error-state">{error}</div>;
  }

  return (
    <div className="page settings-page">
      <header className="page-header">
        <h1>Settings</h1>
        <p>System configuration and MQTT settings</p>
      </header>

      <div className="settings-grid">
        {/* MQTT Broker Settings */}
        <div className="settings-card">
          <div className="card-header">
            <Server size={24} />
            <h2>MQTT Broker</h2>
          </div>
          <div className="card-content">
            <div className="setting-item">
              <label>Broker Host</label>
              <span className="setting-value">{mqttConfig?.broker.host}</span>
            </div>
            <div className="setting-item">
              <label>Broker Port</label>
              <span className="setting-value">{mqttConfig?.broker.port}</span>
            </div>
            <div className="setting-item">
              <label>State Topic Prefix</label>
              <span className="setting-value monospace">{mqttConfig?.topics.statePrefix}</span>
            </div>
            <div className="setting-item">
              <label>Discovery Prefix</label>
              <span className="setting-value monospace">{mqttConfig?.topics.discoveryPrefix}</span>
            </div>
          </div>
        </div>

        {/* Credentials Stats */}
        <div className="settings-card">
          <div className="card-header">
            <Users size={24} />
            <h2>Credentials</h2>
          </div>
          <div className="card-content">
            <div className="setting-item">
              <label>Active Credentials</label>
              <span className="setting-value highlight">{mqttConfig?.totalCredentials}</span>
            </div>
            <div className="setting-item">
              <label>JWT Expiration</label>
              <span className="setting-value">{settings?.cms.jwtExpiresIn}</span>
            </div>
          </div>
        </div>

        {/* Superusers */}
        <div className="settings-card">
          <div className="card-header">
            <Shield size={24} />
            <h2>Superusers</h2>
          </div>
          <div className="card-content">
            <p className="card-description">
              Superusers have full access to all MQTT topics without ACL restrictions.
            </p>
            <ul className="superuser-list">
              {mqttConfig?.superusers.map((user) => (
                <li key={user} className="monospace">
                  {user}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Environment Info */}
        <div className="settings-card">
          <div className="card-header">
            <Server size={24} />
            <h2>Environment</h2>
          </div>
          <div className="card-content">
            <div className="setting-item">
              <label>API Base URL</label>
              <span className="setting-value monospace">
                {import.meta.env.VITE_API_URL || 'http://localhost:3000'}
              </span>
            </div>
            <div className="setting-item">
              <label>Environment</label>
              <span className="setting-value">
                {import.meta.env.MODE}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
