/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { setImmediate } from 'node:timers/promises';
import { In } from 'typeorm';
import * as mfm from 'mfm-js';
import { Injectable, Inject, OnApplicationShutdown } from '@nestjs/common';
import type { MiUser, MiLocalUser, MiRemoteUser } from '@/models/User.js';
import type { IMentionedRemoteUsers, MiNote } from '@/models/Note.js';
import type { InstancesRepository, NotesRepository, UsersRepository, NoteRevisionsRepository, PollsRepository, DriveFilesRepository, UserProfilesRepository } from '@/models/_.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import type { IPoll } from '@/models/Poll.js';
import { noteVisibilities } from '@/types.js';
import { MiPoll } from '@/models/Poll.js';
import { MiNoteRevision } from '@/models/NoteRevision.js';
import { RelayService } from '@/core/RelayService.js';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import NotesChart from '@/core/chart/charts/notes.js';
import PerUserNotesChart from '@/core/chart/charts/per-user-notes.js';
import InstanceChart from '@/core/chart/charts/instance.js';
import ActiveUsersChart from '@/core/chart/charts/active-users.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { ApDeliverManagerService } from '@/core/activitypub/ApDeliverManagerService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { bindThis } from '@/decorators.js';
import { DB_MAX_NOTE_TEXT_LENGTH } from '@/const.js';
import { MetaService } from '@/core/MetaService.js';
import { SearchService } from '@/core/SearchService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { FanoutTimelineService } from '@/core/FanoutTimelineService.js';
import { IdService } from '@/core/IdService.js';
import { extractCustomEmojisFromMfm } from '@/misc/extract-custom-emojis-from-mfm.js';
import { extractHashtags } from '@/misc/extract-hashtags.js';
import { normalizeForSearch } from '@/misc/normalize-for-search.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

type Option = {
	cw?: string | null;
	text?: string | null;
	visibility?: typeof noteVisibilities[number];
	fileIds?: MiDriveFile['id'][] | null;
	poll?: IPoll | null;
	localOnly?: boolean | null;
	updatedAt: Date;
};

