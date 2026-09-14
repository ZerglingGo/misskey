/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// bscone: drop the fork-specific per-instance silence column; silencing now uses upstream meta.silencedHosts
export class RemoveInstanceIsSilenced1789412668129 {
	name = 'RemoveInstanceIsSilenced1789412668129'

	async up(queryRunner) {
		// carry over hosts silenced through the fork column into meta.silencedHosts (added by InstanceSilence1697247230117)
		await queryRunner.query(`UPDATE "meta" SET "silencedHosts" = ARRAY(SELECT DISTINCT h FROM unnest("silencedHosts" || ARRAY(SELECT "host" FROM "instance" WHERE "isSilenced" = TRUE)) AS h ORDER BY h)`);
		await queryRunner.query(`DROP INDEX "public"."IDX_99bb262237b9d1209eef4c1510"`);
		await queryRunner.query(`ALTER TABLE "instance" DROP COLUMN "isSilenced"`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "instance" ADD "isSilenced" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`CREATE INDEX "IDX_99bb262237b9d1209eef4c1510" ON "instance" ("isSilenced") `);
		await queryRunner.query(`UPDATE "instance" SET "isSilenced" = TRUE WHERE "host" = ANY(SELECT unnest("silencedHosts") FROM "meta")`);
	}
}
