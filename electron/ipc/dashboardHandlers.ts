import { ipcMain } from 'electron';
import { DashboardRepository } from '../data/repositories/DashboardRepository';
import { ConfigService } from '../core/services/ConfigService';
import type { DashboardConfig } from '../core/services/ConfigService';

export function registerDashboardHandlers() {
    ipcMain.handle('dashboard:getOnThisDayPhotos', async (_, tolerance = 3) => {
        try {
            return { success: true, photos: DashboardRepository.getOnThisDayPhotos(tolerance) };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('dashboard:getStats', async () => {
        try {
            return { success: true, stats: DashboardRepository.getDashboardStats() };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('dashboard:getTopPeople', async (_, limit = 10) => {
        try {
            return { success: true, people: DashboardRepository.getTopPeople(limit) };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('dashboard:getRecentScans', async (_, limit = 12) => {
        try {
            return { success: true, photos: DashboardRepository.getRecentScans(limit) };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('dashboard:getFunFact', async () => {
        try {
            return { success: true, fact: DashboardRepository.getFunFact() };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('dashboard:getPhotoTimeline', async () => {
        try {
            return { success: true, data: DashboardRepository.getPhotoTimeline() };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('dashboard:getMonthlyBreakdown', async (_, year: number) => {
        try {
            return { success: true, data: DashboardRepository.getMonthlyBreakdown(year) };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('dashboard:getLibraryHealth', async () => {
        try {
            return { success: true, data: DashboardRepository.getLibraryHealth() };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    // Dashboard layout config
    ipcMain.handle('dashboard:getLayout', async () => {
        try {
            return { success: true, config: ConfigService.getDashboardConfig() };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('dashboard:saveLayout', async (_, config: Partial<DashboardConfig>) => {
        try {
            ConfigService.updateDashboardConfig(config);
            return { success: true };
        } catch (e) { return { success: false, error: String(e) }; }
    });
}
