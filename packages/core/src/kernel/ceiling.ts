export class CeilingMet extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`ceiling met; ask again in ${retryAfterSeconds} seconds`);
    this.name = "CeilingMet";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
