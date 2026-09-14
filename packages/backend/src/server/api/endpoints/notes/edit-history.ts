/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteUpdateService } from '@/core/NoteUpdateService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { GetterService } from '@/server/api/GetterService.js';
import { DI } from '@/di-symbols.js';
import type { NoteRevisionsRepository } from '@/models/_.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	requireCredential: false,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: {
					type: 'string',
					optional: false, nullable: false,
					format: 'id',
				},
				version: {
					type: 'number',
					optional: false, nullable: false,
				},
				createdAt: {
					type: 'string',
					optional: false, nullable: false,
					format: 'date-time',
				},
				editorId: {
					type: 'string',
					optional: false, nullable: false,
					format: 'id',
				},
				editor: {
					type: 'object',
					optional: true, nullable: false,
					ref: 'UserLite',
				},
				payload: {
					type: 'object',
					optional: false, nullable: false,
				},
			},
		},
	},

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: 'a774b54f-1d10-4ed8-9afe-3f27e6d1f084',
		},
		accessDenied: {
			message: 'You cannot view the edit history of this note.',
			code: 'ACCESS_DENIED',
			id: 'b885c0e1-2f45-4c8a-9d7e-f3a7e8d9c1b0',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: ['noteId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.noteRevisionsRepository)
		private noteRevisionsRepository: NoteRevisionsRepository,

		private getterService: GetterService,
		private noteUpdateService: NoteUpdateService,
		private noteEntityService: NoteEntityService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.getterService.getNote(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});

			// Check if the requester can view the note
			const canView = await this.noteEntityService.isVisibleForMe(note, me?.id ?? null);
			if (!canView) {
				throw new ApiError(meta.errors.accessDenied);
			}

			// Build query with pagination
			const query = this.noteRevisionsRepository.createQueryBuilder('revision')
				.where('revision.noteId = :noteId', { noteId: note.id })
				.orderBy('revision.version', 'DESC');

			if (ps.sinceId) {
				query.andWhere('revision.id > :sinceId', { sinceId: ps.sinceId });
			}

			if (ps.untilId) {
				query.andWhere('revision.id < :untilId', { untilId: ps.untilId });
			}

			query.limit(ps.limit);

			const revisions = await query.getMany();

			// bscone: pack editors (deduplicated) so the client can show who made each edit
			const editorIds = [...new Set(revisions.map(revision => revision.editorId))];
			const editors = new Map(await Promise.all(editorIds.map(async id => [id, await this.userEntityService.pack(id, me).catch(() => undefined)] as const)));

			// Return revisions with appropriate data (redact if needed)
			return revisions.map(revision => ({
				id: revision.id,
				version: revision.version,
				createdAt: revision.createdAt.toISOString(),
				editorId: revision.editorId,
				editor: editors.get(revision.editorId),
				payload: revision.payload,
			}));
		});
	}
}
