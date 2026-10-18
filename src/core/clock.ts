export type Clock = () => number;

export const systemClock: Clock = () => performance.now();
