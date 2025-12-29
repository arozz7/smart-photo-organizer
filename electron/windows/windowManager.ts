import { BrowserWindow, globalShortcut, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import { getWindowBounds, setWindowBounds } from '../store';
import { setMainWindow } from '../services/pythonService';
import logger from '../logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const APP_ROOT = process.env.APP_ROOT || path.join(__dirname, '..'); // Adjusted: dist-electron -> root is just one level up
export const RENDERER_DIST = path.join(APP_ROOT, 'dist');
export const VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(APP_ROOT, 'public') : RENDERER_DIST;

export class WindowManager {
    private static win: BrowserWindow | null = null;
    private static splash: BrowserWindow | null = null;

    static async createSplashWindow() {
        this.splash = new BrowserWindow({
            width: 500,
            height: 300,
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            center: true,
            resizable: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        const splashFile = path.join(VITE_PUBLIC, 'splash.html');
        logger.info(`[WindowManager] Loading splash from: ${splashFile}`);

        try {
            await fs.access(splashFile);
            this.splash.loadFile(splashFile);
        } catch (e) {
            logger.error(`[WindowManager] Splash file not found at ${splashFile}:`, e);
            // Try loading URL if file access fails (e.g. dev server)
            if (VITE_DEV_SERVER_URL) {
                this.splash.loadURL(`${VITE_DEV_SERVER_URL}/splash.html`);
            }
        }

        this.splash.on('closed', () => (this.splash = null));

        logger.info('[WindowManager] Splash window created');
    }

    static updateSplashStatus(status: string) {
        if (this.splash && !this.splash.isDestroyed()) {
            const safeStatus = status.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
            this.splash.webContents.executeJavaScript(`
                  var el = document.getElementById('status');
                  if(el) el.innerText = '${safeStatus}';
              `).catch(() => { });
        }
    }

    static closeSplash() {
        if (this.splash && !this.splash.isDestroyed()) {
            this.splash.close();
            this.splash = null;
        }
    }

    static async createMainWindow() {
        const savedBounds = getWindowBounds();
        const defaults: { width: number; height: number; x?: number; y?: number } = { width: 1200, height: 800 };

        // Validate bounds
        let bounds = defaults;
        if (savedBounds && savedBounds.width && savedBounds.height) {
            const display = screen.getDisplayMatching({
                x: savedBounds.x || 0,
                y: savedBounds.y || 0,
                width: savedBounds.width,
                height: savedBounds.height
            });

            if (display) {
                if (savedBounds.x !== undefined && savedBounds.y !== undefined) {
                    bounds = { ...defaults, ...savedBounds };
                } else {
                    bounds = { ...defaults, width: savedBounds.width, height: savedBounds.height };
                }
            }
        }

        const preloadPath = path.join(__dirname, 'preload.mjs');

        this.win = new BrowserWindow({
            icon: path.join(VITE_PUBLIC, 'icon.png'),
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y,
            show: false, // Hide initially
            backgroundColor: '#111827', // Set dark background
            webPreferences: {
                preload: preloadPath,
                webSecurity: false,
            },
        });

        // Pass reference to PythonService (legacy requirement?)
        setMainWindow(this.win);

        // Save bounds on resize/move
        const saveBounds = () => {
            if (!this.win) return;
            const { x, y, width, height } = this.win.getBounds();
            setWindowBounds({ x, y, width, height });
        };

        this.win.on('resized', saveBounds);
        this.win.on('moved', saveBounds);
        this.win.on('close', saveBounds);

        // Remove the file menu
        this.win.setMenu(null);

        // Register DevTools shortcut on focus
        this.win.on('focus', () => {
            globalShortcut.register('CommandOrControl+Shift+I', () => {
                this.win?.webContents.toggleDevTools();
            });
        });

        // Unregister on blur
        this.win.on('blur', () => {
            globalShortcut.unregister('CommandOrControl+Shift+I');
        });

        this.win.once('ready-to-show', () => {
            this.win?.show();
            this.closeSplash();
        });

        // Test active push message to Renderer-process.
        this.win.webContents.on('did-finish-load', () => {
            this.win?.webContents.send('main-process-message', (new Date).toLocaleString())
        })

        if (VITE_DEV_SERVER_URL) {
            this.win.loadURL(VITE_DEV_SERVER_URL);
        } else {
            this.win.loadFile(path.join(RENDERER_DIST, 'index.html'));
        }

        logger.info('[WindowManager] Main window created');
        return this.win;
    }

    static getMainWindow() {
        return this.win;
    }
}
