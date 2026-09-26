import React from 'react';
import type { HealthIssue } from '../services/api';
import { ISSUE_META } from './health-meta';

export const IssueBadge: React.FC<{ issue: HealthIssue }> = ({ issue }) => (
  <span className={`health-badge tone-${ISSUE_META[issue].tone}`} title={ISSUE_META[issue].hint}>
    {ISSUE_META[issue].label}
  </span>
);
