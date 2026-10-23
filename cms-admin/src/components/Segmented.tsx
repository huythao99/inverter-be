import React from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ComponentType<{ size?: number }>;
  disabled?: boolean;
  title?: string;
}

/** Pill switch (iOS-style segmented control). */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={value === o.value}
            className={`segmented-item ${value === o.value ? 'active' : ''}`}
            disabled={o.disabled}
            title={o.title}
            onClick={() => !o.disabled && onChange(o.value)}
          >
            {Icon && <Icon size={16} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;
