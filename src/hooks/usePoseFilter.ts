import { useState, useCallback } from 'react';
import { Face } from '../types';

export type PoseFilterMode = 'all' | 'frontal' | 'profile';

export function usePoseFilter() {
    const [mode, setMode] = useState<PoseFilterMode>('all');

    const filterByPose = useCallback((faces: Face[]): Face[] => {
        if (mode === 'all') return faces;
        return faces.filter(f => {
            const absYaw = Math.abs(f.pose_yaw ?? 0);
            if (mode === 'frontal') return absYaw <= 30;
            if (mode === 'profile') return absYaw > 45;
            return true;
        });
    }, [mode]);

    return { mode, setMode, filterByPose };
}
