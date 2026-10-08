/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AsyncLocalStorage } from 'node:async_hooks';

// bscone: marks deliveries enqueued from bulk deletion jobs (account truncation, auto delete)
// so that QueueService gives them a lower priority than interactive deliveries.
const bulkDeliveryStorage = new AsyncLocalStorage<true>();

export function runAsBulkDelivery<T>(fn: () => Promise<T>): Promise<T> {
	return bulkDeliveryStorage.run(true, fn);
}

export function isBulkDelivery(): boolean {
	return bulkDeliveryStorage.getStore() === true;
}
