import { DeliveryWorkflowConsequenceWorker } from './delivery-workflow-consequence.worker';

describe('DeliveryWorkflowConsequenceWorker', () => {
  it('coalesces concurrent recovery cycles into one bounded reconciliation', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reconcilePendingDeliveryWorkflowConsequences = jest.fn().mockReturnValue(pending);
    const worker = new DeliveryWorkflowConsequenceWorker({
      reconcilePendingDeliveryWorkflowConsequences,
    } as never);

    const first = worker.runOnce();
    const second = worker.runOnce();
    expect(reconcilePendingDeliveryWorkflowConsequences).toHaveBeenCalledTimes(1);
    expect(reconcilePendingDeliveryWorkflowConsequences).toHaveBeenCalledWith(25);

    release();
    await Promise.all([first, second]);
  });

  it('starts recovery automatically outside tests and stops cleanly', async () => {
    jest.useFakeTimers();
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const reconcilePendingDeliveryWorkflowConsequences = jest.fn().mockResolvedValue(1);
    const worker = new DeliveryWorkflowConsequenceWorker({
      reconcilePendingDeliveryWorkflowConsequences,
    } as never);

    try {
      worker.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      expect(reconcilePendingDeliveryWorkflowConsequences).toHaveBeenCalledWith(25);
      await worker.onApplicationShutdown();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      jest.useRealTimers();
    }
  });
});
