/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Inject, Injectable } from '@nestjs/common';
import type { UsersRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteUpdateService } from '@/core/NoteUpdateService.js';
import { DI } from '@/di-symbols.js';
import { GetterService } from '@/server/api/GetterService.js';
import { RoleService } from '@/core/RoleService.js';
import { MAX_NOTE_TEXT_LENGTH } from '@/const.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	requireCredential: true,
	requireRolePolicy: 'canEditNote',

	prohibitMoved: true,

	kind: 'write:notes',

	limit: {
		duration: ms('1hour'),
		max: 300,
		minInterval: ms('1sec'),
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			updatedNote: {
				type: 'object',
				optional: false, nullable: false,
				ref: 'Note',
			},
		},
	},

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: '490be23f-8c1f-4796-819f-94cb4f9d1630',
		},

		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: 'fe8d7103-0ea8-4ec3-814d-f8b401dc69e9',
		},

		invalidParam: {
			message: 'Invalid param.',
			code: 'INVALID_PARAM',
			id: '3d81ceae-475f-4600-b2a8-2bc116157532',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
		text: {
			type: 'string',
			minLength: 1,
			maxLength: MAX_NOTE_TEXT_LENGTH,
			nullable: false,
		},
		cw: { type: 'string', nullable: true, maxLength: 100 },
		visibility: { type: 'string', enum: ['public', 'home', 'followers', 'specified'] },
		localOnly: { type: 'boolean' },
		fileIds: {
			type: 'array',
			uniqueItems: true,
			minItems: 0,
			maxItems: 16,
			items: { type: 'string', format: 'misskey:id' },
		},
		poll: {
			type: 'object',
			nullable: true,
			properties: {
				choices: {
					type: 'array',
					uniqueItems: true,
					minItems: 2,
					maxItems: 10,
					items: { type: 'string', minLength: 1, maxLength: 256 },
				},
				multiple: { type: 'boolean' },
				expiresAt: { type: 'integer', nullable: true },
			},
			required: ['choices'],
		},
	},
	required: ['noteId'],
	// bscone: the "at least one field is required" constraint is validated in the handler (a top-level anyOf makes the generated request type `unknown`)
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private getterService: GetterService,
		private roleService: RoleService,
		private noteEntityService: NoteEntityService,
		private noteUpdateService: NoteUpdateService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.getterService.getNote(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});

			const isModerator = await this.roleService.isModerator(me);
			const isAdministrator = await this.roleService.isAdministrator(me);

			// Check if user is the note author or has moderator/admin privileges
			if (note.userId !== me.id && !isModerator && !isAdministrator) {
				throw new ApiError(meta.errors.accessDenied);
			}

			// Moderators/admins can change visibility, but regular users cannot change it if they're not the author
			if (ps.visibility !== undefined && ps.visibility !== note.visibility && !isModerator && !isAdministrator) {
				throw new ApiError(meta.errors.accessDenied);
			}

			if (ps.text === undefined && ps.cw === undefined && ps.visibility === undefined && ps.fileIds === undefined && ps.poll === undefined && ps.localOnly === undefined) {
				throw new ApiError(meta.errors.invalidParam);
			}

			// Convert poll expiresAt timestamp to Date if provided
			let poll = undefined;
			if (ps.poll !== undefined) {
				if (ps.poll === null) {
					poll = null;
				} else {
					poll = {
						choices: ps.poll.choices,
						multiple: ps.poll.multiple ?? false,
						expiresAt: ps.poll.expiresAt ? new Date(ps.poll.expiresAt) : null,
					};
				}
			}

			// この操作を行うのが投稿者とは限らない(例えばモデレーター)ため
			const updatedNote = await this.noteUpdateService.update(await this.usersRepository.findOneByOrFail({ id: note.userId }), note, {
				cw: ps.cw,
				text: ps.text,
				visibility: ps.visibility,
				localOnly: ps.localOnly,
				fileIds: ps.fileIds,
				poll: poll,
				updatedAt: new Date(),
			}, false, me);

			return {
				updatedNote: await this.noteEntityService.pack(updatedNote, me),
			};
		});
	}
}
