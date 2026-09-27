/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// bscone: tests for the fork-only remote avatar decoration fetcher

process.env.NODE_ENV = 'test';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { RemoteAvatarDecorationService, normalizeRemoteAvatarDecorations } from '@/core/RemoteAvatarDecorationService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { MiMeta } from '@/models/Meta.js';
import type { MiRemoteUser, MiUser } from '@/models/User.js';
import type { IActor } from '@/core/activitypub/type.js';

const remoteHost = 'remote.example.com';
const decorationUrl = 'https://remote.example.com/files/deco.png';

function createRemoteUser(avatarDecorations: MiUser['avatarDecorations'] = []): MiRemoteUser {
	return {
		id: 'a1b2c3d4e5f6g7h8',
		username: 'alice',
		host: remoteHost,
		uri: `https://${remoteHost}/users/a1b2c3d4e5f6g7h8`,
		avatarDecorations,
	} as MiRemoteUser;
}

function jsonResponse(body: unknown) {
	return { json: () => Promise.resolve(body) };
}

// Misskey-family actors always carry `isCat`; Mastodon ones do not
const misskeyActor = { isCat: false } as unknown as IActor;
const mastodonActor = {} as IActor;

describe('RemoteAvatarDecorationService', () => {
	describe('normalizeRemoteAvatarDecorations', () => {
		test('returns null for anything but an array', () => {
			expect(normalizeRemoteAvatarDecorations(undefined)).toBeNull();
			expect(normalizeRemoteAvatarDecorations(null)).toBeNull();
			expect(normalizeRemoteAvatarDecorations('x')).toBeNull();
			expect(normalizeRemoteAvatarDecorations({ id: 'x' })).toBeNull();
		});

		test('drops invalid entries, clamps transforms (incl. CherryPick scale / opacity) and strips unknown fields', () => {
			expect(normalizeRemoteAvatarDecorations([
				{ id: 'ok', url: decorationUrl, angle: 0.75, flipH: true, offsetX: -1, offsetY: 0.1, scale: 2, opacity: 0.5, foo: 'bar' },
				{ id: 'defaults', url: decorationUrl },
				{ id: 'nan', url: decorationUrl, angle: 'x', flipH: 'yes', offsetX: Number.NaN, offsetY: null, scale: 'big', opacity: Number.POSITIVE_INFINITY },
				{ url: decorationUrl },
				{ id: 'no-url' },
				{ id: 'ftp', url: 'ftp://remote.example.com/deco.png' },
				{ id: 'garbage-url', url: 'https://' },
				{ id: 'too-long', url: `https://remote.example.com/${'a'.repeat(1100)}` },
				null,
				'string',
			])).toStrictEqual([
				{ id: 'ok', url: decorationUrl, angle: 0.5, flipH: true, offsetX: -0.25, offsetY: 0.1, scale: 1.5, opacity: 0.5 },
				{ id: 'defaults', url: decorationUrl, angle: 0, flipH: false, offsetX: 0, offsetY: 0, scale: 1, opacity: 1 },
				{ id: 'nan', url: decorationUrl, angle: 0, flipH: false, offsetX: 0, offsetY: 0, scale: 1, opacity: 1 },
			]);
		});

		test('keeps at most 16 decorations', () => {
			const many = [...Array(20)].map((_, i) => ({ id: `d${i}`, url: decorationUrl }));
			expect(normalizeRemoteAvatarDecorations(many)).toHaveLength(16);
		});
	});

	describe('service', () => {
		let app: TestingModule;
		let service: RemoteAvatarDecorationService;
		let httpRequestService: Mocked<HttpRequestService>;
		let instancesRepository: { findOneBy: ReturnType<typeof vi.fn> };
		let meta: MiMeta;
		let config: Config;

		beforeEach(async () => {
			instancesRepository = { findOneBy: vi.fn().mockResolvedValue(null) };
			meta = { federation: 'all', federationHosts: [], blockedHosts: [] } as unknown as MiMeta;
			config = { host: 'local.example.com', mediaProxy: 'https://local.example.com/proxy' } as unknown as Config;

			// no GlobalModule: the service only needs config, meta, the instances repository and an HTTP client
			app = await Test
				.createTestingModule({
					providers: [
						RemoteAvatarDecorationService,
						LoggerService,
						UtilityService,
						{ provide: DI.config, useValue: config },
						{ provide: DI.meta, useValue: meta },
						{ provide: DI.instancesRepository, useValue: instancesRepository },
						{ provide: HttpRequestService, useValue: { send: vi.fn() } },
					],
				})
				.compile();

			service = app.get<RemoteAvatarDecorationService>(RemoteAvatarDecorationService);
			httpRequestService = app.get<HttpRequestService>(HttpRequestService) as Mocked<HttpRequestService>;
		});

		afterEach(async () => {
			await app.close();
			vi.resetAllMocks();
			vi.clearAllMocks();
		});

		describe('fetchUpdates', () => {
			test('asks a known Misskey-family instance and stores the normalized decorations', async () => {
				instancesRepository.findOneBy.mockResolvedValue({ host: remoteHost, softwareName: 'cherrypick', suspensionState: 'none' });
				httpRequestService.send.mockResolvedValue(jsonResponse({
					id: 'x',
					avatarDecorations: [{ id: 'd1', url: decorationUrl, angle: 0.1, flipH: true, offsetX: 0, offsetY: -0.1, scale: 1.5, opacity: 0.8 }],
				}) as any);

				const updates = await service.fetchUpdates(createRemoteUser(), mastodonActor);

				expect(httpRequestService.send).toHaveBeenCalledTimes(1);
				expect(httpRequestService.send).toHaveBeenCalledWith(`https://${remoteHost}/api/users/show`, expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ username: 'alice' }),
				}));
				expect(updates).toStrictEqual({
					avatarDecorations: [{ id: 'd1', url: decorationUrl, angle: 0.1, flipH: true, offsetX: 0, offsetY: -0.1, scale: 1.5, opacity: 0.8 }],
				});
			});

			test('does not ask instances running other software', async () => {
				instancesRepository.findOneBy.mockResolvedValue({ host: remoteHost, softwareName: 'mastodon', suspensionState: 'none' });

				expect(await service.fetchUpdates(createRemoteUser(), misskeyActor)).toStrictEqual({});
				expect(httpRequestService.send).not.toHaveBeenCalled();
			});

			test('does not ask suspended instances', async () => {
				instancesRepository.findOneBy.mockResolvedValue({ host: remoteHost, softwareName: 'misskey', suspensionState: 'goneSuspended' });

				expect(await service.fetchUpdates(createRemoteUser(), misskeyActor)).toStrictEqual({});
				expect(httpRequestService.send).not.toHaveBeenCalled();
			});

			test('does not ask blocked hosts', async () => {
				meta.blockedHosts = [remoteHost];
				instancesRepository.findOneBy.mockResolvedValue({ host: remoteHost, softwareName: 'misskey', suspensionState: 'none' });

				expect(await service.fetchUpdates(createRemoteUser(), misskeyActor)).toStrictEqual({});
				expect(httpRequestService.send).not.toHaveBeenCalled();
			});

			test('falls back to the isCat actor marker when the software is unknown', async () => {
				instancesRepository.findOneBy.mockResolvedValue(null);
				httpRequestService.send.mockResolvedValue(jsonResponse({ avatarDecorations: [] }) as any);

				expect(await service.fetchUpdates(createRemoteUser(), mastodonActor)).toStrictEqual({});
				expect(httpRequestService.send).not.toHaveBeenCalled();

				instancesRepository.findOneBy.mockResolvedValue({ host: remoteHost, softwareName: '?', suspensionState: 'none' });
				expect(await service.fetchUpdates(createRemoteUser(), misskeyActor)).toStrictEqual({});
				expect(httpRequestService.send).toHaveBeenCalledTimes(1);
			});

			test('clears decorations the remote user removed', async () => {
				instancesRepository.findOneBy.mockResolvedValue({ host: remoteHost, softwareName: 'misskey', suspensionState: 'none' });
				httpRequestService.send.mockResolvedValue(jsonResponse({ avatarDecorations: [] }) as any);
				const user = createRemoteUser([{ id: 'd1', url: decorationUrl, angle: 0, flipH: false, offsetX: 0, offsetY: 0 }]);

				expect(await service.fetchUpdates(user, misskeyActor)).toStrictEqual({ avatarDecorations: [] });
			});

			test('reports no change when the stored decorations already match (regardless of key order)', async () => {
				instancesRepository.findOneBy.mockResolvedValue({ host: remoteHost, softwareName: 'misskey', suspensionState: 'none' });
				httpRequestService.send.mockResolvedValue(jsonResponse({
					avatarDecorations: [{ id: 'd1', url: decorationUrl, angle: 0.2, flipH: false, offsetX: 0, offsetY: 0 }],
				}) as any);
				// jsonb hands keys back in a different order than we wrote them
				const user = createRemoteUser([{ url: decorationUrl, opacity: 1, offsetY: 0, offsetX: 0, scale: 1, flipH: false, angle: 0.2, id: 'd1' }]);

				expect(await service.fetchUpdates(user, misskeyActor)).toStrictEqual({});
			});

			test('never throws and leaves the user untouched on failures', async () => {
				instancesRepository.findOneBy.mockResolvedValue({ host: remoteHost, softwareName: 'misskey', suspensionState: 'none' });
				const user = createRemoteUser([{ id: 'd1', url: decorationUrl, angle: 0, flipH: false, offsetX: 0, offsetY: 0 }]);

				httpRequestService.send.mockRejectedValue(new Error('timeout'));
				expect(await service.fetchUpdates(user, misskeyActor)).toStrictEqual({});

				httpRequestService.send.mockResolvedValue({ json: () => Promise.reject(new Error('not json')) } as any);
				expect(await service.fetchUpdates(user, misskeyActor)).toStrictEqual({});

				httpRequestService.send.mockResolvedValue(jsonResponse({ id: 'x' }) as any);
				expect(await service.fetchUpdates(user, misskeyActor)).toStrictEqual({});

				httpRequestService.send.mockResolvedValue(jsonResponse(null) as any);
				expect(await service.fetchUpdates(user, misskeyActor)).toStrictEqual({});
			});
		});

		describe('getPublicUrl / pack', () => {
			test('routes the remote image through the media proxy in avatar mode', () => {
				const url = new URL(service.getPublicUrl(decorationUrl));

				expect(url.href.startsWith(`${config.mediaProxy}/avatar.webp?`)).toBe(true);
				expect(url.searchParams.get('url')).toBe(decorationUrl);
				expect(url.searchParams.get('avatar')).toBe('1');
			});

			test('packs stored decorations like the local ones and skips entries without a url', () => {
				const user = createRemoteUser([
					{ id: 'd1', url: decorationUrl, angle: 0, flipH: false, offsetX: 0.1, offsetY: 0 },
					{ id: 'local-only', angle: 0.1, flipH: true, offsetX: 0, offsetY: 0 },
					{ id: 'd2', url: decorationUrl, angle: 0, flipH: false, offsetX: 0, offsetY: 0, scale: 1.25, opacity: 0.5 },
				]);

				expect(service.pack(user)).toStrictEqual([{
					id: 'd1',
					angle: undefined,
					flipH: undefined,
					offsetX: 0.1,
					offsetY: undefined,
					scale: undefined,
					opacity: undefined,
					url: service.getPublicUrl(decorationUrl),
				}, {
					id: 'd2',
					angle: undefined,
					flipH: undefined,
					offsetX: undefined,
					offsetY: undefined,
					scale: 1.25,
					opacity: 0.5,
					url: service.getPublicUrl(decorationUrl),
				}]);
			});
		});
	});
});
