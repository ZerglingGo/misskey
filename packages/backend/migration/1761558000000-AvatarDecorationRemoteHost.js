/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AvatarDecorationRemoteHost1761558000000 {
	name = 'AvatarDecorationRemoteHost1761558000000'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "avatar_decoration" ADD "remoteId" varchar(32)`);
		await queryRunner.query(`ALTER TABLE "avatar_decoration" ADD "host" varchar(128)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "avatar_decoration" DROP COLUMN "host"`);
		await queryRunner.query(`ALTER TABLE "avatar_decoration" DROP COLUMN "remoteId"`);
	}
}

