/*
 * SPDX-FileCopyrightText: syuilo and other misskey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { And, In, MoreThan, Not, Raw } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { NotesRepository, UserNotePiningsRepository, UsersRepository, NoteFavoritesRepository } from '@/models/_.js';
import type Logger from '@/logger.js';
import type { MiNote } from '@/models/Note.js';
import { bindThis } from '@/decorators.js';
import { NoteDeleteService } from '@/core/NoteDeleteService.js';
import { findOwnCascadingNoteIds } from '@/misc/find-own-cascading-note-ids.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import type * as Bull from 'bullmq';
import type { DbUserTruncateJobData } from '../types.js';

@Injectable()
export class TruncateAccountKeepDriveProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.userNotePiningsRepository)
		private userNotePiningsRepository: UserNotePiningsRepository,

		@Inject(DI.noteFavoritesRepository)
		private noteFavoritesRepository: NoteFavoritesRepository,

		private queueLoggerService: QueueLoggerService,
		private noteDeleteService: NoteDeleteService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('truncate-account-keep-drive');
	}

	@bindThis
	public async process(job: Bull.Job<DbUserTruncateJobData>): Promise<string | void> {
		this.logger.info(`Truncate notes (keep drive) of ${job.data.user.id} ...`);

		const user = await this.usersRepository.findOneBy({ id: job.data.user.id });
		if (user == null) {
			return;
		}

		const keepFavorites = job.data.keepFavorites ?? false;

		const pinings = await this.userNotePiningsRepository.findBy({ userId: user.id });
		const piningNoteIds = pinings.map(pining => pining.noteId);
		const cascadingPiningNoteIds = await findOwnCascadingNoteIds(this.notesRepository, user.id, piningNoteIds);

		const specifiedNotes = await this.notesRepository.findBy({
			userId: user.id,
			visibility: Not(In(['public', 'home', 'followers'])),
		});
		const specifiedNoteIds = specifiedNotes.map(note => note.id);
		const cascadingSpecifiedNoteIds = await findOwnCascadingNoteIds(this.notesRepository, user.id, specifiedNoteIds);

		// 즐겨찾기 보호 옵션이 켜져 있으면 즐겨찾기한 노트도 보호
		let favoriteNoteIds: MiNote['id'][] = [];
		let cascadingFavoriteNoteIds: MiNote['id'][] = [];
		if (keepFavorites) {
			const favorites = await this.noteFavoritesRepository.findBy({ userId: user.id });
			favoriteNoteIds = favorites.map(fav => fav.noteId);
			cascadingFavoriteNoteIds = await findOwnCascadingNoteIds(this.notesRepository, user.id, favoriteNoteIds);
			this.logger.info(`Found ${favoriteNoteIds.length} favorite notes to keep`);
		}

		const protectedNoteIds = [...piningNoteIds, ...cascadingPiningNoteIds, ...specifiedNoteIds, ...cascadingSpecifiedNoteIds, ...favoriteNoteIds, ...cascadingFavoriteNoteIds];
		// bscone: pass the protected IDs as one array parameter (NOT IN with many binds can exceed the parameter limit)
		const notInProtected = Raw(alias => `${alias} <> ALL(:protectedNoteIds)`, { protectedNoteIds });

		let cursor: MiNote['id'] | null = null;
		while (true) {
			const notes = await this.notesRepository.find({
				where: {
					userId: user.id,
					...(cursor ? {
						id: And(notInProtected, MoreThan(cursor)),
					} : {
						id: notInProtected,
					}),
				},
				take: 100,
				order: { id: 1 },
			}) as MiNote[];

			if (notes.length === 0) break;

			cursor = notes.at(-1)?.id ?? null;

			await Promise.all(notes.map((note) => this.noteDeleteService.delete(user, note, false, user)));
		}

		this.logger.succ('All of notes deleted (drive kept)');
		return 'Account notes truncated (drive kept)';
	}
}

