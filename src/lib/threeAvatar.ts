// Compatibility layer for the vendored `three-avatar-main` source.
//
// We intentionally do NOT import its `src/index.ts` because that file re-exports
// TypeScript type-only symbols as runtime exports, which Turbopack rejects.

import type * as THREE from "three";
import { Avatar } from "../../three-avatar-main/three-avatar-main/src/avatar";
import type { AvatarOptions } from "../../three-avatar-main/three-avatar-main/src/avatar";
import {
	loadAvatarModel,
	isAnimationDataLoaded,
	preLoadAnimationData,
} from "../../three-avatar-main/three-avatar-main/src/loader";
import type {
	AvatarAnimationDataSource,
	DecordersOptions,
} from "../../three-avatar-main/three-avatar-main/src/loader";
import { Blinker } from "../../three-avatar-main/three-avatar-main/src/ext/blinker";

export type { Avatar, AvatarOptions };
export type { AvatarAnimationDataSource, DecordersOptions };

export { isAnimationDataLoaded, preLoadAnimationData, loadAvatarModel };

export interface CreateAvatarOptions extends DecordersOptions, AvatarOptions {
	isInvisibleFirstPerson?: boolean;
	isLowSpecMode?: boolean;
}

export function setDefaultExtensions(avatar: Avatar): void {
	avatar.addExtension(new Blinker());
}

export async function createAvatar(
	avatarData: Uint8Array,
	renderer: THREE.WebGLRenderer,
	frustumCulled?: boolean,
	options?: CreateAvatarOptions
): Promise<Avatar> {
	const model = await loadAvatarModel(avatarData, renderer, frustumCulled, options);
	const res = new Avatar(model, options);
	if (options?.isInvisibleFirstPerson) {
		res.invisibleFirstPerson();
	}
	res.object3D.updateMatrixWorld();
	setDefaultExtensions(res);
	if (options?.isLowSpecMode) {
		if (res.vrm) {
			type UnsafeVrm = {
				springBoneManager?: object;
			};
			delete (res.vrm as UnsafeVrm).springBoneManager;
		}
	}
	return res;
}
