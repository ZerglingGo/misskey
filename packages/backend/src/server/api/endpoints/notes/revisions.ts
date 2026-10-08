/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteUpdateService } from '@/core/NoteUpdateService.js';
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
			id: 'e1774b54-1d10-4ed8-9afe-3f27e6d1f083',
		},

		accessDenied: {
			message: 'You cannot view the revisions of this note.',
			code: 'ACCESS_DENIED',
			id: '49c854e4-f50f-4410-b12e-b66fa5c8f1da',
		},

		contentRestrictedByUser: {
			message: 'Content restricted by user. Please sign in to view.',
			code: 'CONTENT_RESTRICTED_BY_USER',
			id: '4bffe71a-b1ed-4a85-8dcd-bb3c834e7a0d',
		},

		contentRestrictedByServer: {
			message: 'Content restricted by server settings. Please sign in to view.',
			code: 'CONTENT_RESTRICTED_BY_SERVER',
			id: '8eda4418-b53f-44b7-abf6-d07a9f174c09',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
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
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.getterService.getNote(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});

			// bscone: apply the same visitor restrictions as notes/show in addition to note visibility
			switch (await this.noteUpdateService.checkRevisionsAccess(note, me?.id ?? null)) {
				case 'restrictedByUser': throw new ApiError(meta.errors.contentRestrictedByUser);
				case 'restrictedByServer': throw new ApiError(meta.errors.contentRestrictedByServer);
				case 'invisible': throw new ApiError(meta.errors.accessDenied);
			}

			const revisions = await this.noteUpdateService.getRevisions(note.id);

			return revisions.map(revision => ({
				id: revision.id,
				version: revision.version,
				createdAt: revision.createdAt.toISOString(),
				editorId: revision.editorId,
				payload: revision.payload,
			}));
		});
	}
}
