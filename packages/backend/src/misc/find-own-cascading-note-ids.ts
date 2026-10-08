/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { NotesRepository } from '@/models/_.js';
import type { MiNote } from '@/models/Note.js';
import type { MiUser } from '@/models/User.js';

// bscone: same as the maximum of notes/conversation
export const CASCADING_NOTES_MAX_DEPTH = 100;

/**
 * bscone: walks the reply / quote tree below `rootIds` in a single recursive query (up to CASCADING_NOTES_MAX_DEPTH levels)
 * and returns only the IDs of notes owned by `userId`, since only those are relevant when truncating that user's notes.
 */
export async function findOwnCascadingNoteIds(
	notesRepository: NotesRepository,
	userId: MiUser['id'],
	rootIds: MiNote['id'][],
): Promise<MiNote['id'][]> {
	if (rootIds.length === 0) return [];

	const rows: { id: MiNote['id'] }[] = await notesRepository.query(`
		WITH RECURSIVE tree(id, "userId", depth) AS (
			SELECT n.id, n."userId", 1
			FROM note n
			WHERE n."replyId" = ANY($1) OR (n."renoteId" = ANY($1) AND n.text IS NOT NULL)
		UNION
			SELECT child.id, child."userId", tree.depth + 1
			FROM tree
			CROSS JOIN LATERAL (
				SELECT n.id, n."userId" FROM note n WHERE n."replyId" = tree.id
				UNION ALL
				SELECT n.id, n."userId" FROM note n WHERE n."renoteId" = tree.id AND n.text IS NOT NULL
			) child
			WHERE tree.depth < $3
		)
		SELECT DISTINCT id FROM tree WHERE "userId" = $2
	`, [rootIds, userId, CASCADING_NOTES_MAX_DEPTH]);

	return rows.map(row => row.id);
}
