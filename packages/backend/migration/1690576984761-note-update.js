export class NoteUpdate1690576984761 {
	name = 'NoteUpdate1690576984761'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "note" ADD "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT null`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "note" DROP COLUMN "updatedAt"`);
	}
}