@Injectable()
export class NoteUpdateService implements OnApplicationShutdown {
	#shutdownController = new AbortController();

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.instancesRepository)
		private instancesRepository: InstancesRepository,

		@Inject(DI.noteRevisionsRepository)
		private noteRevisionsRepository: NoteRevisionsRepository,

		@Inject(DI.pollsRepository)
		private pollsRepository: PollsRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private userEntityService: UserEntityService,
		private noteEntityService: NoteEntityService,
		private globalEventService: GlobalEventService,
		private relayService: RelayService,
		private federatedInstanceService: FederatedInstanceService,
		private apRendererService: ApRendererService,
		private apDeliverManagerService: ApDeliverManagerService,
		private metaService: MetaService,
		private searchService: SearchService,
		private moderationLogService: ModerationLogService,
		private notesChart: NotesChart,
		private perUserNotesChart: PerUserNotesChart,
		private instanceChart: InstanceChart,
		private activeUsersChart: ActiveUsersChart,
		private fanoutTimelineService: FanoutTimelineService,
		private idService: IdService,
	) { }

	@bindThis
	public async update(user: {
		id: MiUser['id'];
		uri: MiUser['uri'];
		host: MiUser['host'];
		username: MiUser['username'];
		isBot: MiUser['isBot'];
	}, note: MiNote, data: Option, silent = false, updater?: MiUser): Promise<MiNote> {
		const editorId = updater ? updater.id : user.id;

		// Validate and fetch files if fileIds are provided
		let files: MiDriveFile[] = [];
		if (data.fileIds !== undefined && data.fileIds !== null) {
			if (data.fileIds.length > 0) {
				files = await this.driveFilesRepository.createQueryBuilder('file')
					.where('file.userId = :userId AND file.id IN (:...fileIds)', {
						userId: note.userId,
						fileIds: data.fileIds,
					})
					.orderBy('array_position(ARRAY[:...fileIds], "id"::text)')
					.setParameters({ fileIds: data.fileIds })
					.getMany();

				if (files.length !== data.fileIds.length) {
					throw new IdentifiableError('801c046c-5bf5-4234-ad2b-e78fc20a2ac7', 'No such file');
				}
			}
		}

		// Validate poll if provided
		if (data.poll) {
			if (data.poll.expiresAt != null) {
				if (data.poll.expiresAt.getTime() < Date.now()) {
					throw new IdentifiableError('0c11c11e-0c8d-48e7-822c-76ccef660068', 'Poll expiration must be future time');
				}
			}
		}

		// Capture current state as a revision before updating
		await this.createRevision(note, editorId);

		if (data.visibility !== undefined) {
			await this.updateVisibilityCascadingNotes(note, data);
		}

		if (data.text) {
			if (data.text.length > DB_MAX_NOTE_TEXT_LENGTH) {
				data.text = data.text.slice(0, DB_MAX_NOTE_TEXT_LENGTH);
			}
			data.text = data.text.trim();
		}

		const updatedNote = await this.updateNote(note, data, files);

		this.globalEventService.publishNoteStream(note, 'updated', {
			cw: data.cw,
			text: data.text,
			visibility: data.visibility,
			updatedAt: data.updatedAt,
			fileIds: data.fileIds,
			hasPoll: data.poll !== undefined ? data.poll !== null : undefined,
		});

		setImmediate('post updating', { signal: this.#shutdownController.signal }).then(
			() => this.postNoteUpdated(updatedNote, user, silent),
			() => { /* aborted, ignore this */ },
		);

		// Update redis timeline
		if (data.visibility !== undefined) {
			if (data.visibility !== 'public') {
				const meta = await this.metaService.fetch();
				if (meta.enableFanoutTimeline) {
					this.fanoutTimelineService.remove('localTimeline', note.id);
					this.fanoutTimelineService.remove('localTimelineWithFiles', note.id);
					this.fanoutTimelineService.remove('localTimelineWithReplies', note.id);
				}
			}

			if (updater && (note.userId !== updater.id)) {
				const user = await this.usersRepository.findOneByOrFail({ id: note.userId });
				this.moderationLogService.log(updater, 'updateNote', {
					noteId: note.id,
					noteUserId: note.userId,
					noteUserUsername: user.username,
					noteUserHost: user.host,
					note: note,
				});
			}
		}

		return updatedNote;
	}

	@bindThis
	private async updateNote(note: MiNote, data: Option, files: MiDriveFile[]): Promise<MiNote> {
		const update: Partial<MiNote> = {
			updatedAt: data.updatedAt,
		};

		// Update text
		if (data.text !== undefined) {
			update.text = data.text;
		}

		// Update CW
		if (data.cw !== undefined) {
			update.cw = data.cw === null ? null : data.cw.trim();
		}

		// Update visibility
		if (data.visibility !== undefined) {
			update.visibility = data.visibility;
		}

		// Update localOnly
		if (data.localOnly !== undefined) {
			update.localOnly = data.localOnly ?? false;
		}

		// Update files
		if (data.fileIds !== undefined) {
			update.fileIds = data.fileIds ?? [];
			update.attachedFileTypes = files.map(file => file.type);
		}

		// Recompute derived fields based on updated content
		await this.recomputeDerivedFields(note, update, data);

		try {
			// Handle poll updates in a transaction
			if (data.poll !== undefined) {
				const existingPoll = await this.pollsRepository.findOneBy({ noteId: note.id });

				if (data.poll === null) {
					// Remove poll
					if (existingPoll) {
						await this.pollsRepository.delete({ noteId: note.id });
					}
					update.hasPoll = false;
				} else {
					// Add or update poll
					const pollData = {
						choices: data.poll.choices,
						expiresAt: data.poll.expiresAt,
						multiple: data.poll.multiple,
						noteVisibility: update.visibility ?? note.visibility,
						userId: note.userId,
						userHost: note.userHost,
						channelId: note.channelId,
					};

					if (existingPoll) {
						// Update existing poll
						await this.pollsRepository.update({ noteId: note.id }, {
							...pollData,
							votes: new Array(data.poll.choices.length).fill(0),
						});
					} else {
						// Create new poll
						const poll = new MiPoll({
							noteId: note.id,
							...pollData,
							votes: new Array(data.poll.choices.length).fill(0),
						});
						await this.pollsRepository.insert(poll);
					}
					update.hasPoll = true;
				}
			}

			await this.notesRepository.update({ id: note.id }, update);

			return await this.notesRepository.findOneByOrFail({ id: note.id });
		} catch (e) {
			console.error(e);

			throw e;
		}
	}

	@bindThis
	private async postNoteUpdated(note: MiNote, user: {
		id: MiUser['id'];
		uri: MiUser['uri'];
		host: MiUser['host'];
		username: MiUser['username'];
		isBot: MiUser['isBot'];
	}, silent: boolean) {
		if (!silent) {
			if (this.userEntityService.isLocalUser(user)) this.activeUsersChart.write(user);

			//#region AP deliver
			if (this.userEntityService.isLocalUser(user)) {
				(async () => {
					const noteActivity = await this.renderNoteActivity(user, note);

					// Skip deliver if local only notes
					if (noteActivity === null) {
						return;
					}

					this.deliverToConcerned(user, note, noteActivity);
				})();
			}
			//#endregion
		}

		this.reindex(note);
	}

	@bindThis
	private async deliverToConcerned(user: { id: MiLocalUser['id']; host: null; }, note: MiNote, content: any) {
		this.apDeliverManagerService.deliverToFollowers(user, content);
		this.relayService.deliverToRelays(user, content);
		const remoteUsers = await this.getMentionedRemoteUsers(note);
		for (const remoteUser of remoteUsers) {
			this.apDeliverManagerService.deliverToUser(user, content, remoteUser);
		}
	}

	@bindThis
	private async renderNoteActivity(user: { id: MiLocalUser['id']; }, note: MiNote) {
		// Skip local-only notes and specified visibility notes from federation
		if (note.localOnly) return null;
		if (note.visibility === 'specified') return null;

		const noteObject = await this.apRendererService.renderNote(note, false);
		const content = this.apRendererService.renderUpdate(noteObject, user);

		return this.apRendererService.addContext(content);
	}

	@bindThis
	private async getMentionedRemoteUsers(note: MiNote) {
		const where = [] as any[];

		// mention / reply / dm
		const uris = (JSON.parse(note.mentionedRemoteUsers) as IMentionedRemoteUsers).map(x => x.uri);
		if (uris.length > 0) {
			where.push(
				{ uri: In(uris) },
			);
		}

		// renote / quote
		if (note.renoteUserId) {
			where.push({
				id: note.renoteUserId,
			});
		}

		if (where.length === 0) return [];

		return await this.usersRepository.find({
			where,
		}) as MiRemoteUser[];
	}

	@bindThis
	private async updateVisibilityCascadingNotes(note: MiNote, data: Option): Promise<void> {
		const cascadingNotes = await this.findCascadingNotes(note);

		for (const cascadingNote of cascadingNotes) {
			if (cascadingNote.visibility === 'public' && data.visibility !== 'public') {
				this.globalEventService.publishNoteStream(cascadingNote, 'updated', {
					visibility: data.visibility,
					updatedAt: data.updatedAt,
				});

				await this.notesRepository.update({
					id: cascadingNote.id,
				}, {
					visibility: data.visibility,
					updatedAt: data.updatedAt,
				});
			}
		}
	}

	@bindThis
	private async findCascadingNotes(note: MiNote): Promise<MiNote[]> {
		const recursive = async (noteId: string): Promise<MiNote[]> => {
			const query = this.notesRepository.createQueryBuilder('note')
				.where('note.replyId = :noteId', { noteId })
				.orWhere('note.renoteId = :noteId', { noteId })
				.leftJoinAndSelect('note.user', 'user');
			const replies = await query.getMany();

			return [
				replies,
				...await Promise.all(replies.map(reply => recursive(reply.id))),
			].flat();
		};

		const cascadingNotes: MiNote[] = await recursive(note.id);

		return cascadingNotes;
	}

	@bindThis
	private async createRevision(note: MiNote, editorId: string): Promise<MiNoteRevision> {
		// Get current version number
		const latestRevision = await this.noteRevisionsRepository.findOne({
			where: { noteId: note.id },
			order: { version: 'DESC' },
		});

		const version = latestRevision ? latestRevision.version + 1 : 1;

		// Fetch poll data if note has poll
		let pollData = null;
		if (note.hasPoll) {
			const poll = await this.pollsRepository.findOneBy({ noteId: note.id });
			if (poll) {
				pollData = {
					choices: poll.choices,
					multiple: poll.multiple,
					expiresAt: poll.expiresAt,
				};
			}
		}

		// Create revision payload
		const payload = {
			text: note.text,
			cw: note.cw,
			fileIds: note.fileIds,
			visibility: note.visibility,
			visibleUserIds: note.visibleUserIds,
			localOnly: note.localOnly,
			reactionAcceptance: note.reactionAcceptance,
			poll: pollData,
			name: note.name,
			emojis: note.emojis,
			tags: note.tags,
			mentions: note.mentions,
			mentionedRemoteUsers: note.mentionedRemoteUsers,
		};

		// Create and save revision
		const revision = new MiNoteRevision({
			id: this.idService.gen(),
			noteId: note.id,
			editorId,
			version,
			createdAt: new Date(),
			payload,
		});

		await this.noteRevisionsRepository.insert(revision);

		return revision;
	}

	@bindThis
	private async recomputeDerivedFields(note: MiNote, update: Partial<MiNote>, data: Option): Promise<void> {
		// Recompute emojis and tags from text, cw, and poll
		const text = update.text ?? note.text;
		const cw = update.cw ?? note.cw;

		// Get poll choices for parsing
		let pollChoices: string[] = [];
		if (data.poll) {
			pollChoices = data.poll.choices;
		} else if (note.hasPoll && data.poll === undefined) {
			const existingPoll = await this.pollsRepository.findOneBy({ noteId: note.id });
			if (existingPoll) {
				pollChoices = existingPoll.choices;
			}
		}

		// Parse MFM tokens
		const tokens = text ? mfm.parse(text) : [];
		const cwTokens = cw ? mfm.parse(cw) : [];
		const choiceTokens = pollChoices.length > 0
			? pollChoices.flatMap(choice => mfm.parse(choice))
			: [];

		const combinedTokens = [...tokens, ...cwTokens, ...choiceTokens];

		// Extract emojis and tags
		update.emojis = extractCustomEmojisFromMfm(combinedTokens);
		update.tags = extractHashtags(combinedTokens)
			.filter(tag => Array.from(tag).length <= 128)
			.slice(0, 32)
			.map(tag => normalizeForSearch(tag));
	}

	@bindThis
	public async getRevisions(noteId: string): Promise<MiNoteRevision[]> {
		return await this.noteRevisionsRepository.find({
			where: { noteId },
			order: { version: 'DESC' },
		});
	}

	@bindThis
	private reindex(note: MiNote) {
		if (note.text == null && note.cw == null) return;

		this.searchService.unindexNote(note);
		this.searchService.indexNote(note);
	}

	@bindThis
	public dispose(): void {
		this.#shutdownController.abort();
	}

	@bindThis
	public onApplicationShutdown(signal?: string | undefined): void {
		this.dispose();
	}
}
