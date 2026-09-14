<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<Mfm :text="deidentified ? i18n.ts.mutedUsers : (user.name ?? user.username)" :author="user" :plain="true" :nowrap="nowrap" :emojiUrls="user.emojis"/>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import * as Misskey from 'misskey-js';
import { prefer } from '@/preferences.js';
import { i18n } from '@/i18n.js';

const props = withDefaults(defineProps<{
	user: Misskey.entities.User;
	nowrap?: boolean;
}>(), {
	nowrap: true,
});

// bscone: de-identify muted users (isMuted only exists on UserDetailed)
const deidentified = computed(() => prefer.s.deidentifyMutedUsers && 'isMuted' in props.user && props.user.isMuted === true);
</script>
