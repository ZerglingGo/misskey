/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { format } from 'node:util';

type LoggerFn = (...args: unknown[]) => void;

const createLogWriter = (stream: NodeJS.WritableStream, scope?: string): LoggerFn => (...args) => {
	const label = scope ? `[${scope}] ` : '';
	stream.write(`${label}${format(...args)}\n`);
};

export interface Logger {
	info: LoggerFn;
	warn: LoggerFn;
	error: LoggerFn;
}

export const createLogger = (scope?: string): Logger => ({
	info: createLogWriter(process.stdout, scope),
	warn: createLogWriter(process.stderr, scope),
	error: createLogWriter(process.stderr, scope),
});

export const logger = createLogger('icons-subsetter');
