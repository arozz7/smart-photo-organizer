export interface IService {
    start(): void | Promise<void>;
    stop(): Promise<void> | void;
}
