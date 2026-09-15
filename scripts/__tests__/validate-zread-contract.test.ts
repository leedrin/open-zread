import { describe, expect, test } from 'bun:test';
import {
  parseCancelAfterMs,
  preferNativeZreadExecutable,
} from '../validate-zread-contract.js';

describe('validate:zread-contract arguments', () => {
  test('accepts a positive safe integer cancellation delay', () => {
    expect(parseCancelAfterMs('1000')).toBe(1000);
  });

  test.each(['abc', '1ms', '0', '-1', '9007199254740992'])(
    'rejects invalid cancellation delay %s',
    (value) => {
      expect(() => parseCancelAfterMs(value)).toThrow('--cancel-after-ms');
    },
  );

  test('prefers the verified native Zread executable over its Windows command wrapper', () => {
    const wrapper = 'C:\\Users\\A\\AppData\\Roaming\\npm\\zread.cmd';
    const expected = 'C:\\Users\\A\\AppData\\Roaming\\npm\\node_modules\\zread_cli\\node_modules\\@zread\\cli-win32-x64\\zread.exe';

    expect(preferNativeZreadExecutable(wrapper, 'win32', (path) => path === expected))
      .toBe(expected);
  });

  test('accepts a verified native Zread executable directly on Windows', () => {
    const executable = 'F:\\tools\\zread.exe';
    expect(preferNativeZreadExecutable(executable, 'win32', (path) => path === executable))
      .toBe(executable);
  });

  test.each(['zread.cmd', 'zread.ps1', 'zread', 'F:\\tools\\missing.exe'])(
    'rejects an unresolved or non-native Windows command %s',
    (path) => {
      expect(() => preferNativeZreadExecutable(path, 'win32', () => false))
        .toThrow('zread.exe');
    },
  );

  test('keeps a discovered executable when no verified native replacement exists', () => {
    expect(preferNativeZreadExecutable('/usr/local/bin/zread', 'linux', () => false))
      .toBe('/usr/local/bin/zread');
  });
});
