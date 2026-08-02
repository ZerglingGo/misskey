/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { setTimeout } from 'node:timers/promises';
import { api, post, react, signup, waitFire } from '../utils.js';
import type * as misskey from 'misskey-js';

describe('Mute', () => {
	// alice mutes carol
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;
	let carol: misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
		carol = await signup({ username: 'carol' });

		// Mute: alice ==> carol
		await api('mute/create', {
			userId: carol.id,
		}, alice);
	}, 1000 * 60 * 2);

	test('ミュート作成', async () => {
		const res = await api('mute/create', {
			userId: bob.id,
		}, alice);

		assert.strictEqual(res.status, 204);

		// 単体でも走らせられるように副作用消す
		await api('mute/delete', {
			userId: bob.id,
		}, alice);
	});

	test('「自分宛ての投稿」にミュートしているユーザーの投稿が含まれない', async () => {
		const bobNote = await post(bob, { text: '@alice hi' });
		const carolNote = await post(carol, { text: '@alice hi' });

		const res = await api('notes/mentions', {}, alice);

		assert.strictEqual(res.status, 200);
		assert.strictEqual(Array.isArray(res.body), true);
		assert.strictEqual(res.body.some(note => note.id === bobNote.id), true);
		assert.strictEqual(res.body.some(note => note.id === carolNote.id), false);
	});

	test('ミュートしているユーザーからメンションされても、ストリームに unreadNotification イベントが流れてこない', async () => {
		// 状態リセット
		await api('notifications/mark-all-as-read', {}, alice);

		const fired = await waitFire(alice, 'main', () => post(carol, { text: '@alice hi' }), msg => msg.type === 'unreadNotification');

		assert.strictEqual(fired, false);
	});

	describe('Timeline', () => {
		test('タイムラインにミュートしているユーザーの投稿が含まれない', async () => {
			const aliceNote = await post(alice, { text: 'hi' });
			const bobNote = await post(bob, { text: 'hi' });
			const carolNote = await post(carol, { text: 'hi' });

			const res = await api('notes/local-timeline', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);
			assert.strictEqual(res.body.some(note => note.id === aliceNote.id), true);
			assert.strictEqual(res.body.some(note => note.id === bobNote.id), true);
			assert.strictEqual(res.body.some(note => note.id === carolNote.id), false);
		});

		test('タイムラインにミュートしているユーザーの投稿のRenoteが含まれない', async () => {
			const aliceNote = await post(alice, { text: 'hi' });
			const carolNote = await post(carol, { text: 'hi' });
			const bobNote = await post(bob, {
				renoteId: carolNote.id,
			});

			const res = await api('notes/local-timeline', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);
			assert.strictEqual(res.body.some(note => note.id === aliceNote.id), true);
			assert.strictEqual(res.body.some(note => note.id === bobNote.id), false);
			assert.strictEqual(res.body.some(note => note.id === carolNote.id), false);
		});
	});

	describe('Notification', () => {
		test('通知にミュートしているユーザーの通知が含まれない(リアクション)', async () => {
			const aliceNote = await post(alice, { text: 'hi' });
			await react(bob, aliceNote, 'like');
			await react(carol, aliceNote, 'like');

			const res = await api('i/notifications', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);
		});

		test('通知にミュートしているユーザーからのリプライが含まれない', async () => {
			const aliceNote = await post(alice, { text: 'hi' });
			await post(bob, { text: '@alice hi', replyId: aliceNote.id });
			await post(carol, { text: '@alice hi', replyId: aliceNote.id });

			const res = await api('i/notifications', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);

			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);
		});

		test('通知にミュートしているユーザーからのリプライが含まれない', async () => {
			await post(alice, { text: 'hi' });
			await post(bob, { text: '@alice hi' });
			await post(carol, { text: '@alice hi' });

			const res = await api('i/notifications', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);

			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);
		});

		test('通知にミュートしているユーザーからの引用リノートが含まれない', async () => {
			const aliceNote = await post(alice, { text: 'hi' });
			await post(bob, { text: 'hi', renoteId: aliceNote.id });
			await post(carol, { text: 'hi', renoteId: aliceNote.id });

			const res = await api('i/notifications', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);

			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);
		});

		test('通知にミュートしているユーザーからのリノートが含まれない', async () => {
			const aliceNote = await post(alice, { text: 'hi' });
			await post(bob, { renoteId: aliceNote.id });
			await post(carol, { renoteId: aliceNote.id });

			const res = await api('i/notifications', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);

			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);
		});

		test('通知にミュートしているユーザーからのフォロー通知が含まれない', async () => {
			await api('following/create', { userId: alice.id }, bob);
			await api('following/create', { userId: alice.id }, carol);

			const res = await api('i/notifications', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);

			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);

			await api('following/delete', { userId: alice.id }, bob);
			await api('following/delete', { userId: alice.id }, carol);
		});

		test('通知にミュートしているユーザーからのフォローリクエストが含まれない', async () => {
			await api('i/update', { isLocked: true }, alice);
			await api('following/create', { userId: alice.id }, bob);
			await api('following/create', { userId: alice.id }, carol);

			const res = await api('i/notifications', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);

			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);

			await api('following/delete', { userId: alice.id }, bob);
			await api('following/delete', { userId: alice.id }, carol);
		});
	});

	describe('Notification (Grouped)', () => {
		test('通知にミュートしているユーザーの通知が含まれない(リアクション)', async () => {
			const aliceNote = await post(alice, { text: 'hi' });
			await react(bob, aliceNote, 'like');
			await react(carol, aliceNote, 'like');

			const res = await api('i/notifications-grouped', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);
		});
		test('通知にミュートしているユーザーからのリプライが含まれない', async () => {
			const aliceNote = await post(alice, { text: 'hi' });
			await post(bob, { text: '@alice hi', replyId: aliceNote.id });
			await post(carol, { text: '@alice hi', replyId: aliceNote.id });

			const res = await api('i/notifications-grouped', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);

			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);
		});

		test('通知にミュートしているユーザーからのリプライが含まれない', async () => {
			await post(alice, { text: 'hi' });
			await post(bob, { text: '@alice hi' });
			await post(carol, { text: '@alice hi' });

			const res = await api('i/notifications-grouped', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);

			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);
		});

		test('通知にミュートしているユーザーからの引用リノートが含まれない', async () => {
			const aliceNote = await post(alice, { text: 'hi' });
			await post(bob, { text: 'hi', renoteId: aliceNote.id });
			await post(carol, { text: 'hi', renoteId: aliceNote.id });

			const res = await api('i/notifications-grouped', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);

			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);
		});

		test('通知にミュートしているユーザーからのリノートが含まれない', async () => {
			const aliceNote = await post(alice, { text: 'hi' });
			await post(bob, { renoteId: aliceNote.id });
			await post(carol, { renoteId: aliceNote.id });

			const res = await api('i/notifications-grouped', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);

			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);
		});

		test('通知にミュートしているユーザーからのフォロー通知が含まれない', async () => {
			await api('following/create', { userId: alice.id }, bob);
			await api('following/create', { userId: alice.id }, carol);

			const res = await api('i/notifications-grouped', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);

			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);

			await api('following/delete', { userId: alice.id }, bob);
			await api('following/delete', { userId: alice.id }, carol);
		});

		test('通知にミュートしているユーザーからのフォローリクエストが含まれない', async () => {
			await api('i/update', { isLocked: true }, alice);
			await api('following/create', { userId: alice.id }, bob);
			await api('following/create', { userId: alice.id }, carol);

			const res = await api('i/notifications-grouped', {}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);

			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === bob.id), true);
			assert.strictEqual(res.body.some(notification => 'userId' in notification && notification.userId === carol.id), false);
		});

		test('ミュート前に作成されたグループ化リアクション通知からミュートしたユーザーが除外される', async () => {
			const dave = await signup();
			const eve = await signup();
			const aliceNote = await post(alice, { text: 'hi' });
			await react(bob, aliceNote, 'like');
			await react(dave, aliceNote, 'like');
			await react(eve, aliceNote, 'like');

			// NotificationService#createNotification は非同期なので、通知がRedisに追加されるのを待つ
			await setTimeout(100);

			const beforeMute = await api('i/notifications-grouped', {
				limit: 100,
				markAsRead: false,
			}, alice);
			const beforeMuteGrouped = beforeMute.body.find(notification => notification.type === 'reaction:grouped' && notification.note.id === aliceNote.id);

			if (beforeMuteGrouped?.type !== 'reaction:grouped') {
				assert.fail('expected a grouped reaction notification before muting');
			}
			assert.strictEqual(beforeMuteGrouped.reactions.some(reaction => reaction.user.id === bob.id), true);
			assert.strictEqual(beforeMuteGrouped.reactions.some(reaction => reaction.user.id === dave.id), true);
			assert.strictEqual(beforeMuteGrouped.reactions.some(reaction => reaction.user.id === eve.id), true);

			let daveMuted = false;
			try {
				const muteResult = await api('mute/create', { userId: dave.id }, alice);
				daveMuted = muteResult.status === 204;
				assert.strictEqual(muteResult.status, 204);

				const afterMute = await api('i/notifications-grouped', {
					limit: 100,
					markAsRead: false,
				}, alice);
				const afterMuteGrouped = afterMute.body.find(notification => notification.type === 'reaction:grouped' && notification.note.id === aliceNote.id);

				if (afterMuteGrouped?.type !== 'reaction:grouped') {
					assert.fail('expected the grouped reaction notification to remain after filtering');
				}
				assert.strictEqual(afterMuteGrouped.reactions.some(reaction => reaction.user.id === bob.id), true);
				assert.strictEqual(afterMuteGrouped.reactions.some(reaction => reaction.user.id === dave.id), false);
				assert.strictEqual(afterMuteGrouped.reactions.some(reaction => reaction.user.id === eve.id), true);
			} finally {
				if (daveMuted) {
					await api('mute/delete', { userId: dave.id }, alice);
				}
			}
		});

		test('リモートのミュートユーザー表示設定が通知とリアクション一覧に適用される', async () => {
			const remote = await signup({ host: 'remote.example.test' });
			const eve = await signup();
			const aliceNote = await post(alice, { text: 'hi' });
			await react(bob, aliceNote, 'like');
			await react(remote, aliceNote, 'like');
			await react(eve, aliceNote, 'like');

			assert.strictEqual(remote.host, 'remote.example.test');

			// NotificationService#createNotification は非同期なので、通知がRedisに追加されるのを待つ
			await setTimeout(100);

			const beforeMute = await api('i/notifications-grouped', {
				limit: 100,
				markAsRead: false,
			}, alice);
			const beforeMuteGrouped = beforeMute.body.find(notification => notification.type === 'reaction:grouped' && notification.note.id === aliceNote.id);

			if (beforeMuteGrouped?.type !== 'reaction:grouped') {
				assert.fail('expected a grouped reaction notification before muting');
			}
			assert.strictEqual(beforeMuteGrouped.reactions.some(reaction => reaction.user.id === remote.id), true);

			let remoteMuted = false;
			try {
				const muteResult = await api('mute/create', { userId: remote.id }, alice);
				remoteMuted = muteResult.status === 204;
				assert.strictEqual(muteResult.status, 204);

				const hiddenReactions = await api('notes/reactions', {
					noteId: aliceNote.id,
					limit: 100,
				}, alice);
				assert.strictEqual(hiddenReactions.status, 200);
				assert.strictEqual(hiddenReactions.body.some(reaction => reaction.user.id === bob.id), true);
				assert.strictEqual(hiddenReactions.body.some(reaction => reaction.user.id === remote.id), false);
				assert.strictEqual(hiddenReactions.body.some(reaction => reaction.user.id === eve.id), true);

				const hiddenNotifications = await api('i/notifications-grouped', {
					limit: 100,
					markAsRead: false,
				}, alice);
				const afterMuteGrouped = hiddenNotifications.body.find(notification => notification.type === 'reaction:grouped' && notification.note.id === aliceNote.id);

				if (afterMuteGrouped?.type !== 'reaction:grouped') {
					assert.fail('expected the grouped reaction notification to remain after filtering');
				}
				assert.strictEqual(afterMuteGrouped.reactions.some(reaction => reaction.user.id === bob.id), true);
				assert.strictEqual(afterMuteGrouped.reactions.some(reaction => reaction.user.id === remote.id), false);
				assert.strictEqual(afterMuteGrouped.reactions.some(reaction => reaction.user.id === eve.id), true);

				const disableHiding = await api('i/update', { hideMutedUsers: false }, alice);
				assert.strictEqual(disableHiding.status, 200);
				assert.strictEqual(disableHiding.body.hideMutedUsers, false);

				const visibleReactions = await api('notes/reactions', {
					noteId: aliceNote.id,
					limit: 100,
				}, alice);
				assert.strictEqual(visibleReactions.status, 200);
				assert.strictEqual(visibleReactions.body.some(reaction => reaction.user.id === bob.id), true);
				assert.strictEqual(visibleReactions.body.some(reaction => reaction.user.id === remote.id), true);
				assert.strictEqual(visibleReactions.body.some(reaction => reaction.user.id === eve.id), true);

				const visibleNotifications = await api('i/notifications-grouped', {
					limit: 100,
					markAsRead: false,
				}, alice);
				const visibleGrouped = visibleNotifications.body.find(notification => notification.type === 'reaction:grouped' && notification.note.id === aliceNote.id);

				if (visibleGrouped?.type !== 'reaction:grouped') {
					assert.fail('expected the grouped reaction notification after disabling hiding');
				}
				assert.strictEqual(visibleGrouped.reactions.some(reaction => reaction.user.id === bob.id), true);
				assert.strictEqual(visibleGrouped.reactions.some(reaction => reaction.user.id === remote.id), true);
				assert.strictEqual(visibleGrouped.reactions.some(reaction => reaction.user.id === eve.id), true);

				const newNote = await post(alice, { text: 'hi' });
				await react(bob, newNote, 'like');
				await react(remote, newNote, 'like');
				await setTimeout(100);

				const visibleIndividualNotifications = await api('i/notifications', {
					limit: 100,
					markAsRead: false,
				}, alice);
				assert.strictEqual(visibleIndividualNotifications.status, 200);
				assert.strictEqual(visibleIndividualNotifications.body.some(notification => notification.type === 'reaction' && notification.note.id === newNote.id && notification.userId === bob.id), true);
				assert.strictEqual(visibleIndividualNotifications.body.some(notification => notification.type === 'reaction' && notification.note.id === newNote.id && notification.userId === remote.id), true);

				const enableHiding = await api('i/update', { hideMutedUsers: true }, alice);
				assert.strictEqual(enableHiding.status, 200);
				assert.strictEqual(enableHiding.body.hideMutedUsers, true);

				const hiddenAgainReactions = await api('notes/reactions', {
					noteId: aliceNote.id,
					limit: 100,
				}, alice);
				assert.strictEqual(hiddenAgainReactions.status, 200);
				assert.strictEqual(hiddenAgainReactions.body.some(reaction => reaction.user.id === bob.id), true);
				assert.strictEqual(hiddenAgainReactions.body.some(reaction => reaction.user.id === remote.id), false);
				assert.strictEqual(hiddenAgainReactions.body.some(reaction => reaction.user.id === eve.id), true);

				const hiddenAgainNotifications = await api('i/notifications', {
					limit: 100,
					markAsRead: false,
				}, alice);
				assert.strictEqual(hiddenAgainNotifications.status, 200);
				assert.strictEqual(hiddenAgainNotifications.body.some(notification => notification.type === 'reaction' && notification.note.id === newNote.id && notification.userId === bob.id), true);
				assert.strictEqual(hiddenAgainNotifications.body.some(notification => notification.type === 'reaction' && notification.note.id === newNote.id && notification.userId === remote.id), false);

				const showAgain = await api('i/update', { hideMutedUsers: false }, alice);
				assert.strictEqual(showAgain.status, 200);
				assert.strictEqual(showAgain.body.hideMutedUsers, false);

				const visibleAgainReactions = await api('notes/reactions', {
					noteId: aliceNote.id,
					limit: 100,
				}, alice);
				assert.strictEqual(visibleAgainReactions.status, 200);
				assert.strictEqual(visibleAgainReactions.body.some(reaction => reaction.user.id === remote.id), true);

				const visibleAgainNotifications = await api('i/notifications', {
					limit: 100,
					markAsRead: false,
				}, alice);
				assert.strictEqual(visibleAgainNotifications.status, 200);
				assert.strictEqual(visibleAgainNotifications.body.some(notification => notification.type === 'reaction' && notification.note.id === newNote.id && notification.userId === remote.id), true);
			} finally {
				try {
					await api('i/update', { hideMutedUsers: true }, alice);
				} finally {
					if (remoteMuted) {
						await api('mute/delete', { userId: remote.id }, alice);
					}
				}
			}
		});
	});

	describe('Reactions', () => {
		test('ミュートしているユーザーがリアクション一覧に含まれない', async () => {
			const aliceNote = await post(alice, { text: 'hi' });
			await react(bob, aliceNote, 'like');
			await react(carol, aliceNote, 'like');

			const res = await api('notes/reactions', {
				noteId: aliceNote.id,
				limit: 100,
			}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.some(reaction => reaction.user.id === bob.id), true);
			assert.strictEqual(res.body.some(reaction => reaction.user.id === carol.id), false);
		});
	});
});
