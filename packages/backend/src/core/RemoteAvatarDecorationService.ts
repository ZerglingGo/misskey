/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// bscone: fetch a remote user's avatar decorations from their home instance's REST API.
// ActivityPub has no representation for decorations, so (like CherryPick) we ask the
// Misskey-family home instance directly and keep the result in the user's jsonb column.
// CherryPick's extra transform fields (scale, opacity) are kept as well so its users look the same here.

import { isDeepStrictEqual } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import type { InstancesRepository } from '@/models/_.js';
import type { MiRemoteUser, MiUser } from '@/models/User.js';
import type { Config } from '@/config.js';
import type Logger from '@/logger.js';
import type { Packed } from '@/misc/json-schema.js';
import type { IActor } from '@/core/activitypub/type.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { checkHttps } from '@/misc/check-https.js';
import { appendQuery, query } from '@/misc/prelude/url.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { UtilityService } from '@/core/UtilityService.js';

// nodeinfo software names (lowercased by FetchInstanceMetadataService) whose /api/users/show returns avatarDecorations
const SUPPORTED_SOFTWARE = ['misskey', 'cherrypick', 'sharkey'];
// same limits as the avatarDecorations paramDef of i/update (scale / opacity ranges follow CherryPick's i/update)
const MAX_DECORATIONS = 16;
const MAX_URL_LENGTH = 1024;

export type RemoteAvatarDecoration = {
	id: string;
	angle: number;
	flipH: boolean;
	offsetX: number;
	offsetY: number;
	// CherryPick extensions (Misskey itself has neither); 1 = neutral
	scale: number;
	opacity: number;
	url: string;
};

function clamp(value: unknown, min: number, max: number, fallback = 0): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

/**
 * Validates the `avatarDecorations` array of a remote users/show response.
 * Returns null when the value is not an array (unknown shape => leave the user untouched).
 */
export function normalizeRemoteAvatarDecorations(raw: unknown): RemoteAvatarDecoration[] | null {
	if (!Array.isArray(raw)) return null;

	const decorations: RemoteAvatarDecoration[] = [];
	for (const item of raw) {
		if (decorations.length >= MAX_DECORATIONS) break;
		if (item == null || typeof item !== 'object') continue;
		const { id, url, angle, flipH, offsetX, offsetY, scale, opacity } = item as Record<string, unknown>;
		if (typeof id !== 'string' || id.length === 0 || id.length > 128) continue;
		if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH || !checkHttps(url) || !URL.canParse(url)) continue;
		decorations.push({
			id,
			angle: clamp(angle, -0.5, 0.5),
			flipH: flipH === true,
			offsetX: clamp(offsetX, -0.25, 0.25),
			offsetY: clamp(offsetY, -0.25, 0.25),
			scale: clamp(scale, 0.5, 1.5, 1),
			opacity: clamp(opacity, 0.1, 1, 1),
			url,
		});
	}
	return decorations;
}

@Injectable()
export class RemoteAvatarDecorationService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.instancesRepository)
		private instancesRepository: InstancesRepository,

		private httpRequestService: HttpRequestService,
		private utilityService: UtilityService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('remote-avatar-decoration');
	}

	/**
	 * Decides whether `host` is worth asking. Known software must be Misskey-family;
	 * unknown software (no instance row / metadata not fetched yet) is accepted only when
	 * the actor object carries Misskey's `isCat` marker, so Mastodon & co. are never polled.
	 */
	@bindThis
	private async shouldFetch(host: string, actor?: IActor): Promise<boolean> {
		if (!this.utilityService.isFederationAllowedHost(host)) return false;

		const instance = await this.instancesRepository.findOneBy({ host });
		if (instance != null && instance.suspensionState !== 'none') return false;

		const softwareName = instance?.softwareName;
		if (softwareName != null && softwareName !== '?') {
			return SUPPORTED_SOFTWARE.includes(softwareName);
		}

		return actor != null && 'isCat' in actor;
	}

	/**
	 * Fetches the user's current avatar decorations from their home instance.
	 * Never throws: returns `{}` when nothing should change (unsupported host, request failed,
	 * unexpected response, or the decorations are already up to date).
	 */
	@bindThis
	public async fetchUpdates(user: MiRemoteUser, actor?: IActor): Promise<Partial<Pick<MiUser, 'avatarDecorations'>>> {
		const host = user.host;
		try {
			if (!(await this.shouldFetch(host, actor))) return {};

			const res = await this.httpRequestService.send(`https://${host}/api/users/show`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: user.username }),
				timeout: 5000,
				size: 1024 * 1024,
			});
			const body = await res.json() as { avatarDecorations?: unknown } | null;
			const decorations = normalizeRemoteAvatarDecorations(body?.avatarDecorations);
			if (decorations == null) return {};

			// jsonb reorders object keys, so compare structurally rather than by JSON text
			if (isDeepStrictEqual(decorations, user.avatarDecorations)) return {};
			return { avatarDecorations: decorations };
		} catch (err) {
			this.logger.warn(`failed to fetch avatar decorations of @${user.username}@${host}: ${err}`);
			return {};
		}
	}

	/** Media-proxied url for a remote decoration image (same rule as a remote user's avatarUrl). */
	@bindThis
	public getPublicUrl(rawUrl: string): string {
		return appendQuery(
			`${this.config.mediaProxy}/avatar.webp`,
			query({ url: rawUrl, avatar: '1' }),
		);
	}

	/** Packs the decorations stored on a remote user; entries without a url are ignored. */
	@bindThis
	public pack(user: MiUser): Packed<'UserLite'>['avatarDecorations'] {
		return user.avatarDecorations.flatMap(ud => ud.url == null ? [] : [{
			id: ud.id,
			angle: ud.angle || undefined,
			flipH: ud.flipH || undefined,
			offsetX: ud.offsetX || undefined,
			offsetY: ud.offsetY || undefined,
			scale: ud.scale || undefined,
			opacity: ud.opacity || undefined,
			url: this.getPublicUrl(ud.url),
		}]);
	}
}
