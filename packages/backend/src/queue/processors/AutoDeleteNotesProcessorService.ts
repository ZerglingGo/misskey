/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull, LessThan, Not, In, Raw } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { NotesRepository, UsersRepository, DriveFilesRepository } from '@/models/_.js';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { DriveService } from '@/core/DriveService.js';
import { NoteDeleteService } from '@/core/NoteDeleteService.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import type * as Bull from 'bullmq';

@Injectable()
export class AutoDeleteNotesProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private idService: IdService,
		private driveService: DriveService,
		private noteDeleteService: NoteDeleteService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('auto-delete-notes');
	}

	@bindThis
	public async process(job: Bull.Job<Record<string, unknown>>): Promise<{
		deletedCount: number;
		processedUsers: number;
	}> {
		this.logger.info('Starting auto-delete notes process...');

		const stats = {
			deletedCount: 0,
			processedUsers: 0,
		};

		// autoDeleteNotesAfterDays가 설정된 유저 찾기
		const usersWithAutoDelete = await this.usersRepository.findBy({
			autoDeleteNotesAfterDays: Not(IsNull()),
		});

		if (usersWithAutoDelete.length === 0) {
			this.logger.info('No users with auto-delete settings found.');
			return stats;
		}

		this.logger.info(`Found ${usersWithAutoDelete.length} users with auto-delete settings.`);

		// 각 유저별로 처리
		for (const user of usersWithAutoDelete) {
			try {
				const days = user.autoDeleteNotesAfterDays;
				if (days === null || days <= 0) continue;

				// 삭제 기준 날짜 계산
				const deleteBeforeDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
				const deleteBeforeId = this.idService.gen(deleteBeforeDate.getTime());

				this.logger.info(`Processing user ${user.id}: deleting notes older than ${days} days (before ${deleteBeforeDate.toISOString()})`);

				// 삭제할 노트 찾기
				const queryBuilder = this.notesRepository.createQueryBuilder('note')
					.where('note.userId = :userId', { userId: user.id })
					.andWhere('note.id < :deleteBeforeId', { deleteBeforeId });

				// 즐겨찾기 보호 설정이 켜져 있으면 즐겨찾기된 노트 제외
				if (user.autoDeleteKeepFavorites) {
					// bscone: only the owner's own favorites protect a note
					queryBuilder.andWhere('NOT EXISTS (SELECT 1 FROM note_favorite WHERE "noteId" = note.id AND "userId" = :userId)', { userId: user.id });
				}

				const notesToDelete = await queryBuilder
					.limit(1000) // 한 번에 최대 1000개씩 처리
					.getMany();

				if (notesToDelete.length > 0) {
					const noteIds = notesToDelete.map(note => note.id);

					// 드라이브 파일 삭제가 필요한 경우
					if (!user.autoDeleteKeepDriveFiles) {
						// 모든 노트의 fileIds를 수집
						const allFileIds = notesToDelete
							.flatMap(note => note.fileIds)
							.filter(fileId => fileId != null);

						if (allFileIds.length > 0) {
							try {
								// 각 파일이 다른 노트에서도 사용 중인지 확인 후 삭제
								const uniqueFileIds = [...new Set(allFileIds)];
								let deletedFilesCount = 0;

								for (const fileId of uniqueFileIds) {
									// 이 파일이 삭제 예정이 아닌 다른 노트에서도 사용되는지 확인
									const usageCount = await this.notesRepository.count({
										where: {
											userId: user.id,
											fileIds: Raw(alias => `${alias} @> ARRAY[:fileId]::varchar[]`, { fileId }),
											id: Not(In(noteIds)), // 삭제 대상이 아닌 노트에서
										},
									});

									// 다른 노트에서 사용하지 않는 파일만 삭제
									if (usageCount === 0) {
										try {
											const file = await this.driveFilesRepository.findOneBy({
												id: fileId,
												userId: user.id,
											});

											if (file) {
												await this.driveService.deleteFile(file);
												deletedFilesCount++;
											}
										} catch (fileError) {
											this.logger.error(`Failed to delete file ${fileId}: ${fileError}`);
										}
									} else {
										this.logger.info(`Skipping file ${fileId} (used by ${usageCount} other notes)`);
									}
								}

								this.logger.info(`Deleted ${deletedFilesCount} drive files for user ${user.id}`);
							} catch (fileError) {
								this.logger.error(`Error deleting files for user ${user.id}: ${fileError}`);
							}
						}
					}

					// NoteDeleteService를 사용하여 노트 삭제 (통계, 이벤트, 검색 인덱스, 연합 업데이트)
					for (const note of notesToDelete) {
						try {
							await this.noteDeleteService.delete(user, note, false); // quiet=false로 연합에도 반영
						} catch (noteError) {
							this.logger.error(`Failed to delete note ${note.id}: ${noteError}`);
						}
					}

					stats.deletedCount += notesToDelete.length;
					this.logger.info(`Deleted ${notesToDelete.length} notes for user ${user.id}`);
				} else {
					this.logger.info(`No notes to delete for user ${user.id}`);
				}

				stats.processedUsers++;
			} catch (error) {
				this.logger.error(`Error processing user ${user.id}: ${error}`);
				// 한 유저의 에러가 전체 프로세스를 막지 않도록 계속 진행
			}
		}

		this.logger.succ(`Auto-delete notes process completed. Processed ${stats.processedUsers} users, deleted ${stats.deletedCount} notes.`);

		return stats;
	}
}
