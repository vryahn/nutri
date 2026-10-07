import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatePicker } from './datePicker.js';

afterEach(() => vi.unstubAllGlobals());

describe('openDatePicker', () => {
  it('calls showPicker on the input during an active click', () => {
    vi.stubGlobal('navigator', { userActivation: { isActive: true } });
    let receiver;
    const input = { showPicker: vi.fn(function () { receiver = this; }) };

    openDatePicker({ currentTarget: input });

    expect(input.showPicker).toHaveBeenCalledOnce();
    expect(receiver).toBe(input);
  });

  it('skips showPicker when the browser reports no user activation', () => {
    vi.stubGlobal('navigator', { userActivation: { isActive: false } });
    const input = { showPicker: vi.fn() };

    openDatePicker({ currentTarget: input });

    expect(input.showPicker).not.toHaveBeenCalled();
  });

  it('leaves native behavior alone when showPicker is unavailable', () => {
    const input = {};

    expect(() => openDatePicker({ currentTarget: input })).not.toThrow();
  });

  it('focuses the input when showPicker rejects with NotAllowedError', () => {
    const input = {
      showPicker: vi.fn(() => { throw new DOMException('Gesture required', 'NotAllowedError'); }),
      focus: vi.fn(),
    };

    expect(() => openDatePicker({ currentTarget: input })).not.toThrow();
    expect(input.focus).toHaveBeenCalledOnce();
  });

  it('rethrows unexpected errors', () => {
    const error = new Error('unexpected');
    const input = { showPicker: vi.fn(() => { throw error; }) };

    expect(() => openDatePicker({ currentTarget: input })).toThrow(error);
  });
});
