/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddHideMutedUsers1785542400000 {
    name = 'AddHideMutedUsers1785542400000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "hideMutedUsers" boolean NOT NULL DEFAULT true`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "hideMutedUsers"`);
    }
}
