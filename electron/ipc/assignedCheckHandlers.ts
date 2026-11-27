import { getAssignedVisibilityService } from '../core/services/AssignedVisibilityDeps';
import { registerCheckHandlers } from './faceVisibilityHandlers';

/** Settings card for the background check of faces assigned to people (doubtful faces): `assignedcheck:*`. */
export function registerAssignedCheckHandlers() {
    registerCheckHandlers('assignedcheck', getAssignedVisibilityService);
}
