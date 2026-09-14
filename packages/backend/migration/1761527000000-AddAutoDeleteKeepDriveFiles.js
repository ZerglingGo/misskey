/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddAutoDeleteKeepDriveFiles1761527000000 {
    name = 'AddAutoDeleteKeepDriveFiles1761527000000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" ADD "autoDeleteKeepDriveFiles" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`COMMENT ON COLUMN "user"."autoDeleteKeepDriveFiles" IS 'Keep drive files when auto-deleting notes'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`COMMENT ON COLUMN "user"."autoDeleteKeepDriveFiles" IS 'Keep drive files when auto-deleting notes'`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "autoDeleteKeepDriveFiles"`);
    }
}
