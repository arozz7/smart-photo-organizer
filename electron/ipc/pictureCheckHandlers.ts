import { getPictureCheckService } from '../core/services/PictureCheckDeps';
import { registerCheckHandlers } from './faceVisibilityHandlers';

/** Settings card for the background picture check (docs/plans/pictures-suggestions-plan.md, Phase C): `picturecheck:*`. */
export function registerPictureCheckHandlers() {
    registerCheckHandlers('picturecheck', getPictureCheckService);
}
