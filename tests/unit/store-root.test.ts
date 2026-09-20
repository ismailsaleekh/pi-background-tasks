import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveBgRuntimeRoot } from '../../src/core/store-root.js';

void describe('resolveBgRuntimeRoot', () => {
  void it('returns undefined when unset, empty, or whitespace-only', () => {
    assert.equal(resolveBgRuntimeRoot({}), undefined);
    assert.equal(resolveBgRuntimeRoot({ PI_BG_RUNTIME_ROOT: '' }), undefined);
    assert.equal(resolveBgRuntimeRoot({ PI_BG_RUNTIME_ROOT: '   ' }), undefined);
  });

  void it('expands ~ and ~/x via the home directory', () => {
    assert.equal(resolveBgRuntimeRoot({ PI_BG_RUNTIME_ROOT: '~' }), homedir());
    assert.equal(resolveBgRuntimeRoot({ PI_BG_RUNTIME_ROOT: '~/.pi' }), join(homedir(), '.pi'));
  });

  void it('trims and keeps absolute paths', () => {
    const root = process.platform === 'win32' ? 'C:\\pi\\store' : '/var/lib/pi-store';
    assert.equal(resolveBgRuntimeRoot({ PI_BG_RUNTIME_ROOT: `  ${root} ` }), root);
  });

  void it('rejects relative values loudly', () => {
    assert.throws(
      () => resolveBgRuntimeRoot({ PI_BG_RUNTIME_ROOT: 'relative/path' }),
      /PI_BG_RUNTIME_ROOT must be an absolute path or start with '~'/,
    );
    assert.throws(
      () => resolveBgRuntimeRoot({ PI_BG_RUNTIME_ROOT: 'x/~/y' }),
      /PI_BG_RUNTIME_ROOT must be an absolute path or start with '~'/,
    );
  });
});
