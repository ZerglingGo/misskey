/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class InstanceSilence1690280117923 {
	name = 'InstanceSilence1690280117923'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "instance" ADD "isSilenced" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`CREATE INDEX "IDX_99bb262237b9d1209eef4c1510" ON "instance" ("isSilenced")`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "IDX_99bb262237b9d1209eef4c1510"`, undefined);
		await queryRunner.query(`ALTER TABLE "instance" DROP COLUMN "isSilenced"`);
	}
}
