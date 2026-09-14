/*
 * SPDX-FileCopyrightText: syuilo and other misskey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { UsersRepository } from '@/models/_.js';
import { QueueService } from '@/core/QueueService.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';

@Injectable()
export class TruncateAccountKeepDriveService {
  constructor(
    @Inject(DI.usersRepository)
    private usersRepository: UsersRepository,

    private queueService: QueueService,
  ) {
  }

  @bindThis
  public async truncateAccountKeepDrive(user: {
    id: string;
    host: string | null;
  }, keepFavorites: boolean = false): Promise<void> {
    await this.usersRepository.findOneByOrFail({ id: user.id });

    this.queueService.createTruncateAccountKeepDriveJob(user, { keepFavorites });
  }
}

