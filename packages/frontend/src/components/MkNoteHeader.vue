<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<header :class="$style.root">
	<div v-if="mock" :class="$style.name">
		<MkUserName :user="note.user"/>
	</div>
	<MkA v-else v-user-preview="note.user.id" :class="$style.name" :to="userPage(note.user)">
		<MkUserName :user="note.user"/>
	</MkA>
	<div v-if="note.user.isBot" :class="$style.isBot">bot</div>
	<div :class="$style.username"><MkAcct :user="note.user"/></div>
	<div v-if="note.user.badgeRoles" :class="$style.badgeRoles">
		<img v-for="(role, i) in note.user.badgeRoles" :key="i" v-tooltip="role.name" :class="$style.badgeRole" :src="role.iconUrl!"/>
	</div>
	<div :class="$style.info">
		<button
			v-if="updatedAt && !mock"
			class="_button"
			:class="$style.editedButton"
			style="margin-right: 0.5em;"
			:title="i18n.ts.viewEditHistory"
			@click.stop="showEditHistory"
		>
			<i class="ti ti-pencil"></i>
		</button>
		<span v-else-if="updatedAt" style="margin-right: 0.5em;" :title="i18n.ts.edited"><i class="ti ti-pencil"></i></span>
		<div v-if="mock">
			<MkTime :time="note.createdAt" colored/>
		</div>
		<MkA v-else :to="notePage(note)">
			<MkTime :time="note.createdAt" colored/>
		</MkA>
		<span v-if="visibility !== 'public'" style="margin-left: 0.5em;" :title="i18n.ts._visibility[visibility]">
			<i v-if="visibility === 'home'" class="ti ti-home"></i>
			<i v-else-if="visibility === 'followers'" class="ti ti-lock"></i>
			<i v-else-if="visibility === 'specified'" ref="specified" class="ti ti-mail"></i>
		</span>
		<span v-if="note.localOnly" style="margin-left: 0.5em;" :title="i18n.ts._visibility['disableFederation']"><i class="ti ti-rocket-off"></i></span>
		<span v-if="note.channel" style="margin-left: 0.5em;" :title="note.channel.name"><i class="ti ti-device-tv"></i></span>
	</div>
</header>
</template>

<script lang="ts" setup>
import { inject, defineAsyncComponent, computed } from 'vue';
import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import { notePage } from '@/filters/note.js';
import { userPage } from '@/filters/user.js';
import { DI } from '@/di.js';
import * as os from '@/os.js';

const props = defineProps<{
	note: Misskey.entities.Note;
	updatedAt?: string | null;
	visibility?: Misskey.entities.Note['visibility'];
}>();

const mock = inject(DI.mock, false);

// bscone: visibility can change through note editing, so keep it reactive
const visibility = computed(() => props.visibility ?? props.note.visibility);

function showEditHistory() {
	if (mock) return;

	os.popup(
		defineAsyncComponent(() => import('@/components/MkNoteEditHistoryDialog.vue')),
		{
			noteId: props.note.id,
			currentNote: props.note,
		},
	);
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	align-items: baseline;
	white-space: nowrap;
}

.name {
	flex-shrink: 1;
	display: block;
	margin: 0 .5em 0 0;
	padding: 0;
	overflow: hidden;
	font-size: 1em;
	font-weight: bold;
	text-decoration: none;
	text-overflow: ellipsis;

	&:hover {
		text-decoration: underline;
	}
}

.isBot {
	flex-shrink: 0;
	align-self: center;
	margin: 0 .5em 0 0;
	padding: 1px 6px;
	font-size: 80%;
	border: solid 0.5px var(--MI_THEME-divider);
	border-radius: 3px;
}

.username {
	flex-shrink: 9999999;
	margin: 0 .5em 0 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.info {
	flex-shrink: 0;
	margin-left: auto;
	font-size: 0.9em;
}

.editedButton {
	padding: 0;
	opacity: 0.7;
	transition: opacity 0.2s;

	&:hover {
		opacity: 1;
		text-decoration: underline;
	}
}

.badgeRoles {
	margin: 0 .5em 0 0;
}

.badgeRole {
	height: 1.3em;
	vertical-align: -20%;

	& + .badgeRole {
		margin-left: 0.2em;
	}
}
</style>
