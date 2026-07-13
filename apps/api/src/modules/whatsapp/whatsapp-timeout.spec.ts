import { ConflictException } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

type TimeoutInvoker = {
  withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T>;
};

const invokeWithTimeout = <T>(operation: Promise<T>, timeoutMs: number) =>
  (WhatsappService.prototype as unknown as TimeoutInvoker).withTimeout.call({}, operation, timeoutMs);

describe('WhatsappService timeout lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('cancels the losing timeout after a successful operation', async () => {
    await expect(invokeWithTimeout(Promise.resolve('sent'), 45_000)).resolves.toBe('sent');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with the controlled timeout and leaves no timer handle', async () => {
    const pending = invokeWithTimeout(new Promise<never>(() => undefined), 500);
    const rejection = expect(pending).rejects.toBeInstanceOf(ConflictException);

    await jest.advanceTimersByTimeAsync(500);

    await rejection;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves operation errors and cancels the timeout', async () => {
    const error = new Error('transport failed');

    await expect(invokeWithTimeout(Promise.reject(error), 45_000)).rejects.toBe(error);
    expect(jest.getTimerCount()).toBe(0);
  });
});
