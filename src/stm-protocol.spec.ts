import { parseStmProtocolLog } from './services/device-health.service';

describe('STM_PROTOCOL log', () => {
  it('parses the firmware report', () => {
    expect(
      parseStmProtocolLog('mode=legacy src=auto detected=legacy setting=0'),
    ).toEqual({
      mode: 'legacy',
      detected: 'legacy',
      src: 'auto',
      setting: 'auto',
    });
    expect(
      parseStmProtocolLog('mode=new src=cms detected=legacy setting=1'),
    ).toEqual({ mode: 'new', detected: 'legacy', src: 'cms', setting: 'new' });
    expect(
      parseStmProtocolLog('mode=legacy src=cms detected=new setting=2')
        ?.setting,
    ).toBe('legacy');
  });

  it('rejects garbage', () => {
    expect(parseStmProtocolLog('')).toBeNull();
    expect(parseStmProtocolLog('mode=xyz')).toBeNull();
    expect(parseStmProtocolLog('mode=new setting=9')?.setting).toBe('auto');
  });
});
