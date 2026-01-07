export interface QueueConfig {
    batchSize: number
    cooldownSeconds: number
}

export interface EraConfig {
    minFacesForEra: number
    eraMergeThreshold: number
}
