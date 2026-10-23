import React from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BatteryCharging,
  CircuitBoard,
  Cpu,
  FlaskConical,
  HardDriveUpload,
  Rocket,
  Shuffle,
} from 'lucide-react';
import Segmented from './Segmented';

type DeviceType = 'inverter' | 'charger' | 'hybrid';

const DEVICE_ROUTES: Record<DeviceType, string> = {
  inverter: '/devices',
  charger: '/chargers',
  hybrid: '/hybrids',
};

/**
 * Header of the device list pages: title + switch Inverter / Charger / Hybrid
 * (each type keeps its own route: /devices, /chargers, /hybrids).
 */
export const DeviceTypeSwitch: React.FC<{ subtitle?: React.ReactNode }> = ({ subtitle }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const current = (Object.keys(DEVICE_ROUTES) as DeviceType[]).find((k) =>
    pathname.startsWith(DEVICE_ROUTES[k]),
  ) ?? 'inverter';
  return (
    <header className="page-header section-header">
      <div>
        <h1>Thiết bị</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <Segmented<DeviceType>
        ariaLabel="Loại thiết bị"
        value={current}
        onChange={(v) => navigate(DEVICE_ROUTES[v])}
        options={[
          { value: 'inverter', label: 'Inverter', icon: Cpu },
          { value: 'charger', label: 'Charger', icon: BatteryCharging },
          { value: 'hybrid', label: 'Hybrid', icon: Shuffle },
        ]}
      />
    </header>
  );
};

type FirmwarePage = 'esp' | 'stm' | 'beta' | 'rollout';

const FIRMWARE_ROUTES: Record<FirmwarePage, string> = {
  esp: '/esp-firmware',
  stm: '/stm-firmware',
  beta: '/beta-firmware',
  rollout: '/rollout',
};

/**
 * Sub-navigation of the Firmware section. The chosen device type (?product=)
 * follows you between ESP32 and STM32.
 */
export const FirmwareTabs: React.FC = () => {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const current = (Object.keys(FIRMWARE_ROUTES) as FirmwarePage[]).find((k) =>
    pathname.startsWith(FIRMWARE_ROUTES[k]),
  ) ?? 'esp';
  const product = params.get('product');
  return (
    <div className="section-tabs">
      <span className="section-tabs-title">Firmware</span>
      <Segmented<FirmwarePage>
        ariaLabel="Firmware"
        value={current}
        onChange={(v) =>
          navigate(
            FIRMWARE_ROUTES[v] + ((v === 'esp' || v === 'stm') && product ? `?product=${product}` : ''),
          )
        }
        options={[
          { value: 'esp', label: 'ESP32', icon: HardDriveUpload },
          { value: 'stm', label: 'STM32', icon: CircuitBoard },
          { value: 'beta', label: 'Beta list', icon: FlaskConical },
          { value: 'rollout', label: 'Rollout', icon: Rocket, title: 'Chỉ inverter' },
        ]}
      />
    </div>
  );
};
